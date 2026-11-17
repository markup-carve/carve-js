# Open work at the pinned 0.2 engine

## Upgrade parity

The present replay has 9,746 inputs and 1,359 residual `upgrade-mismatch` results. The 0.1 engine came from
the fresh read-only `main` checkout. The old engine output was written with `process.stdout.write`.

| Cause indicated by tool records | Before | After | Next work |
| --- | ---: | ---: | --- |
| Kept difference, report row only | 777 | 775 | Confirm the cited row's manual action and avoid claiming parity. |
| Mixed report and rewrite rows | 358 | 358 | Separate the kept difference from the failed rewrite. |
| Rewrite or escape rows only | 101 | 101 | Repair the proposed rewrite and verify old/new HTML. |
| No row cited by the tool | 131 | 125 | Audit map coverage; add a spec gap only when no row covers the cause. |

The catalog executor currently recognizes exact whole-document examples for the 23 pending rewrite and escape
rows. It verifies old/new HTML before applying them. General occurrences and interactions need rule implementations.
The largest rewrite-only failures are U-038 (32), U-001 (9), U-065 (8), U-014 (6), U-069 (6), and U-116 (6).
For example, U-065 turns `_*`/`/*a*/_` into a braced underline but the nested strong and emphasis still differ.
The preceding report's 17 postponed extension mismatches were counted without cause analysis. The present
replay's simple extension detector finds 2, so its 17-case partition has not been independently reproduced.

The earlier parity audit found 24 previously unrecorded cause clusters. Eleven minimal inputs still differ
at this pin and have no exact source map row; their two HTML readings are in `_SPEC_GAPS.md`.

## Writer planner

The backtick-before-code-span class was reverted completely. It can move the leftmost escape to the wrong
delimiter. On source `*` followed by an escaped backtick, `*𫐍`*`, the plan kept the first star bare while
the byte-exact repair escaped it. The `both` path's `differences` array exposed it. The planner needs the delimiter's
precedence over the later code span before this class can leave the repair loop.

The line-start pipe class was also reverted completely. A 2,000-input sample showed no byte difference,
but the matched 20,000-input stream exposed four additional plan-versus-repair differences: 15 with the
class versus 11 before it. It lowered repaired groups from 10,977 to 10,973, but the exact-byte rule has
priority. The remaining `line start |` cases require a planner rule that models row-attribute and comment
precedence together. The repair loop remains intact.

The deep quote image plan-check miss now enters the repair, which reports `structure-unspellable` for its
unspellable image. A verified long plan check is still required on the final code.

## Specification and lint pin

`_IN/PIN.md` was absent at the start. The engine stays at specification commit `6bdc5a26`. The 84-rule lint
sweep, later position rules, and command line changes of item 2 await the subsequent pin lane. The pinned
corpus has 1,600 cases, 1,586 passing and 14 held for specification example fixes.

CC-811 reports `semantic-attribute-outside-span` but begins at byte 0; the newer case expects column 2.
The later C2-W-138 range rule belongs to the skipped lint pin move. The 31 earlier clause-unclear cases
are listed with inputs and both readings in `_SPEC_GAPS.md`.

### Rewrite-only groups in the replay

| Map entries cited | Before | After |
| --- | ---: | ---: |
| U-038 | 32 | 32 |
| U-001 | 9 | 9 |
| U-065 | 8 | 8 |
| U-014 | 6 | 6 |
| U-069 | 6 | 6 |
| U-116 | 6 | 6 |
| U-057 | 4 | 4 |
| U-002 | 4 | 4 |
| U-004 | 4 | 4 |
| U-039 | 4 | 4 |
| U-016 | 2 | 2 |
| U-063 | 2 | 2 |
| U-109 | 2 | 2 |
| U-005,U-038 | 2 | 2 |
| U-010,U-038 | 2 | 2 |
| U-006,U-109 | 2 | 2 |
| U-111,U-113 | 2 | 2 |
| U-006 | 2 | 2 |
| U-009 | 2 | 2 |
