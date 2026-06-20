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

## mermaid

`mermaid()` renders a fenced code block tagged `mermaid` (a ` ``` mermaid `
fence) as `<pre class="mermaid">` for client-side Mermaid.js, instead of the
default `<pre><code>`. `>` is preserved so arrow syntax (`A-->B`) survives, and
the diagram source renders as `<pre class="mermaid">graph TD; A-->B</pre>`. A
preceding block-attribute line (`{#id .class}`) carries onto the `<pre>`;
non-mermaid code blocks defer to the core renderer. Configurable `cssClass`
and `language`:

```ts
import { carveToHtml, mermaid } from '@markup-carve/carve'

carveToHtml(diagramSource, { extensions: [mermaid()] })
```

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
```

> [!IMPORTANT]
> Unlike `mermaid`, `mathBlock` does **not** copy any author attributes onto
> the output `<div>` - neither a fence info-string nor a preceding
> `{#id .class}` block-attribute line. The extension emits raw HTML directly,
> bypassing the core safe-mode attribute sanitizer, so copying attributes would
> let `{onclick="…"}` through unfiltered on untrusted documents. The class is
> always the fixed `math display`. If you need styleable/targetable math, use
> the **core** inline `` $`…` `` / display `` $$`…` `` forms instead: those
> carry `{...}` attributes through the core renderer, where safe-mode strips
> dangerous handlers but keeps your classes and id.

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
