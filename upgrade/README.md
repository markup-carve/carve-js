# carve upgrade

Rewrites a Carve 0.1 document into Carve 0.2 so that it renders the same.

```
node upgrade/src/cli.ts [--check] [--write] [--json] [--force] FILE...
```

- Without `--write` the rewritten source of one file goes to stdout and the report to stderr.
- `--write` writes a file only when its self-check is `pass` or `explained`.
- `--force` remains accepted for existing scripts, but it cannot override the HTML check.
- `--check` writes nothing and exits 1 when a file would change or needs a person.
- `--json` prints the report as JSON on stdout.

Exit status: 0 when nothing needs a person, 1 when a report entry hit or the self-check found a
difference, 2 for a usage or file I/O error. Malformed UTF-8 is an unreadable-input error;
`--write` leaves its bytes untouched.
Pure CRLF input is rewritten with LF internally and returned with CRLF. The command reads every
input before it writes any file, so an unreadable file prevents writes to earlier files.

As a function:

```ts
import { canWriteUpgrade, upgrade } from './src/index.ts'

const result = upgrade(source)
const writable = canWriteUpgrade(result)
```

## How it works

The tool reads the input with the 0.1 engine of this repository (the build of `src/` in
`dist/`, so run `npm ci` or `npm run build` at the repository root first), collects edits from
the 0.1 tree and its positions, and applies them from the end of the text backward. It changes
only the spans a contract entry names. It then renders the input with the 0.1 engine and the
output with the 0.2 engine (`v2/`). The check sorts attributes and drops layout whitespace between
tags. `explained` requires the cited entries' HTML transformations to reproduce the 0.2 result
exactly. The transformations are in `data/html-transformations.json`; U-019 and U-021 also have
rules for list paragraph wrappers. U-133 handles task item presentation, and U-154 moves a
footnote mark that immediately follows text inside its containing link. Other footnote shapes
remain unverified. A source shape alone never clears the check. The tool discards an edit when
removing it leaves both engines' HTML unchanged; a needless U-037 brace-tail edit remains an
informational `none` record.

Each record of the report names a contract entry (`U-001` onward, see `data/entries.json`), its
class (`rewrite`, `escape`, `report`, or `none`), the line of the input and the 0.2 lint rule where one
exists. A report whose HTML change has no applicable transformation becomes
`unverified explanation`; the remaining difference is also reported as `upgrade-mismatch`. The
self-check adds one
`U-019` summary line that counts the later paragraphs of list items that gain a paragraph
element in 0.2.

The entries `X-001` and `X-002` are the tool's own `none` entries. The 0.2 engine handles
bidirectional controls and U+0000 itself (C2-H-172, C2-B-218), so the tool leaves their source unchanged.

Two edits that touch the same characters: the entry with the lower id applies, the other is
reported as `upgrade-conflict`.

## Checks

```
npm --prefix upgrade test
npm --prefix upgrade run typecheck
npm --prefix upgrade run lint
node upgrade/scripts/corpus.ts --list DIR...
```

`scripts/corpus.ts` runs the tool over every `.crv` file under the directories and prints the
counts per entry and the unexplained differences.
