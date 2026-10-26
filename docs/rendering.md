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
| `data-carve-generated-id` | `<section>`, `<h1>`-`<h6>` | presence: the identifier was generated |
| `data-carve-ref` | `<a>`, `<img>` | the reference label the link or image resolved by |
| `data-carve-autolink` | `<a>` | presence: the link was authored as an autolink |
| `data-carve-footnote-label` | `<a>`, `<li>` | the authored footnote label, on the reference and on the endnote item |
| `data-carve-inline-footnote` | `<li>` | presence: the endnote came from an inline footnote |
| `data-carve-raw` | `<span>` | the raw inline's format; the span holds its content |
| `data-carve-escaped` | `<span>` | presence; the span holds one escaped character |
| `data-carve-abbreviations` | `<template>` | the document's abbreviation definitions, one per line |
| `data-carve-col-widths` | `<table>` | the authored separator-row dash widths, comma-joined; omitted for a table with no separator row or a width outside 1 to 1000 |
| `data-carve-label` | `<pre>` | a code block's authored label, the text between the fence label's brackets |
| `data-carve-id-slot` | `<section>` | the authored identifier's slot among the heading's attributes, counted from 0; omitted at 0, where the identifier leads |
| `data-carve-tight` | `<ul>`, `<ol>` | presence: the list is tight although an item's paragraph keeps its `<p>` for its own attributes |
| `data-carve-div` | `<div>` | presence: a bare `:::` div, written only where the `<div>` has no other attribute |
| `data-carve-line-block` | `<div>` | presence: a line block; `class="line-block"` alone stays the admonition of that name |
| `data-carve-substitution` | `<span>` | presence: the span holds exactly one `<del>` then one `<ins>`, the two halves of a substitution |

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

Default Markdown export reports flattened divs and captions, dropped block
attributes, and escaped raw HTML as render losses. Roundtrip carriers preserve
divs, attached attributes, and captions, so those losses are absent in roundtrip
mode. Escaped raw HTML still reports `raw-html-escaped`. The source-based checked
export also reports an unattached attribute line that parsing discards.

Under roundtrip export, every authored attribute whose name is reserved is
dropped on every node, even when that node writes no carrier of that name.
Each drop reports one `carrier-attribute-dropped` render loss naming the
authored key. A carrier still writes its own value. Default export passes
these authored attributes through and reports no carrier loss.

The reserved export names are the table's names plus `data-carve-src` and
`data-djot-src`. Neither source name has a carrier or is written by the core.
Matching is case-insensitive. Other names, including `data-carve-ext`,
`data-djot-ext`, and unlisted `data-carve-*` names, are ordinary authored
attributes. The other `data-djot-*` aliases are also passed through on export.

An import consumes the reserved names and accepts the table's deprecated
`data-djot-*` aliases in every mode. It never puts those names into authored
attributes.

### What the import rebuilds

An import does not merely consume the names, it **rebuilds what they hold**:
the authored bullet and ordered delimiter, the thematic-break character, an
authored identifier, a link's or image's reference label (with the
`[label]: /url` definition written beside it), an `autolink` node, a footnote's
authored label, an inline footnote, an `escaped_text` node, a `raw_inline` with
its own format, a table's separator-row widths, a code block's label, the slot
an authored identifier held among a heading's attributes, a tight list whose
item paragraph kept its `<p>`, and the abbreviation definitions - so a use of a defined
abbreviation comes back as prose rather than as `[HTML]{abbr="..."}` on every
occurrence.

```js
htmlToCarve(carveToHtml('`\\x`{=tex}\n', { roundtrip: true })).value
// => '`\\x`{=tex}\n'
```

An unmarked identifier on a heading is authored in every import mode.
An unmarked section-wrapper identifier matching its heading's default slug,
including a generated deduplication suffix, is generated and dropped. Any
other wrapper identifier moves to the heading as authored. The
`data-carve-generated-id` presence carrier drops the identifier regardless of
its value; `data-carve-explicit-id` keeps it as authored.

An identifier slot is read only on a wrapper with `data-carve-explicit-id`,
only as decimal digits, and only up to the number of the heading's other
attribute slots. An invalid or oversized slot is dropped and reported, and
the identifier leads. Without an explicit-id carrier, no attribute order is
published. An unwrapped heading with explicit-id publishes the element's own
attribute order. Tightness is read by presence on lists, whatever the
carrier's value.

