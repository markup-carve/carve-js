# Standard extensions: blocks and inline

`@markup-carve/carve/extensions` holds provisional standard extensions. The core entry never loads them. They follow the
0.2 extension interface (`spec/0.2/extensions.md`), which may still change in a 0.2.x release.

Each factory returns a bundle `{ extensions, renderers }`, the same shape as the
[fenced renderers](fenced-renderers.md); the document transforms below return `transforms` instead. Merge bundles with
`withExtensions` and pass `extensions` to `parse`, `write` and `lint`, and both to `render`:

```ts
import { render } from '@markup-carve/carve'
import { details, spoiler, withExtensions } from '@markup-carve/carve/extensions'

const { extensions, renderers } = withExtensions(details(), spoiler())
const html = render('::: details "More"\nHidden.\n:::\n', { extensions, renderers })
```

Without the extension each form stays the core node it parses as: `::: details` is a `div`, `:spoiler[x]` an inline
extension with a text fallback. With the definition but no renderer in the selected mode, the HTML renderer writes the
fallback and reports `extension-fallback-rendered` (C2-X-035).

## Blocks

| Factory | Source | Node | HTML |
|---|---|---|---|
| `details()` | `::: details "Title"` | `carve.details` | `<details>` with the title as `<summary>`, `Details` without one |
| `spoiler()` | `::: spoiler "Title"` | `carve.spoilerBlock` | `<details class="spoiler">`, `Spoiler` without a title |
| `listTable()` | `::: list-table` holding a list of lists | `carve.listTable` | a `<table>` |
| `imgFence()` | ` ```img ` or ` ```image ` holding SVG | `carve.imgFence.img` or `carve.imgFence.image` | a sanitized, percent-encoded SVG in one `<img>` |

`imgFence()` registers both language words and the standard renderer. Pass its bundle to `render` as options. The
sanitizer keeps a single well-formed SVG root, drops scripts, foreign content, event handlers and unsafe references,
and writes its own data URL directly to the image source. An authored data URL still follows the ordinary URL policy.
If sanitization fails, the source appears as a code block. `imgFenceExtensions` and `imgFenceRenderers` expose the
registrations separately; `sanitizeSvg` exposes the sanitizer for hosts that need it.

```ts
import { render } from '@markup-carve/carve'
import { imgFence } from '@markup-carve/carve/extensions'

const source = '```img\n<svg><circle r="4"/></svg>\n```\n'
const html = render(source, imgFence())
```

In static mode (`mode: 'static'`) `details` writes `<details open>`, and the block spoiler writes a
`<section class="spoiler spoiler-revealed">` whose `<h3 class="spoiler-title">` holds the title. The fallback of
`details` and the block spoiler is the title as a `strong` paragraph followed by the body, as for a tab (C2-X-042).

## Inline

| Factory | Source | HTML |
|---|---|---|
| `spoiler()` | `:spoiler[text]` | `<span class="spoiler">` (`carve.spoiler`), in static mode also `spoiler-revealed` |
| `colorSwatch(options)` | `:color[#f00]` | a swatch chip with the value; options `position`, `shape`, `tint`, `reveal` |
| `wikilinks(options)` | `:wiki[Page#anchor\|Display]` | a link through `urlGenerator`, checked against the URL policy |
| `semanticSpan()` | `[x]{samp}`, `{var}`, `{cite}`, `{dfn=term}` | `<samp>`, `<var>`, `<cite>`, `<dfn title="term">` |
| `smartQuotes(options)` | `"a"` and `'a'` with `smartTypography: true` | the quotes of `options.locale` |

`wikilinks` is the standard `:wiki` matcher (C2-X-057) with a renderer. Its options are `urlGenerator` (default: a
lowercase slug), `cssClass` (default `wikilink`) and `newWindow`. A target that the URL policy refuses renders as its
text.

`semanticSpan` adds `samp`, `var`, `cite` and `dfn` to the core keys `abbr`, `time` and `kbd`. The nesting order from
inside out is `abbr`, `time`, `samp`, `var`, `kbd`, `cite`, `dfn`. `lint` reports the added keys on a node that is not
a span (`semantic-attribute-outside-span`) when the definition is in its `extensions` option.

`smartQuotes` takes `locale` (the exact locale, then its language, then English) and `openDoubleQuote`,
`closeDoubleQuote`, `openSingleQuote` and `closeSingleQuote` overrides. A closing single quote between two letters is
an apostrophe and keeps `’`. `smartQuoteLocales()`, `isSmartQuoteLocaleSupported(locale)` and `SMART_QUOTE_LOCALES`
list the locales.

## Document transforms

Three bundles hold only a document transform, which rewrites the render view (C2-X-053) and leaves the authored tree
alone. Pass the transforms to `renderWithDocumentTransforms`:

```ts
import { renderWithDocumentTransforms } from '@markup-carve/carve'
import { defaultAttributes, inlineFootnotesToParentheses, tabNormalize, withExtensions } from '@markup-carve/carve/extensions'

const bundle = withExtensions(
  defaultAttributes({ table: { class: 'table' }, code_block: { 'data-copy': 'true' } }),
  tabNormalize(4),
  inlineFootnotesToParentheses(),
)
const source = 'A note ^[remember this].\n'
const { html } = renderWithDocumentTransforms(source, bundle.transforms ?? [], {
  extensions: bundle.extensions,
  renderers: bundle.renderers,
})
```

- `defaultAttributes(map)` adds attributes per node type under the authored ones: `class` adds classes, `id` sets a
  missing id, any other key a missing pair.
- `tabNormalize(width = 2)` replaces each tab in code blocks and code spans with `width` spaces.
- `inlineFootnotesToParentheses()` writes each inline footnote `^[note]` as ` (note)` in the text.
