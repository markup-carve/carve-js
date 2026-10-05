# Large document ID traversal follow-up

Measured on Node 22.22.2 and an AMD Ryzen 9 PRO 7940HS with 16 logical CPUs.
The baseline is current main, `a0e996083129b9d51e63be6982d79843fd35ea32`.
Inputs contain 49,270 and 520,855 bytes. [Raw observations](large-owned-ast-followup.json)
retain fixture hashes, build hashes, individual samples and host load.

## Investigation

The earlier 3–8% composed-conversion slowdown did not consistently reproduce
on a quieter host. Compared with the pre-#2492 baseline, current main was 1.7%
slower in one large-document round and 3.1% faster in the other. Current main
includes #2493, so these measurements describe today's code rather than
isolating #2492. Large-document ID collection remained 7–17% slower in that initial run.

Separate CPU profiles on current main identified ID traversal as a cost in
resolution and rendering: the visitor accounted for about 19% and 18% of
samples respectively, and 83% of ID-collection samples. The profiler used
20 calls per phase; resolution inputs were parsed before profiling, and
rendering and collection reused a resolved document. Profiling timings are
not the paired wall-time results. [Full profiles](large-owned-ast-profile.json.gz)
retain samples and call trees.

## Change

Empty arrays and arrays containing one text node without attributes bypass
the cycle set. Those children were already skipped by the visitor. Plain text
also bypasses a redundant schema lookup. Arrays with structural children or
attributes retain traversal and cycle checks. Every call examines current
attributes, so adding an ID after resolution still reserves it.

The schema test pins text as a leaf. Regression tests cover adding and removing
an ID on a single text child after resolution and a self-referencing array.

## Results

Milliseconds per call, rounds 1 and 2. Each round uses separate workers;
order reverses from baseline/candidate to candidate/baseline. Render and
composed-conversion rows use `fixedVersusCurrent`; ID rows use the longer
`longIdRun`. The initial five-batch large-document ID results were unchanged
in the first round and 9.4% faster in the second; both are retained in the JSON.

| Input | Operation | Baseline, rounds 1 / 2 | Candidate, rounds 1 / 2 |
|---|---|---:|---:|
| carve.crv | render | 2.113 / 1.929 | 1.818 / 1.920 |
| carve.crv | owned | 15.208 / 15.609 | 15.960 / 14.967 |
| carve.crv | ids | 0.597 / 0.622 | 0.454 / 0.478 |
| large.crv | render | 54.998 / 55.351 | 51.389 / 52.875 |
| large.crv | owned | 612.240 / 609.537 | 607.172 / 607.683 |
| large.crv | ids | 11.014 / 11.139 | 10.189 / 9.837 |

Large-document ID collection improves 7.5–11.7%; the comparison input improves
23.1–23.9%. Large-document rendering improves 4.5–6.6%. Composed conversion
improves only 0.3–0.8% on the large input, while the smaller input is mixed.
Those end-to-end differences do not establish a throughput gain. Parsing still
dominates the pipeline. These remain shared-host observations, not CI thresholds.

Even batch counts use the average of the two middle samples; the recorded
20-batch medians were recomputed from their raw samples after correcting the
benchmark harness.
ID measurements use 100 warm-up calls and 20 batches of 20 calls per worker.
Other modes use ten warm-up calls and five batches: thirty calls per batch on
the comparison input, five on the large input. Tests and builds ran separately
from timing. Load values are recorded per worker.

## Verification and reproduction

32,627 tests passed, with 113 skipped. Type and lint checks passed.
All 5,215 corpus and generated inputs preserve full ASTs, position-free ASTs
and HTML against current main. Local Claude review found no correctness
regression; its requested text-leaf schema guard was added.

Build a clean baseline checkout and the candidate, then run:

```sh
npm run build
node scripts/check-parser-costs.mjs /path/to/baseline/dist/index.js
node scripts/bench-owned-ast.mjs /path/to/baseline/dist/index.js /path/to/carve-bench/corpus/comparison/carve.crv /path/to/carve-bench/corpus/large.crv render owned ids
CARVE_BENCH_CALLS=20 CARVE_BENCH_BATCHES=20 CARVE_BENCH_WARMUP=100 node scripts/bench-owned-ast.mjs /path/to/baseline/dist/index.js /path/to/carve-bench/corpus/comparison/carve.crv /path/to/carve-bench/corpus/large.crv ids
```

The optional environment variables `CARVE_BENCH_CALLS`, `CARVE_BENCH_BATCHES`
and `CARVE_BENCH_WARMUP` set positive integer worker counts.
`CARVE_BENCH_TIMEOUT_MS` sets the worker timeout, defaulting to 120,000 ms.
Invalid values fail before parsing; worker failures include the error or signal.

For a fresh ID CPU profile, use an absolute candidate entry path:

```sh
node --cpu-prof --cpu-prof-dir=/tmp scripts/bench-owned-ast.mjs --worker /absolute/path/to/candidate/dist/index.js /path/to/carve-bench/corpus/large.crv ids
```
