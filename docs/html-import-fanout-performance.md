# HTML import fanout measurements

Footnote lookup uses lazy subtree indexes and membership sets; cleanup compacts siblings once. HTML import also batches nested-span refusals, compacts empty-code removals, and reuses table-section positions. Capped diagnostic ordering is preserved. Consecutive nested text spans now import successfully with both repair diagnostics instead of throwing after text merging.

## Method

Measured on 2026-10-08 against `e9d16a778f008463e9b3da5ef6edb35ac1ec57f1`. The candidate source hashes and Rust binary hashes are recorded in the [raw results](measurements/html-import-fanout-20261008.json).

Each public API with the Word adapter was measured serially on CPU 13 (AMD Ryzen 9 PRO 7940HS w/ Radeon 780M Graphics). Each size received one warmup and three timed calls. A second round reversed revision and size order, giving six samples per revision and size. The tables use all six samples. JavaScript and PHP collected garbage before each timed call. Report serialization, hashing and file I/O were outside the timer.

Runtimes: v22.22.2; PHP 8.5.11 (cli) (built: Sep 24 2026 13:49:29) (NTS); rustc 1.97.1 (8bab26f4f 2026-07-14). PHP used its default CLI JIT settings with PCOV and Xdebug disabled. These timings use a different PHP configuration from the benchmark site's tracing-JIT core runs.

PHP candidate measurements were refreshed after tightening the subclass hook guard: every size received the same six samples in both size orders, with the original before samples retained. The raw results record that phase separately. PHP ordinary-input and distinct-footnote controls were then repeated with both revisions together because the refresh ran at higher host load; the original control samples are also retained.

## Paired results

The table shows the larger size of each pair. Per-byte growth compares that size with the smaller size: linear work stays near 1x; quadratic work approaches the input-size multiplier. All 34 before/after output and report hashes match.

| Input | Count | API | Before ms | After ms | Speedup | After per-byte growth |
| --- | ---: | --- | ---: | ---: | ---: | ---: |
| Long inverse backlink classes | 4,096 | carve | 925.083 | 408.566 | 2.26x | 0.64x |
| Long inverse reference classes | 4,096 | carve | 935.591 | 411.600 | 2.27x | 0.69x |
| Shared-body backlinks | 4,096 | carve | 2658.965 | 456.327 | 5.83x | 0.58x |
| Wrapped backlinks | 4,096 | carve | 3648.257 | 517.266 | 7.05x | 0.55x |
| Shared definition wrapper | 8,192 | ast | 4745.327 | 434.575 | 10.92x | 0.58x |
| Empty note wrappers | 4,096 | ast | 464.469 | 474.979 | 0.98x | 0.67x |
| Duplicate reference IDs | 4,096 | carve | 2363.171 | 426.208 | 5.54x | 0.59x |
| Aliases for one definition | 4,096 | carve | 416.797 | 372.546 | 1.12x | 0.51x |
| Separator siblings | 512 | ast | 192.996 | 20.390 | 9.47x | 0.66x |
| Deep scope wrappers | 2,048 | ast | 286.973 | 264.659 | 1.08x | 0.74x |
| Overlapping backlink blocks | 2,048 | ast | 1361.621 | 318.820 | 4.27x | 0.70x |
| Deep aliases (depth rejection) | 2,048 | ast | 227.096 | 230.019 | 0.99x | 0.77x |
| Empty table sections | 8,192 | ast | 341.685 | 122.118 | 2.80x | 0.60x |
| Empty code spans | 16,384 | carve | 437.889 | 320.929 | 1.36x | 0.52x |
| Nested code-bearing spans | 512 | carve | 784.608 | 120.141 | 6.53x | 0.81x |
| Distinct mutual footnotes | 1,024 | carve | 451.709 | 431.031 | 1.05x | 0.82x |
| Ordinary paragraphs | 1,024 | carve | 450.863 | 393.223 | 1.15x | 0.67x |

## Ordinary input

- 256 paragraphs: before 164.500 ms (134.724–209.967); after 147.046 ms (130.753–181.858).
- 1024 paragraphs: before 450.863 ms (363.534–479.678); after 393.223 ms (329.220–459.918).

These short samples include JIT warmup effects. The raw ranges should accompany any claim about ordinary-input overhead.

## Validation

33,127 tests passed in the full suite; the final HTML checks passed 323 tests. Type checking and lint passed. All 14 timing guards passed. All 173 semantic cases match except four consecutive nested-text-span cases that previously threw and now retain their text and repair diagnostics. Claude reviewed the diff; findings were addressed and checked.

## Reproduce

The [fixture generator](measurements/html-import-fanout-fixtures.py) accepts a shape and count. Copy the probe into each checkout when comparing a historical revision. Use distinct Cargo target directories for Rust revisions.

```sh
mkdir -p /tmp/carve-footnote-fixtures
for n in 1024 4096; do
  python3 docs/measurements/html-import-fanout-fixtures.py backs "$n" > "/tmp/carve-footnote-fixtures/backs-$n.html"
done
npm run build
node --expose-gc docs/measurements/html-import-fanout-probe.mjs "$PWD" backs 1024,4096 carve
```

Pin the process to the same CPU, repeat with reversed revision and size order, and compare output/report hashes. The semantic inputs are in [the fixture file](measurements/html-import-fanout-semantic-fixtures.json).

## Remaining costs

Attribute-heavy HTML still encounters quadratic duplicate attribute checks in upstream parsers. Deep div nesting also makes parse5 repeat scope scans. The deep-scope fixture uses object boundaries to isolate engine-owned ancestor lookup; it does not establish linear parsing of arbitrary deep HTML. These changes do not establish a core parse/render chart speedup.

The relevant upstream code is in [parse5](https://github.com/inikulin/parse5/blob/e65eae9a9dc27f1b7eb71868d245ca83070ccc4a/packages/parse5/lib/tokenizer/index.ts), [html5ever](https://github.com/servo/html5ever/blob/7760920edff08e6dfd4b62affee39d8084e9dc45/html5ever/src/tokenizer/mod.rs), and [Lexbor](https://github.com/lexbor/lexbor/blob/master/source/lexbor/html/tree.c).
