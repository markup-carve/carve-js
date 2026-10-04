# Owned AST cost follow-up

Baseline: `db274d3e6ea8da952a282c3f23295af48527f696`. Final traversal code: `90d92b91a`.
Measured on Node 22.22.2, AMD Ryzen 9 PRO 7940HS, 16 logical CPUs.
The comparison input contains 49,270 bytes; the large input contains 520,855 bytes.
[Raw observations](owned-ast-costs.json) include fixture hashes, build hashes,
all samples and worker host load.

## Changes

Position-free parsing skips ordinary position construction. Copy-on-write cleanup
removes remaining internal spans while preserving normal object shapes, shared
records, paragraph provenance and author-defined footnote names.

ID collection follows schema child slots. Resolution retains its authored
reservation map; rendering validates current IDs before sharing that map with a
separate overlay for generated IDs. Validation still walks mutable public trees.
Array edges retain their direct worklist path; singleton edges and arrays both
terminate cycles supplied by callers.

Definition ownership scanning ends after the last candidate definition line.
Container prefix scanning uses offsets. Block opener dispatch checks the first
character before trying unrelated regular expressions.

## Measurements

Each cell contains milliseconds per call for rounds 1 and 2. Workers run in
baseline/candidate order, then candidate/baseline order. Each warms for ten calls
and measures five batches: thirty calls for the comparison input, five for the
large input. Parse results precede the final array traversal adjustment, which
does not change parser code. Other rows use the final traversal build. Both runs
are retained in the JSON; superseded traversal rows from the first run are not
used below.

| Input | API | Baseline, rounds 1 / 2 | Candidate, rounds 1 / 2 |
|---|---|---:|---:|
| carve.crv | parse | 18.325 / 18.692 | 15.350 / 17.970 |
| carve.crv | parse-no-positions | 25.953 / 23.917 | 15.783 / 15.233 |
| carve.crv | render | 2.569 / 2.255 | 3.460 / 2.884 |
| carve.crv | render-no-positions | 4.560 / 3.383 | 3.877 / 2.297 |
| carve.crv | owned | 22.792 / 23.705 | 20.980 / 20.656 |
| carve.crv | ids | 1.223 / 1.231 | 0.789 / 0.932 |
| large.crv | parse | 589.611 / 620.256 | 591.825 / 571.444 |
| large.crv | parse-no-positions | 608.198 / 594.733 | 581.685 / 547.896 |
| large.crv | render | 66.790 / 77.742 | 69.699 / 68.670 |
| large.crv | render-no-positions | 94.646 / 95.698 | 78.523 / 64.643 |
| large.crv | owned | 765.346 / 717.763 | 792.018 / 775.658 |
| large.crv | ids | 13.031 / 13.093 | 12.966 / 15.238 |

Position-free parse times are near or below default parsing in these samples.
The comparison document's ID collection and composed conversion improve.
Large-document default rendering is mixed across rounds; composed conversion
is slower in this run. Small-document default rendering also varies between
runs. These shared-host measurements do not establish a universal speedup or a
rendering regression threshold. Position-free rendering improves in both final
rounds on both inputs. Retain the separate rounds when assessing small changes.

This implements incremental changes for #2491. It does not introduce a compact
internal AST, eliminate all ownership scanning, remove every allocation, or
promise 6 MB/s on the owned AST path. Those remain architecture work.

## Verification and reproduction

The suite passed 32,623 tests with 111 skipped. Type and lint checks passed.
The final traversal adjustment passed its 17 regression tests and repeated type
and lint checks. Differential checks preserve complete ASTs, position-free ASTs
and HTML on 5,215 corpus and deterministic generated sources. Local Claude
reviews identified cycle and author-label defects; those were fixed.

Build a clean baseline checkout and the candidate, then run:

```sh
npm run build
node scripts/check-parser-costs.mjs /path/to/baseline/dist/index.js
node scripts/bench-owned-ast.mjs /path/to/baseline/dist/index.js /path/to/carve-bench/corpus/comparison/carve.crv /path/to/carve-bench/corpus/large.crv
```

Optional trailing mode arguments restrict a repeat to `render`,
`render-no-positions`, `owned` and `ids`. `owned` measures manually composed
`renderHtml(resolve(parse(source)))`. Rendering and ID modes reuse a resolved
document. Benchmarks run separately from the test suite; brief verification
commands overlapped the first parse run's startup, so avoid treating differences
of a few percent as precise estimates.

## PR #2488 engine check

PHP at `bcc43231d8e952b3ef9e6feae394b22ebbe1528a` and Rust at
`0dbb75eea4c3eca5a0a4aa0df67ea3f5e92e7c8a` each match JavaScript HTML on 78
fixtures containing U+2028 and U+2029 in unordered, ordered, task and attributed
lists, metadata recovery and sibling/nested/loose lists. LF, CRLF and CR line
endings are covered. Their existing parsing accepts these payload characters,
so neither engine needs the JavaScript regex fix. Python, Ruby, Go and WASM
bindings delegate parsing to Rust; the pinned Rust 0.1.6 implementation also
uses direct byte scanning for list content.

```sh
node scripts/check-list-unicode-engines.mjs /path/to/carve-php/bin/carve /path/to/carve-rs/target/release/carve
```
