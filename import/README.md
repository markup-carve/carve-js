# Carve 0.2 importers

This private package holds the importers of `@markup-carve/carve/import` (`public/formats.ts`). Markdown and GFM are
rendered to HTML by micromark, Djot by djot.js and BBCode by `src/bbcode.ts`; the 0.2 HTML importer reads that HTML,
and the engine writer writes the Carve source (`src/hub.ts`). The user guide is `docs/import.md` of the package.

```ts
import { importDocument } from './src/index.ts'

const { document, source, diagnostics } = importDocument('**hello**', { from: 'gfm' })
```

`from` is `markdown`, `gfm`, `djot`, `bbcode` or `html`. `markdown` uses CommonMark syntax plus frontmatter, math and
directives; `gfm` also enables GFM tables, tasks, strikethrough, autolinks, footnotes and alerts. `document` is the
validated 2.0 tree. `source` is canonical when the writer settles, and `diagnostics` records unsupported input,
degradation and any writer refusal. Foreign parse or tree failures are `ImportInputError`.
Raw HTML nodes render as HTML only when the caller enables the engine's `rawHtml` option.

The HTML importer follows `spec/0.2/import-html.md`. Its option `rawHtml` (default off, C2-M-066) keeps comments,
the elements of the treatment `raw` (scripts, styles, media, embedded objects, form controls, `svg`, `noscript`,
`template`) and `data-carve-raw` spans as `raw_block` and `raw_inline` nodes; with it off they are dropped and
reported. Its diagnostics use the seven codes of C2-M-083 on the `render-loss` channel, each with `foreignType` and a
UTF-8 byte range of the HTML input. Through the hub, Markdown and Djot
report the same codes without a byte range, and BBCode reports `import-element-mapped` for an unknown tag.

```ts
importDocument('<p>a<!-- c -->b</p>', { from: 'html', rawHtml: true })
```

```sh
node import/src/cli.ts --from html [--raw-html] page.html > page.crv
npm --prefix import test
npm --prefix import run typecheck
npm --prefix import run lint
node import/scripts/measure.ts
node import/scripts/mutate.ts
node import/scripts/hub-gaps.ts   # after tsc -p upgrade/engine-0.1/tsconfig.json
```

The CLI writes diagnostics as JSON to standard error. `docs/conformance.md` holds full suite counts and every
different example. `docs/coverage.md` records the 0.1 inventory and explicit omissions.
