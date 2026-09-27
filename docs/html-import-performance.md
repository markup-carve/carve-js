# HTML import measurements for #2154

Reusing recent escape-search parses reduces parser input by 24.6% on Wikipedia
and 14.3% on Wikibooks against `15edf0431`, with identical output hashes.
Wikibooks is now 5.9% below its pre-#2118 parser input. These
measurements do not establish a wall-clock regression. The host had competing
workloads, so this report uses parser-input counts to compare revisions.

## Revisions and inputs

Measured with Node v22.22.2 on 2026-09-27:

- Before #2118: `1a1bc0ddb`.
- After #2118: `03ba0a0c0`.
- Current main: `15edf0431`, including adjacent-text normalization from #2146.

Both historical revisions already contain the windowed search from #2109 and
its nested-container extension from #2112. That search is not a later change
between these three measurements.

The inputs are `01-wikipedia-markdown/page.html` and
`02-wikibooks-latex-mathematics/page.html` from the
[botmonster corpus](https://github.com/botmonster/benchmarks/tree/10b35424f1b3146a64dd582ae729564541a95a5d/html-to-markdown-converters/corpus/pages).
The accompanying [measurements](measurements/html-import-2154.json) record input
hashes, output hashes, parser calls, and UTF-8 bytes supplied to the Carve parser.
The script's JSON lines were normalized for this file: local paths were replaced
with corpus directory names, and the measured revisions were attached.
They also record UTF-16 code units, since JavaScript string length is not a byte
count. HTML parsing by parse5 is outside these counters.

## Parser input

| Page | Revision | Calls | UTF-8 bytes |
| --- | --- | ---: | ---: |
| Wikipedia | Before #2118 | 386 | 5,249,105 |
| Wikipedia | After #2118 | 370 | 4,223,033 |
| Wikipedia | Current main | 304 | 3,470,807 |
| Wikipedia | With window cache | 194 | 2,870,288 |
| Wikipedia | With seeded cache | 181 | 2,618,461 |
| Wikibooks | Before #2118 | 401 | 2,189,599 |
| Wikibooks | After #2118 | 385 | 2,421,239 |
| Wikibooks | Current main | 385 | 2,403,164 |
| Wikibooks | With window cache | 280 | 2,224,106 |
| Wikibooks | With seeded cache | 258 | 2,060,609 |

Current Wikipedia input is 33.9% below the pre-#2118 revision. Wikibooks is
9.8% above it. The exact totals differ from the original issue's measurements;
these comparisons use the same pinned files and counter for all three revisions.

## Where Wikibooks spends the extra input

| Search phase | Before #2118 bytes | After #2118 bytes | Current bytes | With cache bytes | Seeded cache bytes |
| --- | ---: | ---: | ---: | ---: | ---: |
| Whole-unit relaxation | 1,156,236 | 1,083,918 | 1,072,385 | 952,005 | 796,463 |
| Individual-escape relaxation | 766,403 | 1,070,209 | 1,067,013 | 1,008,335 | 1,000,380 |
| Outside either search | 266,960 | 267,112 | 263,766 | 263,766 | 263,766 |

The increase comes from individual-escape relaxation. Immediately after #2118,
that phase uses 303,806 more bytes even though its parser calls fall from 192
to 176. Its average input per call rises from 3,992 to 6,081 bytes. Whole-unit
relaxation gets cheaper.

The search halves a list of candidate escapes and selects a window covering
each group. Moving lone brackets into the unconditional escape set changes
that list and its groups. Fewer candidates therefore do not guarantee less
parser input. The phase measurements locate the increase; they do not identify
a particular group as its sole cause.

Wikipedia also does less parsing immediately after #2118. That does not prove
that the whole import gets faster: #2118 adds a bracket-collection pass to
inline rendering, which the narrowing search repeats. The measurements here
do not isolate the time spent in that pass. The original timing increase
cannot be attributed to it from parser-byte counts alone.

## Reusing window parses

A failed relaxation often leaves the next probe with a window it has already
parsed, and the first whole-document probe relaxes every unit, which renders
the minimal form the caller parsed before the search began. `windowedProbe`
keeps the four most recent source-to-tree results, including failed parses,
seeded with the minimal and conservative forms. It answers window probes,
whole-document probes and each search's final verification. Exact source
equality is required for reuse, and the tree is a pure function of the source,
so a hit returns what a fresh parse would. The cache belongs to one escape
search.

Both benchmark output hashes match `15edf0431`. The definition-list cost
regression falls from 11.74 to 10.20 document lengths of parser input and now
requires less than 10.5. This measures parser work without a timing threshold.

## Reproduce

Build the revision being measured, then run the script from this checkout:

```sh
npm run build
CARVE_MEASURE_SAMPLES=0 node scripts/measure-html-import.mjs . \
  /path/to/corpus/pages/01-wikipedia-markdown/page.html \
  /path/to/corpus/pages/02-wikibooks-latex-mathematics/page.html
```

For a historical revision, build it in a separate worktree and pass that
worktree as the first argument. The script instruments a temporary copy of
`dist`, leaving the build intact. It counts parser calls by search phase using
call stacks, then checks the output against an uninstrumented import. The
instrumented run supplies counts only.

Omit `CARVE_MEASURE_SAMPLES=0` for five uninstrumented timing samples after a
warmup. Run revisions sequentially on an idle host before drawing timing
conclusions. No wall-clock speedup is claimed from this run.

The cache brings the Wikibooks total below its pre-#2118 baseline without
changing search decisions. It does not remove the occurrence-phase increase
introduced by #2118: that phase still parses more input than before #2118, and
the savings come from whole-unit relaxation. Renderer work still needs
separate measurement before attributing the historical wall-clock increase to
a particular pass.
