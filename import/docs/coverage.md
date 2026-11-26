# Import coverage and 0.1 inventory

The 0.1 implementations reviewed were `src/markdown-migrate.ts`, `src/djot-migrate.ts`, `src/html-import.ts`,
the modules under `src/import/`, their `test/` cases, and `docs/html-import.md`. This inventory names each
construct family they handled and the 0.2 result. Markdown, GFM and Djot reach the tree through the HTML hub
(micromark or djot.js HTML, then the HTML importer), BBCode through the engine's BBCode reader and the same
importer. The conformance counts and individual divergent examples are in [conformance.md](conformance.md).
`scripts/hub-gaps.ts` compares the hub with the 0.1 importers.

| Foreign construct handled in 0.1 | Carve 0.2 mapping |
| --- | --- |
| CommonMark paragraphs, headings, quotes, thematic breaks, lists, code blocks, emphasis, strong, code spans, links, images, definitions, autolinks and breaks | Typed paragraph, heading, block quote, thematic break, list, code block and inline nodes. The reference parser decides syntax. |
| GFM strikethrough, task items, pipe tables, footnotes and GitHub alerts | Typed strike, list item task mark, table groups and columns, footnote references and definitions, and admonitions. |
| Markdown raw HTML blocks and inline HTML | `raw_block` and `raw_inline` with `format: "html"`; rendering requires `rawHtml: true`. |
| Markdown frontmatter, math and directives | Typed frontmatter and math; a container directive of an admonition kind is an admonition, any other directive a div or span with its name as class. |
| Djot sections, divs, quotes, code, raw content, ordinary and task lists, definition lists, tables and captions | Their matching typed block nodes, with table groups and caption. |
| Djot formatting, spans, symbols, math, links, images, references, footnotes and smart punctuation | Typed inline nodes, reference definitions and footnote definitions. |
| HTML headings, paragraphs, quotes, lists, task boxes, definition lists, tables with groups and spans, figures, images, code languages, links and inline formatting | Matching typed nodes; cell blocks and image descriptions stay in their typed slots even where the writer reports C2-W-011. |
| HTML role based footnotes, GFM footnotes and common `footnote-ref` wrappers | Typed footnote reference and definition nodes. Backlinks are dropped without a report (C2-M-063). |
| HTML MathML with TeX annotation or `alttext`, ruby pairs, abbreviations, language, direction and exact alignment declarations | Typed math, ruby, abbreviation and common fields; an exact `text-align` declaration on a paragraph, div or heading is the key `align` (C2-M-075). Any other `style` stays a key as written (C2-M-055). |
| HTML comments and elements of the treatment `raw` | With the option `rawHtml` on, HTML raw nodes holding parse5's serialized HTML form; with it off (the default) dropped with `import-element-dropped` (C2-M-065, C2-M-066). |

## Explicit losses and omissions

| Foreign construct or 0.1 behavior | 0.2 decision and reason |
| --- | --- |
| Markdown code fence `meta` | Dropped: the HTML keeps the language only (C2-M-030). |
| Markdown and Djot reference links and definitions | Inline links and images with the same target and title: the HTML holds the resolved link (C2-M-050). |
| Djot `+` bullets and parenthesized ordered markers | Written with the 0.2 markers: the HTML has no marker spelling. List meaning survives. |
| Djot quoted wrappers and smart punctuation | Their glyphs as text: the HTML carries no kind or source (C2-A-098). |
| A loose Markdown or Djot list of one item, a Djot definition list with paragraphs | Tight, and a bare description: C2-B-062 and C2-M-033; `definition_list` has no spacing. |
| Djot filter test commands | The importer reads the parser's resulting AST. A test harness filter command is outside the document language and has no AST node. |
| HTML `details` and `summary` interaction | `import-element-mapped`: a div whose first paragraph is the summary (C2-M-059); Carve has no disclosure node. |
| HTML `head`, `meta`, document `link`, standalone form controls, unexpected table or list children | `import-element-dropped` for the head and the treatment `drop`, the treatment `raw` with `rawHtml` off, and `import-structure-repaired` for children a list, table or description list cannot hold (C2-M-005, C2-M-034, C2-M-036, C2-M-041). |
| HTML event attributes, `srcdoc`, `formaction`, names that are no key and invalid direction | `import-attribute-dropped` at the element position (C2-M-052, C2-M-054). |
| HTML `colgroup` and `col` | A `<col>` of the first `<colgroup>` whose style is exactly `width: N%;` gives its column's width (C2-M-041); other column group facts are not read. |
| HTML media embeds, arbitrary SVG, forms and custom elements | Read by the table "Elements" of `import-html.md`: media, SVG and form controls are raw, form and sectioning containers a div, custom elements a span, each reported (C2-M-056, C2-M-057). |
| HTML `<q>`, `<samp>`, `<var>`, `<cite>` and `<dfn>` semantic spans | `import-element-mapped` to a span; `<kbd>` and `<time>` are spans with their key (C2-M-047). Their visible children and ordinary attributes survive. |
| HTML `<br>` inside a table cell and ordered task boxes | Kept as typed break and task nodes in the tree. The writer reports the source spelling loss; the importer does not flatten them before writing. |
| MathML without TeX annotation or `alttext` | `import-element-mapped`; visible text is retained (C2-M-049). Concatenating MathML tokens would invent a wrong expression. |
| Word, Google Docs and LibreOffice footnote anchor adapters from 0.1 | Omitted from the generic interface. Their reciprocal anchors alone do not establish note semantics; role based or common generated note structures are mapped. |
| Carve 0.1 HTML roundtrip carriers, abbreviations encoded in carrier attributes, and source layout hints | Not decoded. They are renderer specific transport data, not ordinary HTML meaning; the 0.2 importer reports unsupported carrier elements or preserves ordinary attributes. |
| 0.1 HTML mode, adapter, depth, node and diagnostic limit options | Not exposed by the one-interface brief. Parse5 and the engine validator enforce their own limits; errors from foreign inputs have `ImportInputError`. |

The writer's `render-loss` findings identify additional tree facts that Carve source cannot spell, including
HTML table `scope` and spans, figure roles and some image descriptions. The importer keeps these facts in the
returned tree. The conformance report lists each example whose rendered result differs from its foreign reference.
