# Source editing sessions

`createEditorSession(source)` returns revisioned snapshots with source, a frozen
AST, mapped syntax ranges, and stable node IDs. Updates take sorted,
non-overlapping `{ from, to, insert }` changes in the previous snapshot's UTF-16
coordinates. Invalid ranges and split surrogate pairs are rejected atomically.

```ts
const session = createEditorSession('first\n\nmiddle\n\nlast')
const update = session.update([{ from: 7, to: 13, insert: 'edited' }])
console.log(update.reusedPreviousTree, update.parsedSourceBytes)
```

A single edit inside a single-line plain paragraph reparses that paragraph and
reuses the other blocks when the document contains only plain paragraphs. The
supported text includes Unicode letters, numbers, combining marks, spaces, and
sentence punctuation (`.`, `,`, `!`, `?`). Structural edits, newlines, multiple
edits, extensions, and parser callbacks use a full parse.

`reusedPreviousTree` reports whether unchanged blocks were reused.
`parsedSourceBytes` counts UTF-8 bytes passed to the parser, including a failed
local attempt before fallback. Layout and identity matching still traverse the
document, so this is not a constant-time update API. The unchanged prefix keeps
its AST objects; following blocks receive updated position records.

Snapshots retain IDs for unchanged source spans. `changedPaths` reports semantic
changes and their ancestors, including reference effects after a full parse.

An empty edit set reuses an eligible plain-paragraph document without parsing.
Other documents and parser configurations follow the full-parse path.
