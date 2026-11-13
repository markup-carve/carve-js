# Spike: block pass with an event stream against a direct tree build

Phase 0 of the 0.2 plan asks one question before the engine is designed: does it cost anything to have the block pass write flat events into a typed array and build the tree from those events, compared with a block pass that builds the tree directly? The answer decides whether events are the boundary inside the engine or only an export.

This directory is not part of the package or the test suite.

## What was built

A block scanner for a subset of the 0.2 block rules (`src/scanner.ts`): one forward loop over the lines of one source string, an explicit container stack capped at 200, no recursion, no regular expressions and no substrings. A line is first matched against the open containers, then dispatched on its first character code. Leaves keep `(start, end)` offsets into the source, one pair per content line. Inline content is not parsed.

The subset: paragraphs with lazy continuation, blank lines, one-line headings (`=` or `#`), bullet lists (`-`, `*`) and ordered lists (digits and a period) nested by indent past the marker's start column, block quotes, and backtick fences. A fence opener and a list marker inside a list interrupt a paragraph. Everything else is paragraph text.

The scanner reports to a sink with three calls, `enter`, `span` and `exit`. The variants differ only in the sink:

- **A** (`src/events.ts`): the sink writes `[tag, a, b]` triples into an `Int32Array` that doubles when full. A second function replays the events into the tree builder. "A fresh" allocates the array per parse, "A reused" keeps one array across parses.
- **B** (`src/tree.ts`): the sink is the tree builder itself.

Both end in the same `TreeBuilder`, and the line-shape tests in `src/lines.ts` are shared, so the difference between A and B is the event layer and nothing else.

## How to run

Node 22.18 or later runs the TypeScript sources as they are.

```
npm run build        # only for the 0.1 yardstick, which needs dist/
node --expose-gc spike/block-events/bench.mjs
node spike/block-events/dump.mjs some-file.crv    # prints the block tree
npx tsc -p spike/block-events/tsconfig.json       # type check
```

`bench.mjs` reads `small.crv` and `large.crv` from `--corpus` (default: `carve-bench/corpus` next to this repository) and `guide.crv`, `migration.crv` and `contract.crv`, the Track D documents, from `--realistic` (default `<corpus>/realistic`). Missing files are skipped. `--rounds` and `--sample-ms` set the length of the run.

Before timing, the script checks on every input that all variants produce deep-equal trees. Each round then takes one sample of every task in rotating order. A sample is enough repetitions to fill about 20 ms, measured with `process.cpuUsage()` (user plus system, all threads of the process, so collector threads count) and `process.hrtime.bigint()`. The ratio against B is taken per round. Each variant also runs alone in a child process, where the scanner sees one sink class only. Allocation is measured in another child with a 64 MB young generation: the growth of `heapUsed` over a few parses with no collection in between, checked by counting scavenges.

## Result

Run of 2026-11-13 on carve-js `next2` at `c08449d7`. The Track D documents came from carve-bench at `ff8815e`.

Node v22.22.2, V8 12.4.254.21-node.39, AMD Ryzen 9 PRO 7940HS w/ Radeon 780M Graphics, 16 logical CPUs.
Load average (1, 5, 15 min): 4.25 3.74 3.62 at the start, 4.12 3.82 3.66 after the paired runs, 3.65 3.73 3.63 at the end.
100 paired rounds per input in rotating order, about 20 ms of CPU per sample.
The trees of all variants were deep-equal on every input.

A fresh: events into a new array per parse, then the tree. A reused: the same with one array kept across parses. B: the tree directly.

Paired runs, CPU time per parse in microseconds (median over rounds):

| Input | Bytes | Lines | Nodes | Events | A fresh | A reused | B | A scan only | A build only | 0.1 `parse()` |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| small.crv | 1233 | 103 | 67 | 192 | 9.65 | 5.93 | 4.26 | 3.20 | 2.21 | 1351 |
| large.crv | 520855 | 76616 | 26193 | 110314 | 12926 | 14669 | 13294 | 3068 | 9567 | 921461 |
| realistic/guide.crv | 5003 | 128 | 52 | 179 | 8.12 | 6.66 | 5.11 | 4.42 | 1.72 | 1301 |
| realistic/migration.crv | 21935 | 470 | 139 | 586 | 23.77 | 21.70 | 17.86 | 14.99 | 5.97 | 4980 |
| realistic/contract.crv | 98541 | 1947 | 626 | 2778 | 110 | 106 | 89.23 | 74.65 | 28.37 | 47634 |

