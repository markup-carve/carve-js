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

## Resource limits

`maxDepth` and `maxNodes` bound the document. Past either, the import throws
`HtmlImportLimitError` with the limit that stopped it, rather than handing back
part of a document.

`maxDiagnostics` (default 1000) bounds the REPORT instead. The conversion still
returns its Carve or its AST; the report carries the rows that fit, and its last
row is replaced by a `diagnostics-truncated` row of `error` severity saying more
findings existed. Read that row as "some loss is not listed here": its fidelity
is `dropped` and its confidence `fallback`, because nothing is known about the
rows it stands for.

```ts
const { value, report } = htmlToCarve(html, { maxDiagnostics: 50 })
if (report.diagnostics.at(-1)?.code === 'diagnostics-truncated') {
  // `value` is complete; the report is not.
}
```

Raising `maxDiagnostics` and importing again is what gets the rest.

## What the importer does not model


Six decisions are deliberate, so a diagnostic naming them is the whole answer
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
- **An empty `<code>` is written only where its backtick run ends.** A code
  span with nothing in it is a run nothing closes, and the run ends at the end
  of a block, at the braced closer of an emphasis, or at the end of a table
  row. Anywhere else it would read what follows as code, so the span is
  dropped with a `structure-unspellable` warning: `<p>x<code></code>y</p>`
  imports as `xy`. Where the run does end, the span is written and the
  emphasis around it takes the braced closer, so `<p><s><code></code></s></p>`
  imports as ```{~``~}```. An empty span has no closing run for an attribute
  block to follow, so its attributes are reported as `attribute-dropped`.
- **A `<br>` in a table cell becomes a space.** A table row is one line and a
  hard break ends the line, so Carve has no spelling for one inside a cell. The
  break flattens to one space between the words on either side, with a
  `structure-unspellable` warning: `<td>x<br>y</td>` imports as `| x y |`.
  `htmlToAst` keeps the break, and `renderCarve` writes the same space for a
  tree that holds one.
- **Ruby annotations stay structured.** A conforming `<ruby>` run becomes a
  `ruby` AST node whose `pairs` keep each base and its first `<rt>` annotation.
  Conventional `<rp>` parentheses are ignored. Custom `<rp>` content is
  dropped with an `element-dropped` diagnostic. Obsolete `<rb>` is unwrapped;
  `<rtc>` and additional annotation levels keep their visible text in
  parentheses and report `element-unwrapped`. `htmlToCarve` also reports
  `structure-unspellable`, because Carve 0.1 can preserve the readable
  `base(annotation)` text but not the relationship.
- **An ordered task item keeps its bracket text.** `task_marker` in the grammar
  hangs off `unordered_item` alone, so no Carve source carries a checkbox behind
  an ordered marker. The pair is written where the `<input>` stood, with a
  `structure-unspellable` warning at the `<input>`'s own path:
  `<ol><li><input type="checkbox" checked> done</li></ol>` imports as
  `1. [x] done`. A `data-task-state` character reaches the brackets, because
  that is the marker a bullet would have carried. `htmlToAst` keeps the box on
  the item and reports nothing, only a writer losing it.
- **A span nested directly in a span of the same kind can lose a level.**
  Carve cannot open a braced span inside a braced span of the same kind, so
  where both levels need braces the inner element is unwrapped with a
  `structure-unspellable` warning: `<sup><sup>x</sup></sup>` imports as
  `{^x^}`. Where one level can be written bare, as in `a{**x**}b`, both stay.

`migrate` reaches the other importers too - `--from markdown` (or `md`),
`--from djot`, and `--from bbcode` - which need no report because they parse
their source whole and drop nothing. See
[Migration and linting](https://github.com/markup-carve/carve-js/blob/main/docs/migration.md).

---

[Back to the README](https://github.com/markup-carve/carve-js/blob/main/README.md)
