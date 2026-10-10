# Rendering behavior

Three rendering choices this package exposes: the depth ceiling, how heading ids are derived, and how sections are wrapped.

## Ruby annotations

An ingested AST can carry ruby as ordered `base` and `annotation` inline arrays:

```json
{
  "type": "ruby",
  "pairs": [
    { "base": [{ "type": "text", "value": "漢" }], "annotation": [{ "type": "text", "value": "かん" }] }
  ]
}
```

HTML and Markdown preserve the relationship with native `<ruby>`, `<rt>`, and generated `<rp>` elements. Plain text, ANSI, and canonical Carve use `漢(かん)` and report `ruby-flattened`. With outer attributes, the Carve writer wraps the complete fallback in one attributed span.

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
`Über-uns`); a cross-reference names the id in its exact case (`</#Über-uns>`),
and `</#über-uns>` stays literal text. Two
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

## Carrying a container through a Markdown round trip

Flattening keeps the words and loses the container. On the Markdown target that
loss is total for a tab set, an admonition, a named div, a columns container, a
disclosure, a spoiler and a composite figure's group wrapper: no element, no
marker and no attribute of its own reaches the output, so an import cannot tell
a container was ever there. An admonition loses its kind along with its title.

`CARVE-P11-063` closes that round trip with an opt-in *carrier mode*. It leaves
the visible fallback exactly as it is and brackets each of those containers with
an HTML comment holding the Carve opener and closer verbatim:

```bash
carve render --markdown --carry-markers note.crv
```

```markdown
<!-- carve: ::: note "Heads up" -->
**Heads up**

An admonition body.

<!-- carve: ::: -->
```

`carve migrate --from markdown` reads those markers back and returns the
container. Programmatically the mode is the `carryMarkers` option on
`carveToMarkdown` and `renderMarkdown`.

The mode is **off by default**, and the default output is unchanged: a renderer
with raw HTML turned off shows the comment as text, so the carrier is a choice
the host makes for files it will re-import. Markers are only ever *added* - the
body bytes are the ones this target writes today.

### What the markers carry

An attributed container's attributes live on the line **above** the opener,
because `PART 4` admits no inline `{...}` attributes on an opener line. So an
attributed container is two Carve lines, and it takes two markers:

```markdown
<!-- carve: {.fancy} -->
<!-- carve: ::: wrapper -->
A generic div.

<!-- carve: ::: -->
```

A `-->` inside a payload is written `--\>`, and a backslash already sitting
where that escape would land grows by one, so the transform reverses exactly.
Nothing else is escaped: the payload is Carve source, and Carve's own escape is
the one the reader already has.

### What takes no marker

- A container this target already spells. An attributes-only opener
  (`::: {.warning}`) is written verbatim and a list table becomes a pipe table,
  so neither is element-less.
- A container inside a line-prefixing host - a list item, a block quote, a table
  cell. The comment would sit at the host's content column or behind its `>`,
  where the import does not read it, so writing one would look like a carry and
  not be. Such a container degrades exactly as it does with the mode off.
- A marker-shaped line inside a fenced code block, on the way back in: a code
  block's payload is verbatim content, so a page like this one holds lines that
  record no container.

A composite figure group's own caption is not restored either. The caption slot
hangs on the closing fence, outside the container the markers bracket.

### A damaged marker set is never guessed

A Markdown editor that deleted one marker, reordered two or left the set
unbalanced has destroyed the structure the markers recorded, and a
reconstruction that is wrong is worse than a fallback that is honest. The import
then reads the file as ordinary Markdown, comments and all, and reports one
`carrier-markers-damaged` diagnostic at `degraded` fidelity and `fallback`
confidence. There is no partial reconstruction and no per-marker recovery.
