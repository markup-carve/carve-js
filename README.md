# carve-js

Reference TypeScript implementation of the [Carve](https://github.com/markup-carve/carve) markup language.

> **Status:** the parser, HTML renderer, and migration tooling are implemented and pass the spec corpus. Not yet published to npm (the package is still `private`).

## What this is

- A linear-time parser for `.crv` source → typed AST
- An HTML renderer that produces the canonical output defined by the spec
- A test runner that validates output against the [shared corpus](https://github.com/markup-carve/carve/tree/master/tests/corpus)

The spec, EBNF grammar, and example pairs live in the upstream [`markup-carve/carve`](https://github.com/markup-carve/carve) repo, pulled in here as a git submodule under [`spec/`](./spec). The corpus at `spec/tests/corpus/` is the contract this implementation honors.

## Layout

```
carve-js/
├── src/
│   ├── ast.ts            Typed AST node definitions
│   ├── parse.ts          Linear-time block + inline parser
│   ├── render-html.ts    AST → canonical HTML renderer
│   ├── djot-migrate.ts   Djot/Markdown collision warnings + autocorrect
│   ├── markdown-migrate.ts  Markdown → Carve source transform
│   ├── cli.ts            `carve` binary (carve fix)
│   └── index.ts          Public API (parse, resolve, renderHtml, carveToHtml)
├── test/                 Vitest suites, including the spec/tests/corpus
│                         runner that asserts parse + render matches each
│                         paired .html exactly
├── spec/                 git submodule → markup-carve/carve
├── package.json
└── tsconfig.json
```

## Development

```sh
git clone --recurse-submodules https://github.com/markup-carve/carve-js.git
cd carve-js
npm install
npm test
```

If you cloned without `--recurse-submodules`:

```sh
git submodule update --init
```

## Migrating from Markdown

`markdownToCarve(md)` rewrites common Markdown into equivalent Carve. It is a
source-to-source transform, not a parser, so it works on raw text and leaves
fenced/inline code untouched.

```ts
import { markdownToCarve } from '@markup-carve/carve'

markdownToCarve('a *very* **bold** ~~old~~ idea')
// => 'a /very/ *bold* ~old~ idea'
```

It handles the inline constructs that differ between Markdown and Carve, plus
Carve's blank-line-around-blocks rule:

| Markdown                | Carve     | Note                                      |
| ----------------------- | --------- | ----------------------------------------- |
| `*x*`, `_x_`            | `/x/`     | `_x_` is **underline** in Carve, not em   |
| `**x**`, `__x__`        | `*x*`     | Carve strong is a single `*`              |
| `***x***`, `___x___`    | `/*x*/`   | Carve's canonical bold-italic             |
| `~~x~~`                 | `~x~`     | Carve strikethrough is a single `~`       |
| `==x==`, `^x^`          | unchanged | identical in Carve                        |
| `$x$`                   | `` $`x` `` | inline math (`$5` left as currency)      |
| `<em>`/`<strong>`/`<mark>`/… | Carve form | common inline HTML tags             |

To go the other way — flagging a Djot document that would silently mis-render
under Carve — use [`djotMigrationWarnings`](./src/djot-migrate.ts), and to
rewrite those collisions in place use `applyMigrationFixes` (or the `carve fix`
CLI below):

```ts
import { applyMigrationFixes } from '@markup-carve/carve'

const { output, applied, skipped } = applyMigrationFixes('use _emphasis_ here')
// output  -> 'use /emphasis/ here'
// applied -> the warnings that were spliced in (nested ones compose, so
//            **_x_** fixes to a single-star bold wrapping a slash emphasis)
// skipped -> crossing collisions (e.g. **_x**_) left for manual review
```

## Command line

Installing the package provides a `carve` binary. Its one subcommand, `carve
fix`, wraps `applyMigrationFixes` to rewrite Djot/Markdown delimiter collisions
to their Carve equivalents.

```sh
carve fix < in.crv > out.crv     # stdin -> stdout (default)
carve fix --write doc.crv …      # rewrite files in place
carve fix --check doc.crv …      # report only; exit 1 if any would change (CI)
carve fix --stdout doc.crv       # print the fix for one file, don't modify it
```

With no files it reads stdin and writes the fixed result to stdout. Nested
collisions compose (`**_x_**` fixes in one pass); only *crossing* collisions
that are genuinely ambiguous (e.g. `**_x**_`) are reported on stderr for manual
review. `--check` is a gate: it exits non-zero when a file would change or has
manual-review collisions, so it drops into a pre-commit hook or CI step.

## Linting

`djotMigrationWarnings` catches *source-level* delimiter collisions;
`lintCarve` catches *semantic* problems that need the parsed tree - references
that silently degrade to literal text when the document resolves:

```ts
import { lintCarve } from '@markup-carve/carve'

lintCarve('# Setup\n\n## Setup\n\nSee </#ghost>.')
// [
//   { rule: 'duplicate-heading-id', line: 3, ... },  // second "Setup" -> id setup-2
//   { rule: 'broken-crossref',      line: 5, ... },  // </#ghost> has no heading
// ]
```

| Rule | Catches |
| ---- | ------- |
| `duplicate-heading-id` | two headings producing the same id (slug collision or repeated explicit `{#id}`); ambiguous references resolve to the first |
| `broken-crossref` | a `</#id>` cross-reference with no matching heading; it renders as literal text |

The `carve lint` CLI reports both the collision warnings and these semantic
ones as `file:line:col rule - message`, and exits non-zero if anything is
found:

```sh
carve lint doc.crv …   # report; exit 1 if any finding (CI / pre-commit)
carve lint < doc.crv   # read stdin
```

## Extensions

Extensions are plain objects passed via `{ extensions: [...] }`. Carve preserves
literal tabs in code content by default (djot/CommonMark-aligned). Add
`tabNormalize(width = 2)` to expand each tab to spaces on output — flat
replacement, code content only — for fixed-width output without CSS `tab-size`:

```ts
import { carveToHtml, tabNormalize } from '@markup-carve/carve'

carveToHtml(src)                                  // tabs preserved (default)
carveToHtml(src, { extensions: [tabNormalize()] }) // tabs -> 2 spaces
carveToHtml(src, { extensions: [tabNormalize(4)] })// tabs -> 4 spaces
```

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

### Adding syntax: parse-stage matchers

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
way — this keeps extension block syntax identical across implementations.

### Built-in: autolink

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

## Roadmap

See the [reference-parser plan](https://github.com/markup-carve/carve#roadmap) in the spec repo.

| Phase | Scope | Status |
|-------|-------|--------|
| M0.5 | Scaffold, AST types, corpus runner | ✅ Done |
| M1   | Block parser: headings, paragraphs, lists, quotes, fences, tables, frontmatter, hr, admonitions, captions | ✅ Done |
| M2   | Inline parser: emphasis (all 8 forms), links, images, code, autolinks, attributes, extensions, mentions, tags, smart typography, CriticMarkup | ✅ Done |
| M3   | HTML renderer; full corpus green | ✅ Done |
| M4   | npm publish; playground page in the docs site | Playground shipped; npm publish pending |

## License

MIT.
