# Reference definition costs

This change removes a quadratic source-position scan and lets the HTML fast
path render adjacent reference definitions. It also removes temporary ownership
arrays and caches successful lexical definition matches within one parse.
Container ownership is still checked at every use. Unrecognized fast-path
shapes still go through the full parser.

## Why these changes

The old `wholeLinePos` summed all preceding line lengths for each collected
definition. With D definitions in L lines, that step could take O(DL) work.
The lexer already indexes line starts, so definition positions now use that
index. A deterministic test checks two indexed reads per definition across
4,096 definitions. This removes that specific quadratic cost; it does not
establish a complexity bound for the whole parser.

The index also preserves authored CRLF, CR and BOM offsets. The previous scan
assumed one character per newline and missed the leading BOM. These are
intentional AST position corrections. LF input without a BOM retains its existing positions.

The fast collector formerly required a blank line on both sides of every
definition. Adjacent definitions therefore forced AST parsing even when the
rest of the source was supported by the HTML fast path. It now accepts runs
of validated definitions with the existing surrounding separation rules.
Backslash titles use the full parser because its title grammar differs from
the fast renderer's grammar. Duplicate labels retain their last definition;
forward references and URL sanitization retain their existing behavior.

The ownership cleanup replaces `filter`, `slice` and `reduce` chains with scans
and removes a closure created for every definition candidate. The cache stores
only successful lexical matches, is allocated on first success, and belongs
to the current `ParseSession`. It avoids repeating destination and attribute
validation without caching context-dependent ownership decisions. Lines without `]:`
cannot match the definition production and now skip cache lookup as well.

## Measurements

Both measurement runs use baseline
`04845b7fc31610e17e53ab64bdf7dc5d00a81b39`.

The final source candidate is `edee40791`. These
[final observations](reference-definitions-final.json.gz) compare it against
that baseline after adding the lexical check:

| Final candidate, size 1,024 | API | Baseline ms, rounds 1 / 2 | Candidate ms, rounds 1 / 2 | Sampled KiB/op, baseline to candidate |
|---|---|---:|---:|---:|
| fixed-definitions | parse | 23.023 / 17.053 | 17.745 / 19.135 | 6712.8 to 6588.9 |
| fixed-definitions | html | 25.322 / 22.775 | 3.336 / 3.267 | 10291.6 to 2120.6 |
| dense | parse | 28.947 / 35.581 | 26.908 / 30.016 | 11765.5 to 9724.3 |
| dense | html | 40.331 / 47.900 | 5.712 / 5.488 | 16721.0 to 3102.2 |
| inline-links | parse | 12.642 / 9.633 | 10.101 / 9.466 | 5004.9 to 4959.9 |
| inline-links | html | 4.746 / 3.463 | 4.012 / 2.715 | 2044.8 to 2034.4 |

The sparse case uses 64 definitions and 1,024 reference paragraphs. Its parse
timings remain mixed after the check. It removes unnecessary
cache lookups, but this shared-host run cannot establish that sparse parsing
has no overhead. The allocation reduction is clearer than the timing change.
The final run had one-minute host load of 15.42 to 17.23 on 16 logical
CPUs. The broader matrix below provides the other workload dimensions; its HTML
fast renderer is identical to the final candidate.

The nine-family matrix candidate is `40a9da017`, before the final lexical
check that skips impossible definition lines. Its build hashes, fixture hashes, Node version, CPU, host
load, CPU samples and separate timing rounds are recorded in
[the matrix observations](reference-definitions-matrix.json.gz).

| Family, size 1,024 | API | Baseline ms, rounds 1 / 2 | Candidate ms, rounds 1 / 2 | Sampled KiB/op, baseline to candidate |
|---|---|---:|---:|---:|
| dense | parse | 13.164 / 13.000 | 11.746 / 11.622 | 11859.7 to 9779.6 |
| dense | html | 20.317 / 18.849 | 2.436 / 2.312 | 16610.2 to 3067.4 |
| fixed-paragraphs | parse | 6.633 / 6.374 | 5.403 / 4.641 | 5828.0 to 3724.0 |
| fixed-paragraphs | html | 7.777 / 7.609 | 0.768 / 0.760 | 7191.7 to 1193.2 |
| fixed-definitions | parse | 10.307 / 8.209 | 11.158 / 9.499 | 6722.2 to 6630.4 |
| fixed-definitions | html | 13.641 / 13.235 | 1.860 / 1.745 | 10268.1 to 2105.7 |
| distributed | parse | 15.342 / 15.262 | 13.776 / 14.165 | 11963.7 to 9827.1 |
| distributed | html | 19.212 / 20.638 | 3.001 / 2.317 | 16680.1 to 3086.9 |
| missing | parse | 15.712 / 16.974 | 13.160 / 14.287 | 11835.1 to 9715.7 |
| missing | html | 18.163 / 19.990 | 18.269 / 19.015 | 15551.3 to 14481.7 |
| forward | parse | 20.212 / 19.845 | 13.033 / 15.314 | 11743.8 to 9700.2 |
| forward | html | 52.153 / 44.920 | 6.194 / 4.629 | 16568.6 to 3198.6 |
| fallback | parse | 39.909 / 24.792 | 22.564 / 20.090 | 11871.3 to 9731.2 |
| fallback | html | 37.600 / 174.968 | 34.989 / 35.502 | 16357.4 to 14175.2 |
| plain | parse | 42.248 / 14.327 | 17.146 / 28.702 | 2363.9 to 2363.9 |
| plain | html | 2.399 / 2.096 | 2.158 / 2.056 | 1127.4 to 1130.6 |
| inline-links | parse | 11.882 / 8.904 | 11.583 / 8.260 | 5002.1 to 4990.5 |
| inline-links | html | 2.440 / 2.401 | 2.351 / 2.468 | 2047.4 to 2024.9 |

