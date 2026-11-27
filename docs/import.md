# Importing Markdown, Djot, BBCode and HTML

`@markup-carve/carve/import` turns a Markdown, GFM, Djot, BBCode or HTML document into a Carve 0.2 tree and
writes its Carve source with the engine writer. The core entry `@markup-carve/carve` never loads it, so the
Markdown and Djot libraries load only when a host imports this entry.

```js
import { importDocument } from '@markup-carve/carve/import'

const { document, source, diagnostics } = importDocument('# Hello *world*\n', { from: 'gfm' })
// source === '= Hello /world/\n'
```

| Option | Values | Meaning |
|---|---|---|
| `from` | `markdown`, `gfm`, `djot`, `bbcode`, `html` | The input format. Required. |
| `rawHtml` | boolean, default `false` | HTML only: keeps comments and raw elements as raw nodes (C2-M-065). |
| `labels` | map of label keys to text | HTML only: identifies generated accessible names from the renderer (C2-M-101). |
| `adapter` | `generic` (default), `tiptap`, `prosemirror`, `ckeditor`, `tinymce`, `word`, `google-docs` | HTML only: the editor that wrote the HTML (C2-M-102). `word` and `google-docs` read a word processor's notes, a reference and a note linked to each other, as footnotes; the other values read the HTML as `generic` does. |
| `listTable` | boolean, default `false` | HTML only: a table with a cell of two or more blocks, or of one block that is not a paragraph, becomes a `::: list-table` div (C2-M-112). |
| `strictLosses` | boolean, default `false` | Makes each loss of the import an error (C2-M-082). |
| `constructs` | boolean, default `false` | Markdown, GFM and Djot: adds `constructs` to the result, a record of each construct of the input. |

The result holds `document` (the validated tree), `source` (the writer's Carve text) and `diagnostics`. An input
the importer cannot read throws `ImportInputError`; an unknown option throws `CarveOptionError`. The core entry
keeps its own `importDocument`, which reads HTML only (C2-T-005): it refuses `markdown`, `gfm`, `djot` and `bbcode`
with a `CarveOptionError` that names this entry.

On the command line:

```sh
carve import --from markdown README.md > README.crv
carve import --from djot notes.dj > notes.crv
carve import --from bbcode post.txt > post.crv
carve import --from html --adapter word export.html > export.crv
carve import --from html --list-table page.html > page.crv
```

## Construct records

The diagnostics name what an import lost. With `constructs: true`, a Markdown, GFM or Djot import also lists what
it read, so a host can show a receipt for each construct:

```js
import { importDocument } from '@markup-carve/carve/import'

const { constructs } = importDocument('**Hello**', { from: 'markdown', constructs: true })
// [{ construct: 'strong', node: 'strong', status: 'preserved', range: { startOffset: 0, endOffset: 9 } }]
```

Each record names the construct as its library does (a micromark token type such as `strong`, `atxHeading` or
`codeFenced`, or a djot.js node tag such as `emph`), the Carve node type it imports as, and its range in UTF-8 bytes
of the input. Records come in input order. The status is decided per node type: the constructs that import as a type
are `preserved` when the tree holds exactly as many nodes of that type and no diagnostic names the HTML element the
type is read from; otherwise every one of them is `unverified`. Emphasis inside an image's alternative text, for
example, has no node in the tree, so the emphasis records of that import are `unverified`.

HTML and BBCode imports give no records: their diagnostics already point into the input.

## How it works

HTML is the one import hub. Markdown and GFM are rendered to HTML with micromark (CommonMark 0.31, `cmark-gfm`
0.29.0.gfm.13), Djot with djot.js 0.3.2, and BBCode with the engine's own BBCode reader. The 0.2 HTML importer
(`spec/0.2/import-html.md`) reads that HTML, and the writer spells the tree. None of the routes walks a foreign
syntax tree, so every format gets the same tree rules.

The hub step adds what library HTML cannot carry on its own:

- Raw HTML of Markdown and raw content of Djot stay raw nodes, with their format.
- A tight list stays tight when an item holds a second block (`data-carve-tight`, C2-M-033).
- Markdown frontmatter (YAML or TOML), math (`$x$`, `$$`), container directives and GitHub alerts
  (`> [!NOTE]`) become frontmatter, math, admonitions and divs.
- A Djot list that starts at `0` keeps its start, and the section ids djot.js generates are left to the
  Carve renderer.
- Djot reads with the parser fixes of djot.js main that 0.3.2 lacks: a blank line detaches block attributes, an
  escaped `$` before a code span is text, brackets before an invalid attribute block stay text, a task list ends
  where its bullet changes, and a delimiter inside a link destination closes no emphasis outside the link.

The libraries' own line breaks around tags are not reported as whitespace normalization, and the diagnostics of
the HTML importer name no byte range, since the HTML they point into is not the caller's input.

## What differs from the 0.1 importers

Measured over the CommonMark 0.31 (652 examples), GFM (648) and djot.js (253) test suites, each route rendered
by its own engine and compared with the suite's HTML (`import/scripts/hub-gaps.ts`):

| Suite | Same as reference, 0.1 | Same as reference, 0.2 |
|---|---:|---:|
| CommonMark | 574 | 569 |
| GFM | 561 | 554 |
| Djot | 191 | 189 |

The remaining differences are known losses of the 0.2 language, not of the hub:

| Construct | Result | Why |
|---|---|---|
| A loose list with one item | tight | A list of one item is tight (C2-B-062, C2-M-033). |
| A Djot definition list with paragraphs | the description is written bare | `definition_list` has no spacing. |
| An empty heading or an empty link `[](url)` | dropped | They need content (C2-M-069, C2-W-116). |
| Reference links and definitions | inline links with the same target and title | HTML holds the resolved link (C2-M-050). |
| A code fence info string after the language | dropped | HTML keeps the language only (C2-M-030). |
| Djot smart punctuation | the glyph as text | HTML holds the glyph, not the kind or the source (C2-A-098). |
| A Djot ordered list delimiter `)` or `(1)` | `.` | HTML has no delimiter. |

## BBCode

BBCode is read by the engine, not by a library, with the tag set of the 0.1 `bbcodeToCarve`:

| Tags | Carve |
|---|---|
| `[b]`, `[i]`, `[u]`, `[s]`, `[sup]`, `[sub]` | strong, emphasis, underline, strike, superscript, subscript |
| `[c]`, `[icode]`, `[code]`, `[code=LANG]` | code and code blocks; a leading `=` of the language is cut |
| `[url]`, `[url=...]`, `[email]`, `[img]`, `[youtube]` | links and images; a YouTube id becomes a link to the video |
| `[quote]`, `[quote=...]` | block quote; the attribution is a `name (date) #id` caption |
| `[list]`, `[list=1]`, `[list=a]`, `[*]` | bullet and ordered lists |
| `[table]`, `[tr]`, `[th]`, `[td]` | table; a first row of header cells is the head |
| `[hr]`, `[spoiler]`, `[center]`, `[left]`, `[right]` | thematic break, a `spoiler` div, an aligned div |
| `[color]`, `[size]`, `[font]` | their text |
| `[noparse]` | its content as text |

An unknown tag keeps its content and is reported with `import-unsupported`; an unclosed tag and a stray closing
tag stay text. An input over `BBCODE_MAX_INPUT_LENGTH` (262144 UTF-8 bytes) throws `BbcodeInputTooLargeError`,
an `ImportInputError`.
