# Parser cost reductions

Recorded 2026-09-29T14:54:58.310Z on v24.19.0, AMD Ryzen 9 PRO 7940HS w/ Radeon 780M Graphics.
The baseline is commit `393111222a45ba916f18290581e345169500b71b`. Candidate source and
build hashes are recorded in the [raw observations](parser-costs.json); the
candidate was measured before committing the change.

## Changes

1. HTML eligibility and delimiter scans use native searches without creating
   a suffix string for every character. Rejected fast-path attempts benefit too.
2. The definition prepass returns early when the remaining source contains no
   opening bracket. All definitions and rejected-definition records require that
   character. Sources containing it still use the complete ownership scan.
   Skipping the pass also skips its speculative matcher probes; extension
   matchers must remain pure predicates.
3. Nested lexers receive their existing shared maps and sets at construction,
   avoiding allocations that were immediately discarded. Each lexer's fence
   memo remains independent and is allocated only when needed.
4. Newline indexing uses native searches. Trailing whitespace is checked at
   line ends instead of retrying a regex at every interior space. Unicode offset
   conversion builds its line-start table in the same pass as its offset table.

Internal source positions remain necessary for authored code payloads and
ownership decisions. The positions option keeps its existing output contract;
it does not disable all internal bookkeeping.

## Measurements

Wall cells retain the separate medians for rounds 1 and 2. Allocation combines
both 50-call samples and estimates churn, including collected objects, rather
than retained memory. CPU samples, timing ranges, fixture hashes and per-worker
host load are in the JSON.

| Fixture | API | Input bytes | Baseline wall ms, rounds 1 / 2 | Candidate wall ms, rounds 1 / 2 | Sampled KiB/op, baseline → candidate |
|---|---|---:|---:|---:|---:|
| long-line | parse | 40964 | 1.240 / 2.133 | 0.672 / 0.517 | 11.3 → 10.7 |
| long-line | no-positions | 40964 | 2.086 / 0.888 | 0.572 / 0.455 | 13.9 → 12.6 |
| long-line | html | 40964 | 2.099 / 2.130 | 0.265 / 0.269 | 1311.9 → 42.6 |
| unclosed-code | parse | 40965 | 0.569 / 0.440 | 0.257 / 0.230 | 16.0 → 11.0 |
| unclosed-code | no-positions | 40965 | 0.410 / 0.388 | 0.194 / 0.193 | 14.2 → 14.3 |
| unclosed-code | html | 40965 | 1.793 / 1.796 | 0.451 / 0.451 | 1317.9 → 28.7 |
| many-paragraphs | parse | 12288 | 7.851 / 8.014 | 2.884 / 2.776 | 4814.3 → 2305.6 |
| many-paragraphs | no-positions | 12288 | 9.243 / 9.711 | 4.552 / 4.559 | 5727.5 → 3217.9 |
| many-paragraphs | html | 12288 | 1.126 / 1.042 | 0.730 / 0.707 | 1425.6 → 1112.8 |
| nested-quotes | parse | 388 | 0.501 / 0.797 | 0.479 / 0.494 | 1381.9 → 893.6 |
| nested-quotes | no-positions | 388 | 1.214 / 0.647 | 1.229 / 0.903 | 1478.5 → 888.7 |
| nested-quotes | html | 388 | 0.830 / 3.175 | 0.830 / 1.283 | 1878.8 → 1364.7 |
| nested-lists | parse | 388 | 2.715 / 1.701 | 1.630 / 2.448 | 2585.5 → 2001.2 |
| nested-lists | no-positions | 388 | 1.379 / 1.706 | 1.374 / 1.571 | 2950.2 → 2134.7 |
| nested-lists | html | 388 | 1.891 / 1.710 | 1.322 / 1.540 | 3497.9 → 2818.8 |
| unicode-lines | parse | 8192 | 5.625 / 4.591 | 2.410 / 2.598 | 3403.2 → 2517.9 |
| unicode-lines | no-positions | 8192 | 4.456 / 4.442 | 3.129 / 3.139 | 3718.3 → 2921.1 |
| unicode-lines | html | 8192 | 6.040 / 4.418 | 3.297 / 3.459 | 4412.8 → 3451.7 |
| interior-spaces | parse | 8195 | 119.806 / 116.202 | 0.070 / 0.076 | 16.9 → 10.7 |
| interior-spaces | no-positions | 8195 | 129.451 / 132.439 | 0.114 / 0.100 | 16.7 → 11.9 |
| interior-spaces | html | 8195 | 50.075 / 51.369 | 0.060 / 0.064 | 265.2 → 10.7 |
| definitions | parse | 8206 | 7.285 / 7.760 | 20.459 / 5.579 | 3806.4 → 3802.5 |
| definitions | no-positions | 8206 | 8.635 / 11.842 | 8.431 / 9.690 | 4830.2 → 4831.2 |
| definitions | html | 8206 | 1.859 / 1.308 | 2.041 / 1.092 | 1193.1 → 1073.4 |

Two fresh-worker rounds per fixture/mode, baseline-candidate then candidate-baseline. Each worker warms for 300ms and records five batches of at least 100ms. GC precedes each batch. Separate 50-call heap sample at 4096 bytes includes collected objects. Keep rounds separate; timing and sampled allocation are observations, not CI thresholds.

One-minute host load ranged from 11.38 to 32.36 on
16 logical CPUs. These measurements come from a shared
host. They support inspecting individual costs, not a guaranteed throughput
ratio. Reversing run order does not remove host drift or JIT variation.

## Verification and reproduction

The benchmark compares complete ASTs, ASTs without positions and HTML before
measuring each fixture. The differential checker adds the pinned corpus and
3,000 deterministic generated inputs, including mixed line endings, Unicode,
definitions and opaque containers. The normal test suite covers the changes;
the interior-whitespace timing guard runs only with `CARVE_PERF=1`.

Build a clean checkout of the baseline commit, then run in the candidate tree:

```sh
npm run build
node scripts/check-parser-costs.mjs /path/to/baseline/dist/index.js
node scripts/bench-parser-costs.mjs /path/to/baseline/dist/index.js reports/parser-costs.json
node scripts/report-parser-costs.mjs
CARVE_PERF=1 npx vitest run test/parser-costs.test.ts --maxWorkers=1 --minWorkers=1
```
