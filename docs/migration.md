# Migration and linting

Tools for moving Markdown or Djot documents to Carve, and for catching
constructs that would silently mis-render under Carve's rules.

## Migrating from Markdown

`markdownToCarve(md)` rewrites common Markdown into equivalent Carve. It is a
source-to-source transform, not a parser, so it works on raw text and leaves
fenced/inline code untouched.

```ts
import { markdownToCarve } from '@markup-carve/carve'

markdownToCarve('a *very* **bold** ~~old~~ idea')
// => 'a /very/ *bold* ~old~ idea'
```

It handles the inline constructs that differ between Markdown and Carve, plus
Carve's blank-line-around-blocks rule:

| Markdown                     | Carve      | Note                                                       |
| ---------------------------- | ---------- | ---------------------------------------------------------- |
| `*x*`, `_x_`                 | `/x/`      | `_x_` is **underline** in Carve, not emphasis              |
| `**x**`, `__x__`             | `*x*`      | Carve strong is a single `*`                               |
| `***x***`, `___x___`         | `/*x*/`    | Carve's canonical bold-italic                              |
| `~~x~~`                      | `~x~`      | Carve strikethrough is a single `~`                        |
| `==x==`                      | `=x=`      | highlight: Carve uses a single `=` (`==x==` renders literal) |
| `^x^`                        | `^x^`      | superscript: identical in Carve                            |
| `<mark>x</mark>`             | `=x=`      | highlight tag → bare marker (brace-forced `{=x=}` intraword) |
| `<sub>x</sub>`               | `,x,`      | subscript tag → bare marker (`H<sub>2</sub>O` → `H{,2,}O` intraword) |
| `<sup>x</sup>`               | `^x^`      | superscript tag → bare marker (brace-forced `{^x^}` intraword) |
| `$x$`                        | `` $`x` `` | inline math (`$5` left as currency)                        |
| `<em>`/`<strong>`/`<del>`/…  | Carve form | other inline HTML tags map to their Carve markers          |

> [!NOTE]
> Carve's highlight and subscript markers are **single** characters (`=x=`,
> `,x,`); the doubled forms `==x==` and `,,x,,` are literal text in Carve (see
> the corpus pair `74-two-char-delimiter-runs`). A bare `,x,` / `^x^` / `=x=`
> only renders at a word boundary, so the `<mark>`/`<sub>`/`<sup>` tags map to
> the **bare markers** when they sit between non-alphanumeric neighbors (the
> common, whitespace-separated case) and to the **forced brace forms** `{=x=}` /
> `{,x,}` / `{^x^}` only when intraword (e.g. `H<sub>2</sub>O` → `H{,2,}O`),
> where the brace form renders in every position (corpus
> `67-superscript-and-subscript`).

It also rewrites **GFM tables** to Carve's native form: a header row followed by
a `| --- |` delimiter row becomes `|=`-prefixed header cells, and the delimiter
row is dropped (Carve needs no separator). Column alignment from the delimiter
(`:--`, `--:`, `:--:`) is glued onto the header marker as `|=<`, `|=>`, `|=~`:

```md
| L | C | R |
| :-- | :--: | --: |
| a | b | c |
```

becomes

```
|=< L |=~ C |=> R |
| a | b | c |
```

Body rows are already valid Carve, so they pass through unchanged.

To go the other way - flagging a Djot document that would silently mis-render
under Carve - use `djotMigrationWarnings`, and to rewrite those collisions in
place use `applyMigrationFixes` (or the `carve fix` CLI below):

```ts
import { applyMigrationFixes } from '@markup-carve/carve'

const { output, applied, skipped } = applyMigrationFixes('use _emphasis_ here')
// output  -> 'use /emphasis/ here'
// applied -> the warnings that were spliced in (nested ones compose, so
//            **_x_** fixes to a single-star bold wrapping a slash emphasis)
// skipped -> crossing collisions (e.g. **_x**_) left for manual review
```

## Command line: `carve fix`

Installing the package provides a `carve` binary. Its `carve fix` subcommand
wraps `applyMigrationFixes` to rewrite Djot/Markdown delimiter collisions to
their Carve equivalents.

```sh
carve fix < in.crv > out.crv     # stdin -> stdout (default)
carve fix --write doc.crv …      # rewrite files in place
carve fix --check doc.crv …      # report only; exit 1 if any would change (CI)
carve fix --stdout doc.crv       # print the fix for one file, don't modify it
```

With no files it reads stdin and writes the fixed result to stdout. Nested
collisions compose (`**_x_**` fixes in one pass); only *crossing* collisions
that are genuinely ambiguous (e.g. `**_x**_`) are reported on stderr for manual
review. `--check` is a gate: it exits non-zero when a file would change or has
manual-review collisions, so it drops into a pre-commit hook or CI step.

## Linting

`djotMigrationWarnings` catches *source-level* delimiter collisions;
`lintCarve` catches *silent-failure* problems - markup that parses without
error but renders as the wrong thing, so nothing throws:

```ts
import { lintCarve } from '@markup-carve/carve'

lintCarve('# Setup\n\n## Setup\n\nSee </#ghost>.')
// [
//   { rule: 'duplicate-heading-id', line: 3, ... },  // second "Setup" -> id setup-2
//   { rule: 'broken-crossref',      line: 5, ... },  // </#ghost> has no heading
// ]
```

| Rule | Catches |
| ---- | ------- |
| `duplicate-heading-id` | two headings producing the same id (slug collision or repeated explicit `{#id}`); ambiguous references resolve to the first |
| `broken-crossref` | a `</#id>` cross-reference with no matching heading or numbered caption id; it renders as literal text |
| `unresolved-reference-link` | a `[text][label]` or `[text][]` reference link with no matching link definition or implicit heading target; it renders as literal text |
| `unresolved-footnote` | a `[^label]` footnote reference with no matching `[^label]: ...` definition; it renders as literal text |
| `duplicate-footnote-definition` | a repeated `[^label]: ...` definition; the parser keeps the first definition and ignores the later one |
| `unused-footnote-definition` | a footnote definition that is never referenced; it is omitted from rendered output |
| `heading-trailing-attribute` | a trailing `{#id}` / `{.class}` on a heading line; under heading-strict this is literal text, so the attributes never attach (put them on a `{…}` line *above* the heading) |
| `raw-block-syntax` | a legacy `` ```raw FORMAT `` fence; the Carve raw block is `` ```=FORMAT ``, and the wrong form fails to open and desyncs the rest of the document's fences |
| `block-marker-as-text` | a line that opens like a block (`:::`, `{#`, `{.`) but parsed as a paragraph because the block never opened |
| `empty-include-path` | a `{{ … }}` run shaped like an include directive but with no path (empty braces, or only a `#section` / `@option`); an empty path is not a directive, so it renders as literal text - add a path or remove the braces |

The `carve lint` CLI reports both the collision warnings and these lint
findings as `file:line:col rule - message`, and exits non-zero if anything is
found:

```sh
carve lint doc.crv …   # report; exit 1 if any finding (CI / pre-commit)
carve lint < doc.crv   # read stdin
```
