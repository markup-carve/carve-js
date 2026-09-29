# Parser traversal and Unicode measurements

Baseline: `45bbec34edd9d446ba9e78e8031e33c916473923`. Recorded 2026-09-29T22:53:17.933Z
on v24.19.0, AMD Ryzen 9 PRO 7940HS w/ Radeon 780M Graphics. The [observations](parser-next-five.json.gz)
record source/build hashes, five timing batches per worker, CPU profiles and
sampled allocation. Two worker rounds reverse baseline/candidate order.

## Changes

- Position removal visits children before deleting position fields. It skips
  those fields during traversal and still deletes non-enumerable own positions.
- Container lexers share collected immutable line arrays. Offset mapping builds
  the parent's line-number index only when literal strip origins cannot anchor a line.
- Ordinary non-ASCII text joins the existing plain-text paths. Every ASCII
  syntax opener and active extension matcher retains the authoritative scan.
- Reference resolution skips empty definition maps and keeps child arrays while
  resolving nodes in place. Unresolved heading references remain available.
- The two deep-quote scaling guards use batches of at least 20 ms, warm both
  sizes and retain the 2× per-byte threshold, reversed order and five rounds.

## Parse and render observations

Allocation is sampled churn, including collected objects, not peak or retained
memory. Profiles run separately from timing. Each raw observation retains the
64 largest CPU and heap frames, omitted counts and full sampled allocation totals.
Host one-minute load ranged from 7.74 to 22.13 on 16 logical CPUs.
Process CPU includes worker CPU consumed during a timed batch; it excludes
time waiting to be scheduled, but does not remove frequency and GC variation.
Both timing rounds remain visible; these results do not establish a general
speed ranking or attribute every difference to an individual change.