The fixed-paragraphs family uses 64 paragraphs; fixed-definitions uses 64
definitions. Other reference families use 1,024 of each in these rows. The
plain and inline-links controls contain no reference definitions. One-minute
host load ranged from 5.22 to 44.41 on 16 logical CPUs. Control
timings vary substantially during the busiest periods.

The adjacent-definition HTML gain is worth keeping: the dense case was about
8 times faster in both matrix rounds and used about 82% less sampled allocation
in that matrix.
Full parsing improved modestly on that case. The indexed position fix also
removes a demonstrated quadratic cost and corrects authored source offsets.
Sparse-definition parsing regressed by 8% and 16% in the two matrix rounds.
That observation prompted the final lexical check before cache lookup. The allocation
cleanup and cache reduce sampled churn. These results do not support a general
throughput promise.

The matrix varies definition count and paragraph count independently, uses
one label or distributed labels, includes missing and forward references,
forces AST fallback, and checks plain paragraphs and inline links as controls.
Each input is measured through `parse` and `carveToHtml` at sizes 64, 256 and
1,024. The runner checks identical complete result hashes before recording
each observation.

There are two fresh-worker rounds in opposite reader order. Each worker warms
for 250 ms and measures five batches of at least eight calls and 150 ms.
Allocation uses a separate 50-call heap sample including collected objects;
it estimates churn, not retained memory. Measurements come from a shared
host and have no CI timing thresholds. Keep the rounds separate when comparing
small differences.

The intermediate reports isolate [offset indexing](reference-definitions-offsets.json.gz),
[fast-path acceptance](reference-definitions-fast.json.gz),
[ownership allocation](reference-definitions-allocations.json.gz),
[match caching](reference-definitions-cache.json.gz), and
[the cache with its lexical check against the uncached build](reference-definitions-lexical-check.json.gz). The offset snapshot preceded
the final first-line BOM column correction; its ASCII fixtures are unaffected.
The cache report shows about 15% less sampled parse allocation on
definition-heavy inputs, with mixed timing results and similar control timings.
The final reproduction uses `--sparse` for its comparison against the named baseline.

## Verification

After each implementation step, focused tests and differential comparisons
checked the supported behavior. The final lexical-check build `edee40791` was
also compared against `8d9344d09`, the corrected-position and fast-path build.
Ownership, cache and lexical-check changes preserve full
ASTs, position-free ASTs and HTML across 2,200 pinned corpus sources and 3,000
seeded generated inputs. These comparisons use the corrected position build
as their baseline, so they do not mask the intentional CRLF and BOM corrections.

The focused position, fast-path and session checks also passed on Node 20.
A local Claude CLI review found no code or benchmark issues requiring changes.
The completed change passed typecheck and lint, 32,083 tests, browser bundle
parity over 2,200 corpus documents, and the packed-package consumer check.
Tests cover adjacent and duplicate definitions, forward links, simple and
escaped titles, unsafe destinations, fenced literal definitions, rejected
layouts, authored newline offsets, Unicode, and nested independent parses.

## Reproduction

The raw JSON reports are gzip-compressed to keep the review focused on source
changes and the measurement summary. Use `gzip -dc` to inspect them.

Build clean checkouts of baseline `04845b7fc` and corrected-position build
`8d9344d09`, using `npm ci` and `npm run build` in each. Then use separate
candidate checkouts for the two recorded runs:

```sh
# In candidate checkout 40a9da017, using its benchmark runner:
npm ci
npm run build
node scripts/bench-reference-definitions.mjs \
  /path/to/baseline/dist/index.js dist/index.js /tmp/reference-matrix.json --matrix

# In final candidate checkout edee40791, using its benchmark runner:
npm ci
npm run build
git submodule update --init --depth 1
node scripts/bench-reference-definitions.mjs \
  /path/to/baseline/dist/index.js dist/index.js /tmp/reference-final.json --sparse
node scripts/check-parser-costs.mjs /path/to/corrected-position-build/dist/index.js
```

The runner changed between the matrix and final runs to add `--sparse`.
Each JSON records its runner hash. Running `--matrix` on the final source is
also supported, but measures the source after the lexical check rather than
reproducing the recorded earlier matrix.

The parity check runs from `edee40791` against `8d9344d09`. The timing matrix
and final measurements compare against `04845b7fc` and use LF ASCII fixtures,
whose ASTs do not need the position corrections.

Internal position tracking remains in place because source payloads and
container ownership depend on it. Removing it requires a separate design and
correctness investigation.
