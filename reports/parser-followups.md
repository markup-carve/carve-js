# Parser performance follow-ups

Baseline: `23204e8982012a4b3900dc735e46b3c2630803c2`. Recorded 2026-09-29T21:27:20.204Z
on v24.19.0, AMD Ryzen 9 PRO 7940HS w/ Radeon 780M Graphics. Candidate source/build hashes,
CPU frame locations and allocation samples are in [the observations](parser-followups.json.gz).

## Changes

- #2390: position removal walks own enumerable properties without creating a
  key array for every object. Shared/cyclic extension state and attribute rules
  are preserved. Internal positions remain available during parsing.
- #2391: definition collection requires a line containing `]: `, the shared
  sequence in every definition spelling. Other bracket uses skip the complete
  pass. A possible definition still receives the full ownership scan.
- #2392: quote/list fence memo maps and list comment-payload maps are created
  only when used. They retain their existing container scopes.
- #2393: single-line paragraphs avoid a mapped line array. Ordinary ASCII
  letters, digits, spaces and tabs use a plain-text inline path when no
  extension matcher is active. Punctuation, Unicode and multiline text retain
  the authoritative scanner.

## Paired observations

Wall cells keep rounds separate. Allocation combines two 50-call samples and
measures churn, including collected objects. It is not retained or peak memory.
CPU profiles are separate from timing batches. Each observation keeps the
64 largest CPU and heap frames; omitted frame counts and full allocation totals
are recorded. The shortlist below filters to implementation frames. Sampled frames identify costs;
they do not establish causality for every timing difference.

| Fixture | API | Input bytes | Baseline wall ms, rounds 1 / 2 | Candidate wall ms, rounds 1 / 2 | Sampled KiB/op, baseline → candidate |
|---|---|---:|---:|---:|---:|
| plain-paragraphs | parse | 12288 | 2.070 / 2.227 | 2.004 / 1.909 | 2335.8 → 1773.7 |
| plain-paragraphs | no-positions | 12288 | 3.526 / 3.497 | 3.517 / 3.338 | 3251.0 → 2640.1 |
| plain-paragraphs | html | 12288 | 0.647 / 0.643 | 0.688 / 0.637 | 1111.3 → 1116.7 |
| literal-bracket | parse | 12289 | 5.659 / 6.130 | 1.821 / 1.764 | 4859.4 → 1764.0 |
| literal-bracket | no-positions | 12289 | 6.751 / 6.573 | 2.854 / 3.127 | 5780.9 → 2632.9 |
| literal-bracket | html | 12289 | 7.438 / 7.899 | 3.267 / 3.227 | 6714.5 → 3675.6 |
| inline-links | parse | 11264 | 4.263 / 4.463 | 2.057 / 2.133 | 3982.7 → 2520.9 |
| inline-links | no-positions | 11264 | 5.383 / 5.042 | 3.254 / 3.117 | 4990.1 → 3469.0 |
| inline-links | html | 11264 | 0.747 / 0.761 | 0.808 / 0.805 | 1039.3 → 1043.5 |
| sparse-definitions | parse | 12302 | 5.717 / 5.613 | 5.184 / 5.710 | 4681.1 → 4165.7 |
| sparse-definitions | no-positions | 12302 | 6.720 / 7.006 | 6.762 / 6.609 | 5633.7 → 5004.5 |
| sparse-definitions | html | 12302 | 0.647 / 0.638 | 0.647 / 0.644 | 1113.4 → 1108.9 |
| dense-definitions | parse | 10277 | 4.896 / 4.911 | 4.890 / 4.674 | 5054.4 → 4786.9 |
| dense-definitions | no-positions | 10277 | 6.667 / 6.276 | 6.288 / 5.573 | 6008.1 → 5659.6 |
| dense-definitions | html | 10277 | 6.704 / 6.338 | 5.936 / 6.089 | 7071.6 → 6839.9 |
| quotes-32 | parse | 68 | 0.043 / 0.054 | 0.042 / 0.041 | 138.4 → 133.3 |
| quotes-32 | no-positions | 68 | 0.064 / 0.065 | 0.062 / 0.062 | 161.4 → 155.6 |
| quotes-32 | html | 68 | 0.079 / 0.075 | 0.074 / 0.071 | 215.0 → 206.4 |
| lists-32 | parse | 68 | 0.134 / 0.134 | 0.127 / 0.137 | 352.2 → 346.9 |
| lists-32 | no-positions | 68 | 0.174 / 0.179 | 0.182 / 0.175 | 399.3 → 414.6 |
| lists-32 | html | 68 | 0.179 / 0.194 | 0.186 / 0.193 | 499.0 → 486.2 |
| quotes-96 | parse | 196 | 0.129 / 0.132 | 0.128 / 0.128 | 452.7 → 422.5 |
| quotes-96 | no-positions | 196 | 0.177 / 0.183 | 0.186 / 0.189 | 511.5 → 504.8 |
| quotes-96 | html | 196 | 0.227 / 0.223 | 0.215 / 0.206 | 714.9 → 691.0 |
| lists-96 | parse | 196 | 0.384 / 0.400 | 0.427 / 0.434 | 1063.3 → 1025.2 |
| lists-96 | no-positions | 196 | 0.536 / 0.519 | 0.520 / 0.533 | 1171.7 → 1113.9 |
| lists-96 | html | 196 | 0.643 / 0.594 | 0.612 / 0.582 | 1486.0 → 1440.6 |
| quotes-192 | parse | 388 | 0.267 / 0.271 | 0.248 / 0.247 | 881.6 → 852.7 |
| quotes-192 | no-positions | 388 | 0.355 / 0.367 | 0.384 / 0.389 | 975.8 → 1002.2 |
| quotes-192 | html | 388 | 0.457 / 0.445 | 0.424 / 0.439 | 1424.1 → 1384.9 |
| lists-192 | parse | 388 | 0.787 / 0.816 | 0.776 / 0.786 | 2083.6 → 2001.6 |
| lists-192 | no-positions | 388 | 1.106 / 0.989 | 1.088 / 1.057 | 2297.6 → 2215.1 |
| lists-192 | html | 388 | 1.161 / 1.155 | 1.116 / 1.091 | 2842.0 → 2772.6 |
| quotes-body | parse | 1601 | 0.169 / 0.165 | 0.139 / 0.137 | 446.2 → 422.9 |
| quotes-body | no-positions | 1601 | 0.218 / 0.225 | 0.194 / 0.192 | 485.8 → 507.1 |
| quotes-body | html | 1601 | 0.256 / 0.251 | 0.234 / 0.224 | 717.7 → 687.2 |
| lists-body | parse | 1601 | 0.464 / 0.461 | 0.408 / 0.405 | 1060.3 → 1039.8 |
| lists-body | no-positions | 1601 | 0.635 / 0.611 | 0.510 / 0.529 | 1172.7 → 1127.4 |
| lists-body | html | 1601 | 0.647 / 0.631 | 0.592 / 0.605 | 1501.1 → 1454.4 |
| long-ascii | parse | 11265 | 0.093 / 0.094 | 0.033 / 0.034 | 8.5 → 8.6 |
| long-ascii | no-positions | 11265 | 0.094 / 0.091 | 0.039 / 0.036 | 10.3 → 9.2 |
| long-ascii | html | 11265 | 0.146 / 0.143 | 0.071 / 0.071 | 18.8 → 19.1 |
| long-unicode | parse | 11265 | 0.582 / 0.588 | 0.603 / 0.594 | 767.9 → 763.8 |
| long-unicode | no-positions | 11265 | 0.560 / 0.594 | 0.547 / 0.596 | 775.6 → 767.6 |
| long-unicode | html | 11265 | 0.700 / 0.681 | 0.782 / 0.692 | 801.8 → 800.4 |
| unicode-paragraphs | parse | 12288 | 3.423 / 3.456 | 3.358 / 3.487 | 3628.6 → 3508.0 |
| unicode-paragraphs | no-positions | 12288 | 4.032 / 4.081 | 3.803 / 3.586 | 4028.6 → 3862.0 |
| unicode-paragraphs | html | 12288 | 4.622 / 4.571 | 4.592 / 4.628 | 5352.6 → 5308.0 |
| sparse-markup | parse | 10240 | 2.081 / 1.977 | 1.902 / 1.828 | 2654.9 → 2323.6 |
| sparse-markup | no-positions | 10240 | 3.489 / 2.883 | 3.240 / 3.355 | 3660.2 → 3334.8 |
| sparse-markup | html | 10240 | 0.669 / 0.683 | 0.661 / 0.684 | 1087.1 → 1079.0 |