| Fixture | API | Input bytes | Baseline wall ms, rounds 1 / 2 | Candidate wall ms, rounds 1 / 2 | Baseline CPU ms, rounds 1 / 2 | Candidate CPU ms, rounds 1 / 2 | Sampled KiB/op, baseline → candidate |
|---|---|---:|---:|---:|---:|---:|---:|
| plain-paragraphs | parse | 12288 | 2.604 / 2.672 | 1.989 / 3.098 | 4.044 / 3.997 | 2.945 / 4.839 | 1769.5 → 1580.1 |
| plain-paragraphs | no-positions | 12288 | 4.264 / 4.321 | 3.558 / 3.251 | 6.802 / 6.443 | 5.444 / 5.052 | 2616.8 → 2321.2 |
| plain-paragraphs | html | 12288 | 1.339 / 1.539 | 1.356 / 1.378 | 1.400 / 1.552 | 1.565 / 1.538 | 1107.9 → 1104.8 |
| literal-bracket | parse | 12289 | 5.271 / 6.436 | 3.949 / 5.299 | 6.582 / 6.732 | 4.946 / 7.021 | 1766.6 → 1575.1 |
| literal-bracket | no-positions | 12289 | 11.140 / 11.371 | 12.807 / 10.335 | 11.247 / 12.103 | 13.116 / 10.656 | 2630.1 → 2320.7 |
| literal-bracket | html | 12289 | 8.673 / 10.673 | 10.371 / 9.155 | 11.524 / 13.928 | 12.599 / 11.989 | 3769.3 → 3489.3 |
| inline-links | parse | 11264 | 10.063 / 6.310 | 6.733 / 7.749 | 10.247 / 7.631 | 8.616 / 8.633 | 2540.8 → 2336.4 |
| inline-links | no-positions | 11264 | 5.126 / 11.146 | 12.971 / 12.928 | 7.599 / 13.722 | 12.903 / 11.825 | 3487.9 → 3128.5 |
| inline-links | html | 11264 | 2.802 / 1.245 | 1.947 / 2.183 | 2.323 / 1.576 | 2.194 / 2.557 | 1057.0 → 925.5 |
| sparse-definitions | parse | 12302 | 8.540 / 8.872 | 16.916 / 9.268 | 15.899 / 16.078 | 20.324 / 15.046 | 4109.0 → 3968.0 |
| sparse-definitions | no-positions | 12302 | 14.125 / 8.647 | 8.910 / 8.276 | 22.750 / 14.028 | 14.883 / 14.676 | 4981.7 → 4760.6 |
| sparse-definitions | html | 12302 | 0.721 / 0.713 | 0.706 / 0.710 | 0.834 / 0.826 | 0.834 / 0.817 | 1111.8 → 1106.2 |
| dense-definitions | parse | 10277 | 6.332 / 6.263 | 5.641 / 6.337 | 10.427 / 10.024 | 10.247 / 10.067 | 4772.7 → 4579.3 |
| dense-definitions | no-positions | 10277 | 5.970 / 7.851 | 7.127 / 7.907 | 10.571 / 13.168 | 11.631 / 12.191 | 5696.5 → 5403.6 |
| dense-definitions | html | 10277 | 7.798 / 6.869 | 7.189 / 5.670 | 15.103 / 12.667 | 12.602 / 9.953 | 6892.5 → 6641.7 |
| quotes-32 | parse | 68 | 0.051 / 0.103 | 0.051 / 0.060 | 0.078 / 0.177 | 0.077 / 0.092 | 129.3 → 122.1 |
| quotes-32 | no-positions | 68 | 0.167 / 0.202 | 0.281 / 0.191 | 0.250 / 0.295 | 0.256 / 0.277 | 161.9 → 151.9 |
| quotes-32 | html | 68 | 0.250 / 0.304 | 0.215 / 0.286 | 0.378 / 0.394 | 0.352 / 0.408 | 202.2 → 191.7 |
| lists-32 | parse | 68 | 0.437 / 0.320 | 0.282 / 0.332 | 0.550 / 0.486 | 0.440 / 0.521 | 339.3 → 326.0 |
| lists-32 | no-positions | 68 | 0.490 / 0.439 | 0.357 / 0.405 | 0.691 / 0.595 | 0.520 / 0.571 | 406.0 → 397.8 |
| lists-32 | html | 68 | 0.405 / 0.413 | 0.522 / 0.634 | 0.690 / 0.645 | 0.718 / 0.811 | 485.5 → 480.4 |
| quotes-96 | parse | 196 | 0.356 / 0.604 | 0.363 / 0.413 | 0.544 / 0.678 | 0.603 / 0.630 | 414.7 → 392.6 |
| quotes-96 | no-positions | 196 | 0.501 / 0.291 | 0.586 / 0.387 | 0.700 / 0.476 | 0.803 / 0.525 | 495.3 → 470.4 |
| quotes-96 | html | 196 | 0.386 / 0.611 | 0.426 / 0.516 | 0.666 / 0.919 | 0.714 / 0.832 | 667.1 → 644.5 |
| lists-96 | parse | 196 | 0.767 / 0.586 | 0.460 / 0.482 | 1.208 / 1.014 | 0.816 / 0.882 | 1023.8 → 997.6 |
| lists-96 | no-positions | 196 | 0.795 / 0.611 | 0.674 / 0.605 | 1.376 / 0.993 | 1.077 / 0.988 | 1124.5 → 1143.6 |
| lists-96 | html | 196 | 0.731 / 2.450 | 2.053 / 1.294 | 1.244 / 2.777 | 2.408 / 1.734 | 1468.9 → 1378.1 |
| quotes-192 | parse | 388 | 1.588 / 1.193 | 1.474 / 0.738 | 1.689 / 1.460 | 1.654 / 0.860 | 846.9 → 778.4 |
| quotes-192 | no-positions | 388 | 1.271 / 1.238 | 1.213 / 1.217 | 1.708 / 1.840 | 1.523 / 1.705 | 988.7 → 937.9 |
| quotes-192 | html | 388 | 0.563 / 2.011 | 2.063 / 1.695 | 0.974 / 2.516 | 2.455 / 2.254 | 1335.6 → 1291.8 |
| lists-192 | parse | 388 | 2.760 / 4.674 | 3.174 / 4.025 | 3.543 / 4.515 | 3.731 / 4.085 | 1998.5 → 1934.0 |
| lists-192 | no-positions | 388 | 4.474 / 3.641 | 5.358 / 3.133 | 5.550 / 4.487 | 5.178 / 3.931 | 2230.2 → 2163.3 |
| lists-192 | html | 388 | 5.911 / 1.898 | 3.616 / 2.487 | 5.840 / 3.287 | 4.608 / 3.960 | 2836.9 → 2711.2 |
| quotes-body | parse | 1601 | 0.238 / 0.695 | 0.195 / 0.559 | 0.405 / 0.712 | 0.337 / 0.648 | 422.8 → 402.4 |
| quotes-body | no-positions | 1601 | 0.790 / 0.306 | 0.542 / 0.576 | 0.879 / 0.488 | 0.707 / 0.792 | 498.7 → 467.9 |
| quotes-body | html | 1601 | 0.827 / 0.802 | 0.893 / 0.776 | 1.026 / 1.049 | 1.098 / 0.997 | 667.8 → 659.3 |
| lists-body | parse | 1601 | 0.516 / 0.544 | 0.498 / 0.496 | 0.940 / 0.935 | 0.868 / 0.855 | 1036.4 → 1001.8 |
| lists-body | no-positions | 1601 | 0.678 / 0.678 | 0.609 / 0.749 | 1.097 / 1.059 | 0.995 / 1.144 | 1150.9 → 1151.6 |
| lists-body | html | 1601 | 0.725 / 0.759 | 0.821 / 0.716 | 1.266 / 1.316 | 1.335 / 1.163 | 1468.9 → 1475.4 |
| long-ascii | parse | 11265 | 0.041 / 0.040 | 0.040 / 0.039 | 0.047 / 0.046 | 0.046 / 0.044 | 8.4 → 7.0 |
| long-ascii | no-positions | 11265 | 0.042 / 0.045 | 0.042 / 0.044 | 0.050 / 0.053 | 0.049 / 0.050 | 9.8 → 9.4 |
| long-ascii | html | 11265 | 0.093 / 0.088 | 0.092 / 0.093 | 0.103 / 0.098 | 0.107 / 0.108 | 20.1 → 19.7 |
| long-unicode | parse | 11265 | 0.706 / 0.728 | 0.113 / 0.108 | 0.848 / 0.880 | 0.138 / 0.135 | 772.4 → 8.4 |
| long-unicode | no-positions | 11265 | 0.685 / 0.755 | 0.071 / 0.069 | 0.826 / 0.916 | 0.078 / 0.075 | 765.3 → 9.2 |
| long-unicode | html | 11265 | 0.800 / 0.764 | 0.145 / 0.134 | 0.960 / 0.909 | 0.177 / 0.162 | 791.8 → 19.6 |
| unicode-paragraphs | parse | 12288 | 4.639 / 4.648 | 3.716 / 2.793 | 7.615 / 7.320 | 5.612 / 4.084 | 3495.5 → 2129.2 |
| unicode-paragraphs | no-positions | 12288 | 4.920 / 4.365 | 2.826 / 2.987 | 7.406 / 6.353 | 4.074 / 4.131 | 3838.4 → 2325.7 |
| unicode-paragraphs | html | 12288 | 5.728 / 6.310 | 4.222 / 4.280 | 9.284 / 10.644 | 6.635 / 6.977 | 5331.7 → 3826.6 |
| sparse-markup | parse | 10240 | 2.148 / 2.224 | 2.223 / 2.191 | 3.582 / 3.687 | 3.857 / 3.643 | 2343.1 → 2143.0 |
| sparse-markup | no-positions | 10240 | 3.780 / 3.880 | 3.395 / 3.342 | 5.708 / 5.672 | 5.564 / 5.504 | 3324.5 → 2975.6 |
| sparse-markup | html | 10240 | 0.844 / 0.762 | 0.889 / 0.895 | 1.103 / 0.901 | 1.135 / 1.103 | 1086.3 → 1071.4 |

