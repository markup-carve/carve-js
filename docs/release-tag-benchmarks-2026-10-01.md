# Release tag benchmark comparison, 2026-10-01

The candidate `dev-main` is [PR #2442](https://github.com/markup-carve/carve-js/pull/2442) based on main `e347afe75246c9209496d1ee62298ed363769d31`, including the completed engine maintenance fixes. The PR remains a separate branch; these results do not imply a merge into main. The latest two remote Git tags at measurement time were `0.1.9` and `0.1.8`.

Measured revisions:

- `dev-main`: `b81fe8fc07a78e4b7d9298f55e1f72eb56017c59`
- `0.1.9`: `a0cb0ad18fc4da223e46cfb77672e4dec537a83b`
- `0.1.8`: `23204e8982012a4b3900dc735e46b3c2630803c2`

## Method

Each revision ran in a separate process. Three rounds rotated the order of dev-main and both tags. Each case used seven timed samples per round, for 21 samples per revision and size. Three warmups preceded each case in each round. Medians below pool all 21 samples. The host is x86_64 with Node 22.22.2.

The workload generators and sizes are identical across revisions of this engine. `mixed_document` includes unique headings, emphasis, a reference link, inline code, lists, and pipe tables. Other cases exercise repeated quoted verse fences, literal definition-shaped verse lines, plain paragraphs, or block-cell HTML import. Timing includes in-process conversion.

The source fixtures are generated outside the timed region. Percentages use `100 * (dev / tag - 1)`; negative values mean faster. Small changes should be read against the retained sample variation on this shared host. Every fixture's byte length and output hash remained stable across all three rounds within each revision. All output hashes match both tags.

## Largest cases

- `quoted_fences`, 4096: 13.84 ms; +20.2% versus `0.1.9`, +5.0% versus `0.1.8`.
- `verse_definitions`, 4096: 32.90 ms; +14.3% versus `0.1.9`, +5.4% versus `0.1.8`.
- `paragraphs`, 4096: 3.69 ms; +4.7% versus `0.1.9`, +9.7% versus `0.1.8`.
- `mixed_document`, 4096: 629.98 ms; -0.4% versus `0.1.9`, -0.4% versus `0.1.8`.

## All measured differences

| Case | Size | Dev ms | 0.1.9 ms | Change | 0.1.8 ms | Change | Output hashes match both tags |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| quoted_fences | 128 | 2.048 | 1.360 | +50.6% | 1.898 | +7.9% | yes |
| verse_definitions | 128 | 3.454 | 2.723 | +26.9% | 2.652 | +30.3% | yes |
| paragraphs | 128 | 0.282 | 0.310 | -9.2% | 0.235 | +19.9% | yes |
| mixed_document | 128 | 2.747 | 3.223 | -14.8% | 2.363 | +16.2% | yes |
| quoted_fences | 1024 | 3.940 | 3.591 | +9.7% | 3.620 | +8.8% | yes |
| verse_definitions | 1024 | 8.797 | 7.528 | +16.8% | 7.106 | +23.8% | yes |
| paragraphs | 1024 | 0.734 | 0.773 | -5.0% | 0.771 | -4.7% | yes |
| mixed_document | 1024 | 29.155 | 28.740 | +1.4% | 29.905 | -2.5% | yes |
| quoted_fences | 4096 | 13.843 | 11.521 | +20.2% | 13.178 | +5.0% | yes |
| verse_definitions | 4096 | 32.897 | 28.792 | +14.3% | 31.198 | +5.4% | yes |
| paragraphs | 4096 | 3.687 | 3.519 | +4.7% | 3.360 | +9.7% | yes |
| mixed_document | 4096 | 629.976 | 632.196 | -0.4% | 632.726 | -0.4% | yes |

[Raw samples and hashes](../benchmarks/release-tag-results.json) include the measured commits and initial/final host load. [Maintenance measurements](maintenance-measurements-2026-10-01.md) record the static code-quality changes and remaining maintenance debt.

## Reproduce

Create detached worktrees for both tags. Prepare each built worktree, and the candidate, with the same runtime. Build both tags with `npm run build` using the same locked development dependencies as the candidate.

Run from the candidate worktree, substituting absolute paths:

```sh
python3 benchmarks/compare-revisions.py --engine js \
  --harness "$PWD/benchmarks/maintenance.mjs" \
  --revision dev-main=/absolute/path/to/candidate \
  --revision 0.1.9=/absolute/path/to/latest-tag \
  --revision 0.1.8=/absolute/path/to/previous-tag \
  --output /tmp/release-tag-results.json
```

The comparison wrapper enables the mixed-document case, resolves commits from each repository, rotates revision order, and refuses unstable input bytes or output hashes across rounds.
