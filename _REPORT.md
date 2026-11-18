# Carve 0.2 engine lane report

Pinned spec `6bdc5a26`; engine started at `5d0041d3`. Fresh clones: spec `next2` read only, engine `next2`, and 0.1 `main` read only. `_IN/PIN.md` was absent, so the pin stayed fixed.

Corpus: **1,600 total; 1,586 pass; 14 held** for existing example fixes. No corpus case was changed.

| Item | Result | Commits |
| --- | --- | --- |
| 1, engine defects and O3 | Source budget, tabs label, source length, import loss, extension write and depth, writer paths, lint defects fixed; CC-811 range awaits the later pin. | `f0dd941f`–`f84e50bf`, `c5b14472`, `d6d71787` (17 commits) |
| 2, lint rules | Skipped by the addendum; no `_IN/PIN.md`. | none |
| 3, upgrade and O1 | All `NOT_YET` rows removed. Exact catalog rewrites are HTML verified; kept differences produce manual records. General rewrite interactions remain open. | `0a08d5b0`, `7749cbf6` |
| 4, writer and O2 | Deep image, comment-bracket and reference-label plan misses routed to repair. Both planner classes reverted after byte differences. | `f0b29dce`, `5b32c73a`, `70e2fcb5`, `70b12e4a`, `c2ee4ac5`–`a7e4bb0c` (10 code commits) |

The 0.1 replay has 9,746 inputs. Mismatch groups by cited map action:

| Group | Before | After |
| --- | ---: | ---: |
| Report only, manual | 777 | 775 |
| Report plus rewrite | 358 | 358 |
| Rewrite only | 101 | 101 |
| No row cited | 131 | 125 |
| **Total** | **1,367** | **1,359** |

The earlier audit counted 17 postponed extension mismatches; this replay did not reproduce their exact partition, so the group totals include them without cause analysis. `_SPEC_GAPS.md` contains 31 unresolved clause readings and 11 minimal no-exact-row upgrade causes. `_EXAMPLE_FIXES.md` adds the U-206/U-366 contract conflict. `_OPEN.md` lists the remaining rewrite and attribution work.

Writer repaired groups per matched 20,000 inputs: inline contents **905 → 916**, documents **1,951 → 1,969**, mixed property stream **10,977 → 11,058**. The pipe trial reached 10,973 on the mixed stream but added four byte differences (15 versus 11 in the baseline), so it was reverted. The backtick trial also changed exact bytes and was reverted. The final mixed byte difference count is 10.

Short gates: `test:v2` 3,549 pass and 8 skipped; lint, CLI, import, upgrade, migrate, typecheck,
ESLint, build, and corpus passed. Local plan check: 1,020,898 inputs, zero misses. Random:
5,000,000 contents and 500,000 documents, zero failures or undecided groups.
Code-push long gates passed: four writer tokens, five inline tokens, four lines, tree enumerators,
stress, fuzz, and 100,000 schema mutants (0 engine-only, 254 schema-only disagreements).

Speed A/B against `5d0041d3`, three quiet 41-round runs: parse ratios **0.988–1.004**,
render **1.047–1.057** (about 5% slower), format **0.967–1.000**.
Workflows on the code push: CI, import, upgrade, and block-core green.