A carrier that cannot be honored is dropped and reported. Examples include
a reference label no Carve source could spell, an escape longer than one
character, and an autolink whose text differs from its destination. A reserved
name never becomes an authored attribute.

Exactly four pairs contradict on one element: footnote-label with
inline-footnote, autolink with ref, explicit-id with generated-id, and escaped
with raw. Neither meaning is restored; the ordinary element imports, one
`attribute-dropped` warning covers the pair, and both names are consumed.
This applies to the `data-djot-*` aliases too. Value validation comes first:
an invalid value is not a carrier and contradicts nothing.

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
collapsed form `[r][]`. A reference with distinct label text stays `[t][r]`.
The label, the destination and the rendering survive; the spelling
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

A definition list nested inside another one is carried too. Its markers carry
its depth right after `carve:`, so the import can tell which list a marker
belongs to: the outermost list writes a bare `carve:`, a list inside one of its
definitions writes `carve:2`, and so on. A marker of depth 2 or more with no
open list one level up makes the set damaged.

```markdown
<!-- carve: :: Outer -->
**Outer**

<!-- carve: : -->
body

<!-- carve:2 :: Inner -->
**Inner**

<!-- carve:2 : -->
inner body

<!-- carve:2 -->

<!-- carve: -->
```

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

A bare div's opener is `:::` with nothing after it, so its marker is
`<!-- carve: ::: -->`, the same bytes as its closer's. The import tells them
apart by the containers already open: a bare fence of the innermost opener's
width closes it, any other opens one.

A payload may span lines. A definition term the canonical writer spells over two
lines is written across them, and the import reads the whole comment as one
marker and restores the line break:

```markdown
<!-- carve: :: A term that
wraps onto the next line -->
**A term that
wraps onto the next line**
```

### Reference links

Under roundtrip export a link that resolved through a reference definition keeps
its reference form, `[a][r]` or `[r][]`, and the definition writes its
`[r]: /u` line where it stands (CARVE-P11-028). Markdown has the construct, so
no marker is needed. Without the mode the link is written inline and a
referenced definition writes no line. A label Markdown would case-fold onto
another definition's stays inline.

### Attribute lines, definition lists, captions and fence titles

Four constructs that are not containers take markers too (`CARVE-P11-067`).

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

A code fence with a title or a label takes one marker directly above the fence,
holding the opener as `carve fmt` writes it. The fence below is written as
without the mode, and the import takes only the title and the label from the
marker. A title is not an attribute, so it is never carried as `{title=...}`; a
block attribute line keeps its own marker above the fence marker.

````markdown
<!-- carve: ```js "app.js" [Example] -->
```js "app.js" [Example]
let x = 1
```
````

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
confidence. There is no partial reconstruction of a set whose pairing breaks.

A marker whose payload it cannot stand for is a different case. Pairing is read
on marker shapes first, so an invalid opener still pairs with its closer and the
two drop together; any other invalid marker drops alone. A dropped marker stays
in the output as the ordinary HTML comment it is, the rest of the set restores,
and each dropped marker or pair is reported as `carrier-marker-dropped` at the
marker's line.

## Rendering an existing document

`carveToHtml` and its siblings take source. A host that produced a *tree*
instead; `expandIncludes` for a preview with the children merged in, an AST
patch, an editor session, a decoded PART 12 payload; reaches the same
composition with `renderDocument`:

```ts
import { renderDocument, renderDocumentWithReport } from '@markup-carve/carve'

