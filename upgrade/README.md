# carve upgrade

Rewrites a Carve 0.1 document into Carve 0.2 so that it renders the same.

For the 0.1 `wikilinks` host extension, `[[Page]]` becomes `:wiki[Page]` and `[[Page|Display]]` becomes `:wiki[Page|Display]`. For its `samp` semantic span, `:samp[x]` becomes `[x]{samp}`. These source rewrites apply only where the 0.1 host registered the named extension (U-423 to U-425); check host registrations when migrating documents.

```
node upgrade/src/cli.ts [--check] [--write] [--json] [--force] [--registered-extension=wikilinks|samp] FILE...
```

- Without `--write` the rewritten source of one file goes to stdout and the report to stderr.
- `--write` writes a file only when its self-check is `pass` or `explained`.
- `--force` is accepted by both commands for existing scripts. It does not override the HTML check or permit a mismatched rewrite to be written.
- `--check` writes nothing and exits 1 when a file would change or needs a person.
- `--json` prints the report as JSON on stdout.
- `--registered-extension` may be repeated for the default 0.1 `wikilinks` and `samp` hosts. The rewrite is kept only when the registered old and new hosts render alike; a mismatch blocks `--write`.

Exit status: 0 when nothing needs a person, 1 when a report entry hit or the self-check found a
difference, 2 for a usage or file I/O error. Malformed UTF-8 is an unreadable-input error;
`--write` leaves its bytes untouched.
Pure CRLF input is rewritten with LF internally and returned with CRLF. The command reads every
input before it writes any file, so an unreadable file prevents writes to earlier files.

As a function:

```ts
import { canWriteUpgrade, upgrade } from './src/index.ts'

const result = upgrade(source, ['wikilinks'])
const writable = canWriteUpgrade(result)
```

## How it works

The tool reads the input with the frozen 0.1 engine in `engine-0.1/` (its build in
`build/engine-0.1/`, so run `npm ci` or `npm run build` at the repository root first), collects edits from
the 0.1 tree and its positions, and applies them from the end of the text backward. It changes
only the spans a contract entry names. It then renders the input with the 0.1 engine and the
output with the 0.2 engine (`src/` of the repository). The check sorts attributes, lowercases HTML attribute names,
and drops layout whitespace between
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
An unexplained HTML difference with no mapped upgrade row carries the blocking JSON status
`no mapped row` and the differing source range.

The entries `X-001` and `X-002` are the tool's own `none` entries. The 0.2 engine handles
bidirectional controls and U+0000 itself (C2-H-172, C2-B-218), so the tool leaves their source unchanged.
U-183 escapes an unresolved block image reference above a caption, such as `![a][r]` over `^ cap`: 0.2 makes it a
figure (C2-B-147), so a backslash keeps the 0.1 paragraph.

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
