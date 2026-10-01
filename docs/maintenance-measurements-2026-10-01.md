# Engine maintenance measurements, 2026-10-01

Historical main baseline: `2047ff7c863c2ddb58dbd5b8b6ddadee4f071c05`. Candidate: `quality/measured-maintenance-20261001`.

The PR was rebased onto main `e347afe75246c9209496d1ee62298ed363769d31`. Intervening commits changed release versions and notes; production parser and importer code did not change.

## Maintenance and verification

| Measure | Before | After |
| --- | ---: | ---: |
| Production files explicitly covered by indexed-access checking | 32 | 116 |
| Diagnostics when checking all production files | 42 | 0 |
| Independently maintained child-field rosters in conversion, diff, sidecars, coalescing | 4 | 1 |

The shared registry derives membership from generated schema slots and keeps an explicit document-order priority. Unknown schema slots append automatically. Runtime definition records and ruby pairs retain their own fields. Diffs now descend into citation fields, replacement arms, short captions, and singleton fallbacks; callers receive child paths for those changes. Source-line recording replaces the separate verse scope machine.

Validation: 32,203 tests passed and 88 were skipped in the full suite. The related ownership, diff, sidecar, and matcher tests also passed in a 47-test focused run. Type checks, typed lint, package consumer checks, and browser parity passed. Browser bundles matched 2,201 corpus documents and 16 API probes.

## Timing measurements

Three warmups and seven timed samples per case. The table shows median milliseconds for this engine. Both revisions run the same harness and inputs on this host. [maintenance-results.json](../benchmarks/maintenance-results.json) retains medians, minima, input bytes, and SHA-256 output hashes.

| Case | Size | Before ms | After ms | After / before | Same output hash |
| --- | ---: | ---: | ---: | ---: | --- |
| quoted_fences | 128 | 1.638 | 2.466 | 1.505 | yes |
| verse_definitions | 128 | 2.870 | 3.936 | 1.371 | yes |
| paragraphs | 128 | 0.318 | 0.289 | 0.907 | yes |
| quoted_fences | 1024 | 3.939 | 4.601 | 1.168 | yes |
| verse_definitions | 1024 | 11.629 | 9.115 | 0.784 | yes |
| paragraphs | 1024 | 0.845 | 1.264 | 1.495 | yes |
| quoted_fences | 4096 | 14.434 | 12.885 | 0.893 | yes |
| verse_definitions | 4096 | 38.243 | 32.681 | 0.855 | yes |
| paragraphs | 4096 | 3.463 | 3.237 | 0.935 | yes |

Wall-clock results are local medians from a shared host. They are not CI thresholds or release performance guarantees. Compare before and after within this engine. Output hashes distinguish equivalent-output workloads from corrected behavior. Conversion runs in process. Timing changes vary across sizes. Verse collection now checks for opaque spans that protect colon closers. The structural definition pass adds work when both verse and definition candidates occur. Indexed-access checks cover all source files; typed ESLint remains scoped to 33 files.

## Reproduce

Install locked dependencies in both worktrees and pass each absolute worktree path to the candidate harness. Build each worktree with `npm run build`. To reproduce the full-source indexed-access comparison, run `npx tsc --noEmit --noUncheckedIndexedAccess` in each worktree.

```sh
node benchmarks/maintenance.mjs /absolute/path/to/built/worktree
```

## Remaining maintenance

The five cases in [verse-oracle-cases.json](../benchmarks/verse-oracle-cases.json) include source and rendered results from all engines and executable spec commit `e12ed741313c16185375e6f17b0cc6fe3e4366c2`. TypeScript and Rust match all five cases after trimming outer whitespace. PHP matches the definition-after-verse case and disagrees on four existing verse cases. The prose grammar describes fence openers inside verse as ordinary text, while the executable oracle protects colon closers inside closed opaque spans. The TypeScript and Rust changes follow the executable oracle; that grammar disagreement remains explicit.

Large verse documents still require an extra structural pass when definitions are possible. Extension callbacks can run during probes, as in existing lazy-boundary probes. Future parsing changes should extend the oracle cases and keep document order stable.
