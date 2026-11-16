# Carve 0.2 importers

This private package parses Markdown, GFM, Djot and HTML with their reference parsers, maps the foreign tree to
the public Carve 0.2 node interfaces, validates it, and asks the engine writer for Carve source.

```ts
import { importDocument } from './src/index.ts'

const { document, source, diagnostics } = importDocument('**hello**', { from: 'gfm' })
```

`from` is `markdown`, `gfm`, `djot` or `html`. `markdown` uses CommonMark syntax plus frontmatter, math and
directives; `gfm` also enables GFM tables, tasks, strikethrough, autolinks and footnotes. `document` is the
validated 2.0 tree. `source` is canonical when the writer settles, and `diagnostics` records unsupported input,
degradation and any writer refusal. Foreign parse or tree failures are `ImportInputError`.
Raw HTML nodes render as HTML only when the caller enables the engine's `rawHtml` option.

The HTML importer follows `spec/0.2/import-html.md`. Its option `rawHtml` (default off, C2-M-066) keeps comments,
the elements of the treatment `raw` (scripts, styles, media, embedded objects, form controls, `svg`, `noscript`,
`template`) and `data-carve-raw` spans as `raw_block` and `raw_inline` nodes; with it off they are dropped and
reported. Its diagnostics use the seven codes of C2-M-083 on the `render-loss` channel, each with `foreignType` and a
UTF-8 byte range of the HTML input. The Markdown and Djot importers keep the codes `import-degraded` and
`import-unsupported`.

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
```

The CLI writes diagnostics as JSON to standard error. `docs/conformance.md` holds full suite counts and every
different example. `docs/coverage.md` records the 0.1 inventory and explicit omissions.
