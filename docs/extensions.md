# Extensions

Extensions are plain objects passed via `{ extensions: [...] }` to `carveToHtml`
(and the other renderers). They can add inline/block syntax with parse-stage
matchers, transform the AST before rendering, and override renderers for
extension nodes. A matcher is offered only where core syntax declined, so an
extension never hijacks core parsing.

The normative extension contract is documented in the spec repo at
[`carve/docs/extensions.md`](https://github.com/markup-carve/carve/blob/main/docs/extensions.md);
the matcher API matches carve-php and carve-rs.

## tabNormalize

Carve preserves literal tabs in code content by default (djot/CommonMark-aligned).
Add `tabNormalize(width = 2)` to expand each tab to spaces on output - flat
replacement, code content only - for fixed-width output without CSS `tab-size`:

```ts
import { carveToHtml, tabNormalize } from '@markup-carve/carve'

carveToHtml(src)                                   // tabs preserved (default)
carveToHtml(src, { extensions: [tabNormalize()] })  // tabs -> 2 spaces
carveToHtml(src, { extensions: [tabNormalize(4)] }) // tabs -> 4 spaces
```

## details

`details()` renders `::: details` admonitions as the HTML5
`<details>/<summary>` disclosure widget instead of the default
`<div class="details">`. The quoted title becomes the `<summary>` (a
title-less block falls back to `<summary>Details</summary>`):

```ts
import { carveToHtml, details } from '@markup-carve/carve'

const src = '::: details "More info"\nHidden until expanded.\n:::'
carveToHtml(src)                              // <div class="details">…
carveToHtml(src, { extensions: [details()] }) // <details><summary>More info</summary>…
```

The summary renders as escaped plain text (inline markup in a title is
flattened), and the widget needs raw-HTML output, so it is inert when raw
HTML is stripped. A top-level details block whose direct children include a
heading falls back to a plain `<div class="details">` (to avoid mis-nesting
it against heading section-wrapping).

## listTable

`listTable()` renders a `::: list-table` admonition as a real HTML `<table>`,
with the table authored as a nested list so cells can hold full block content
(paragraphs, lists, code) that the native pipe-table syntax cannot. Each outer
list item is a row; each inner list item is a cell:

```ts
import { carveToHtml, listTable } from '@markup-carve/carve'

const src = [
  '{header-rows=1}',
  '::: list-table "Quarterly results"',
  '- - Region',
  '  - Notes',
  '- - EMEA',
  '  - Strong quarter.',
  ':::',
].join('\n')

carveToHtml(src, { extensions: [listTable()] })
// <table>
//   <caption>Quarterly results</caption>
//   <thead><tr><th>Region</th><th>Notes</th></tr></thead>
//   <tbody>
//     <tr><td>EMEA</td><td>Strong quarter.</td></tr>
//   </tbody>
// </table>
```

The quoted title becomes the `<caption>`. Attributes sit on the **preceding**
line (a trailing `{...}` on the `:::` opener would make the whole block
literal in Carve):

- `header-rows=N` promotes the first `N` rows to `<thead>` / `<th>`.
- `header-cols=N` promotes the first `N` cells of every row to row-header
  `<th>`.
- The boolean form `{header-rows}` (no value) means the first row, the common
  "this table has a header row" case, so `=1` is rarely needed; `{header-cols}`
  likewise promotes the first column. An explicit `=N` wins; an absent attribute
  means no header.

A single-paragraph cell collapses to inline content (`<td>text</td>`), matching
tight list-item rendering; a multi-block cell keeps its block wrappers. A cell's
own list-item attributes (`-{.x} cell`) carry onto its `<td>` / `<th>`.

Cells span rows and columns with the **same** continuation markers Carve's pipe
tables use: a cell whose only content is a lone `^` merges with the cell above
(rowspan), and a lone `<` merges with the cell to the left (colspan). The span
markup matches what the equivalent pipe table produces. A cell carrying its own
attribute block, or one with extra blocks, is never a bare marker - its `^` / `<`
is then literal (the same escape pipe tables use). A header-row rowspan is
clamped at the `<thead>` / `<tbody>` boundary (an HTML cell cannot reliably span
row groups), where it degrades to an empty cell.

```ts
const sales = [
  '{header-rows=1}',
  '::: list-table "Sales"',
  '- - Region',
  '  - Q1',
  '  - Q2',
  '- - EMEA',
  '  - 10',
  '  - 12',
  '- - ^',   // rowspan: merge with EMEA above
  '  - 14',
  '  - 16',
  '- - Total',
  '  - <',   // colspan: merge with Total to the left
  '  - <',
  ':::',
].join('\n')
// EMEA gets rowspan="2"; Total gets colspan="3".
```

Only `::: list-table` blocks are claimed; every other admonition defers to the
core renderer. When the extension is not registered (or the block is malformed -
a row with no cell list, or stray siblings around the list) it degrades to the
default `<div class="list-table">` holding the literal nested list, so content
is never silently dropped.

## mermaid

`mermaid()` renders a fenced code block tagged `mermaid` (a ` ``` mermaid `
fence) as `<pre class="mermaid">` for client-side Mermaid.js, instead of the
default `<pre><code>`. `>` is preserved so arrow syntax (`A-->B`) survives, and
the diagram source renders as `<pre class="mermaid">graph TD; A-->B</pre>`. A
preceding block-attribute line (`{#id .class}`) carries onto the `<pre>`;
non-mermaid code blocks defer to the core renderer. Mermaid is a preset of
`fencedRender` (below) and accepts the same `cssClass` / `tag` / `wrapInFigure` /
`figureClass` options:

```ts
import { carveToHtml, mermaid } from '@markup-carve/carve'

carveToHtml(diagramSource, { extensions: [mermaid()] })
```

## fencedRender

`fencedRender(opts)` is the generic client-rendered fenced-block factory that
`mermaid` is a preset of. It claims fenced code blocks by language word and
emits one hydration element; the body is passed through verbatim. One factory
covers D2, Graphviz, WaveDrom, ABC, Vega-Lite, Chart.js, etc.

Options: `language` (string | string[], required), `cssClass` (default: first
language word), `tag` (`'pre'` | `'div'`; default `'div'` for json mode else
`'pre'`), `contentMode` (`'text'` | `'json'`, default `'text'`), `wrapInFigure`,
`figureClass`.

- **text mode** (Mermaid/D2/Graphviz/WaveDrom/ABC): escapes `&` and `<`, keeps
  `>` for arrow syntax.
- **json mode** (Vega-Lite/Chart.js): body verbatim inside
  `<script type="application/json">`, with `</` rewritten to `<\/` so it cannot
  close the script early.

```ts
import { carveToHtml, fencedRender, d2, vegaLite } from '@markup-carve/carve'

carveToHtml('```d2\na -> b\n```', { extensions: [d2()] })
// → <pre class="d2">a -> b</pre>
carveToHtml('```vega-lite\n{"mark":"bar"}\n```', { extensions: [vegaLite()] })
// → <div class="vega-lite"><script type="application/json">{"mark":"bar"}</script></div>
carveToHtml('```dot\na->b\n```', { extensions: [fencedRender({ language: ['dot', 'graphviz'], cssClass: 'graphviz' })] })
```

Built-in presets: `mermaid()`, `d2()`, `graphviz()` (claims `dot` + `graphviz`),
`wavedrom()`, `abc()`, `vegaLite()`, `chart()`. `presets()` returns all seven as
an array to spread straight into `extensions`
(`carveToHtml(src, { extensions: [...presets(), mathBlock()] })`); note it claims
every preset fence word, so a literal code sample in one of those languages
becomes a hydration element. Author attributes on the fence are copied
through `renderAttrs`, which applies the always-on attribute hardening (strips
`on*` / `srcdoc` / `formaction`, neutralizes dangerous URL / `expression()`
values), so a `{onclick="…"}` fence can never reach the output.

> [!NOTE]
> **json mode emits a `<script type="application/json">`.** If you sanitize the
> HTML *after* converting (e.g. DOMPurify), that inert script is typically
> stripped. Either whitelist `<script type="application/json">` in your
> sanitizer, or render the library config in **text mode** so it rides in a
> `<pre>` as escaped text and survives sanitizing - then read it from
> `textContent` instead of a script tag:
>
> ```ts
> // Chart.js config as escaped text in <pre class="chart"> (sanitizer-safe).
> carveToHtml(src, { extensions: [fencedRender({ language: 'chart', contentMode: 'text', cssClass: 'chart' })] })
> // → <pre class="chart">{ "type": "bar", … }</pre>
> ```

## mathBlock

`mathBlock()` renders a fenced code block tagged `math` (a ` ``` math ` fence)
as `<div class="math display">\[ … \]</div>`, the GFM-style block form of
Carve's core `$$` display math. The body is HTML-escaped (`&`, `<`, `>`) and
wrapped in `\[ … \]` for a client-side math engine (KaTeX/MathJax).
Non-`math` code blocks defer to the core renderer. Configurable `language`:

```ts
import { carveToHtml, mathBlock } from '@markup-carve/carve'

carveToHtml('```math\nx^2\n```', { extensions: [mathBlock()] })
// → <div class="math display">\[x^2\]</div>

// A {#eq .big key=val} line above the fence merges onto the div, exactly like
// core display $$ math (math display base class, then attrs in source order):
carveToHtml('{#eq .big data-ref=x}\n```math\nx^2\n```', { extensions: [mathBlock()] })
// → <div id="eq" class="math display big" data-ref="x">\[x^2\]</div>
```

> [!NOTE]
> Author attributes are copied through the shared `renderAttrs`, which applies
> the always-on attribute hardening every element gets: event handlers (`on*`),
> `srcdoc`, `formaction` are stripped and dangerous URL / `expression()` values
> neutralized, regardless of render options. So a `{onclick="…"}` on a fence can
> never reach the output. This mirrors how core inline `` $`…` `` / display
> `` $$`…` `` math carry their `{...}` attributes.

## spoiler

`spoiler()` is the standard hidden-content extension (inline + block). It claims
the reserved `spoiler` role - no new syntax.

```ts
import { carveToHtml, spoiler } from '@markup-carve/carve'

carveToHtml('Plot: :spoiler[the butler did it].', { extensions: [spoiler()] })
// <p>Plot: <span class="spoiler">the butler did it</span>.</p>

carveToHtml('::: spoiler "Ending"\nEveryone lives.\n:::', { extensions: [spoiler()] })
// <details class="spoiler">
//   <summary>Ending</summary>
//   <p>Everyone lives.</p>
// </details>
```

- **Inline** `:spoiler[text]` → `<span class="spoiler">text</span>`.
- **Block** `::: spoiler ["Title"]` → an HTML5 `<details class="spoiler">`
  disclosure (native, keyboard- and screen-reader-accessible). No title →
  `<summary>Spoiler</summary>`.
- Without the extension, `:spoiler[x]` stays `<span class="ext-spoiler">x</span>`
  and `::: spoiler` stays `<div class="spoiler">`, so documents stay readable.
- Author attributes merge onto the output element through the shared
  `renderAttrs` (always-on hardening: `on*` / `srcdoc` / `formaction` stripped).

Carve emits only the marker; the blur / collapse + reveal is the host's CSS/JS.
Three host looks over the same markup (hover never reveals - it would spoil by
accident; content stays in the DOM for screen readers):

- inline `:spoiler[text]` → `<span class="spoiler">` styled as a **blur** that
  reveals on click;
- a generic `{.spoiler}` block div → `<div class="spoiler">` styled as a
  **blurred panel that keeps its space**, revealing on click;
- `::: spoiler` → `<details class="spoiler">` left as a **native collapse**
  (summary only, expands on click - no JS, fully keyboard/AT accessible).

A `.masked` variant gives a credit-card / PIN look (every char a dot):
`:spoiler[1234]{.masked}`.

```css
/* Inline: blurred until clicked. */
span.spoiler { filter: blur(.3em); cursor: pointer; border-radius: 3px; padding: 0 .15em;
  background: rgba(127, 127, 127, .14); user-select: none; transition: filter .2s; }
span.spoiler.revealed { filter: none; background: transparent; user-select: text; }
/* Credit-card / PIN variant ({.masked}): every char a dot. */
span.spoiler.masked { filter: none; -webkit-text-security: disc; }
span.spoiler.masked.revealed { -webkit-text-security: none; }
/* Block as a blurred panel that keeps its space (a generic {.spoiler} div). */
div.spoiler { filter: blur(.4em); cursor: pointer; border-radius: 8px; padding: 10px 14px;
  border-left: 3px solid #e0af68; user-select: none; transition: filter .25s; }
div.spoiler.revealed { filter: none; cursor: auto; user-select: text; }
/* Block as a native collapse (::: spoiler): summary only until clicked. */
details.spoiler { border-left: 4px solid #e0af68; border-radius: 8px; padding: 6px 14px; }
details.spoiler > summary { color: #e0af68; cursor: pointer; list-style: none; }
details.spoiler > summary::before { content: "👁 "; }
details.spoiler > summary::after { content: " (click to reveal)"; font-weight: 400; }
details.spoiler[open] > summary::after { content: ""; }
```

```js
// The two blur forms (inline span, block div) reveal on click / Enter / Space.
for (const el of document.querySelectorAll('span.spoiler, div.spoiler')) {
  el.tabIndex = 0
  el.setAttribute('role', 'button')
  el.setAttribute('aria-label', 'Spoiler, activate to reveal')
  const toggle = () => el.classList.toggle('revealed')
  el.addEventListener('click', toggle)
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle() }
  })
}
// `::: spoiler` → <details> is a native disclosure - it collapses/expands on its own.
```

## wikilinks

`wikilinks()` parses `[[Page]]` links (Obsidian / MediaWiki style) into
anchors, using the parse-stage matcher below. Forms: `[[Page]]`,
`[[page|Display]]`, `[[page#anchor]]`, `[[folder/page]]`. The default href is a
slug; pass `urlGenerator` for custom routing, `cssClass` (default `wikilink`),
or `newWindow`:

```ts
import { carveToHtml, wikilinks } from '@markup-carve/carve'

carveToHtml('See [[Tigers]].', { extensions: [wikilinks()] })
// <p>See <a href="tigers" class="wikilink" data-wikilink="Tigers">Tigers</a>.</p>

carveToHtml('[[Tiger Facts|big cats]]', {
  extensions: [wikilinks({ urlGenerator: (p) => '/wiki/' + p.toLowerCase().replace(/ /g, '-') })],
})
// <p><a href="/wiki/tiger-facts" class="wikilink" data-wikilink="Tiger Facts">big cats</a></p>
```

## externalLinks

`externalLinks()` adds `target` and `rel` to external (`http(s)://`) links and
autolinks, ported from carve-php's ExternalLinksExtension. It runs as a
`beforeRender` transform, so the core renderer emits the attributes:

```ts
import { carveToHtml, externalLinks } from '@markup-carve/carve'

carveToHtml('[docs](https://example.com)', { extensions: [externalLinks()] })
// <p><a href="https://example.com" target="_blank" rel="noopener noreferrer">docs</a></p>
```

Configurable `target`, `rel`, and `nofollow`. Relative and anchor links are
left untouched. (Semantic spans like `:kbd[…]`, `:abbr[…]`, `:dfn[…]` are
already core, no extension needed.)

## headingPermalinks

`headingPermalinks()` adds a clickable anchor to each heading (ported from
carve-php's HeadingPermalinksExtension):

```ts
import { carveToHtml, headingPermalinks } from '@markup-carve/carve'

carveToHtml('# My Heading', { extensions: [headingPermalinks()] })
// <section id="my-heading">
//   <h1>My Heading <a href="#my-heading" class="permalink" aria-label="Permalink">¶</a></h1>
// </section>
```

Configurable `symbol`, `cssClass`, `ariaLabel`, `levels`, and `prepend`. It
uses a `blockRenderers.heading` renderer: top-level headings render through a
section-wrapping pass, so an extension can render the `<h*>` element (the
`<section id>` wrapper stays core) by registering a renderer for the `heading`
node type.

## tableOfContents

`tableOfContents()` builds a nested `<nav class="toc">` of links from the
document's headings, ported from carve-php's TableOfContentsExtension:

```ts
import { carveToHtml, tableOfContents } from '@markup-carve/carve'

carveToHtml('# Intro\n\n## Details', { extensions: [tableOfContents()] })
// <nav class="toc"><ul><li><a href="#intro">Intro</a><ul><li><a href="#details">Details</a></li></ul></li></ul></nav>
// <section id="intro"> … </section>
```

A `beforeRender` transform: it reads the resolved heading ids and inserts the
TOC at the document `top` (default) or `bottom`. Configurable `minLevel`,
`maxLevel`, `listType` (`ul`/`ol`), `cssClass`, and `position`. The generated
markup is raw HTML, so it is inert when raw HTML output is stripped.

## autolink

`autolink()` linkifies bare URLs and email addresses (carve core leaves them
literal by default). Ported from carve-php's AutolinkExtension:

```ts
import { carveToHtml, autolink } from '@markup-carve/carve'

carveToHtml('Visit https://example.com or a@b.com.', { extensions: [autolink()] })
// <p>Visit <a href="https://example.com">https://example.com</a> or <a href="mailto:a@b.com">a@b.com</a>.</p>
```

Linkifies `https://`, `http://`, `mailto:`, and bare emails; a trailing
sentence punctuation mark stays outside the link. Restrict with
`autolink({ allowedSchemes: ['https'] })` (dropping `mailto` also disables bare
email linking).

## Adding syntax: parse-stage matchers

An extension can add new syntax with a `matchInline` or `matchBlock` matcher
(the parse half of the contract, matching carve-php and carve-rs). Core
constructs are dispatched first at each position; a matcher is offered only
where core declined, so extensions add syntax and never hijack core. The `ctx`
exposes recursive `parseInlines` / `parseBlocks` plus the link/abbr definition
tables.

```ts
import { carveToHtml, type CarveExtension } from '@markup-carve/carve'

// Inline: `[[Page]]` -> a wiki link, inner text parsed recursively.
const wikilinks: CarveExtension = {
  name: 'wikilinks',
  matchInline(text, pos, ctx) {
    if (!text.startsWith('[[', pos)) return null
    const close = text.indexOf(']]', pos + 2)
    if (close < 0) return null
    const label = text.slice(pos + 2, close)
    return {
      node: { type: 'link', href: '/' + label, children: ctx.parseInlines(label) },
      end: close + 2,
    }
  },
}

carveToHtml('See [[Home]].', { extensions: [wikilinks] })
// <p>See <a href="/Home">Home</a>.</p>
```

An inline matcher returns `{ node, end }` (`end` is the source offset past the
match); a block matcher receives `(lines, start, ctx)` and returns
`{ node, linesConsumed }`. Matchers run in registration order.

A block matcher is offered at block start (after a blank line or another
block); it does not interrupt an open paragraph, so an extension block on the
line directly below paragraph text needs a blank line first. Paragraph
interruption (spec §10) is core-only, and carve-rs / carve-php behave the same
way - this keeps extension block syntax identical across implementations.