Per-round ratio against B, median (middle half):

| Input | A fresh / B, CPU | A reused / B, CPU | A fresh / B, wall | A reused / B, wall |
|---|--:|--:|--:|--:|
| small.crv | 2.262 (2.135 to 2.383) | 1.394 (1.326 to 1.459) | 1.974 (1.876 to 2.077) | 1.385 (1.315 to 1.445) |
| large.crv | 1.000 (0.743 to 1.259) | 1.073 (0.882 to 1.257) | 1.115 (0.958 to 1.244) | 1.162 (0.989 to 1.326) |
| realistic/guide.crv | 1.563 (1.512 to 1.643) | 1.304 (1.255 to 1.349) | 1.487 (1.451 to 1.543) | 1.299 (1.254 to 1.341) |
| realistic/migration.crv | 1.339 (1.277 to 1.402) | 1.218 (1.179 to 1.254) | 1.312 (1.259 to 1.371) | 1.209 (1.174 to 1.251) |
| realistic/contract.crv | 1.238 (1.184 to 1.319) | 1.189 (1.139 to 1.238) | 1.231 (1.183 to 1.312) | 1.187 (1.139 to 1.233) |

Each variant alone in its own process, CPU time per parse in microseconds (median of 40 samples, not paired):

| Input | A fresh | A reused | B | A fresh / B | A reused / B |
|---|--:|--:|--:|--:|--:|
| small.crv | 8.83 | 5.38 | 3.67 | 2.403 | 1.465 |
| large.crv | 13906 | 13402 | 12855 | 1.082 | 1.043 |
| realistic/guide.crv | 8.28 | 7.20 | 5.20 | 1.591 | 1.385 |
| realistic/migration.crv | 24.59 | 23.02 | 17.90 | 1.374 | 1.287 |
| realistic/contract.crv | 117 | 111 | 89.57 | 1.302 | 1.244 |

Bytes allocated per parse:

| Input | A heap | A event array (outside the heap) | B heap | Scavenges during the measurement |
|---|--:|--:|--:|--:|
| small.crv | 19771 | 3696 | 19670 | 0 |
| large.crv | 8964824 | 1559472 | 8937848 | 0 |
| realistic/guide.crv | 14979 | 3732 | 15090 | 0 |
| realistic/migration.crv | 41938 | 16440 | 42142 | 0 |
| realistic/contract.crv | 182486 | 73704 | 186804 | 0 |

"A scan only" writes events into a reused array and builds no tree. "A build only" replays a prepared event array. The 0.1 `parse()` column is the current engine on the same input and is there for scale only: it parses the whole language including inline content, the spike a subset of the block rules.

## Conclusion

The event layer costs CPU time in a block-only pass: with a reused array, A takes 1.19 to 1.39 times as long as B on the four inputs up to 98 KB, and the middle half of the per-round ratio stays above 1 on each of them. On `large.crv` the two cannot be told apart (median 1.00 to 1.07, middle half 0.74 to 1.26), because replaying the events into 26,000 nodes, with the collector running, is about 70 percent of A's time there and the scan about a quarter. In absolute terms the layer adds 1.7 microseconds on `small.crv` and 17 microseconds on the 98 KB contract, against 1,351 and 47,634 microseconds for the full 0.1 parse, so events can be the internal boundary as long as the array is reused: a fresh array per parse raises the ratio on `small.crv` from 1.39 to 2.26.

## Limits

- CPU time under the recorded load, not instruction counts. Hardware counters are not available on this machine (`perf_event_paranoid` is 4, no valgrind). The load average was about 4 on 16 logical CPUs during the run.
- A subset of the block rules. Not built: the three-blank-line list split, tightness, description lists, definitions, attributes, tables, divs, comments, captions, thematic breaks, frontmatter, task items, letter and roman markers. Tabs inside fence content are stripped by offset, not by column.
- No inline pass. The share of the event layer in a full parse is an estimate from the 0.1 column, not a measurement.
- The inputs are 0.1 syntax. They give realistic line mixes, but the trees are not what 0.2 will produce for them.
- The tree is plain: one node class, `children` and `spans` as arrays grown by `push`. That is about 340 bytes per node on `large.crv`; an AST 2.0 builder will have a different cost.
- In the paired run the scanner's sink calls see two classes. The single-variant runs see one, and their ratios agree with the paired ones.
- The reused event array and the shared container stack make a parse non-reentrant. A real engine needs a rule for nested parses and has to copy the events it exports.
