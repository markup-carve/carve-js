# Import coverage and 0.1 inventory

The 0.1 implementations reviewed were `src/markdown-migrate.ts`, `src/djot-migrate.ts`, `src/html-import.ts`,
the modules under `src/import/`, their `test/` cases, and `docs/html-import.md`. This inventory names each
construct family they handled and the 0.2 result. The conformance counts and individual divergent examples
are in [conformance.md](conformance.md).

| Foreign construct handled in 0.1 | Carve 0.2 mapping |
| --- | --- |
| CommonMark paragraphs, headings, quotes, thematic breaks, lists, code blocks, emphasis, strong, code spans, links, images, definitions, autolinks and breaks | Typed paragraph, heading, block quote, thematic break, list, code block and inline nodes. The reference parser decides syntax. |
| GFM strikethrough, task items, pipe tables, footnotes and GitHub alerts | Typed strike, list item task mark, table groups and columns, footnote references and definitions, and admonitions. |
| Markdown raw HTML blocks and inline HTML | `raw_block` and `raw_inline` with `format: "html"`; rendering requires `rawHtml: true`. |
| Markdown frontmatter, math and directives | Typed frontmatter, math, admonition or directive. An unknown directive becomes a div and receives `import-degraded`. |
| Djot sections, divs, quotes, code, raw content, ordinary and task lists, definition lists, tables and captions | Their matching typed block nodes, with table groups and caption. |
| Djot formatting, spans, symbols, math, links, images, references, footnotes and smart punctuation | Typed inline nodes, reference definitions and footnote definitions. |
| HTML headings, paragraphs, quotes, lists, task boxes, definition lists, tables with groups and spans, figures, images, code languages, links and inline formatting | Matching typed nodes; cell blocks and image descriptions stay in their typed slots even where the writer reports C2-W-011. |
| HTML role based footnotes and common `footnote-ref` wrappers | Typed footnote reference and definition nodes. Generated backlinks receive a degradation finding. |
| HTML MathML with TeX annotation or `alttext`, ruby pairs, abbreviations, language, direction and direct alignment | Typed math, ruby, abbreviation and common fields; alignment enters `carve.style`. |
| HTML comments and script or style blocks | HTML raw nodes holding parse5's serialized HTML form. |

## Explicit losses and omissions

| Foreign construct or 0.1 behavior | 0.2 decision and reason |
| --- | --- |
| Markdown code fence `meta` | `import-degraded`: mdast exposes it, but the code block's `syntax` and `title` fields do not mean arbitrary info-string metadata. |
| Markdown shortcut reference spelling | `import-degraded`: Carve's `refForm` admits only full and collapsed; the link or image target remains typed. |
| Nested Markdown reference definitions | Moved to document level with `import-degraded`: the 0.2 contract permits definitions only as document children. |
| Djot `+` bullets and parenthesized ordered markers | `import-degraded`: the 0.2 marker vocabulary has no matching spelling. List meaning survives. |
| Djot quoted wrapper nodes | `import-degraded`: the wrapper becomes quote glyphs and children; there is no quoted-container inline node. |
| Djot filter test commands | The importer reads the parser's resulting AST. A test harness filter command is outside the document language and has no AST node. |
| HTML `details` and `summary` interaction | `import-degraded`: content becomes a div and span; Carve has no disclosure node. |
| HTML `head`, `meta`, document `link`, standalone form controls, unexpected table or list children | `import-unsupported` at the foreign element position: no corresponding Carve content node. |
| HTML event attributes and invalid direction | `import-unsupported` or `import-degraded` at the element position: event handlers are not document content and invalid `dir` cannot occupy the typed field. |
| HTML `colgroup` and `col` | `import-unsupported`: HTML column groups can carry span and style semantics that the current mapper cannot derive safely as Carve columns. Existing table row and cell facts survive. |
| HTML media embeds, arbitrary SVG, forms and custom elements | `import-degraded` to a span or content fallback: no core media or form node. The element name and attributes that have no rendering counterpart are reported. |
| HTML `<q>`, `<time>`, `<samp>`, `<var>`, `<kbd>`, `<cite>` and `<dfn>` semantic spans | `import-degraded` to a span: the 0.2 core has no distinct node for these HTML element semantics. Their visible children and ordinary attributes survive. |
| HTML `<br>` inside a table cell and ordered task boxes | Kept as typed break and task nodes in the tree. The writer reports the source spelling loss; the importer does not flatten them before writing. |
| MathML without TeX annotation or `alttext` | `import-unsupported`; visible text is retained. Concatenating MathML tokens would invent a wrong expression. |
| Word, Google Docs and LibreOffice footnote anchor adapters from 0.1 | Omitted from the generic interface. Their reciprocal anchors alone do not establish note semantics; role based or common generated note structures are mapped. |
| Carve 0.1 HTML roundtrip carriers, abbreviations encoded in carrier attributes, and source layout hints | Not decoded. They are renderer specific transport data, not ordinary HTML meaning; the 0.2 importer reports unsupported carrier elements or preserves ordinary attributes. |
| 0.1 HTML mode, adapter, depth, node and diagnostic limit options | Not exposed by the one-interface brief. Parse5 and the engine validator enforce their own limits; errors from foreign inputs have `ImportInputError`. |

The writer's `render-loss` findings identify additional tree facts that Carve source cannot spell, including
HTML table `scope` and spans, figure roles and some image descriptions. The importer keeps these facts in the
returned tree. The conformance report lists each example whose rendered result differs from its foreign reference.