## Position removal alone

Each batch prepares 100 ASTs before timing removal; parsing and GC are outside
that interval. Each tree is checked against position-free parsing afterward.
The [separate profiles](position-removal-next-five.json.gz) include profiler control overhead.

| Fixture | Baseline ms, rounds 1 / 2 | Candidate ms, rounds 1 / 2 | Sampled KiB/op, baseline → candidate |
|---|---:|---:|---:|
| paragraphs | 1.195 / 1.349 | 0.858 / 0.823 | 833.5 → 715.0 |
| definitions | 1.074 / 1.051 | 0.828 / 0.777 | 802.6 → 700.0 |
| quotes | 0.134 / 0.139 | 0.097 / 0.111 | 134.0 → 121.5 |
| lists | 0.284 / 0.277 | 0.223 / 0.216 | 234.8 → 221.9 |

## Sampled implementation hotspots

Frames below are normalized per profile operation and averaged across both
rounds. Runtime frames are excluded from this shortlist but remain in the raw
observations. Self time and allocation identify costs; they do not prove a
cause for every timing difference. Line locations are recorded in the raw data.

| Fixture | Reader | CPU frames | Allocation frames |
|---|---|---|---|
| plain-paragraphs | baseline | `parseBlockInner` 0.382 ms/op; `promoteBlockImages` 0.153 ms/op; `scanInlineInner` 0.150 ms/op | `parseParagraph` 437.987 KiB/op; `scanInlineInner` 280.998 KiB/op; `applyLinkDefs` 180.566 KiB/op |
| plain-paragraphs | candidate | `parseBlockInner` 0.367 ms/op; `parseParagraph` 0.181 ms/op; `scanInlineInner` 0.160 ms/op | `parseParagraph` 439.702 KiB/op; `scanInlineInner` 278.622 KiB/op; `parseBlockInner` 144.845 KiB/op |
| inline-links | baseline | `scanInlineInner` 0.614 ms/op; `parseBlockInner` 0.479 ms/op; `newlineIndices` 0.424 ms/op | `scanInlineInner` 563.858 KiB/op; `buildBracketMap` 318.006 KiB/op; `parseParagraph` 198.489 KiB/op |
| inline-links | candidate | `scanInlineInner` 0.565 ms/op; `parseBlockInner` 0.469 ms/op; `newlineIndices` 0.437 ms/op | `scanInlineInner` 594.920 KiB/op; `buildBracketMap` 315.781 KiB/op; `parseParagraph` 201.965 KiB/op |
| lists-192 | baseline | `parseList` 0.518 ms/op; `parseBlockInner` 0.292 ms/op; `attachBlockPos` 0.070 ms/op | `parseList` 448.189 KiB/op; `attachBlockPos` 129.926 KiB/op; `attachDocumentOffsets` 101.657 KiB/op |
| lists-192 | candidate | `parseList` 0.226 ms/op; `parseBlockInner` 0.084 ms/op; `attachBlockPos` 0.055 ms/op | `parseList` 442.594 KiB/op; `attachBlockPos` 125.866 KiB/op; `attachDocumentOffsets` 99.230 KiB/op |
| quotes-192 | baseline | `parseBlockInner` 0.074 ms/op; `parseBlockQuote` 0.030 ms/op; `attachDocumentOffsets` 0.030 ms/op | `parseBlockQuote` 146.288 KiB/op; `attachDocumentOffsets` 103.386 KiB/op; `attachBlockPos` 51.645 KiB/op |
| quotes-192 | candidate | `parseBlockInner` 0.078 ms/op; `parseBlockQuote` 0.031 ms/op; `attachDocumentOffsets` 0.022 ms/op | `parseBlockQuote` 141.193 KiB/op; `attachDocumentOffsets` 101.245 KiB/op; `nestedSubLexer` 60.733 KiB/op |
| long-unicode | baseline | `smartToken` 0.218 ms/op; `scanInlineInner` 0.213 ms/op; `matchEmphasis` 0.053 ms/op | `matchEmphasis` 478.130 KiB/op; `scanInlineInner` 236.382 KiB/op; `append` 12.323 KiB/op |
| long-unicode | candidate | `toCodepointPositions` 0.041 ms/op; `utf8ByteLength` 0.014 ms/op; `newlineIndices` 0.013 ms/op | `parse` 1.271 KiB/op; `toCodepointPositions` 0.732 KiB/op; `Lexer` 0.559 KiB/op |
| unicode-paragraphs | baseline | `walk` 0.923 ms/op; `scanInlineInner` 0.517 ms/op; `parseBlockInner` 0.375 ms/op | `scanInlineInner` 836.261 KiB/op; `matchEmphasis` 471.542 KiB/op; `parseParagraph` 436.383 KiB/op |
| unicode-paragraphs | candidate | `walk` 0.823 ms/op; `parseBlockInner` 0.399 ms/op; `parseParagraph` 0.146 ms/op | `parseParagraph` 435.373 KiB/op; `scanInlineInner` 280.834 KiB/op; `parseBlockInner` 154.380 KiB/op |

## Verification and limits

The full performance suite passed on the baseline and candidate locally. The
reported failure in #2405 was 2.28× per-byte growth on a short deep-quote sample;
the guard threshold has not been relaxed. The [full GitHub scaling run](https://github.com/markup-carve/carve-js/actions/runs/36642217388)
also passed for source commit `1cc6b3f5b`.
The differential checker covers 2,134 corpus and 3,000 generated sources, full
ASTs, position-free ASTs and HTML. Focused tests cover Unicode, surrogate halves,
line blocks, tables, mixed endings, extension matching and heading fallback.

Shared arrays remove a container copy; they do not eliminate recursive body
collection or make all container processing linear. Internal positions are
still built before removal. Newline indexes keep their existing document cache.

## Reproduction

Build a checkout of the baseline and this branch, then run:

```sh
npm run build
node scripts/check-parser-costs.mjs /path/to/baseline/dist/index.js
node scripts/bench-parser-followups.mjs /path/to/baseline/dist/index.js reports/parser-next-five.json
node scripts/profile-position-removal.mjs /path/to/baseline/dist/index.js reports/position-removal-next-five.json
gzip -n reports/parser-next-five.json reports/position-removal-next-five.json
node scripts/report-parser-next-five.mjs
npm run test:perf
```