const html = renderDocument(doc, { extensions, target: 'html' })
const report = renderDocumentWithReport(doc, { extensions, strictLosses: true })
```

It runs resolution, the extension transforms (`afterParse`, `beforeRender`),
the profile pass and then the renderer for `target` (`'html'` by default, plus
`'markdown'`, `'plain'`, `'ansi'`); the same order, entered one step later, so
a host never has to know that order. Composing it by hand is what this
replaces: `applyTransforms` is not public, and a pipeline missing it still
renders, so an extension that contributes a transform (citations numbering its
groups and appending the references list, a heading-level shift, default
attributes) degrades silently instead of failing.

Two obligations, because the seam begins after the parse:

- **Parse with the same `extensions` you pass here.** `matchInline` and
  `matchBlock` run at parse time; passing an extension here reaches only its
  transform and renderer hooks.
- **Parse with `positions: true`**, which the string entry points force.
  Resolution reads a block image's own column for the strict column-0 figure
  rule, so a positionless tree resolves to a different document.

The document is transformed **in place**, as the string entry points transform
the tree they just parsed. That is invisible when the entry point owns a fresh
parse and visible here, so hand over a freshly produced tree; re-parse or
re-expand a tree you already rendered.

A profile's `maxLength` is not enforced here; it is a pre-parse guard on
source bytes, and there is no source at this seam. `'carve'` is deliberately
not a target: `carveToCarve` runs a different composition on purpose, because a
formatter must write back what the author wrote.
Pass `{ alignTables: true }` to `carveToCarve` to pad table cells by Unicode 18
display width. The default keeps the canonical one-space padding.

## Mention and tag resolvers

`mentionUrl` and `tagUrl` remain available for route templates. For application
lookups, configure `resolveMention` or `resolveTag` instead:

```ts
carveToHtml(source, {
  socialContext: currentTenant,
  resolveMention: ({ name, context }) => (context as AppContext).users.get(name)?.url ?? null,
  resolveTag: ({ name, context }) => (context as AppContext).tags.get(name)?.url ?? null,
})
```

A resolver is authoritative for its kind. Returning `null`, throwing, or
returning a denied URL produces the ordinary inert span and never falls back to
the corresponding template. The callback receives the exact parsed name,
read-only attributes, the node kind, and the opaque `socialContext`. Its result
is a complete destination and is not encoded again.

## Task markers and AST state

`[ ]` and `[_]` are open; `[/]` is progress; `[!]` is blocked; `[x]` and
`[X]` are done; `[-]` is dropped; `[>]` is deferred; `[?]` is uncertain.
Only done checks the box. `TaskState` and AST JSON keep a nondefault authored
marker in `list_item.taskState`; `_` keeps its spelling but remains open.

## Check table preservation

Render-loss reports cover the events defined by the Carve render-loss schema.
Markdown, plain, and ANSI output report flattened merged cells as
`table-span-flattened`. Markdown also reports later header rows written as body
rows as `table-header-row-demoted`, a header row moved above earlier body rows
as `table-header-row-hoisted`, and each header cell in a row that is not a
header row as `table-header-cell-demoted`. A table caption written as a paragraph
reports `markdown-caption-flattened`. Render-loss reports do not assess every semantic
change. A nested tight item whose blocks cannot be written tight without an
indented `+` is written loose and reports `list-tightness-lost`.

Use the separate preservation assessment when caption placement or other table
structure matters:

```ts
import { carveToPreservationReport } from '@markup-carve/carve'

const result = carveToPreservationReport(source, 'markdown')
console.log(result.value)
console.log(result.losses)
console.log(result.preservation.diagnostics)

// Refuse any diagnosed table degradation, independently of strictLosses.
carveToPreservationReport(source, 'markdown', { strictPreservation: true })
```

Targets are `html`, `markdown`, `plain`, and `ansi`. The `table-structure-v1`
assessment checks spans, caption association, header roles, row groups,
attributes, column metadata, block cells, and alignment. Diagnostics carry
AST JSON node paths and field names. `maxDiagnostics` bounds retained detail
while `totalDiagnostics` counts all findings; strict refusal uses that count.
`result.losses` is the normative render-loss report; the assessment adds the
fields it does not cover.

The report sets `complete: false` and lists its unchecked boundaries. A clean
assessment does not establish preservation of non-table semantics, source
spelling, assets, host behavior, or a final PDF. `assessTablePreservation` also
accepts a validated AST JSON tree for callers that already have one.

Table alignment checks treat an unset alignment as left alignment. Host CSS and default header styling are outside the assessment.

## Straight quotes with smart typography



Pass `{ smartTypography: { quotes: false } }` to `carveToHtml`,
`carveToMarkdown`, `carveToPlainText`, or `carveToAnsi` to keep quote source
runs, including apostrophes. Other smart substitutions still render as glyphs.
An empty family object or `{ quotes: true }` keeps the default output.
`false` and `'source'` still emit every source run. Parsing and heading IDs
are unchanged; typed curly quotes and escapes keep their existing behavior.
