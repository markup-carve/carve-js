# Rendering behavior

Three rendering choices this package exposes: the depth ceiling, how heading ids are derived, and how sections are wrapped.

## Renderers refuse a tree that nests too deeply


Every `render*` function stops at `MAX_RENDER_DEPTH` and throws a
`RenderDepthError` naming the bound, rather than truncating the output or
letting the host stack run out:

```ts
import { renderHtml, RenderDepthError, MAX_RENDER_DEPTH } from '@markup-carve/carve'

try {
  renderHtml(doc)
} catch (err) {
  if (err instanceof RenderDepthError) {
    // err.renderer, err.depth === MAX_RENDER_DEPTH
  }
}
```

Nothing `parse` produces can reach the ceiling - it sits above the parser's own
nesting cap - so this only applies to a tree you built through the API or
decoded from somewhere else. A renderer that stopped emitting instead would
hand back a document that looks complete and is not.

## Heading ids


Every heading gets an automatic id derived from its text. Ids are
**case-preserving** and keep non-ASCII verbatim by default (`# Über uns` ->
`Über-uns`); cross-references (`</#uber-uns>`) resolve case-insensitively. Two
orthogonal options on every converter (and on `resolve` / `lintCarve`) adjust
the slug:

| Option | Values | Effect |
|--------|--------|--------|
| `asciiHeadingIds` | `false` (default) | keep non-ASCII verbatim |
| | `true` / `'fold'` | best-effort: transliterate non-ASCII to ASCII, but scripts the map can't handle (Greek, CJK, Arabic, emoji) are kept verbatim |
| | `'strict'` | guarantee a pure-ASCII id (`[0-9A-Za-z-]`): transliterate, then drop any unmappable residue |
| `lowercaseHeadingIds` | `false` (default) / `true` | lowercase the id (GitHub/SSG-style anchors) |

The two combine - `'strict'` plus `lowercaseHeadingIds` yields a fully lowercase
ASCII slug.

```ts
carveToHtml('# Café 日本語', { asciiHeadingIds: 'fold' })   // id="Cafe-日本語"
carveToHtml('# Café 日本語', { asciiHeadingIds: 'strict' }) // id="Cafe"
carveToHtml('# Über uns', { asciiHeadingIds: 'strict', lowercaseHeadingIds: true }) // id="uber-uns"
```

Under `'strict'`, a heading made entirely of unmappable script has no ASCII
left and falls back to the id `s` (then `s-2`, ...); attach an explicit
`{#my-id}` to such a heading for a meaningful anchor.

## Section wrappers


A top-level heading is wrapped, along with the content following it up to the
next same-or-shallower heading, in a `<section>` that carries the heading's id
(spec PART 9 §13). Only the id moves - `{#install .featured}` gives
`<section id="install"><h2 class="featured">` - and a heading inside a
blockquote, div, or list item is not wrapped at all.

Pass `sections: false` to render headings flat, with the id back on the `<h*>`:

```ts
carveToHtml('# A\n\np\n')
// <section id="A">
//   <h1>A</h1>
//   <p>p</p>
// </section>

carveToHtml('# A\n\np\n', { sections: false })
// <h1 id="A">A</h1>
// <p>p</p>
```

This exists for sites whose CSS or JS assumes rendered blocks are direct
children of the content container - the `.stack > * + *` spacing idiom,
`:first-child`, `nth-child()` counting, `element.children` walks - all of which
stop matching once a wrapper sits in between. It is the one output change that
breaks a document whose *source* migrated cleanly.

Nothing else changes when it is off: ids, collision dedup, `</#id>`
cross-references, implicit `[Heading][]` references, `::: toc`, endnotes
placement and heading numbering all resolve against the slug rather than the
element carrying it. The endnotes `<section role="doc-endnotes">` is a separate
construct and is still emitted. The option is HTML-only - no other target emits
`<section>`, and the AST has no `section` node.

---

[Back to the README](https://github.com/markup-carve/carve-js/blob/main/README.md)
