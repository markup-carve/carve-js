# carve upgrade

Rewrites a Carve 0.1 document into Carve 0.2 so that it renders the same.

```
node upgrade/src/cli.ts [--check] [--write] [--json] [--force] FILE...
```

- Without `--write` the rewritten source of one file goes to stdout and the report to stderr.
- `--write` writes each file in place. A file whose HTML differs in a way no contract entry
  explains is not written unless `--force` is given.
- `--check` writes nothing and exits 1 when a file would change or needs a person.
- `--json` prints the report as JSON on stdout.

Exit status: 0 when nothing needs a person, 1 when a report entry hit or the self-check found a
difference, 2 for a usage error.

As a function:

```ts
import { upgrade } from './src/index.ts'

const { output, records, check } = upgrade(source)
```

## How it works

The tool reads the input with the 0.1 engine of this repository (the build of `src/` in
`dist/`, so run `npm ci` or `npm run build` at the repository root first), collects edits from
the 0.1 tree and its positions, and applies them from the end of the text backward. It changes
only the spans a contract entry names. It then renders the input with the 0.1 engine and the
output with the 0.2 engine (`v2/`) and compares the HTML after sorting attributes and dropping
whitespace between tags.

Each record of the report names a contract entry (`U-001` onward, see `data/entries.json`), its
class (`rewrite`, `escape`, `report`), the line of the input and the 0.2 lint rule where one
exists. The self-check adds `upgrade-mismatch` for a difference no entry explains, and one
`U-019` summary line that counts the later paragraphs of list items that gain a paragraph
element in 0.2.

The entries `X-001` and `X-002` are the tool's own: a bidirectional control in text or code is
removed and U+0000 is written as U+FFFD, because 0.1 did that in its output and the 0.2
specification has no clause for either.

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