Two fresh-worker rounds per fixture/mode, baseline-candidate then candidate-baseline. Each worker warms for 300ms and records five batches of at least 100ms. GC precedes each batch. Separate 50-call heap sample at 4096 bytes includes collected objects. Keep rounds separate; timing and sampled allocation are observations, not CI thresholds.

Host one-minute load ranged from 2.49 to 7.40 on
16 logical CPUs. Timing variation and regressions remain
visible. These measurements are workload observations, not general speed claims.
Nesting is bounded; this change does not make all container processing linear
in source length.

## Position removal alone

Each worker prepares 100 ASTs before measuring each of five batches. Parsing,
GC and parity checks stay outside the measured removal interval. A separate
100-call allocation/CPU profile contains only removal operations and profiler
control overhead. See [the raw profiles](position-removal.json.gz). Each removed
tree is checked against the same reader's position-free parse.

| Fixture | Baseline ms, rounds 1 / 2 | Candidate ms, rounds 1 / 2 | Sampled KiB/op, baseline → candidate |
|---|---:|---:|---:|
| paragraphs | 0.780 / 0.808 | 1.003 / 0.994 | 915.1 → 837.1 |
| definitions | 0.797 / 0.736 | 0.953 / 0.950 | 822.6 → 784.8 |
| quotes | 0.105 / 0.103 | 0.114 / 0.115 | 117.8 → 136.7 |
| lists | 0.210 / 0.218 | 0.246 / 0.246 | 263.0 → 237.6 |

