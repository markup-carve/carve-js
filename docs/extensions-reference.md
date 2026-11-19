# Reference apparatus extensions: glossary, index, citations

Provisional standard extensions of Carve 0.2. They may change in a 0.2.x release, as `spec/0.2/extensions.md`
states. They live in their own entry point and the core entry never loads them:

```ts
import { renderWithDocumentTransforms } from '@markup-carve/carve'
import { citations, withExtensions, glossary, index } from '@markup-carve/carve/extensions'

const registered = withExtensions(glossary(), index(), citations())
const { html } = renderWithDocumentTransforms(source, registered.transforms, {
  extensions: registered.extensions,
  renderers: registered.renderers,
})
```

Each factory returns a bundle with three parts:

- `extensions`: the inline matcher (`:term`, `:index` or `:cite`, C2-X-006) and the schema of the node that claims
  the directive. Pass them as the `extensions` option of `parse`, `render`, `write` and `lint`.
- `renderers`: one renderer per node, registered for both channels, so `mode: 'static'` writes the same HTML
  (C2-X-052).
- `transforms`: the document transform (C2-X-053) that reads the whole document, claims the directive and resolves
  each use. Pass them to `renderWithDocumentTransforms`.

`withExtensions` merges several bundles in registration order; two claims of one name fail at registration
(C2-X-014).

Without a bundle every construct keeps its core reading: `:term[HTTP]` is `<span class="ext-term">HTTP</span>` and
`::: glossary` is a plain `<div class="glossary">` (C2-H-158). With the matchers but no transform or renderer, each
use writes its core fallback (C2-X-035). The authored tree is never changed: the transforms work on a copy of the
render view, and `write` writes the source as it was.

## Glossary

A `::: glossary` directive holds description lists. Each term is an entry, and `:term[word]` links a use to it.

```carve
Use :term[HTTP] for pages.

::: glossary
:: HTTP
: HyperText Transfer Protocol.
:::
```

```html
<p>Use <a href="#gloss-HTTP" class="term">HTTP</a> for pages.</p>
<div class="glossary">
  <dl class="glossary">
    <dt id="gloss-HTTP">HTTP</dt>
    <dd>HyperText Transfer Protocol.</dd>
  </dl>
</div>
```

- A use reaches an entry by its exact text after whitespace collapse and NFC; case counts.
- An entry's id is `gloss-` and the case-preserving slug of the term. The first entry of a slug takes it; an id
  that an author already wrote gets `-2`, `-3` and so on.
- A use with no entry is `<span class="term">`. The authored attributes of a use stay on its element, except an
  `href`: the entry is the target.
- Blocks around the lists, the title, the label and the attributes of the directive stay where they are.

## Index

`:index[term]` is an invisible marker. A `::: index` directive lists every term, sorted by code point, with one
back-link per marker.

```carve
A :index[widget]widget and another :index[widget]widget.

::: index
:::
```

```html
<p>A <span id="idx-widget-1" class="index-term"></span>widget and another <span id="idx-widget-2" class="index-term"></span>widget.</p>
<div class="index">
  <ul class="index">
    <li>widget <a href="#idx-widget-1" class="index-backref" aria-label="Back to widget 1">↩<sup>1</sup></a> <a href="#idx-widget-2" class="index-backref" aria-label="Back to widget 2">↩<sup>2</sup></a></li>
  </ul>
</div>
```

- Terms are grouped by their lowercase slug; the first marker of a term gives the text the list shows.
- A marker in a footnote is not counted and has no id.
- `index({ backrefLabel })` sets the first words of each back-link's accessible name; the default is `Back to`, the
  `indexBackref` label. A document transform does not see the render's `labels`, so a host that localizes them
  passes the same text here.
- One render writes at most about 1 MB of index lists (8 times the source when that is more); further entries are
  left out.
- An index directive with no marker in the document stays core.

## Citations

`:cite[key]` cites an entry of a `bibliography` or `references` directive (C2-X-058). Each term of a description list
in that directive is a key, and its description is the entry. Several keys are separated by `;`.

```carve
See :cite[doe]{locator="p. 4"}.

::: references
:: doe
: Doe, J. (2020). /A book/.
:::
```

```html
<p>See [<a href="#ref-doe" data-cite-key="doe">1</a>, p. 4].</p>
<div class="references">
  <ol class="references">
    <li id="ref-doe">Doe, J. (2020). <em>A book</em>.</li>
  </ol>
</div>
```

- Options of a citation are attributes, not punctuation in the key: `locator`, `prefix`, `suffix`, and `mode`
  (`author-in-text` or `suppress-author`, the modes of C2-A-120). They are not written as HTML attributes.
- `citations({ mode: 'author-date' })` writes `(Doe 2020)` and lists the entries sorted by author. The author and
  year come from a span around the key, `:: [doe]{author="Doe" year="2020"}`, or from the CSL-JSON entry.
- `citations({ bibliography })` adds a CSL-JSON pool. A key resolves in the document first, then in the pool. With a
  pool each use gets an id `cite-KEY-N`, and each listed entry back-links to its uses. The extension reads no file:
  the host parses the CSL-JSON and passes the array.
- Citations are numbered in order of first use, in the body first and then in the notes. A citation with a key
  that has no entry is written as its text and takes no number.
- The list goes into the first `bibliography` or `references` directive, in place of the description lists the
  entries came from. Without one it is added at the end of the document.
