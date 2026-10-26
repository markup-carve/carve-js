# JavaScript library API

## Converting and inspecting documents

```ts
import { carveToHtml } from '@markup-carve/carve'

carveToHtml('# Hello\n\nThis is /italic/ and *bold*.')
// <section id="Hello">
//   <h1>Hello</h1>
//   <p>This is <em>italic</em> and <strong>bold</strong>.</p>
// </section>
```

The package exposes one-call converters per output format, plus the lower-level
`parse` / `resolve` / `render*` functions for inspecting or transforming the AST:

```ts
import {
  carveToHtml,
  carveToHtmlWithReport,
  carveToMarkdown,
  carveToPlainText,
  carveToAnsi,
  parse,
  resolve,
  renderHtml,
} from '@markup-carve/carve'

const doc = resolve(parse(source)) // typed Document AST
const html = renderHtml(doc)       // same as carveToHtml(source)
```

Raw nodes are routed to their named target. If omitted content must be
observable, use the checked sibling of either API:

```ts
const result = carveToHtmlWithReport('`x`{=latex}')
// result.value is the unchanged HTML output
// result.losses[0].code === 'raw-format-dropped'

carveToHtmlWithReport('`x`{=latex}', { strictLosses: true })
// throws RenderLossError before a value is returned
```

The other codes are `ruby-flattened`, `editorial-comment-flattened` (one row
per editorial comment the plain and ANSI targets flatten into the surrounding
text) and `destination-denied`, one row per destination the scheme denylist
blanked. See [untrusted input](security.md) for that one.

Reports are bounded to 100 entries by default while `totalLosses` retains the
complete count. Set `maxRenderLosses` to change the bound. The compatible
string-returning APIs remain available.

Tools that need to retain unrelated source bytes can use `carveToCarvePatch`
and `applySourcePatch`; see
[source-preserving patches](https://github.com/markup-carve/carve-js/blob/main/docs/source-patches.md).

HTML rendering accepts a `symbols` map for symbol shortcodes (e.g. emoji):
mapped values are trusted raw HTML output, and unmapped `:name:` shortcodes
render literally.

It runs in a browser too, from a script tag or a module -
[docs/browser.md](https://github.com/markup-carve/carve-js/blob/main/docs/browser.md).