The removal pass is slower in both rounds for all four fixtures. Sampled allocation
is lower for paragraphs, definitions and lists, but higher for quotes. This is
an allocation tradeoff, not a position-removal speed improvement. Internal
position construction remains a separate cost.

## Current parse hotspots

Top implementation frames by sampled self time and allocation. Runtime frames
are excluded from this shortlist, but remain in the raw data. The two rounds
are normalized per profile operation before averaging. Line numbers refer to
the installed JavaScript.

| Fixture | Reader | CPU frames | Allocation frames |
|---|---|---|---|
| plain-paragraphs | baseline | `parseBlockInner` 0.354 ms/op; `parseParagraph` 0.226 ms/op; `scanInlineInner` 0.167 ms/op | `parseParagraph` 568.186 KiB/op; `scanInlineInner` 473.004 KiB/op; `applyLinkDefs` 184.676 KiB/op |
| plain-paragraphs | candidate | `parseBlockInner` 0.337 ms/op; `scanInlineInner` 0.145 ms/op; `parseParagraph` 0.144 ms/op | `parseParagraph` 434.418 KiB/op; `scanInlineInner` 279.598 KiB/op; `applyLinkDefs` 184.596 KiB/op |
| inline-links | baseline | `collectLinkDefs` 0.684 ms/op; `scanInlineInner` 0.291 ms/op; `newlineIndices` 0.201 ms/op | `collectLinkDefs` 829.435 KiB/op; `scanInlineInner` 700.027 KiB/op; `buildBracketMap` 311.673 KiB/op |
| inline-links | candidate | `scanInlineInner` 0.276 ms/op; `newlineIndices` 0.204 ms/op; `parseBlockInner` 0.164 ms/op | `scanInlineInner` 570.022 KiB/op; `buildBracketMap` 322.648 KiB/op; `parseParagraph` 199.088 KiB/op |
| lists-192 | baseline | `parseList` 0.096 ms/op; `parseBlockInner` 0.032 ms/op; `unorderedMatch` 0.020 ms/op | `parseList` 442.189 KiB/op; `attachBlockPos` 126.911 KiB/op; `attachDocumentOffsets` 102.385 KiB/op |
| lists-192 | candidate | `parseList` 0.084 ms/op; `parseBlockInner` 0.036 ms/op; `unorderedMatch` 0.022 ms/op | `parseList` 440.446 KiB/op; `attachBlockPos` 128.802 KiB/op; `attachDocumentOffsets` 100.541 KiB/op |
| quotes-192 | baseline | `parseBlockInner` 0.036 ms/op; `attachDocumentOffsets` 0.013 ms/op; `parseBlockQuote` 0.012 ms/op | `parseBlockQuote` 141.872 KiB/op; `attachDocumentOffsets` 103.214 KiB/op; `nestedSubLexer` 61.025 KiB/op |
| quotes-192 | candidate | `parseBlockInner` 0.030 ms/op; `attachDocumentOffsets` 0.014 ms/op; `parseBlockQuote` 0.012 ms/op | `parseBlockQuote` 140.330 KiB/op; `attachDocumentOffsets` 103.861 KiB/op; `nestedSubLexer` 55.799 KiB/op |
| long-ascii | baseline | `scanInlineInner` 0.034 ms/op; `newlineIndices` 0.013 ms/op; `Lexer` 0.006 ms/op | `parse` 0.906 KiB/op; `scanInlineInner` 0.403 KiB/op; `parseParagraph` 0.363 KiB/op |
| long-ascii | candidate | `newlineIndices` 0.013 ms/op; `scanInlineInner` 0.008 ms/op; `Lexer` 0.004 ms/op | `parse` 1.111 KiB/op; `Lexer` 0.597 KiB/op; `utf8ByteLength` 0.364 KiB/op |
| unicode-paragraphs | baseline | `walk` 0.571 ms/op; `scanInlineInner` 0.428 ms/op; `parseBlockInner` 0.323 ms/op | `scanInlineInner` 777.686 KiB/op; `parseParagraph` 572.925 KiB/op; `matchEmphasis` 485.499 KiB/op |
| unicode-paragraphs | candidate | `walk` 0.508 ms/op; `scanInlineInner` 0.459 ms/op; `parseBlockInner` 0.333 ms/op | `scanInlineInner` 838.244 KiB/op; `matchEmphasis` 483.048 KiB/op; `parseParagraph` 440.536 KiB/op |

## Reproduction

Build both checkouts. Run the scripts from the candidate checkout:

```sh
npm run build
node scripts/check-parser-costs.mjs /path/to/baseline/dist/index.js
node scripts/bench-parser-followups.mjs /path/to/baseline/dist/index.js reports/parser-followups.json
node scripts/profile-position-removal.mjs /path/to/baseline/dist/index.js reports/position-removal.json
gzip -n reports/parser-followups.json reports/position-removal.json
node scripts/report-parser-followups.mjs
```

The differential checker compares full ASTs, position-free ASTs and HTML across
2,134 corpus documents and 3,000 deterministic generated sources. The benchmark
also checks both AST variants and HTML before timing each fixture. Regression
tests cover extension matching, abbreviation expansion, nested definitions,
opaque code, shared/cyclic objects and inherited properties.
