# Exports: Markdown, plain text and ANSI

`@markup-carve/carve/export` writes a Carve 0.2 tree as Markdown, as plain text, or as text styled with ANSI escape
sequences for a terminal. It is an entry of its own: `@markup-carve/carve` never loads it.

Each format has one call. It takes a tree from `parse` (or one that `validateTree` passes) and returns the text and
the losses of the run in one result. The tree is not changed.

```ts
import { parse } from '@markup-carve/carve'
import { toAnsi, toMarkdown, toPlainText } from '@markup-carve/carve/export'

const tree = parse('# Notes\n\nSee *this* and </#Notes>.\n')
const markdown = toMarkdown(tree)
if (markdown.output !== '# Notes\n\nSee **this** and [Notes](#notes).\n') throw new Error(markdown.output)
if (toPlainText(tree).output !== 'Notes\n\nSee this and Notes.\n') throw new Error('plain')
if (!toAnsi(tree).output.includes('\x1b[1mthis\x1b[0m')) throw new Error('ansi')
```

## Options

All three calls take the same options. An unknown option is refused with `CarveOptionError`.

| Option | Default | Effect |
|---|---|---|
| `smartTypography` | `true` | Writes the glyph of smart punctuation (`–`, `…`, `“`); `false` writes the characters as typed. |
| `strictLosses` | `false` | Throws `CarveExportError` (with `diagnostics`) instead of returning a result that lost something. |
| `urlPolicy` | `{}` | `{ deny }` or `{ allow }` lists of schemes. A denied destination is written empty and reported. |

## Losses

`diagnostics` holds entries of the `render-loss` channel, each with the pointer of its node (`path`) and, where the
tree has positions, its byte `range`. The codes:

| Code | Target | What was lost |
|---|---|---|
| `markdown-container-flattened` | markdown | a div: its blocks are written without the container |
| `markdown-caption-flattened` | markdown | a caption: written as a paragraph after its host |
| `markdown-attributes-dropped` | markdown | the attributes of a block |
| `fence-title-dropped` | markdown | the title of a code block without a language |
| `raw-html-escaped` | markdown | raw HTML, written escaped so it cannot become live markup |
| `table-header-row-demoted`, `table-header-cell-demoted` | markdown | a header row or cell after the first row |
| `list-style-dropped` | markdown | an ordered list style other than decimal |
| `table-span-flattened` | all | a cell spanning rows or columns |
| `raw-format-dropped` | all | raw content in a format the target does not write (ANSI shows it dimmed instead) |
| `ruby-flattened`, `editorial-comment-flattened` | plain, ansi | ruby annotations in parentheses, an editorial comment as text |
| `destination-denied` | all | a destination the URL policy denies |
| `include-unresolved` | all | an include that was not expanded, written as its source line |
| `derived-text-budget` | all | abbreviation expansions and cross-reference labels past the derived-text budget |

## What Markdown cannot express

The Markdown target is CommonMark with the GFM tables, task lists, strikethrough and footnotes, as in 0.1.

- Underline, superscript, subscript, highlight, insertions, deletions, small caps, ruby and abbreviations are inline
  HTML: `<u>`, `<sup>`, `<sub>`, `<mark>`, `<ins>`, `<del>`, `<span class="smallcaps">`, `<ruby>`, `<abbr>`.
- Admonitions and directives write their title as a bold line and then their blocks; a div does the same and is
  reported. A definition list writes each term as a bold paragraph followed by its descriptions.
- Headings have no ids. A link or cross-reference to a heading uses the slug GFM derives from the heading text.
- A caption follows its host as a paragraph; a figure group writes each panel's caption emphasized and its own
  caption bold at the end.
- A line block joins its lines with hard breaks. Math is `$x$` or `$$x$$`.
- Two lists in a row keep apart by alternating their bullet (`-`, `*`) or delimiter (`.`, `)`).

## The writer registry

The exports register on the writer registry under the reserved targets `markdown`, `plain` and `ansi`. No other
writer may take those names. `exportDocument` writes by target name, which is what the command line uses
(`carve render --to markdown|plain|ansi`), and refuses an unknown target with a message that lists the known ones.

```ts
import { createWriterRegistry, parse } from '@markup-carve/carve'
import { exportDocument, registerExports } from '@markup-carve/carve/export'

const writers = registerExports(createWriterRegistry())
if (writers.targets().join() !== 'html,carve,markdown,plain,ansi') throw new Error(writers.targets().join())
if (exportDocument('plain', parse('*a*')).output !== 'a\n') throw new Error('plain')
```

## Differences to the 0.1 writers

On the 0.1 corpus, for every document the upgrade tool rewrites with unchanged HTML, the 0.2 exports write the same
text as the 0.1 writers for about 92% of the documents in Markdown and 97% in plain text and ANSI. What differs is
intended:

| Node type | 0.2 export | Reason |
|---|---|---|
| `xref`, `link` to a heading | the resolved text, as in HTML | 0.1 left some references unresolved that its HTML resolved |
| `caption_number` | the number the caption takes | 0.1 wrote `#` where its HTML wrote the number |
| `text` (Markdown) | `_` and `[` are escaped by fixed rules | 0.1 decided them on the written line; both read back as text |
| `footnote` | definitions in source order, the first of each key | 0.1 ordered some definitions differently |
| `heading` (ANSI) | the rule takes the grapheme width (spec 0.2 C2-W-119) | 0.1 counted code points |
| `autolink` | the text as written, `mailto:` kept where the source had it | 0.1 dropped `mailto:` from the shown text |
| `list_item` (Markdown) | an empty item writes its bare marker | 0.1 kept a trailing space |

The `roundtrip` option of the 0.1 Markdown writer is gone: 0.2 has no Markdown carrier format.
