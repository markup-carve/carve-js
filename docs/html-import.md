# Importing HTML

What `htmlToCarve` and `htmlToAst` convert, and what they deliberately do not model.


```ts
import { htmlToCarve } from '@markup-carve/carve'

const { value, report } = htmlToCarve(html, { mode: 'safe', adapter: 'generic' })
```

The importer uses an HTML5 DOM, builds a Carve AST, and delegates source output
to the canonical writer. `report.diagnostics` records every lossy decision.
Use `semantic` for trusted editor HTML and `roundtrip` only for Carve-produced
HTML. The CLI equivalent is `carve migrate --from html --report report.json`.

`adapter: 'word'` and `adapter: 'google-docs'` (CLI: `--adapter`) add one
recognition the `generic` default does not risk: footnote-shaped HTML. A word
processor writes a note as a body anchor and a definition block that link to
each other, and none of them uses the `doc-noteref` / `doc-endnotes` roles a
Carve engine writes, so under `generic` a note arrives as a literal link beside
an orphaned list. Under those two adapters the pair is matched through the
fragment each anchor addresses and written back as `[^1]` and `[^1]: `,
whatever the ids are called - Word's `_ftnref1`/`_ftn1`, Google Docs'
`ftnt_ref1`/`ftnt1`, LibreOffice's `sdfootnote1anc`/`sdfootnote1sym` and
Pandoc's `fnref1`/`fn1` all pair by the same rule. Back-links, the marker
anchors they sit on, and the rule separating the notes from the body are
generated navigation and are dropped. A reference whose target is missing
stays a link, and a definition nothing references stays ordinary content
rather than becoming a definition that renders as nothing. Name the adapter
only for input you know came from that editor: on arbitrary HTML a mutually
linked anchor pair is not proof of a footnote, which is why `generic` stays
out.

## What the importer does not model


Three decisions are deliberate, so a diagnostic naming them is the whole answer
rather than a placeholder for a mapping still to come:

- **MathML is read for the TeX it already carries, never converted.** A
  `<math>` becomes a `math` node from an `<annotation>` whose encoding declares
  TeX (`application/x-tex`, `text/x-tex`, `LaTeX`) on the element's own
  `<semantics>`, else from its `alttext` with an `info` recording that the
  encoding was assumed. An element with neither carries no TeX, so it is
  dropped with a `warning` naming it in `safe` and `semantic` mode and kept
  verbatim in `roundtrip`. Its children are not concatenated into content:
  they are a token stream, and `<mfrac><mn>1</mn><mn>2</mn></mfrac>` reads out
  as `12`, which is a wrong value rather than a degraded one.

- **Embedded media** - `<video>`, `<audio>`, `<iframe>`, `<svg>`, `<object>`,
  `<embed>`, `<canvas>` - is unwrapped to the fallback content the author wrote
  for it in `safe` and `semantic` mode, and kept verbatim in `roundtrip`. Every
  attribute it carried is reported dropped: the ones Carve cannot represent as
  it reads them, and the ones it can - an `id`, a `class`, a `data-` pair - when
  the element they belonged to is unwrapped out from under them. Carve has no embed
  node, and giving it one is a spec question (which media, which attributes,
  what a non-HTML renderer does with them, what a `src` means in a document that
  must be safe to render from an untrusted source), so it is settled in the spec
  rather than by an importer.
- **`<mark>` and `<code>` are not semantic-span imports.** The seven elements
  PART 9 spells as a span attribute - `abbr`, `time`, `samp`, `var`, `kbd`,
  `cite`, `dfn` - import as `[text]{kbd}` and friends. These two are not among
  them: each already has its own syntax (`=text=` and a code span), so importing
  them as span attributes as well would give one input two spellings.

`migrate` reaches the other importers too - `--from markdown` (or `md`),
`--from djot`, and `--from bbcode` - which need no report because they parse
their source whole and drop nothing. See
[Migration and linting](https://github.com/markup-carve/carve-js/blob/main/docs/migration.md).

---

[Back to the README](https://github.com/markup-carve/carve-js/blob/main/README.md)
