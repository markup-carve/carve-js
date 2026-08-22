# RFC: source-authoritative editor API

> **Status: draft for review.** This proposes a public API; nothing is exported
> by `@markup-carve/carve` yet.

This is the carve-js companion to the Carve
[editor source map RFC](https://github.com/markup-carve/carve/pull/1519). It is
for Obsidian-style Live Preview: source remains authoritative while an editor
hides delimiters, styles semantic ranges and places widgets over source ranges.
HTML is a render target, never the editing interchange format.

## Goals and non-goals

The API needs exact document-space UTF-16 ranges, lossless edits through nested
blocks/tables/footnotes/attributes/extensions, immutable worker-safe snapshots,
and typed refusal instead of unrelated canonicalization. The first correct
implementation may fully reparse; sub-linear parsing is not an initial claim.

It does not promise stable node identity across arbitrary edits, regenerate an
author's source from mutated AST JSON, depend on one editor framework, or map
render-extension output to fictional source.

## Proposed API

```ts
export interface EditorOffsetRange { start: number; end: number }
export interface EditorSelection { anchor: number; head: number }

export interface EditorToken {
  role:
    | 'block-marker' | 'open-marker' | 'close-marker' | 'content'
    | 'destination' | 'attribute' | 'fence-open' | 'fence-close'
    | 'table-marker' | 'caption-marker' | 'frontmatter-fence' | 'escape'
  range: EditorOffsetRange
}

export interface EditorMappedNode {
  path: string
  range: EditorOffsetRange
  tokens: readonly EditorToken[]
}

export interface EditorDiagnostic {
  code: string
  severity: 'info' | 'warning' | 'error'
  message: string
  range?: EditorOffsetRange
}

export interface EditorSnapshot {
  readonly revision: number
  readonly source: string
  readonly ast: AstJsonDocument
  readonly nodes: readonly EditorMappedNode[]
  readonly unmapped: readonly {
    path: string
    reason: 'generated' | 'recovered' | 'extension' | 'unmeasured'
  }[]
  readonly diagnostics: readonly EditorDiagnostic[]
}

export interface EditorChange { from: number; to: number; insert: string }
export interface EditorUpdate extends EditorSnapshot {
  readonly changedPaths: readonly string[]
}

export interface EditorSession {
  snapshot(): EditorSnapshot
  update(changes: readonly EditorChange[]): EditorUpdate
  command(command: EditorCommand): EditorCommandResult
}

export function createEditorSession(
  source: string,
  options?: ParseOptions & EditorOptions,
): EditorSession
```

Changes use the previous snapshot's UTF-16 coordinates. They must be sorted,
non-overlapping, in bounds and on Unicode scalar boundaries. Invalid input
throws `EditorChangeError` without advancing the revision. Every result is a
complete immutable snapshot; `changedPaths` is only a performance hint.

The first implementation should apply changes and fully reparse. The API does
not call a parser incremental merely because its input is a change set.

## Commands

Commands describe author intent without exposing parser internals:

```ts
export type EditorCommand =
  | { type: 'toggle-inline'; kind: 'strong' | 'emphasis' | 'underline' |
      'strikethrough' | 'highlight' | 'superscript' | 'subscript' | 'code';
      selection: EditorSelection }
  | { type: 'set-block'; kind: 'paragraph' | 'heading' | 'quote' | 'code';
      level?: 1 | 2 | 3 | 4 | 5 | 6; selection: EditorSelection }
  | { type: 'set-link'; selection: EditorSelection; destination?: string }
  | { type: 'table-row'; at: number; action: 'insert-before' |
      'insert-after' | 'delete' }
  | { type: 'table-column'; at: number; action: 'insert-before' |
      'insert-after' | 'delete' }
  | { type: 'table-cell'; at: number; header?: boolean;
      align?: 'left' | 'center' | 'right' | null }

export type EditorCommandResult =
  | { ok: true; changes: readonly EditorChange[];
      selection: EditorSelection; update: EditorUpdate }
  | { ok: false; reason: 'unmapped-range' | 'ambiguous-selection' |
      'invalid-structure' | 'unsupported-node' | 'stale-revision';
      message: string; range?: EditorOffsetRange }
```

A successful command changes only the smallest authored ranges needed. It must
not run `carveToCarve` over a document/containing block as a shortcut. Refusal
never changes session state. Table commands need a logical grid for spans;
inserting through a span follows an accepted policy or refuses. Empty cells are
source cells, not hard-break paragraphs.

## Incomplete source while typing

Ordinary incomplete input must yield a complete snapshot, mapped recovery
regions where honest, and diagnostics rather than exceptions. Consumers reveal
source for an unmapped region rather than showing a stale widget. Fatal resource
limits remain exceptions and do not advance the session.

## Extensions

Parse-time extensions may optionally supply editor ranges and commands if the
spec permits namespaced roles. Render-only extensions cannot participate.
Unknown authored extension nodes retain an outer range when possible and list
unmeasured interiors explicitly.

## CodeMirror adapter (separate package)

`@markup-carve/codemirror` should own framework integration:

```ts
export function carveLanguage(options?: CarveLanguageOptions): Extension
export function carveLivePreview(options?: CarvePreviewOptions): Extension
export function carveCommands(session: EditorSession): KeyBinding[]
```

It converts transactions to changes, requests a snapshot, and decorates token
roles. Delimiters reveal when selection intersects their node; block widgets
appear only while selection is outside the block. CodeMirror remains the only
undo history.

## Performance and worker plan

Phase 1 establishes correctness with synchronous full reparses and benchmarks
10 KiB, 100 KiB and 1 MiB. Phase 2 adds cooperative scheduling/worker support;
responses carry revisions and stale results are discarded. Phase 3 may reuse
unchanged blocks only when property tests prove byte-for-byte equality with a
fresh parse.

Suggested budgets, subject to measurement:

- 100 KiB full snapshot p95 below 16 ms on the supported Node baseline;
- one-character edit in 1 MiB below 50 ms after incremental reuse ships;
- stale-result handling below one animation frame in the adapter.

## Required tests before export

1. Shared spec fixtures for every node and token role.
2. Astral Unicode and mixed-line-ending equivalence.
3. Nested containers and hoisted definitions in document space.
4. Random change sequences equal fresh parsing.
5. Commands preserve every unrelated source byte.
6. Typed refusals for unmapped/ambiguous structures.
7. Worker revision races and cancellation.
8. CodeMirror IME, bidi selection, undo/redo and mobile smoke tests.

## Review decisions

1. Mutable session returning immutable snapshots, or a pure update function?
2. Commands in core or a companion package?
3. Runtime UTF-16 only, or paired UTF-16/UTF-8 ranges like exchange?
4. Recovered literal text mapped normally or always listed as unmapped?
5. Which table-span policy should axis commands standardize?

No API should be exported until the spec contract is accepted or the names
clearly communicate experimental status.
