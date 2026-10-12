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

## Roundtrip export

A render writes the bytes the serialization has a spelling for. A document also
holds distinctions it does not - which bullet character an author used, whether
an identifier was written or generated, which reference label a link resolved
by - and once a render drops one, no import can recover it.

`roundtrip` is one opt-in that adds the preservation metadata for those, and
changes nothing else:

```bash
carve render --html --roundtrip note.crv
carve render --markdown --roundtrip note.crv
```

```js
carveToHtml(src, { roundtrip: true })
renderMarkdown(doc, { roundtrip: true })
```

It is **off by default** on every surface, and enabling it neither removes nor
reorders an attribute the default output writes.

**The target decides the carrier.** HTML writes the named attributes PART 10
§13a lists; Markdown writes the carrier comments below, and none of the HTML
names.

What it guarantees is **recovery of the named distinctions, not byte-identical
source**.

### The HTML carriers

| Attribute | Rides | Holds |
| --- | --- | --- |
| `data-marker` | `<ul>` | the authored bullet marker, only where it is not `-` |
| `data-char` | `<hr>` | the authored thematic-break character, only where it is not `-` |
| `data-carve-explicit-id` | `<section>`, `<h1>`-`<h6>` | presence: the identifier was authored, not generated |
| `data-carve-ref` | `<a>`, `<img>` | the reference label the link or image resolved by |
| `data-carve-autolink` | `<a>` | presence: the link was authored as an autolink |
| `data-carve-footnote-label` | `<a>`, `<li>` | the authored footnote label, on the reference and on the endnote item |
| `data-carve-inline-footnote` | `<li>` | presence: the endnote came from an inline footnote |
| `data-carve-raw` | `<span>` | the raw inline's format; the span holds its content |
| `data-carve-escaped` | `<span>` | presence; the span holds one escaped character |
| `data-carve-abbreviations` | `<template>` | the document's abbreviation definitions, one per line |
| `data-carve-col-widths` | `<table>` | the authored separator-row dash widths, comma-joined; omitted for a table with no separator row or a width outside 1 to 1000 |
| `data-carve-label` | `<pre>` | a code block's authored label, the text between the fence label's brackets |

```carve
| a | b |
|:--|-----:|
| 1 | 2 |
```

```html
<table data-carve-col-widths="2,5">
```

**A raw block has no carrier.** One whose format the target cannot write is
dropped with the option on exactly as with it off, and the render reports
`raw-format-dropped` either way.

An **authored attribute that collides** with a carrier is dropped and the drop
is reported as a `carrier-attribute-dropped` render loss naming it. The carrier
wins because it is structural; emitting both would be invalid HTML.

`data-carve-*` is the serializer's protocol, not an author's content. An import
**consumes** these names and never writes one back out as an authored
attribute, in `safe` mode exactly as in `roundtrip`; the deprecated
`data-djot-*` spelling that earlier releases wrote is read too, so a document
exported before the rename still imports.

### What the import rebuilds

An import does not merely consume the names, it **rebuilds what they hold**:
the authored bullet and ordered delimiter, the thematic-break character, an
authored identifier, a link's or image's reference label (with the
`[label]: /url` definition written beside it), an `autolink` node, a footnote's
authored label, an inline footnote, an `escaped_text` node, a `raw_inline` with
its own format, a table's separator-row widths, a code block's label, and the
abbreviation definitions - so a use of a defined
abbreviation comes back as prose rather than as `[HTML]{abbr="..."}` on every
occurrence.

```js
htmlToCarve(carveToHtml('`\\x`{=tex}\n', { roundtrip: true })).value
// => '`\\x`{=tex}\n'
```

A carrier that cannot be honored is **not** a carrier: a value outside its
enumeration, a reference label no Carve source could spell, an escape longer
than one character, an autolink whose text is not its own destination, or a
label and an inline-note carrier contradicting each other on one endnote.
Those are dropped and reported, not guessed at, and the reserved name is still
never written back out.

One carrier's answer depends on the import mode. A raw inline of format `html`
is markup every HTML render emits verbatim, so rebuilding one would hand the
document back the markup `safe` and `semantic` just filtered out - whether the
carrier span held it as elements or as entity-escaped text, which is the same
payload. Only `mode: 'roundtrip'`, which already preserves input markup
wholesale, rebuilds it; everywhere else the span's children take the ordinary
filtered path and only the format is lost. Every other format is inert in this
target and rebuilds in every mode.

One distinction is not recovered. A collapsed reference `[r][]` and the full
`[r][r]` render identical bytes, carrier included, so the import writes the
full form. The label, the destination and the rendering survive; the spelling
is not in the HTML to read.

### Export is not an import mode

`roundtrip` adds information to **output**. HTML import's `mode: 'roundtrip'`
decides reconstruction and raw-HTML preservation of **input**, and finding a
carrier in a document is not a reason to trust that document. Enabling the
export option never enables a trusted import, never widens an importer's mode
and never relaxes a destination check.

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
carve render --markdown --roundtrip note.crv
```

```markdown
<!-- carve: ::: note "Heads up" -->
**Heads up**

An admonition body.

<!-- carve: ::: -->
```

`carve migrate --from markdown` reads those markers back and returns the
container. Programmatically the mode is the `roundtrip` option on
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

### Attribute lines, definition lists and captions

Three constructs that are not containers take markers too (`CARVE-P11-067`).

An attribute line this target drops - a heading's `#id`, a class on a paragraph,
a block quote, a list or a table - takes one marker directly above its block. A
generated heading id is not authored and takes none.

```markdown
<!-- carve: {#start} -->
# Roundtrip Test
```

A definition list is carried term by term: a marker holding the term line above
the term's paragraph, a `:` marker above each definition's first block, and one
marker with an empty payload after the list's last block.

```markdown
<!-- carve: :: Carve -->
**Carve**

<!-- carve: : -->
A markup language.

<!-- carve: -->
```

A caption - on a block quote, a table, an image, a code listing, an equation or
a composite figure - takes a marker holding the `^` line, directly above the
paragraph the caption renders as. For a composite figure that is the line after
the closer's marker.

```markdown
> Stay hungry.

<!-- carve: ^ Steve Jobs -->
Steve Jobs
```

The import replaces a term's or a caption's rendered paragraph, so neither
appears twice.

### What takes no marker

- A container this target already spells. An attributes-only opener
  (`::: {.warning}`) is written verbatim and a list table becomes a pipe table,
  so neither is element-less.
- A container inside a table cell. This target flattens a cell to one line, so
  there is no line for a marker to stand on. A container inside a list item or a
  block quote does take its markers, at the item's content column or behind the
  `>`, and the import restores it in that host.
- A definition list nested inside a definition. Only the outermost list is
  carried.
- An attribute on a list item's marker line or on an inline construct. Only an
  attribute line is carried.
- A marker-shaped line inside a fenced code block, on the way back in: a code
  block's payload is verbatim content, so a page like this one holds lines that
  record no container.

### A damaged marker set is never guessed

A Markdown editor that deleted one marker, reordered two or left the set
unbalanced has destroyed the structure the markers recorded, and a
reconstruction that is wrong is worse than a fallback that is honest. The import
then reads the file as ordinary Markdown, comments and all, and reports one
`carrier-markers-damaged` diagnostic at `degraded` fidelity and `fallback`
confidence. There is no partial reconstruction and no per-marker recovery.
