# Carve 0.2 importers

This private package parses Markdown, GFM, Djot and HTML with their reference parsers, maps the foreign tree to
the public Carve 0.2 node interfaces, validates it, and asks the engine writer for Carve source.

```ts
import { importDocument } from './src/index.ts'

const { document, source, diagnostics } = importDocument('**hello**', { from: 'gfm' })
```

`from` is `markdown`, `gfm`, `djot` or `html`. `markdown` uses CommonMark syntax plus frontmatter, math and
directives; `gfm` also enables GFM tables, tasks, strikethrough, autolinks and footnotes. `document` is the
validated 2.0 tree, `source` is stable canonical Carve text, and `diagnostics` combines `import-unsupported`,
`import-degraded` and the writer's C2-W-011 findings. Foreign parse or tree failures are `ImportInputError`.
Raw HTML nodes render as HTML only when the caller enables the engine's `rawHtml` option.

```sh
node import/src/cli.ts --from html page.html > page.crv
npm --prefix import test
npm --prefix import run typecheck
npm --prefix import run lint
node import/scripts/measure.ts
node import/scripts/mutate.ts
```

The CLI writes diagnostics as JSON to standard error. `docs/conformance.md` holds full suite counts and every
different example. `docs/coverage.md` records the 0.1 inventory and explicit omissions.
