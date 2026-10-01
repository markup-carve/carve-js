# Engine maintenance measurements, 2026-10-01

Baseline: `2047ff7c863c2ddb58dbd5b8b6ddadee4f071c05` on `main`. Candidate: `quality/measured-maintenance-20261001`.

## Maintenance and verification

| Measure | Before | After |
| --- | ---: | ---: |
| Production files explicitly covered by indexed-access checking | 32 | 116 |
| Diagnostics when checking all production files | 42 | 0 |
| Independently maintained child-field rosters in conversion, diff, sidecars, coalescing | 4 | 1 |

The shared registry derives membership from generated schema slots and keeps an explicit document-order priority. Unknown schema slots append automatically. Runtime definition records and ruby pairs retain their own fields. Diffs now descend into citation fields, replacement arms, short captions, and singleton fallbacks; callers receive child paths for those changes. Source-line recording replaces the separate verse scope machine.

Validation: 32,202 tests passed and 88 were skipped in the full suite. The final added diff-path test and related ownership, sidecar, matcher tests passed in a 46-test focused run. Type checks, typed lint, package consumer checks, and browser parity passed. Browser bundles matched 2,201 corpus documents and 16 API probes.

## Timing measurements

Three warmups and seven samples per case for TypeScript and Rust; PHP uses two warmups and seven samples. The table shows median milliseconds. Both revisions run the same harness and inputs on this host. Results retain median, minimum, input bytes, and SHA-256 output hashes in [maintenance-results.json](../benchmarks/maintenance-results.json).

| Case | Size | Before ms | After ms | After / before | Same output hash |
| --- | ---: | ---: | ---: | ---: | --- |
| quoted_fences | 128 | 1.917 | 2.329 | 1.215 | yes |
| verse_definitions | 128 | 4.243 | 4.767 | 1.123 | yes |
| paragraphs | 128 | 0.458 | 0.363 | 0.791 | yes |
| quoted_fences | 1024 | 3.694 | 6.511 | 1.763 | yes |
| verse_definitions | 1024 | 12.063 | 9.266 | 0.768 | yes |
| paragraphs | 1024 | 0.886 | 0.974 | 1.099 | yes |
| quoted_fences | 4096 | 11.941 | 15.418 | 1.291 | yes |
| verse_definitions | 4096 | 38.012 | 32.738 | 0.861 | yes |
| paragraphs | 4096 | 5.208 | 3.836 | 0.737 | yes |

Wall-clock results are local medians, not CI thresholds or release performance guarantees. The host was shared; small changes can reflect scheduler noise. Output hashes permit comparison without discarding behavior changes. TypeScript and PHP use in-process conversion; Rust uses the CLI, including process startup and serialization. Compare before and after within one engine, not absolute times across engines.

## Reproduce

Build both worktrees and install their locked dependencies. Pass each absolute worktree path to the candidate harness. For Rust, build both binaries with `CARGO_PROFILE_DEV_OPT_LEVEL=2` and copy each binary before building the other revision when using a shared target directory.

```sh
node benchmarks/maintenance.mjs /absolute/path/to/built/worktree
```

## Final review and remaining maintenance

Local Claude CLI reviewed the completed diff. Review findings were checked against source, tests, and the current executable spec. Traversal order, list-opener context, source-line ownership, cached lookahead, and importer validation costs were corrected during review.

The five cases in [verse-oracle-cases.json](../benchmarks/verse-oracle-cases.json) include source and rendered results from all engines and executable spec commit `e12ed741313c16185375e6f17b0cc6fe3e4366c2`. TypeScript and Rust match all five cases. PHP matches the definition-after-verse case and disagrees on four existing verse cases. The prose grammar describes fence openers inside verse as ordinary text, while the executable oracle protects colon closers inside closed opaque spans. The TypeScript and Rust changes follow the executable oracle; that grammar disagreement remains explicit.

Large verse documents still require an extra structural pass when definitions are possible. Extension callbacks can run during probes, as in existing lazy-boundary probes. Future parsing changes should extend the oracle cases and keep document order stable.
