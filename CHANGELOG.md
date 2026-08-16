# Changelog

All notable changes to carve-js are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Composite figures: a bare `::: figure` fence is ONE figure of ordered
  panels** (markup-carve/carve#1122, PART 9 §4c). An opener carrying the fence
  and the kind word and nothing else - no quoted title, no `[label]` - parses
  as the new `figure_group` node, whose captionable direct children are its
  PANELS in source order: a captioned image, quote, code listing or display
  math, a promoted reference image, or a table. Everything else in the body
  stays ordinary group content, preserved in place. The `^ ` line after the
  CLOSING fence captions the group, with §4's slot idiom (adjacent or across
  one blank line attaches, two detach). An opener that carries a title or a
  label stays a generic container, and a bare opener inside an open group stays
  one too, so groups do not nest.

  The group is one sequence unit: its caption's `#` draws one number from the
  label's own sequence, the group id registers as `Label N`, and - only when
  the group drew a number - each panel id registers with a letter by panel
  order, so a crossref reaches the group or a single panel. A `#` in a panel
  caption stays the authored character and draws no number of its own. In HTML
  the panels nest DIRECTLY inside `<figure class="carve-figure-group">`, each
  as `<figure class="carve-figure-panel">`, with the group's `<figcaption>`
  last; Markdown degrades the panels in place and the plain-text and ANSI
  targets lead with the group caption. The canonical writer emits the authored
  form back, the HTML importer reads the rendered group shape back to the node,
  and five lint rules - `figure-group-nested`,
  `figure-group-opener-metadata`, `figure-group-panel-number`,
  `figure-group-empty` and `figure-group-single-panel` - name the shapes that
  parse fine and do less than they look like they do.

- **The `word` and `google-docs` HTML import adapters read footnote-shaped
  HTML as footnotes** (markup-carve/carve#1210, porting
  markup-carve/carve-php#1303). Word, Google Docs, LibreOffice and pre-3.x
  Pandoc each spell a footnote differently and none of them with the DPUB-ARIA
  roles, so their notes arrived as a literal link beside an orphaned list.
  Passing `adapter: 'word'` or `adapter: 'google-docs'` (CLI: `--adapter`) now
  binds each reference to its note and writes real `[^N]` references and
  definitions. The pair is matched through the fragment each anchor addresses
  and the back-link the note carries, so nothing depends on a vendor class
  name or on the `fn1`/`fnref1` id convention; back-links and the marker
  anchors they sit on are dropped as generated navigation, as is the rule
  separating the notes from the body. A reference with no target stays the
  link the HTML spelled, and a definition nothing references stays ordinary
  visible content. `generic` is unchanged.

- **Behavior change: `{% … %}` is now a delimited inline comment.**
  `foo {% bar %} baz` used to render its braces and now hides the middle. The
  new `braced-comment-in-a-template-source` lint rule reports the likely
  collision when Liquid, Nunjucks or Twig source reaches the parser as text.

- **HTML import reads MathML as math.** A `<math>` element becomes a `math`
  node whose content is the TeX the producer already put in the source: an
  `<annotation>` on the element's own `<semantics>` whose encoding declares TeX
  (`application/x-tex`, `text/x-tex`, `LaTeX`, matched on the whole value), else
  the `alttext` attribute with an `encoding-assumed` `info` recording that its
  encoding was guessed - MathML never states what `alttext` holds, so the math
  node is only correct while the guess does. `encoding-assumed` joins
  `HtmlImportDiagnosticCode`, which a consumer switching over the codes
  exhaustively has to answer for. It is deliberately not filed under
  `element-unwrapped`: unwrapping describes the input's structure and loses no
  meaning, while an assumed encoding is a claim about the output, and a
  consumer told only that an element is gone cannot separate the two.
  `display="block"` is display math and the TeX is written byte for
  byte, `{\displaystyle …}` wrapper included. An element carrying neither is
  dropped with a `warning` naming it in `safe` and `semantic` mode, and kept
  verbatim in `roundtrip`, where the output is byte for byte what it was and
  the preservation is now reported once for the element instead of once per
  descendant. There was no `math` branch at all until
  now, so every `<math>` unwrapped to its children and
  `<math><mfrac><mn>1</mn><mn>2</mn></mfrac></math>` imported as `12` - one half
  arriving as twelve, with nothing in the report naming `<math>` as the thing
  lost. MathML is not converted to TeX (decision D6, ruled as (a)+(b)). The
  element's subtree is charged against `maxNodes` and `maxDepth` even though
  the mapping does not walk it, so a structural limit still surfaces as
  `HtmlImportLimitError` rather than as a stack overflow.

- **HTML import states a table's row grouping, where it says something.**
  `<thead>`, `<tbody>` and `<tfoot>` map to `table.rowGroups` - a foot, a second
  body, a body with its own header rows or with row-head columns, and a
  `<thead>` whose rows are not header cells (what Word and pandoc emit). A plain
  `<thead>` over a `<tbody>` still emits nothing: that IS the structure every
  renderer derives from the rows, and carrying the field for it would put
  unspellable structure in every imported table (decision D1, ruled as (b)).
  Carve source cannot spell the field, so `htmlToAst` keeps it and `htmlToCarve`
  reports the loss.
- **`AstJsonPartitionError`.** `fromAstJson` refuses a `table.rowGroups` whose
  counts do not consume the table's rows. PART 12 section 15 makes the sum a
  MUST and JSON Schema cannot express it - there is no way to relate one field's
  value to another's length - so `headRows: 5` on a two-row table validated
  cleanly, decoded, and reached a consumer that then read rows the table does
  not have.

- **HTML import keeps a table's spans.** `colspan` and `rowspan` were thrown
  away, so a spanning cell was written as an ordinary one and its row came up
  short: `<td colspan="2">` under a two-column header produced a one-column row,
  with `table-degraded` as the only trace. They map to the continuation cells
  the model already had (`^` continues the cell above, `<` the one to its left),
  so the imported grid re-reads as the grid that came in. `rowspan="0"` is
  resolved against the row group, as HTML defines it; both spans are clamped to
  HTML's maxima and every generated cell is charged to `maxNodes`; a span that
  would leave the head the renderer derives is clipped and reported, because a
  rowspan across row groups is one browsers clip anyway. A second
  `<caption>` is reported instead of dropped in silence, mirroring the parser's
  first-caption-wins rule.

- **HTML import reads `<details>/<summary>` as the `details` admonition.** It
  became a generic `div` carrying a `details` class, and `<summary>` was not
  recognized at all: the label unwrapped into the body, so it re-rendered inside
  the box rather than on it and nothing could get back to a disclosure element.
  It now writes `::: details "Summary"`, which the `details()` extension renders
  as a real `<details>/<summary>` and a core render marks as the admonition
  title. `<details open>` keeps its state as the bare `{open}` attribute. A
  label the title slot cannot spell - it is delimited by `"` and has no escape -
  stays the body's first paragraph and is reported, and the attributes a
  `<summary>` carried are reported rather than dropped in silence.
- **HTML import reads `<q>` as quotation marks.** The element unwrapped, so the
  content arrived without the marks that made it a quotation. It now writes the
  typographic pair a browser draws, alternating double and single by nesting
  depth, and reports the mapping at `info` rather than claiming an unwrap. In
  `roundtrip` mode the element is raw-preserved instead, since the marks are
  text and do not render back as a `<q>`.

- **HTML import keeps an edit as an edit.** `<ins>` unwrapped to its text, so
  the insertion vanished and only its words stayed; it maps to the `insert`
  node now. `<del>` moves with it, from `strike` to `delete`: `<del>`/`<ins>`
  are HTML's change-tracking pair and Carve spells that pair `{-x-}` / `{+x+}`,
  while `<s>` and `<strike>` - content no longer accurate, no edit implied -
  keep `~x~`. All three now render back as the tag they came from.
- **HTML import reads `<ol type>`.** The attribute was exempt from the
  unsupported-attribute report and then never read, so `<ol type="a">` came back
  counting `1.` `2.` `3.` with no diagnostic anywhere. `a`, `A`, `i` and `I` map
  to `olType`, `1` is the default and carries no field, and any other value is
  reported rather than exempted into silence. Two shapes keep the field and lose
  the written MARKER - an alphabetic list starting past the 26th letter, and a
  one-item list whose only marker is a letter the other alphabet claims - and
  both are reported as serialization losses instead of being traded for a
  silently different list. A zero or negative `start` claims no alphabet at all,
  since none has a letter there, and a roman start above 3999 claims none
  either, because past it the writer has no numeral and repeats the thousands
  letter - a 40-byte input asking for a million characters per item.

- **HTML import reads `<dl>` as a definition list.** The tag had no branch, and
  `dt`/`dd` are not block tags, so every term and every definition landed in one
  inline buffer and the list came out as a single paragraph with the texts run
  together: `<dl><dt>Term</dt><dd>Definition</dd></dl>` imported as
  `TermDefinition`. It now maps to `definition_list`, a run of `<dt>` shares the
  `<dd>` entries that follow it, and the HTML5 `<div>` wrapper around a
  name-value group is walked through transparently. A `<dd>` with no `<dt>`
  before it is kept in the AST and reported as `structure-unspellable` when a
  writer has to spell it, because `:  text` on its own re-reads as a paragraph;
  content inside a `<dl>` that is neither a term nor a definition is kept after
  the list rather than dropped, and reported. An empty `<dt>`, a `<dd>` whose
  blocks write nothing, and the attributes a `<dt>`/`<dd>` has no slot for are
  reported too - including an event-handler attribute on a `<dt>`, `<dd>` or
  group `<div>`, which were the only places in the importer where active markup
  was dropped in silence.
- **A browser IIFE bundle.** `dist/carve.iife.min.js` exposes the whole public
  API as a `carve` global, for consumers that load classic scripts rather than
  ESM: CDN script tags, sandboxed iframes, userscript hosts. The `unpkg` and
  `jsdelivr` fields point at it, so those hosts serve it from the bare package
  URL and embedders no longer hand-bundle the package to load it outside a
  module context. The bundle carries no Node builtins and does not embed
  `@djot/djot`, which stays dependency-injected. It is built at release time
  and ships in the npm tarball; a git-dependency install of the repository
  still builds the ESM output only.
- **`semanticSpan()` extension.** The four semantic span names core does not
  reserve - `samp`, `var`, `cite`, `dfn` - plus the `:name[…]` spelling for all
  seven as a SOFT-DEPRECATED compatibility form, scheduled for removal in 0.2
  (markup-carve/carve#1146). The span half is declarative: the extension names
  what it claims and the core renderer renders it, so the nesting order, the
  value mapping and the riding rule have one implementation rather than two.
- **The `{:TAG}` language attribute** (markup-carve/carve#1114). `[x]{:fr}` is
  exact sugar for `{lang=fr}`, on inline spans and block attribute lines alike;
  `{:}` is the explicit "language unknown" form and desugars to `lang=""`. A
  tag is hyphen-separated ASCII-alphanumeric subtags of at most eight
  characters, a malformed candidate leaves the whole block literal, and the
  sigil takes no padding, so `{: fr}` is the empty attribute plus a separate
  boolean. `:tag` and `lang=tag` are one key, last value at the first position.
  This shipped without a changelog entry when the feature landed; recording it
  here rather than leaving it to the diff.
- **`carve migrate --from` reaches the Markdown and BBCode importers**, not
  just the HTML one it started with: `--from markdown` (with the `md` short
  name) and `--from bbcode` now convert on the command line, where
  `markdownToCarve` and `bbcodeToCarve` were library-only. `--mode`,
  `--adapter`, `--report` and `--check-loss` stay HTML's alone - it is the only
  importer that drops anything - and are ignored rather than rejected for the
  other two. An unknown format now fails with `unknown source format <name>`
  instead of the old `--from html is required`. Djot is deliberately not
  accepted: this package has no Djot importer, only the `carve fix` linter, so
  it reports as unknown rather than looking supported.
- **`smartQuotes` locale extension.** It matches carve-php's additive
  smart-quote configuration: 20 built-in locale sets, exact-locale then
  language fallback (`de-AT` → `de`, `fr_FR` → `fr`), English fallback for an
  unknown locale, and optional per-quote overrides. Apostrophes remain U+2019
  regardless of locale. The German optional-corpus case is now shared rather
  than PHP-only.
- **New rule `footnote-labels-differ-only-in-whitespace`.** Two definitions
  whose labels differ only in whitespace are legal and distinct, and are almost
  always one definition typed twice: the difference does not survive into
  rendered output and is invisible in most editors. Djot merges such labels,
  which drops one definition's content and emits duplicate ids; this reports
  the pair instead.

- **Structural three-way AST merge and patches** (#970). Explicit JSON-Pointer
  conflicts, optional conflict resolution, deterministic handling of
  independent edits, insertions, deletions and moves, position-independent
  patch creation and replay, and `carve merge [--json] base ours theirs` on
  the CLI. Final trees are validated as PART 12, malformed inputs are
  rejected, ambiguous wide-list matching is bounded, and prototype-pollution
  paths are avoided. Authored attributes named `pos` or `srcByteLength`
  survive; stale generated positions are discarded.

- **An AST-first HTML importer and migration CLI** (#985). `htmlToCarve`
  builds the tree instead of splicing strings, and the CLI reports what it
  could not carry faithfully rather than dropping it silently.

- **`bbcodeToCarve` importer** (#1014), the BBCode-to-Carve migration ported
  from carve-php's `BbcodeToCarve`.

- **Structural short captions are preserved in AST JSON** (#1006), with
  accessors on the owning nodes.

### Changed

- **A `[@key]: entry` bibliography line is a `citation_definition` node**
  (markup-carve/carve#1276, PART 12 §18). The line used to reach the published
  tree as a paragraph whose first child is a `citation_group` followed by the
  literal text `: {author=` and the rest of the entry - the parser's failure to
  recognize it, published, which anything reading the AST received as
  citation-shaped prose and round-tripped as prose. It is now a block node
  carrying `key` (the key without the `@`), `children` (the entry's inline
  content), `attrs` (the leading `{author= year=}` metadata block, when the
  definition carries one) and its `pos`, and it is built in the PARSE stage -
  the tree `toAstJson` serializes - rather than in the citations extension's
  `afterParse` hook, which `parse` does not call. Tier-2: with the extension
  off the line stays ordinary paragraph text, and a definition inside a block
  quote or list item is paragraph text as before.

  No rendered output moves on any target: the definition renders nothing where
  it sits and its entry renders in the references list, exactly as before. The
  canonical writer now writes the line back from the node, keeping a run of
  definition lines a run and always quoting the metadata values.

- **Every HTML import adapter, `generic` included, reads the DPUB-ARIA
  footnote roles** (markup-carve/carve-js#1105). An anchor with
  `role="doc-noteref"` and the `role="doc-endnotes"` section feed the same
  footnote pass the word-processor adapters run, so Pandoc 2.11+ HTML - and
  this engine's own rendered footnotes - import as real `[^N]` references and
  definitions without naming an adapter. This is a deliberate `generic`-mode
  behavior change, matching carve-php's core policy; the roles are AUTHORED
  semantics where the adapters' anchor-pair heuristic is an inference, so the
  heuristic (and the vendor class names) stays adapter-gated. A role-less
  document imports exactly as before, and an unmarked anchor addressing a
  note stays the content link the author wrote.

- **Every table cell pads its content in the canonical form** (PART 11 §6e). A
  cell carrying a prefix - the kind marker `=`, an alignment marker, an
  attribute block - was written with its content glued to it: `|=Heading|`,
  `|={.total}Total|=99|`. It now writes `|= Heading |` and
  `|={.total} Total |= 99 |`. The prefix still touches the opening pipe,
  because a space in front of it makes it literal content; only the content is
  padded, the way an unprefixed cell always was. An empty cell takes a single
  space. This also removes the guard that inserted a space only for content
  beginning with `<`, `>` or `~`: those characters are read glued off the
  untrimmed cell, and padding every cell covers the class without listing it.

- **BREAKING: a table cell's attribute block binds after its kind and alignment
  markers** (markup-carve/carve#1226, spec §5 T10). `header_cell` had no
  attributes slot, so an attributed header cell had no spelling at all: the only
  shape available was `|{#x}=R|`, which the grammar reads as a data cell whose
  content starts with `=`. Both productions take one order now - the `=`, then
  the alignment marker, then the block - so `|={.total} Total |`, `|=~{#score}
  Score |` and `|>{.num} 9 |` are cells the parser reads and the writer emits.
  That also reaches `scope="colgroup"` and `scope="rowgroup"`, which §5 T9
  documented as spellings and which were not expressible.

  The retired order is what breaks: `|{#x}< content |` was documented as
  attributes then a left-alignment marker. The `<` is no longer in a marker
  position, so it is literal content and the cell is not aligned. Nothing
  changes in practice for a document this engine already rendered - it read that
  source as attributes plus a literal `<` before this change too - but the
  documented meaning did move, so the new lint rule
  `table-cell-attribute-before-marker` reports the shape and names both
  spellings. It is a REPORT, not a rewrite: rewriting it inside `fmt` would add
  `text-align: left` and remove a character from the content, breaking
  `toHtml(fmt(x)) == toHtml(x)` on a document that is currently correct.

  Row attributes are untouched. They still glue to the row's closing `|`.
- **The canonical writer spells an attributed header cell natively.** It used to
  promote such a row with a GFM delimiter row instead, because the native form
  did not exist; it now writes `|={.x} a |` and keeps the delimiter row only for
  the one shape that still has no native spelling, a span marker promoted to a
  header cell.
- **HTML-to-Carve conversion reports the figure wrapper it cannot spell**
  (markup-carve/carve#1211, PART 12 §16). A `<figure>` wrapping a table imports
  as a figure whose target is the table, which Carve source has no spelling for,
  so the writer emits the table and a `^ ` caption line. That re-reads as the
  table's own caption, moving the text from a `<figcaption>` beside the table to
  a `<caption>` inside it. `htmlToCarve` now reports that as a
  `structure-unspellable` warning and `carve migrate --from html --check-loss`
  exits 1 for such input. `htmlToAst` is unchanged and reports nothing: a
  consumer that keeps the AST keeps the wrapper.
- **HTML import spells the seven semantic elements instead of unwrapping them**
  (markup-carve/carve#1140). `<kbd>Tab</kbd>` imports as `[Tab]{kbd}`,
  `<abbr title="X">c</abbr>` as `[c]{abbr="X"}` and `<time datetime="X">c</time>`
  as `[c]{time="X"}`, with `samp`, `var`, `cite` and `dfn` alongside them; an
  absent `title` or `datetime` gives the bare boolean, and leftover `id`,
  `class` and `data-*` ride the same span. In 0.1.3 each of the seven came back
  as its bare text with an `element-unwrapped` diagnostic, and `<time>` lost its
  `datetime` to an `attribute-dropped` one step earlier, so a document Carve can
  express exactly arrived as plain text. Both diagnostics stop firing for these
  elements, because neither loss still happens. The compact attribute form, not
  `:kbd[…]`: the generic spelling is the soft-deprecated compatibility form, so
  importing into it would write a form scheduled for removal into freshly
  migrated documents. `<mark>` and inline `<code>` are unchanged, each already
  having its own syntax, and `<pre><code>` still imports as a code block. All
  three modes map alike: none of the seven is active content for `safe` to
  withhold, and `roundtrip` raw-preserves only what Carve cannot express, so an
  exotic attribute on one of them (`<kbd dir="rtl">`) is now diagnosed as
  dropped rather than riding along inside raw HTML - the treatment `<mark>` and
  `<em>` already get there. `kbd`, `abbr` and `time` are core and round-trip
  through a plain render; `samp`, `var`, `cite` and `dfn` belong to
  `semanticSpan()`, so without that extension registered they render as
  `<span samp="">out</span>` rather than `<samp>` - the semantic survives as an
  attribute a reader can recover, where it was discarded before.
- **A table's `rowGroups` is validated on ingest, at every depth**
  (markup-carve/carve-js#1055). `fromAstJson` now refuses a `rowGroups` that is
  missing `headRows`, `bodies` or `footRows`, carries a property the schema does
  not name, or gives a negative count - inside a body group as well as on the
  record itself. It previously accepted any object at all there, including `{}`
  and `{junk: -5}`, kept it in the tree and published it again from
  `toAstJson`, which put this engine's decode behind a payload it had not
  looked at. Since 0.1.3 refused `rowGroups` outright as a property the schema
  did not name, nothing that decoded then stops decoding now: a well-formed
  `rowGroups` is newly accepted and rides through unchanged. This engine still
  neither produces nor reads the field.
- **Semantic spans split by tier.** Core reserves three span attributes -
  `abbr`, `time`, `kbd` - because the first two carry data the author would
  otherwise lose and the third is what every comparable system ships. `samp`,
  `var`, `cite` and `dfn` are ordinary attributes unless `semanticSpan()` is
  registered.
- **Core registers no `:name[…]` handler at all.** `:kbd[x]` renders
  `<span class="ext-kbd">x</span>`; the extension re-registers the seven names
  as the deprecated spelling. The extension SYNTAX is core and the handlers are
  Tier-2/3, which is what the spec always said and what a hardcoded set of
  seven tags in this renderer had been contradicting since the first release.
- **Leftover attributes ride the outermost semantic element.** `[Tab]{#k .key kbd}`
  is `<kbd id="k" class="key">Tab</kbd>` rather than a `<span>` wrapping a
  `<kbd>`, and `[x]{kbd onclick="…"}` is a bare `<kbd>`. A span with no semantic
  name is unchanged. A DERIVED attribute yields to an AUTHORED one of the same
  name, so `[x]{abbr="gen" title="authored"}` carries `title` once.
- **`code` and `mark` leave the built-in semantic registry.** Both spellings
  follow the spec's seven-name list - `abbr`, `time`, `samp`, `var`, `kbd`,
  `cite`, `dfn` - so `:code[x]` and `:mark[x]` take the generic
  `<span class="ext-NAME">` fallback and `[x]{code}` / `[x]{mark}` are ordinary
  boolean attributes on the outer span. A name belongs in the registry only
  where Carve has no other way to write that element, and these two have one:
  a code span writes `<code>`, `=x=` writes `<mark>`. `code` was also the name
  that made the duplication a defect rather than a wart - a code span is
  verbatim while an extension body is parsed, so `` `*b*` `` and `:code[*b*]`
  produced the same tag with different content models, and nothing reported
  the switch (markup-carve/carve#1146). `lintCarve` follows: a value on `code`
  or `mark` is no longer reported as ignored, because it is no longer ignored.
- **Compact semantic span attributes are now portable core syntax.**
  `[Ctrl]{kbd}`, `[HTML]{abbr="…"}`, and combined forms such as
  `[CSS]{dfn abbr="…"}` render without an opt-in extension and match PHP and
  Rust. The AST and non-HTML renderers retain ordinary span behavior.
- **The existing nine-name semantic inline registry is now spec- and
  corpus-pinned across all engines.** `:abbr[…]`, `:cite[…]`, `:dfn[…]`,
  `:kbd[…]`, `:samp[…]`, `:var[…]`, `:time[…]`, `:code[…]`, and `:mark[…]`
  retain their existing same-named HTML output; this release adds explicit
  attribute-hardening, non-HTML and source-writer conformance coverage.
- **The Markdown target escapes `<` only where it would open markup** (PART 11
  §8a M1e, markup-carve/carve#1148). `<` and `>` were rewritten to `&lt;` and
  `&gt;` unconditionally, with no clause behind it. A `<` is now escaped with a
  BACKSLASH when the next character is an ASCII letter, `/`, `!` or `?` - the
  four things that open raw HTML - and left alone otherwise; `>` takes nothing,
  since it is inert mid-line and a block quote marker at line start, which M1
  already covers. So `a < b` survives as itself instead of becoming
  `a &lt; b`, and `a <b> c` becomes `a \<b> c`, which a CommonMark reader gives
  back as text. An entity is not an escape: it replaces the character rather
  than protecting it, which is why the old behavior could not be derived from
  the section.
- **The Markdown target leaves a bare ampersand alone.** Text was neutralized as
  `&amp;`, `&lt;` and `&gt;`; only two thirds of that was doing anything. An
  entity in Markdown TEXT decodes to a CHARACTER, and a character cannot open a
  tag, so `&` carried no risk to leave bare - measured against pandoc 3.5,
  commonmark.js and marked with raw HTML allowed. `<` and `>` keep the entity
  form, which is what actually neutralizes embedded HTML. `Aktionen & Reaktionen`
  now writes as itself. Text authored as `&#65;` is emitted as itself too and a
  consumer may decode it; there is no character-reference exception.

- **Bidi control characters are stripped from presentation targets** (#964),
  and ANSI widths ignore the controls they are about to strip (#967), so
  Trojan-Source reordering cannot survive into plain-text, ANSI or Markdown
  output.

- **Plain-text and ANSI targets preserve list structure** (#966) instead of
  flattening items into prose.

### Removed

- **The dead `portable-quote-marker-space` collector** (markup-carve/carve#1142).
  `collectPortableWhitespace` was retained behind an explicit
  `void collectPortableWhitespace` statement and called from nowhere, so the id
  could not fire for any input or option - the blockquote marker rule became core
  syntax and is reported by `blockquote-marker-without-space`, which is
  documented and does fire. No behavior changes: the `portable` option was
  already a no-op and still accepts its value, so no caller breaks.

### Fixed

- **`carveToCarve` writes no `+` continuation marker where a block-attributes
  line already interrupts** (markup-carve/carve#1275). The writer emits the
  marker so that a paragraph attached to a list item cannot come back folded
  into the paragraph above it as a lazy continuation. A block carrying
  attributes is written with a `{…}` line of its own ahead of it, and
  `block_attributes` is one of PART 9 §10's INVISIBLE CONSTRUCTS - it
  interrupts an open paragraph - so the fold that rule prevents cannot happen
  and the marker added a construct the document did not have:

  ```
  - a
  +
  {.x}
  para
  ```

  is now written the way its source and carve-rs already wrote it:

  ```
  - a
    {.x}
    para
  ```

  Both spell the same document; the marker form stays readable. An attributed
  IMAGE keeps the marker, because its attributes are written inline
  (`![a](i.png){.c}`) and no attribute line interrupts.

- **An attribute block before a nested list attaches to that list**
  (markup-carve/carve#1238, markup-carve/carve-js#1100). A `{.x}` line written
  inside a list item, directly above an indented sub-list, was dropped without
  a warning and without leaving its text on the page; the class or id reached
  neither the sub-`<ul>`/`<ol>` nor anything else. It now lands on the nested
  list, with or without a blank line above it, at any nesting depth, and
  whether the attribute line stands alone in the item or follows the item's own
  prose. A nested list was the only block type in that position that lost its
  attributes - a paragraph, block quote or fenced code there always kept them -
  because the item's collected lines are split at the first sub-list marker and
  each half carried its own pending-attribute slot. The abutting marker form
  `-{.x} item`, which attributes the `<li>` itself, is a separate mechanism and
  is unchanged, as is the strict column-0 rule that keeps a brace one column
  past the content column ordinary paragraph text. List tightness does not
  move: PART 9 §17 L2 leaves the item tight when a sub-block is attached after
  a blank line, attributed or not.

- **HTML import keeps the tightness the source spelled** (markup-carve/carve#1210,
  spec corpus-convert 27/28). Every list imported loose, whatever the source
  spelled, so `<ul><li>one</li><li>two</li></ul>` came back with a blank line
  between its items and re-rendered as `<li><p>one</p></li>`. A bare-text
  `<li>` now imports as a tight list item and a paragraph-wrapped
  `<li><p>...</p></li>` as a loose one. Carve spells tightness per LIST rather
  than per item, so a mixed list resolves the way CommonMark resolves it: one
  paragraph item loosens the whole list, because resolving it tight would drop
  the paragraph that item actually spelled. Looseness is decided per level, so
  a paragraph item in a sublist does not loosen its bare-text parent. A nested
  sublist beside bare text is structure rather than a paragraph wrapper and
  leaves its host item tight, and the task-list checkbox `<input>` is consumed
  into the `[x]` marker rather than imported, so it does not vote either.

- **HTML import names the `<colgroup>` it drops.** The element went in
  complete silence: the table walk looks for `tr`, descends through the
  `<colgroup>` and finds none, so a table's column description left the
  document with nothing in the report to say it had. Carve has no column model
  - a table's columns are only the cells its rows carry - and whether it should
  get one is a language question (`markup-carve/carve#1092`), so the drop
  stands; what it gets is a `warning` naming the element under the
  `<colgroup>`'s own path. The wording is verbatim from `carve-rs`, so the
  engines report the drop in the same words. Only `<colgroup>` is scanned for:
  an HTML parser answers a `col` start tag inside a table by inserting an
  implied `<colgroup>` first, so `<table><col span="2"><col>` arrives as one
  wrapper holding both and a bare `<col>` reports through it.

- **A table's sections and rows keep the attributes they have a slot for.** A
  `<tbody id="totals">` and a `<tr class="warn">` fell into the empty `attrs`
  slot with no diagnostic at all, though the model has a place for both:
  `table_row.attrs`, which the writer spells on the closing pipe and every
  renderer emits on the `<tr>`, and the body group's `attrs` in
  `table.rowGroups`. A `<tbody>` carrying attributes is now a table whose
  grouping says something the rows cannot, so the field is emitted to hold
  them; the head and the foot are stated as row COUNTS and have no slot, so a
  `<thead>` or `<tfoot>` that carries any is reported by name, as is a
  `<tbody>` whose grouping was dropped for another reason. An unsupported
  attribute on one of these elements reports the way it does everywhere else,
  where nothing was said about them at all before. A section with no rows is
  read too - it is one of the table's sections, and reading them back off the
  rows had missed it - and reported, because a body group is the run of rows it
  consumes and one with none is not a group.

- **A cell spanning both ways keeps the grid it came with.** A `^` is resolved
  against the cell at the same INDEX above it, so a
  `<td colspan="2" rowspan="2">` written with one mark for its origin left the
  next rowspan in the row resolving against a column it does not own: the gap
  between the two marks was filled with a cell the source did not have,
  reported as an invention, and rendered as a `<td>` the table does not have.
  The import writes a mark into each column the cell covers, and the renderer
  absorbs a `^` standing under a merged `<` instead of finding no source and
  rendering an empty cell - so `| A | < |` over `| ^ | ^ |` renders the covered
  row empty whether it was imported or typed. `::: list-table` resolves the
  same shape the same way. A `<th colspan rowspan>` also reported one row-head
  column too few, because the column below the merged `<` read the cell two
  rows up rather than the `<` that already carries its origin's header flag.

- **A caret before a TAB is written bare.** The canonical writer escaped it as
  `\^`, but a tab after the marker leaves the line as prose (corpus 231), so the
  caret opens no caption there. A caret before a SPACE after a caption host
  still re-attaches on re-parse and stays escaped. Corpus 304 states the rule
  both follow: a character is escaped only where it opens markup.

- **BBCode keeps the backslash, the brace and the backtick a post typed.**
  `bbcodeToCarve` ran one of the four escaping stages a language without a
  backslash escape of its own needs, so three characters that are literal text
  in a forum post became markup. A backslash was read as a Carve escape and ate
  the character after it, turning `a \ b` into a non-breaking space with the
  backslash gone; `a {#id} c` opened an attribute block and came back as a tag
  span; and a backtick opened a code span, a lone one included. All three now
  survive as the text the post wrote. A `[code]` body is unaffected: it is
  stashed before any escaping runs.
- **A delimiter the calling converter handles keeps its brace bare.** The
  escaper escaped the delimiter inside an UNESCAPED brace, which is only right
  when the brace was escaped - a bare one is a brace the caller declared it
  owns. `{=x=}` is a highlight in Djot as well as in Carve, so a converter
  passing `=` as handled meant the run to survive, and it came back as literal
  braces and equals signs instead of a mark.
- **A braced opener with no closer on its line is escaped.** The escaper is
  line-oriented and a braced run is not, so an opener left bare let the NEXT
  line close it: `a {^x` over `y^}` turned two lines of literal source text into
  a superscript. Escaping it costs nothing when nothing closes the run, since
  both spellings render alike. An attribute block opener is excluded, since it
  is not a pair opener and escaping its brace would destroy a pinned id.
- **An unwrapped element reports the attributes it takes with it.** The importer
  keeps an `id`, a `class` and `data-` pairs while it reads an element, and when
  the element itself is unwrapped there is nothing left to hang them on - so
  they went in silence. `<video id="player">` said the element had been
  unwrapped and never that the id had gone with it. Applies to every unwrap arm:
  embeds, `<section>` and friends, and any unmapped inline element.

- **A `details` block carrying `{open}` renders it once in a static render.**
  The static renderer adds `open` so the body is expanded for print and did not
  check whether the block already carried it, so a hand-written `::: details
  {open}` came out as `<details open open="">`.

- **`<ol start>` is read by HTML's integer rules on import.** `Number()` stood
  there and accepted what the attribute does not: `start="2.9"` opened a list at
  2.9 and `start="1e3"` at 1000, both written back as their own marker, and
  `start="foo"` became `NaN`, which the writer spelled `NaN. x`. Such a value is
  now reported and the list starts where it would without the attribute.

- **The canonical writer no longer over-escapes a definition list it did not
  parse.** Its escape decision compares the two renders as trees and skips
  position fields BY NAME; `termSpans` was missing from that list, so an escape
  candidate anywhere before the last term shifted an offset the comparison saw
  and escalated the whole document to conservative escaping. Only a tree built
  without positions reached it - what the HTML importer and `--from-json` hand
  the writer - so an imported two-entry list came back as `x language\.` where
  the parsed same document came back as `x language.`.
- **`LIB_VERSION` reports the version that is running.** On 0.1.3 the exported
  constant read `0.1.0`, so the `carve fmt --stamp` provenance stamp and every
  embedder reading the export named a release other than the installed one. The
  constant is hand-maintained and its only guard was a comment asking for a
  release to keep it in step with `package.json`, which no CI step could check;
  a test now pins it to `package.json`, so a release bump cannot miss it.
- **The Markdown target writes no marker line ending in a space.** A blank line
  inside a block quote came out as `>` followed by a space where carve-php and
  carve-rs wrote a bare `>`, which is what a cross-engine comparison of all
  render targets surfaced (markup-carve/carve#1147). Seven further sites spelled
  the same defect and that comparison did not reach them: an emptied list item
  (`-`, `1.`, `- [ ]`), an emptied definition description (`:`), a heading with
  no text (`##`), a footnote definition with an empty body (`[^a]:`) and an
  abbreviation definition with an empty expansion (`*[X]:`). Trailing whitespace
  is what editors strip on save and what `git apply --whitespace=fix` and CI
  whitespace checks rewrite, so output carrying it is output ordinary tooling
  changes behind the renderer - the reason PART 11 section 9 already gives on
  this target for spelling a hard break as a backslash. Both spellings parse to
  the same document, so no rendered output moves: over the conformance corpus
  the change moves 21 documents' bytes and no document's HTML under commonmark
  0.31.2. Verbatim payload is untouched, deliberately - a fenced code body line
  of `abc` plus a space keeps its bytes, including inside a quote, because a
  code body is the block's payload rather than a content line.
- **`fmt` writes a code fence with no space before its info string.** The
  canonical writer emitted the Djot spelling, so `carve fmt` rewrote the
  authored ` ```js ` to ` ``` js ` and `carve migrate --from html` produced the
  same. `fenced_code_block` names the no-space form canonical while leaving the
  reader lenient, and the leniency is why nothing caught this: both spellings
  parse to the same tree, so the writer's own invariants held either way. The
  separators INSIDE the info string are a different slot and are unchanged - a
  header or label still takes exactly one space, since ` ```js"t" ` is not a
  fence opener at all. Reading ` ``` js ` keeps working. `raw_block`, whose
  slot is spelled the same way, was already writing the tight ` ```=html ` and
  is unaffected.
- **`fmt` no longer escapes into a run whose content is raw.** An image's alt
  text, a colon-fence or code-fence `[label]` and a footnote's `[^id]` are all
  read verbatim, so a backslash the writer emitted to neutralize a bracket
  arrived as two more characters of the value: `![t[z]](/i.png)` came back as
  `alt="t\[z\]"`, and `::: note [a\b]` and `[^n\m]` grew a backslash on every
  pass, because each one escaped what the last one wrote. All four constructs
  are now written as authored, which is correct wherever the run has a Carve
  spelling at all - an alt text closes at the MATCHING `]`, by the balanced,
  escape- and literal-span-aware scan a link's text closes by
  (markup-carve/carve#1197, ruled in markup-carve/carve#1206). The read path
  was already right; only the writer was not. An escape is still emitted where
  the reader resolves one - a link's text, a span's, an inline note's - and for
  an ingested alt that has no spelling, where it keeps the image well formed
  and settles on the next pass.
- **A footnote inside an unresolved reference no longer counts as a reference**
  (markup-carve/carve-js#1064, ruled in markup-carve/carve#1198 as PART 9R R2).
  An unresolved reference degrades to its literal source, so the link text built
  for it never reaches the reader; a `[^label]` use or an `^[content]` note
  sitting in that text was nevertheless numbered, because footnotes were
  resolved before the reference was known to have failed. A document whose only
  use of a definition sat there grew an endnotes section for a note nothing
  references, with a backlink to an id no element carries, and where a live use
  followed, the one noteref a reader can see was numbered `fnref1-2`, a repeat
  of a reference the document does not contain. Such a use now draws no number,
  its definition stays unreferenced and is dropped, and the surviving use is the
  first one. This covers the collapsed spelling, an unresolved reference nested
  in a resolved one, one inside a footnote body, and every container a reference
  can sit in. Text that does reach the reader is unchanged: a note in a
  reference that resolves, and a note in a bracketed run that never carried a
  tail, are ordinary references as before.

- **The Markdown importer no longer makes a table from a pipe row that has no
  delimiter row** (markup-carve/carve-js#1061). Carve reads any line that begins
  and ends with `|` as a table row and needs no delimiter row, so passing such a
  line through was itself a conversion, and a migrated document grew a table
  its author never saw. Measured against `marked` 18 with `gfm: true`, every
  partly-formed shape renders as a paragraph and now migrates as one: a pipe row
  with no delimiter row, a delimiter row with no header above it, a delimiter
  row alone, a header and delimiter whose column counts disagree, a stray row
  before or after a real table, a row following a paragraph line, and the same
  inside a block quote or a list item. The opening pipe is escaped, which keeps
  the row readable and keeps it in the paragraph it belongs to. A table GFM does
  read is untouched, including its alignment markers and the tables a container
  holds.

- **The `semantic-attribute-outside-span` diagnostic names the value the
  renderer writes** (markup-carve/carve-js#1058). Its closing sentence ended
  with a fixed `name=""`, which is what the boolean form renders and is false
  for every authored value: `` `c`{kbd="keyboard"} `` renders
  `<code kbd="keyboard">` while the message reported `kbd=""`. It now quotes
  the value the render actually contains - escaped as the renderer escapes it,
  blanked where the attribute sanitizer blanks it (a `javascript:` value really
  does render empty), and cut at 120 codepoints with an ellipsis so a pasted
  paragraph cannot push the explanation off the screen. The rule id, the
  trigger and the `cite`-on-a-block-quote carve-out are unchanged, as is every
  rendering. The sibling `semantic-attribute-value-ignored` never interpolated
  a value and is unchanged.

- **A referenced abbreviation definition splits by target on plain text and the
  terminal** (markup-carve/carve#1185, PART 11 section 10f). Both targets used
  to emit the `*[TERM]: expansion` definition line whether or not anything
  referenced it, and plain text emitted no expansion at all - so on the
  terminal the same words appeared twice, and in a plain-text document a line
  of Carve source sat there while the expansion the author defined appeared
  nowhere. A definition whose own expansion is emitted now loses its line on
  both targets, and plain text writes `TERM (expansion)` at every occurrence,
  the shape the terminal already used. A definition whose expansion reaches no
  output keeps its line exactly as before: one that is never referenced, one an
  authored `abbr` outranks, and the losing half of a term defined twice.
  Markdown keeps the line and the expansion beside it, because `*[TERM]:` is
  PHP Markdown Extra's own spelling and keeping it is what lets the export
  round-trip; the canonical writer keeps it too.
- **The Markdown importer converts a setext heading a block quote or a list
  item holds** (markup-carve/carve-js#1052). It converted one only at the top
  level, so `> Title` over `> =====` arrived in Carve as prose with the
  underline still in it. Where the underline was `-`, the migrated document
  also gained a thematic break the source never had, and nothing in the result
  told a reader that rule apart from one the author wrote. The conversion now
  runs on what a container holds, at that container's own depth, so it reaches
  a quote, a nested quote, a bullet or ordered item, and a quote inside an
  item. The bounds a reference reader draws are kept: an underline four columns
  past the container's content is still code, one to three columns of slack is
  still an underline, and `> ***` over `> ---` is still two rules rather than a
  heading. A setext heading whose text runs over several lines is approximated
  as the top level already approximates it - the line above the underline
  becomes the heading - because a Carve heading is a single line.
- **A table caption is separated from the table by a blank line on the Markdown
  target** (markup-carve/carve#1179, PART 11 §10e). It was written on the line
  directly after the last row, which a GFM reader takes as another row: the
  caption came back as a fabricated data cell that no reader and no parser can
  tell from one the author wrote. A blank line separates it, the position an
  image caption and a listing caption already take on this target. The same
  separation reaches a `figure` whose target is a table, where the caption had
  no separator at all and was welded onto the last row's closing pipe; on the
  plain-text target that path now writes the caption on its own line, matching
  what that target's own table renderer already does.
- **A fence title and a fence grouping label take a bold standalone line each
  on the terminal target** (markup-carve/carve#1179, PART 11 §10e). Both were
  folded into the `┌── ` rule line. That rule exists only when the fence has a
  language, so a titled fence without one had a rule line invented for it and a
  fence carrying both tokens had a separator invented too. They now render the
  way a fenced div's title and label already do on this target - title first,
  then the label, above the block - and the rule line carries only the
  language. A fence with neither token is unchanged.

- **The Markdown importer re-bases a tab-indented fenced code block to its list
  item's column** (markup-carve/carve-js#1048). The fence handler already
  re-based to the item's content column, but measured the fence's own indent in
  characters, so a tab counted as one column rather than four: it read as less
  indented than the item holding it, nothing was stripped, and the tab reached
  Carve, which does not read a tab-indented fence inside an item as a fence at
  all. Both the measurement and the strip work in columns now. A space-indented
  fence, at the document level or inside an item, is unchanged.
- **The Markdown importer recognizes indented code inside a block quote**
  (markup-carve/carve-js#1048). The four columns that open an indented code
  block are counted after the quote marker, where the quote's content starts;
  counted from column 0 they were never reached, because the line begins with
  `>`, so quoted code came through as quote prose and Carve then read the
  sample's `*` and `_` as emphasis. It now migrates to a fence carrying the
  quote's own marker, through nested quotes and a quote a list item holds, with
  a blank line carried through the sample and a trailing blank given back to the
  quote. An indented line that lazily continues quoted prose is still prose, as
  CommonMark reads it.
- **The Markdown importer writes a block held by a list item at that item's
  content column** (markup-carve/carve-js#1048). Every block branch other than
  the HTML one measured a line's indent and emitted its block from column 0, so
  a block a list item held was read as something else or written outside the
  item. A paragraph sitting AT a nested item's content column matched the
  four-column indented-code test and became a top-level code fence, taking a
  quote or a rule at that column with it; a quote or a heading at an item's
  content column looked like Markdown's 1-3 space slack and was dedented out of
  the item; genuine indented code inside an item was fenced at column 0 still
  carrying the item's columns as leading whitespace of the sample; and a rule, a
  converted setext heading and a converted GFM table header were all written at
  column 0, the table's body rows staying behind so that one table became a
  table plus a paragraph. All of them now measure from, and emit at, the
  innermost open item's content column. Two measurement bugs go with it: a tab
  counts as four columns rather than one character, so a tab-indented
  continuation no longer closes the item holding it, and a spaced thematic break
  that could also read as a bullet (`* * *`) is a rule, so it no longer opens a
  content column that padded out every following block. The document level is
  unchanged: top-level indented code, a top-level quote or heading in its 1-3
  space slack, and lazy continuation all migrate exactly as before.
- **The Markdown importer reads a block-level HTML element inside a container as
  a block** (markup-carve/carve-js#1045). `markdownToCarve` decided
  block-vs-inline by testing the raw source line against CommonMark's HTML block
  conditions, and inside a container the raw line is not what the container
  holds. In a block quote nothing ever matched - the line starts with `>` - so a
  `<footer>` came back as an inline raw span wrapped in a paragraph the source
  did not have, which is invalid HTML, since `<p>` takes phrasing content. Under
  a list item the block was recognized and then written at column 0, landing
  outside the item. Both now strip what the container contributes and re-emit the
  raw fence with the container's own prefix, through nested quotes, ordered and
  nested items, and a list item a quote holds. An inline `<span>` in the same
  position still migrates inline. Two related readings at the top level are fixed
  with it: an opener on the line after prose now interrupts that paragraph
  instead of being carried into it as a span, and an HTML block ends where
  CommonMark ends it - at the next blank line - rather than at the element's
  closing tag or, for a complete tag alone on a line, at that line. Cut early, a
  `<div>x</div>` followed by prose fenced the element alone and migrated the
  prose as a paragraph outside the block the source had put it in.
- **Presentation targets no longer discard authored text**
  (markup-carve/carve#1179). `docs/graceful-degradation.md` states the floor as
  a MUST - "losing the click is fine; losing the words is not" - and three kinds
  of authored text were dropped outright:

  - a table caption vanished on the Markdown target. It now sits on its own line
    under the table, which is how an image and a listing caption already degrade
    there, so the table stops being the odd one out.
  - a fence header (`"src/app.js"`) and a grouping label (`[Node]`) vanished on
    the plain-text and terminal targets. Plain emits them as standalone lines
    ahead of the code, matching the caption floor the `div` renderer already
    applied; the terminal joins them to the rule line it was already drawing, so
    a captioned fence still reads as one block.

  Nothing else moves: an uncaptioned table, a fence with no header and every
  other target are byte-identical to before.
- **An authored `abbr` wins on the Markdown and ANSI targets too**
  (markup-carve/carve#1176). markup-carve/carve#1127 ruled that an explicit
  `abbr` outranks automatic expansion, and the HTML target honoured it while
  Markdown and ANSI emitted the DEFINITION's text - so
  `[HTML]{abbr="Custom"}` under a `*[HTML]: Hyper Text Markup Language` line
  came out with the wrong title on two of five targets. Both now carry the
  authored value, using the same suppression the HTML renderer already had.
  The plain-text target carries it too: an authored expansion has no
  `*[TERM]: …` definition line to state it once, so dropping it lost the text
  outright, and plain already uses `(…)` for an inline footnote.
- **An abbreviation expands inside the `:name[…]` extension form**
  (markup-carve/carve#1151). PART 9R R3 matches a term in rendered text at word
  boundaries and says nothing about the container it sits in, but an
  `inline_extension` keeps its inlines under `content` while the abbreviation
  walk recursed generically into `children` - so `:kbd[HTML]` silently dropped
  an expansion that `*HTML*`, `[HTML](/u)` and `[HTML]{.x}` all got.
- **`htmlToCarve` keeps an authored table-cell `scope` position cannot explain**
  (markup-carve/carve-js#1032). `<th scope="colgroup">` imports as
  `|={scope=colgroup} A |`, and a `<th scope="rowgroup">` in a body row keeps
  its value the same way, in the attributes slot a header cell has under the
  binding order described in Changed above; the cell re-reads as the header
  cell it was. `scope="col"` in the leading header run and `scope="row"` below
  it are still dropped, because the renderer derives those from position and
  importing them would write the generator's own output back as if the author
  had typed it.
- **`lintCarve` reports the semantic-attribute rules against the render the
  caller configured** (markup-carve/carve#1167). PART 9 §9 splits the reserved
  names by tier, so `samp`, `var`, `cite` and `dfn` become elements only once
  the SemanticSpan extension is enabled; in a core render they stay ordinary
  attributes and their value reaches the output intact. The rules reported a
  discarded value for all seven regardless, so a core render produced three
  false reports - a loss that is not happening, which is the same defect these
  rules exist to catch, pointed the other way. `lintCarve` now takes the
  `extensions` the caller renders with (pass what you pass to `carveToHtml`)
  and answers for that render. With no extensions it reports only `kbd`; with
  `semanticSpan()` enabled it reports `samp`, `var`, `cite` and `kbd`, and
  stays quiet for the three that map their value to `title` or `datetime`.
- **The Markdown migration table documented the pre-dialect behavior.** After
  the CommonMark-plus-GFM default landed, `==x==`, `^x^` and `$x$` stay literal
  unless `dialect.highlight` / `superscript` / `math` opts in, but
  `docs/migration.md` still showed them converting unconditionally. Corrected,
  with the opt-in spelling and the note that the `<mark>` / `<sub>` / `<sup>`
  tags are unaffected because they mean the same thing in every dialect.
- **The Markdown importer keeps the constructs Carve spells the way the source
  does.** The CommonMark-plus-GFM default covered the constructs the converter
  REWRITES (`^x^`, `==x==`, `$x$`). It could not cover the ones that need no
  rewrite because Carve happens to use the same spelling, so leaving the source
  alone was itself the conversion: `a ^[note] b`, `*[HTML]: HyperText`,
  `::: note`, an attribute list on any inline construct (`[t]{.c}`, `[t](u){.c}`,
  `` `x`{.c} ``, `<https://e.com/>{.c}`, `*x*{.c}`) and a `{.cls}` line all
  reached the migrated document as live markup, while `commonmark` and `marked`
  read every one of them as ordinary text. A braced delimiter pair is exempt:
  `{,x,}` is a subscript in Carve wherever it stands, and it is what
  `<sub>x</sub>` converts to. Each is now escaped, and each has a flag that restores
  the conversion - `inlineFootnotes`, `abbreviations`, `fencedDivs` and
  `attributes`, alongside the three that were already there. Five more Carve
  constructs have no Markdown spelling in any flavour and are escaped
  unconditionally: `` a $`x` ``, `` a $$`x` ``, `` a !`x` `` (which dropped the
  `!` and the code formatting outright), `a :term[x]`, and a leading `^ ` on a
  paragraph, which bound itself to the block above as that block's caption.
  Footnote references (`[^1]` with `[^1]: …`) are deliberately left converting:
  GitHub renders them, so the migrated document matches what the author saw.
- **`lintCarve` explains a near-miss footnote label.** An unresolved reference
  whose definition differs only in whitespace now names it -
  `Footnote reference [^a  b] has no matching definition; it renders as literal
  text. Definition [^a b] differs only in whitespace; footnote labels are
  matched exactly.` The rule id is unchanged, so a consumer keying on
  `unresolved-footnote` is unaffected.
- **The footnote-definition lint rules see definitions inside containers.**
  They scanned raw source lines, so a definition in a block quote or list item
  was invisible to them while the parser had already collected it and the
  document rendered it: `> [^a]: one` twice reported no duplicate. The scanner
  strips the same container prefixes the parser strips - block quotes, bullet
  and decimal list items, description markers - and reports only labels the
  parser collected, which fixes `duplicate-footnote-definition`, gives
  `unused-footnote-definition` the definition's own line instead of line 1, and
  covers the new whitespace-twin rule. Alphabetic and Roman list markers are
  still not stripped, matching the parser's own helper.
- **Footnote labels are matched exactly, without trimming their ends.** The
  parser trimmed the label on both the definition and the reference side, so
  `[^ a ]` resolved against `[^a]: …` and rendered a note. PART 9 §16 says a
  label may contain spaces and tabs and is matched exactly, and carve-php and
  carve-rs leave that pair literal. Interior whitespace was already
  significant; now the ends are too. The two footnote lint rules key on the
  same raw label, so a padded definition is reported as unused rather than
  silently counted as the bare one.
- **A footnote reference no longer crosses a source newline.** The parser used
  to publish an unresolved `footnote_ref` whose id contained that newline,
  although the one-line definition marker could never bind it. The bracketed
  source now remains ordinary text around a soft break, matching the grammar;
  rendered HTML and canonical source are unchanged.
- **`applyMigrationFixes` converts Djot's braced subscript instead of doubling
  its braces.** `{~y~}` came out as `{{,y,}}`, rendering the stray literal
  braces `{<sub>y</sub>}` where Djot means `<sub>y</sub>`. The
  `djot-subscript-tilde` span covered `~y~` but not the surrounding braces,
  while its suggestion supplied braces of its own, so the splice left the
  source's behind. The braced form now has its own rule and converts as a
  single edit; the bare rule is guarded off it. Unlike the superscript pair, it
  cannot simply be skipped: `{~x~}` is subscript in Djot and strikethrough in
  Carve, so it still has to be rewritten.
- **A nested list is indented once on the Markdown target, not twice.**
  `renderList` padded every emitted line by the list's own depth, and the
  enclosing item padded the same lines again by the width of its marker, so each
  level was indented twice: two levels came out at four spaces and three at ten.
  Ten spaces under a marker whose content column is six is an indented verbatim
  block, so a third level stopped being a list for every reader that is not
  Carve itself. Nesting now comes from the parent's continuation pad alone -
  `- a` / `  - b` / `    - c` - and a line with no content no longer takes that
  pad, which removes the whitespace-only lines PART 11 §7 forbids.

- **A raw block is opaque to the link-definition prepass** (#973), and a
  definition past the content column is visible to the looseness scan (#979).

- **A fence running to the end of a container keeps its trailing blank lines**
  (#989), and an invisible child no longer changes a list item's or a block
  quote's framing (#991, #992).

- **Adjacent sibling lists stay separate through fmt** (#981).

- **The Markdown importer keeps a hard break and an indented code block**
  (#1015), and stays on CommonMark plus GFM (#1020).

- **A value-less attribute is written as a boolean** (#1025), and an attribute
  needs a separator before it (#1029).

- **`djot-migrate` reports an intraword underscore instead of losing it
  silently** (#997).

## [0.1.3] - 2026-08-10

### Breaking

- **An escaped space in the last column of a line is a hard break**
  (markup-carve/carve#1027). The trailing-whitespace strip runs BEFORE escape
  resolution, so the space in `\ ` is gone by the time the escape is read and the
  bare backslash left behind is a line break, not a no-break space:

  ```
  x \ 
  y
  ```

  ```html
  <p>x <br>
  y</p>
  ```

  It used to render `<p>x &nbsp;\ny</p>`. Mid-line nothing changes - `10\ kg` is
  still a no-break space - and an even run of backslashes is still a literal
  backslash whose following space is ordinary trailing whitespace.

  MARKER REQUIRES CONTENT in `resources/grammar.ebnf` decides it: "an editor
  stripping the trailing space cannot change the meaning", stated for the bullet
  marker and stated as general. With the old reading, `x \ ` was a no-break space
  and `x \` - the same document once an editor saved it - was a line break.
  carve-rs and carve-php were stable across that strip and this engine now
  matches them node for node.

  The cost is deliberate: the escape means a no-break space mid-line and a hard
  break at the end of a line. An author who wants a no-break space in the last
  column writes the character itself. The Carve writer does the same for an
  ingested text node that ends in one, which no parse can build any more.

- **A block-attribute line below a list item ends the item, and its attributes
  reach the next block** (markup-carve/carve#1028). Documents shaped like

  ```
  - item
  {.cls}
  > quote
  ```

  rendered the quote with NO class and printed nothing for the attribute line:
  it folded into the item, where it had no following block to float onto, and
  §15 drops a dangling run. The author's attribute reached the page nowhere.
  It now ends the item and attributes the quote.

  PART 9 §10 I5 makes the three invisible constructs interrupt an open paragraph
  - "a reference definition ..., a comment ..., and a block-attribute line
  (`{…}` alone on a line, §15)" - and I6 applies the relation to every open
  paragraph, an item's included. The two definition kinds already ended the fold
  here; the attribute line did not. PART 2's LIST-ITEM ATTRIBUTES clause names
  this engine's behavior and rejects it: "a trailing `{…}` line folded onto a
  tight item, which carve-php attached to the `<li>` and carve-js dropped - is
  REJECTED as the mechanism".

  An INDENTED attribute line is unaffected: at the item's content column it is
  the item's, and floats onto the item's own next block.

- **The AST now publishes `thematic_break.marker` and the Carve writer
  reproduces it** (markup-carve/carve#976). Parsed `***` and `___` carry `*`
  and `_` respectively; the default `---` leaves the optional field absent.
  AST ingest accepts the field and defaults an absent one to `---`.

- **`beforeRender` takes a read-only context, and the injected TOC honors the
  caller's options** (markup-carve/carve#1007, carve-js#871). The hook is called
  as `beforeRender(doc, ctx)`, where `ctx` is the exported `BeforeRenderContext`:
  `options` (a frozen snapshot of the options the conversion was called with),
  `mode`, `isStatic` and `targetIsHtml`.

  The hook runs before the render starts, so it had nothing to inherit and
  rendered any output of its own with DEFAULTS. `tableOfContents()` builds its
  `<nav>` there, so `# :ok: h` with `{ symbols: { ok: 'OK' } }` published
  `<h1>OK h</h1>` and a TOC entry reading `:ok: h`, from the same nodes.
  `smartTypography` and `sanitizeUrls` diverged the same way, the last of them in
  the loosening direction: a caller who turned sanitization off got a blanked
  `src` in the entry and the live one in the heading. The `::: toc` placement
  directive renders during the render and always honored the options; the two
  paths now agree.

  `targetIsHtml` is why the contract carries a context rather than the options
  alone: an extension that emits HTML in this hook reads it to skip its transform
  on the Markdown, plain-text, ANSI and AST-JSON paths and leave the source node
  for that target. `mode` is the EFFECTIVE mode, which is `"interactive"` on
  every non-HTML target whatever the caller passed, because static rendering is
  an HTML-only concern.

  The context is read-only: `options` is frozen and is a different object from
  the one the renderer is handed, so a hook reads the caller's settings and
  cannot write them, and cannot talk a later guard out of its own input. Only the
  flat options are protected - `symbols`, `renderers` and `extensions` are the
  caller's own objects, shared by reference.

  BREAKING against this unreleased line rather than against 0.1.2, and stated
  here because release notes are generated from this file. A hook written for
  0.1.2 takes `(doc)`, and a function of fewer parameters is assignable, so it
  compiles and runs unchanged. What breaks is a hook written against the
  `beforeRender(doc, opts)` shape that landed earlier in this same line
  (carve-js#871): the second parameter is no longer the options, and such a hook
  reads `ctx.options` instead.

- **A heading ends at the newline** (markup-carve/carve#451,
  markup-carve/carve#434). Nothing folds into a heading, so `# Title` with prose
  beneath is a heading plus a paragraph, and its id derives from the heading line
  alone (`Title`, not `Title-Some-text`). Anything with a blank line after the
  heading is unaffected.

- **An explicit `[text][label]` no longer reaches the heading index**
  (markup-carve/carve#742). An explicit label that matches no `[label]: url`
  definition is unresolved and renders as its literal source. The collapsed
  `[text][]` form is unaffected. `carve lint` reports the shape as
  `unresolved-reference-link`.

- **A bare `.` is an ordered-list marker** (proposal for markup-carve/carve#315,
  DRAFT - the spec PR markup-carve/carve#347 is not accepted yet). `. first` /
  `. second` is a decimal list counting from 1. After a blank line, a paragraph
  beginning `. ` now opens an `<ol>`. `) text` is unchanged. `fmt` writes back
  the spelling the author used, recorded as `bareMarker` on the list node; the
  flag stays off the serialized AST until the schema carries it.

- **A quoted attribute value stops at the newline, inline and on a
  block-attribute line** (markup-carve/carve#888). A break inside the quotes ends
  the production, so the whole attribute block is unrecognized. A block attribute
  may still span lines between two attributes. Eleven surfaces narrow, including
  the inline extension `:name[x]{…}`, which had no attribute validity check at
  all.

- **An inline attribute block's interior is space-only** (markup-carve/carve#906).
  A tab after `{`, between two attributes, before `}`, after an unquoted value,
  or in the blessed empty block `{ }` leaves the block unrecognized and its
  braces showing. Fourteen surfaces narrow together. The block-attribute LINE
  does not narrow, and a tab inside a quoted value is content.

- **A reference definition is anchored at end of line**
  (markup-carve/carve#911, markup-carve/carve#933). `[a]: /u zzz` is an ordinary
  paragraph, not a definition with trailing junk. A trailing `{...}` block the
  `attributes` production rejects makes the line prose too, so `[a]: /u {#}`,
  `{ }`, `{=}` and `{}` no longer define and the author's braces stay on the
  page. An unquoted `key=value` no longer swallows the closing brace. A trailing
  run of spaces or tabs is still the line ending.

- **A renderer refuses at the render ceiling instead of truncating** (§25,
  markup-carve/carve#548). `renderHtml`, `renderMarkdown`, `renderCarve`,
  `renderPlainText` and `renderAnsi` throw `RenderDepthError` (exported alongside
  `MAX_RENDER_DEPTH`). The five renderers become fallible - a signature change.
  No tree from `parse` can reach the ceiling, so only hand-built or ingested
  trees are affected. Four of the five used to delete the body and emit the
  markers, so the output looked complete; `renderHtml` had no ceiling and
  overflowed the host stack.

- **`fromAstJson` refuses a footnote definition spelled `id`** (carve-js#907,
  markup-carve/carve#743). `label` is the PART 12 §7 field; `id` is what this
  engine and carve-php published before §7 settled it, and the decoder used to
  accept both. carve-php refuses it, so the same payload decoded in two engines
  and failed in the third - the interchange break §3's "field names are spec
  surface" exists against. It is now refused like any other field the schema does
  not name, and the pre-render normalizer stops reading it too, so the engine
  gives one answer about the field. A stored tree carrying `id` must be rewritten
  to `label`. Found in the same sweep and fixed with it: an untyped legacy
  definition-list entry (`items: [{terms, definitions}]`) accepted ARBITRARY
  unnamed properties, which then survived into the decoded tree; its fields are
  now closed to the four the legacy record carries. The legacy entry itself still
  decodes.

- **`fromAstJson` refuses a malformed or foreign payload at decode**
  (markup-carve/carve#709, markup-carve/carve#881, PART 12 §9-§12). Three new
  exported errors: `AstJsonSchemaError` (the whole payload is validated against
  the AST schema - types and required fields together), `AstJsonNodeTypeError` (a
  missing or non-string `type`), `AstJsonRootError` (a foreign root such as
  ProseMirror's `doc`). A wire property the schema does not name is refused
  rather than echoed: injecting one on each of 31 nodes, 29 used to survive the
  round trip and every one made the re-published tree invalid. `children: null`
  used to read as an empty document. Payloads relying on any of that now fail
  loudly.

- **AST vocabulary: four node types change spelling or shape.** Rendered output
  does not move on any target.

  - `footnote` splits into `footnote_ref` (carrying `id`) and `inline_footnote`
    (carrying `inline`). A `Footnote` union alias is exported. A stored tree
    naming the old type is still accepted on input and mapped by its own shape.
  - `critic-comment` becomes `critic_comment`. The rendered
    `<span class="critic-comment">` class is deliberately unchanged.
  - An escaped character is its own `escaped_text` node instead of being
    flattened into surrounding text. Consumers reading `text.value` see the run
    split at each escape.
  - `::: |` is a `line_block` node instead of a `div` carrying `.line-block`.
    Consumers matching on the class must match on the type.

- **The `Link` type no longer declares `fromCrossref`.** No node ever carried the
  property, so no output, payload or value-reading consumer is affected - but a
  TypeScript consumer naming `link.fromCrossref` now gets a type error. Read the
  `heading_ref` node's `resolvedText` instead.

- **The published AST keeps what the author wrote.** Three changes a tree
  consumer sees; no rendered output moves.

  - An unresolved reference is published as a `link` (an `image` for
    `![alt][nope]`) carrying `ref` and `rawRef`, not as text. Every target still
    writes the authored source back out.
  - A nested link or autolink inside a link's label stays the node the author
    wrote; "links never nest" binds the renderer, which unwraps at the render
    seam. `[[x](y)](z)` no longer loses `y` from the tree.
  - A collapsed reference resolving against a heading publishes the DERIVED label
    in `ref` (PART 12 §3a's resolution key), with the authored spelling still in
    `rawRef`.
  - An escaped pipe in a table cell is an `escaped_text` node like every other
    escape.

### Added

- **`toAstJson(doc)`** serializes a parsed document to the PART 12 exchange
  shape: a root of exactly `type`, `children` and `srcByteLength`, with
  frontmatter and footnote definitions as block nodes. The runtime `Document` is
  unchanged. Consumers needing conformant JSON must call this rather than
  stringifying `parse()`.

- **`carve portability`** reports whether a document means the same thing in
  Djot. It renders with both engines and reports the first divergence, with
  `--json` and exit 1 on divergence. Carve's deliberate departures (`/italic/`,
  `=mark=`, quoted link titles) are reported; renderer-level differences
  (attribute order, boolean spelling, block-boundary whitespace) are normalized
  away. Needs djot.js, declared as an optional peer dependency and installed
  separately. The `carve` package still installs nothing at runtime.

- **`sections: false`** renders headings without the `<section>` wrapper. The id
  returns to the `<h*>` alongside its other attributes and the blocks that would
  have been section children stay siblings. Default unchanged. The endnotes
  `<section role="doc-endnotes">` is unaffected.

- **`carve lint` gains three opt-in rule sets.**

  - `--platform github` (repeatable; `lintCarve(src, { platforms: ['github'] })`)
    reports at-word and hash-number tokens a host re-linkifies out of published
    output, under `platform-mention-token` and `platform-issue-reference`. They
    read prose and inline code spans, never fenced code, raw blocks or comments.
    An unknown platform name is an error.
  - `--from-djot` gains `djot-heading-continuation` and
    `djot-heading-continuation-marker` for a Djot document that wraps a heading.
  - `--portable` is the outbound twin: `portable-quote-marker-space` flags a `>`
    with no space after it, which Djot leaves as literal text. Advisory only.

### Changed

- **`carve fmt` writes a frontmatter opener with its format token** (PART 11 §6b,
  markup-carve/carve#977): `---yaml`, not a bare `---`. Every other format was
  already spelled out. The reader is unchanged - `---`, `--- yaml` and `---yaml`
  all still open frontmatter.

- **Markdown output reproduces the author's escapes** (PART 11 §7 M2).
  `A \" B \-\- C` renders as `A \" B \-\- C` rather than `A " B -- C`. A document
  that escapes nothing gains no backslashes.

- **The Markdown target's escaping narrows on the line** (PART 11 §8a,
  markup-carve/carve#970). `_`, `#` and `[` are escaped if and only if the
  character is ADJACENT on the emitted line to an unescaped delimiter of the
  same character. So `company_id`, `C#` and `issue #123` are written as the
  author typed them, where before they were `company\_id`, `C\#` and
  `issue \#123` - a backslash inside an identifier breaks exact-match search in
  the published document and protects nothing that a CommonMark reader would
  read differently. `a__b` and `[[x]]` keep both escapes, because unescaping
  would merge the two into one delimiter run. The ASTERISK is exempt and keeps
  its unconditional escape: this writer spells emphasis with `*`, so a literal
  asterisk can merge with a delimiter the writer itself just wrote. Nothing
  else narrows, and an author-escaped character is still emitted as an escape
  (M2) - including `\_`, which used to lose its backslash to the old intraword
  rule. Markdown output only; every other target is unchanged.

- **An abbreviation definition written inside a container is a child of the
  document** (PART 12 §7). A footnote definition already worked that way. All
  three engines render identical HTML; only the tree moves, and `pos` still
  records where the author wrote it. The hoist is part of `parse()`, not of
  serialization.

- **A fence opened with a non-Tier-1 word classifies as `div` for profiles, not
  `admonition`** (grammar PART 9 §12). Only the eight Tier-1 kinds (`note`,
  `tip`, `warning`, `danger`, `info`, `success`, `example`, `quote`) are
  callouts.

  **Migration:** `denyBlock(['admonition'])` used to strip *every* named fence
  and now strips only Tier-1 callouts. To keep the old behavior, deny both
  `admonition` and `div`. The serialized AST is unchanged.

- **A profile that names a type now acts on it.** `denyBlock(['frontmatter'])`,
  `denyBlock(['footnote'])`, `denyInline(['escaped_text'])`, `denyBlock`/
  `denyInline` for `autolink` and `admonition` were all silent no-ops - a host
  restricting untrusted input got no error, no violation and the construct
  anyway. Frontmatter and footnote definitions are REMOVED rather than degraded,
  since neither has a text form. Denying the broader name (`link`, `div`) still
  covers the narrower one.

- **A bottom-positioned table of contents is emitted at document level, after the
  last section.** `tableOfContents({ position: 'bottom' })` used to be absorbed
  by whichever `<section>` the document happened to end with - one option, four
  placements. The nav is now the last thing in the output, byte-identical to
  carve-php. The in-document `::: toc` directive is unchanged.

- **`markdownToCarve` stops corrupting its input.** Leading YAML frontmatter
  passes through byte-for-byte instead of migrating as a thematic break plus a
  setext underline. Carve-only inline syntax (`/…/`, `=…=`, single `~…~`,
  `%%…%%`, braced `{X…X}`) is escaped rather than passed through for Carve to
  parse as markup - `a %%c%% b` used to lose its text entirely. Markdown that
  contained Carve inline syntax and passed through verbatim is now escaped.

### Fixed

- **A short ANSI table row is padded out to the box** (markup-carve/carve#1044).
  The ANSI box draws its rules at the TABLE width, so a ragged table left the
  short row stopping mid-box with no right border:

  ```
  | h |
  |---|
  | |x |
  ```

  used to render

  ```
  ┌───┬───┐
  │ h │
  ├───┼───┤
  │   │ x │
  └───┴───┘
  ```

  and now renders

  ```
  ┌───┬───┐
  │ h │   │
  ├───┼───┤
  │   │ x │
  └───┴───┘
  ```

  The trailing cells a row does not have are a DISPLAY pad: nothing re-parses
  ANSI output, and a box has to be a rectangle to read as one. It is also what
  the HTML target already shows, since the table is two columns wide there. PART
  11 §10b forbids this same padding on the Markdown delimiter row because a
  reader parses that row; that reason is absent here, which is why the two
  targets settle it differently. AST row cell counts are unchanged, and the
  Markdown, plain and Carve targets still write each row's own cells.

- **The Markdown delimiter row is sized from the header row, not the table**
  (markup-carve/carve#1042). PART 11 §10b says the delimiter "carries exactly one
  cell for each cell in the HEADER ROW, not one for each column reached by a
  wider body row", and the Markdown target sized it from the table width instead.
  A ragged table therefore emitted a delimiter wider than the row it promotes:

  ```
  | h |
  |---|
  | |x |
  ```

  used to write

  ```
  | h |
  | --- | --- |
  |  | x |
  ```

  which neither python-markdown nor marked reads as a table - the whole document
  published as a paragraph of pipes. It now writes

  ```
  | h |
  | --- |
  |  | x |
  ```

  and both readers render a table again. A header that is itself the widest row
  is unchanged, and the header's column alignment still reaches the delimiter.

- Keep adjacent mergeable block openers separate when formatting a tight
  `+`-attached run, instead of collapsing two quotes or tables into one block.

- Preserve each row's cell count when formatting a ragged table instead of
  manufacturing empty cells to make the table rectangular.

- Keep the thematic-break writer override out of band, so the legal `---`
  spelling can be forced without being mistaken for "no override".

- **A profile's link policy reads the scheme through the characters a URL
  consumer discards** (carve-js#917). `LinkPolicy.isUrlAllowed` read the text
  before the first colon with no character filter, and `trim()` only reaches the
  ends, so any control or whitespace character INSIDE the scheme defeated the
  denied-scheme lookup: `java<U+0001>script:alert(1)`, `java<DEL>script:` and
  `java<U+009B>script:` were all answered `allowed`, while the plain
  `javascript:alert(1)` was answered `denied`. The scheme is now read through the
  same probe class the renderer settled on in carve-js#915, every control
  character plus every whitespace character.

  Two further answers were wrong for the same reason and are now right: a split
  scheme was neither `http` nor `https`, so it also skipped the **denied-domain**
  check and the **allowExternal** check, and `htt<DEL>ps://evil.com` was answered
  `allowed` under a policy denying `evil.com`. The link and image paths share the
  one rule, so both narrow together.

  This is a **narrowing only**. Stripping removes characters, so it can only make
  the deny lists recognize MORE destinations; **no destination a policy refuses
  today becomes allowed**. No legitimate scheme contains a stripped character -
  a URL scheme is a letter followed by letters, digits, `+`, `-` and `.` - so
  nothing legitimate starts being refused. The ALLOWLIST form deliberately still
  reads the raw text: it asks whether a scheme is exactly one it permits, a split
  scheme is not, and it was never defeated. It is unaffected here in both
  directions.

  A document rendered with default options was never at risk: PART 9 §25 blanks
  these destinations in the renderer no matter what a profile answered. What was
  affected is a caller using a profile to VALIDATE or FILTER, where the
  permissive answer is the whole output.

- **A denied URL scheme split by DEL or a C1 control is blanked** (carve-js#915,
  PART 9 §25). `[x](java<DEL>script:alert(1))` reached the rendered `href` with
  the raw U+007F byte intact, and the image spelling reached `src` the same way,
  while the plain `javascript:alert(1)` was blanked correctly. The denylist was
  never wrong; the class of characters stripped before the scheme was read was.
  It stopped at U+001F, so DEL (U+007F) and the C1 block (U+0080..U+009F) - the
  characters §29 T5 puts OUTSIDE what a target may emit - were invisible to the
  probe. That class now spans every control character and every whitespace
  character, on the HTML target and in the SVG sanitizer's second copy of the
  same rule, where `<a href>`, `<image href>` and the reject-every-absolute-
  scheme check on paint attributes had the same gap.

  This is a **defense-in-depth fix, not a demonstrated execution**: whether such
  a URL resolves depends on whether the consumer's URL parser discards the
  character before it reads the scheme, and consumers differ. The probe class is
  deliberately WIDER than the §29 emit class, because the two answer different
  questions - what a target may write, versus what the probe must see through.
  Stripping only removes characters, so the wider class can refuse more and can
  never permit more; a destination that is allowed is still emitted with its
  original bytes.

- **The Markdown and plain targets emit the non-whitespace C0 controls**
  (carve-js#896, PART 9 §29 `C0 CONTROLS ON THE RENDER TARGETS`). After
  markup-carve/carve#963 the whitespace of the language is exactly U+0020,
  U+0009, U+000A and U+000D, and every other C0 control - U+0000..U+0008,
  U+000B, U+000C, U+000E..U+001F - is ordinary content. These two writers
  deleted the whole `\p{Cc}` block, so a document holding a vertical tab, a form
  feed or an ESC kept it in HTML and lost it on the way to Markdown or plain
  text. Four Markdown readers were measured and all four keep these characters,
  so the strip made Carve the lossy party rather than protecting the boundary.
  A Markdown link or image destination carries them too.

  **The terminal target is unchanged and keeps its broad strip** (§29 T4): it is
  the one consumer that acts on the character. U+000D stays stripped everywhere,
  because carve#963 made it whitespace, and DEL (U+007F) and the C1 controls
  stay refused on all three non-HTML targets (§29 T5) - the denied-scheme probe
  on a Markdown destination still runs on the broadly stripped form, so
  `java<DEL>script:` is blanked as before.

- **An expansion budget is sized from what the payload cost, not from what it
  claims** (carve-js#900). The abbreviation, table-of-contents, index and
  cross-reference-label budgets are `max(1 MB, 8 * srcByteLength)`. On the parse
  path that number is a measurement; on the AST-ingest path it arrives inside the
  payload, so rewriting one field widened the guard meant to bound the document
  that rewrote it. An ingested document is now bounded by the measured size of
  its payload as well as by its claim, and the smaller wins. `srcByteLength` is
  still read as written and re-encoded unchanged, because PART 12 §7 requires the
  field to survive a round trip - what moved is what the budget trusts.
  `fromAstJson` takes an optional second argument, the measured payload length in
  bytes; when it is omitted the payload is measured by re-encoding, so a caller
  that does not pass it is not left with the old behavior. **A legitimate
  divergence, stated rather than papered over:** a source much larger than its
  AST - mostly blank lines, past roughly 125 KB where the 1 MB floor stops
  covering - renders with a smaller budget after a round trip than it did on the
  parse path. That is not fixable; the bytes that would tell an honest large
  source from a claim about one are exactly the bytes the AST does not carry.
  carve-php and carve-rs accepted the same divergence.
- **`fmt` writes an empty footnote body as a line that still defines**
  (carve-js#904). A footnote whose body holds only a block-attribute line
  (`[^f]: {x}`) has that line consumed as attributes, leaving the body empty -
  and the writer emitted `[^f]:`, which is not a definition. Both the definition
  and its reference came back as literal text and the endnote section
  disappeared. The grammar takes a definition's content as one-or-more, so an
  empty body cannot be spelled directly; **behavior change:** it is now written
  as `[^f]: {empty}`, an attribute line the reader consumes back to nothing. That
  is the only body measured to render identically on HTML, Markdown, plain text
  and ANSI alike. The link-reference and abbreviation definition writers were
  measured for the same shape and neither has it.
- **`fmt` keeps the continuation marker on every block it attaches**
  (carve-js#902). The writer converts a `+` attachment into indentation when the
  attached block cannot fold into the paragraph above it, and two cases could.
  A standalone image and a figure are written as a bare inline run on their own
  line, so at the item's content column they read as lazy continuation: `- x` /
  `+` / `![a](i.png)` / `^ cap` came back as one paragraph holding an inline
  image and the literal text `^ cap`, with the `<figure>` and `<figcaption>`
  gone. Separately, only the LAST line of a multi-block attachment was indented,
  so a thematic break under a flush paragraph was absorbed into it and rendered
  as an em dash instead of `<hr>`. **Behavior change:** an image or figure
  attached after a paragraph keeps its `+`, and once one block of an attachment
  is written at the marker column every later one is too. A `+`-attached fence,
  quote, heading, table or thematic break after a paragraph is still converted
  to indentation.
- **`fmt` does not write a header cell whose content reads back as alignment**
  (carve-js#903). A prefixed table cell is written tight, so the first character
  of the content sits exactly where the parser reads a glued `<`, `>` or `~` as
  an alignment marker. `| ~x~ |` came back as `|=~x~|`, which re-read as center
  alignment with the text `x~`: the strikethrough gone, and every cell in the
  column centered by a marker nobody wrote. `| <https://e.example> |` lost its
  anchor the same way through the left marker. **Behavior change:** a header
  marker is followed by one space when the content opens with an alignment sigil.
  The delimiter row is still rewritten as `|=`, and a cell that already carries
  an alignment is unchanged. The body-cell and row-attribute writers were
  measured and were already safe.

- **The Markdown target neutralizes embedded HTML in five more slots**
  (carve-js#894). The writer's stated invariant is that `<`, `>` and `&` in
  author content are escaped so Markdown re-rendered to HTML cannot execute, and
  math content, the abbreviation definition line, the footnote label (resolved
  and unresolved) and an unresolved cross-reference's target all skipped it: a
  math span holding a `script` tag came out live, and an `<abbr title="...">`
  built from an escaped expansion sat in the same output as the unescaped
  `*[AB]:` line it came from. **Behavior change:** those slots now escape like
  every other author-content slot on this target. A footnote label escapes in
  both the reference and the definition, so the pair still matches; escaping
  math is transparent to a consumer, which decodes the entity back to the
  character before its math renderer sees it, exactly as the HTML target has
  always relied on. An unresolved cross-reference keeps its authored
  `</#target>` marker, which stays readable; only the target inside it is
  escaped, because `</#a<script>` is a complete opening tag once the Markdown is
  rendered.

- **A cross-reference label is a budgeted expansion** (carve-js#892). `</#slug>`
  republishes the target heading's whole display text while the reference costs
  only the slug, so a short slug on a long heading amplified output by
  (heading length) x (reference count): 20 KB of input produced 16.7 MB of HTML,
  40 KB produced 66.7 MB, and the ratio kept growing with the input until a
  160 KB paste exhausted the heap. The label now charges the same per-render
  expansion budget an abbreviation charges, on the HTML, Markdown, plain-text
  and ANSI targets alike. **Behavior change:** once that budget is spent, a
  cross-reference renders labelled with its authored target
  (`<a href="#A">A</a>`) instead of the target's full display text, the way an
  over-budget abbreviation renders as its plain key. The budget's floor and
  factor are unchanged, so ordinary documents are byte-identical. The Carve
  target reproduces the authored `</#slug>` and never expanded, so it is
  unchanged.

- **The Markdown writer probes the destination it will actually emit**
  (carve-js#893). It normalizes a destination on the way out - it drops control
  characters, and its consumer decodes character references - but it probed the
  authored form, so the writer itself manufactured live URLs the denylist had
  already dismissed. A destination holding U+007F or any C1 control came out as
  `[t](javascript:alert1)`; `&#106;`, `&#x6A;`, `&colon;` and `&#58;` came out
  verbatim and decoded to a live scheme one hop downstream. **Behavior change:**
  a destination whose scheme is denied once control characters are stripped is
  now blanked (the ANSI target of this engine, and carve-php, already did this),
  and an ampersand that opens a character reference is emitted as `&amp;`, so a
  consumer decodes it back to the authored bytes instead of into a scheme. An
  ampersand that opens nothing, such as the `&` in a query string, is untouched.

- **A boundary line inside an open fence no longer ends the container**
  (markup-carve/carve#983 corpus category 279, carve-js#884). A `+` continuation
  marker attaches ONE block, and a fenced block ends at its closer - so a blank
  line, a sibling list marker, a dedent, a quote line or the next definition
  written between an opener and its closer is fence content and ends nothing.
  Six `+` collectors consulted no fence state at all, so a code, `:::` or `%%%`
  fence with a blank in its body was cut in two in every container that can hold
  one: a list item, a block quote, a footnote body and a `dd`. The opener was
  left an empty block, the tail escaped to document level, and a code fence's
  closer came back as an empty inline code span. A seventh collector, a list
  item's indented body, knew the code and comment fences but not the colon
  depth, so `- x` / `  :::` / `  a` / `  - m` / `  b` / `  :::` split the div
  around a nested list. The looseness scan had the same one-kind-of-three read
  and is fixed with it: a blank inside a `:::` or `%%%` body no longer loosens
  the item that holds it. An UNTERMINATED fence is unchanged and still ends at
  the boundary.

- **A label, node type or role that names a key on `Object.prototype` no longer
  reaches a table it was never in** (carve-js#886). `[^__proto__]` - twelve
  bytes, the default `carveToHtml` path, no options - threw an uncaught
  `TypeError` on all four targets, and so did `[^constructor]`, `[^toString]`,
  `[^valueOf]` and every other inherited key: a caller without a try/catch
  returned a 500 or dropped the worker. Every table keyed by author text had the
  same read, so the whole class is fixed: `carve lint` reports
  `unresolved-footnote` for such a label, an AST-JSON node type named after a
  prototype key raises `AstJsonUnknownNodeTypeError` instead of a bare
  `TypeError`, an AST-JSON footnote definition so labelled is no longer judged a
  duplicate and discarded, an extension role so named renders rather than
  throwing, and the `symbols` option no longer emits a function's source text
  RAW for `:constructor:`. The SVG sanitizer had the sharpest form: `&constructor;`
  expanded to a function's source inside the string its URL check reads, and
  since that text carries no `;` it welded the checked segments together, so
  `fill="red&constructor;https://evil.example/y"` was kept where
  `fill="red;https://evil.example/y"` was blanked. A definition, symbol or role
  the author genuinely wrote under one of these names still resolves; only the
  inherited hit is gone.

- **Whitespace is a space or a tab, in every construct**
  (markup-carve/carve#977, markup-carve/carve#890, PART 7). Nine sites read the
  host language's whitespace class instead - `.trim()`, `\s`, or `\s` with one
  character carved back out - and each gave a different answer from the construct
  beside it. A VERTICAL TAB (U+000B) and a FORM FEED (U+000C) are CONTENT
  everywhere now, as are U+00A0, U+FEFF, U+1680, U+2000-U+200A, U+2028, U+2029,
  U+202F, U+205F and U+3000. So: `# <FF>` is a heading, `<VT>- a` is not a list,
  `^[<VT>]` is an inline footnote, a line holding only a byte order mark no
  longer ends a paragraph, a fence closer and a continuation marker take spaces
  and tabs only, and `carve fmt` keeps every character the renderer keeps - 61 of
  the 63 C0/C1 controls used to be deleted by the writer while the HTML renderer
  emitted them. Only U+0000 and U+000D are still dropped.

- **Whitespace is a space or a tab in fourteen further constructs**
  (markup-carve/carve#977, markup-carve/carve#963, PART 7). The sweep above
  narrowed the sites a reading of the source found; these were found by
  MEASUREMENT, feeding every construct a VERTICAL TAB, a FORM FEED and an
  ordinary control character and keeping the rows where the first two behaved
  differently from the third. So: `:: <VT>` is a definition term (the list used
  to stay a paragraph), `{k=v<VT>w}` is ONE attribute whose value holds the
  character rather than two attributes, `{#a}<VT>{.b}` is no longer one
  attribute line, `{#x}<VT>` is no longer an attribute line at all, a trailing
  `{...}` is not reached across such a character on a reference definition, a
  `+`-continuation row and a block image end at their own line's padding,
  `/*<VT>a*/` is bold-italic, an unclosed code span keeps a trailing one, a
  cross-reference id and a footnote label keep one, and the canonical writer
  stops truncating a fence info token at one. A quote after a NO-BREAK SPACE
  still opens, and a link destination still ends at UNICODE whitespace, because
  PART 3 marks that slot as the wider one.

- **Trailing whitespace is dropped on every content line, not only a block's
  last** (markup-carve/carve#926). The run before a SOFT BREAK was kept until
  now, so `abc<SP>` / `def` and `abc` / `def` are the same document. Applies to a
  heading, list item, block quote line, definition term and description, footnote
  body line, table caption and line block. Only U+0020 and U+0009 drop. Verbatim
  content is untouched.

- **Whitespace between tokens is decided by role** (PART 7,
  markup-carve/carve#892, markup-carve/carve#912). A MARKER SEPARATOR is a run of
  ASCII spaces: the first character that is not one ends the separator and begins
  the content, so `*[HTML]: <NBSP>Hyper` puts the character in the title and
  `[^f]: <NBSP>note` starts the note body with it. A tab immediately after the
  marker is still not a separator. A PADDING SLOT spelled `space` takes exactly
  ONE space - the link and image title, the code fence's slot before its info
  string, `frontmatter_open`'s slot before the format token, and a reference
  definition's slot before its trailing attributes - so ``` ```<SP><SP>php ```,
  `---<SP><SP>yaml` and `[a]: /u<SP><SP>{.c}` fall back to prose rather than
  silently taking the metadata. Slots spelled `space+` keep their run.

- **An autolink body admits non-ASCII and excludes format and control
  characters** (markup-carve/carve#844, markup-carve/carve#860). A
  General_Category Cf or Cc character ends the body, on both the angle autolink
  and the bare-URL extension - ninety codepoints move, the C1 block included. An
  invisible character in a host is a spoofing surface. `link_destination` is a
  different production and does not move.

- **A construct opens only AT its container's content column**
  (PART 1 S4, PART 9 §24 C3, markup-carve/carve#603). One rule, seven shapes that
  used to answer differently:

  - A definition line indented past a list item's content column is item text and
    is no longer COLLECTED, so a reference elsewhere in the document stops
    resolving through a line the reader sees printed.
  - A definition one column in folds into the item's open paragraph, like the
    heading, quote, table row, colon fence and bullet already did.
  - A below-column line folds at every depth, carrying exactly one column, so
    `-   x` / `    - a` / `  - b` no longer nests `b` under `a`.
  - A quoted definition past the content column is text, as its unquoted twin
    already was.
  - A definition body's continuation is measured in COLUMNS, not characters, and
    a line indented past the body's column continues the body's paragraph instead
    of opening a block quote, heading, table row, fence or definition term.

- **No open paragraph, no lazy line - in every container** (PART 1 S4). The rule
  was written about the open stack, not about which container kind is on it, and
  five containers had their own answer:

  - A closed or empty container inside a block quote no longer swallows the
    flush-left line below it. Twelve shapes moved; the quote's tracker had never
    modelled a colon fence's closer.
  - An unterminated comment fence in a block quote opens no block, so following
    blocks still render.
  - A definition body answers S4 like a list item and a block quote: a fence, an
    empty quote, a closed fence at the body column or a block-attribute line
    leaves no open paragraph, so a flush-left line re-parses at document level.
  - A fence opened on a list-marker line does not swallow a below-column body and
    its closer. The item holds an empty code block and the residue re-parses at
    document level.
  - A flush-left line with nothing open closes the item, so a `{i}` line no
    longer folds the next line in and takes the attribute with it.

- **A fence's body inside a list item is verbatim** (PART 9 §24 S1/S2,
  markup-carve/carve#975). §24 places a line by the COLUMN it reaches without
  reading its first character, so `- x` inside a fenced or commented body is the
  same continuation a plain `x` is. A marker line used to split the item in two:
  a code fence published an empty code block plus a nested list plus a stray
  inline span, and a `%%%` comment published its hidden body as a nested list.
  The `+` continuation marker's two attach paths carried the same defect. `carve
  fmt` stopped breaking `%%%` across a space with it.

- **An invisible construct in a list item does not loosen it** (PART 9 §17 L1,
  markup-carve/carve#621). A comment, a definition or a bare `{.c}` attribute
  line renders nothing, so an item holding one stays tight instead of coming back
  wrapped in `<p>`. A `+`-injected separator is not a blank line the author
  wrote. The blank is still remembered: with a sibling item after it the list is
  still loose, and a visible paragraph behind the invisible line still loosens.

- **A floating attribute skips what renders nothing** (§15 A2a,
  markup-carve/carve#571). `{#i}` followed by a reference, footnote or
  abbreviation definition, a line comment or a comment block attaches to the next
  VISIBLE block. carve-js was the only engine that threw the attribute away, which
  A4 reserves for end of document.

- **Over-cap openers group as one paragraph** (§25, markup-carve/carve#547). Past
  `MAX_NESTING_DEPTH` consecutive flattened openers and any text after them form
  ONE paragraph ending at the first blank line, instead of one paragraph per
  opener.

- **A block that renders to nothing leaves no blank line inside its container.** A
  comment, comment block, abbreviation definition or non-HTML raw block rendered
  as the empty string and the container joined it in, so `::: note` holding a
  `%%%` block came out with a stray blank. The list item filtered these already;
  the div, admonition, line block, block quote, definition body and the extension
  API's `renderChildren` did not.

- **An empty footnote label is not a footnote** (markup-carve/carve#589).
  `footnote_label` is one-or-more characters, so `[^]: /x` is a LINK reference
  definition whose label is `^`: it registers as one, leaves no node in the tree
  and emits nothing on the non-HTML targets. This engine used to build a footnote
  node and emit `[^]: %` where the other engines emit nothing. `[^ ]: x`, whose
  label is a space, is still a footnote.

- **A collapsed reference whose label carries markup reaches a heading**
  (markup-carve/carve#949, PART 9R R1). The heading index is keyed by rendered
  plain text, and the LABEL now enters the comparison the same way, so
  `[*bold* heading][]` under `# *bold* heading` links to `#bold-heading`. Eleven
  inline markup kinds move. The lookup is a retry - the label as written is tried
  first - and `linkDefs` matching is unchanged. `carve lint` mirrors the resolver.

- **A link label's closing `]` is found past an editorial comment.** `[{#a]b#}](u)`
  formed no link and no spelling worked, since `{# … #}` resolves no escapes.

- **A `%%%` comment opener with trailing text no longer leaks the comment body
  and drops the next block** (PART 9 §28). Only the leading run of `%` is
  structural, so `%%% TODO` opens and `%%% end` closes; `%%% html` is a comment,
  not a raw block, and its body stays hidden. An opener with no closer ahead
  degrades to a line comment, so following blocks still render. The opener's tail
  is kept as the body's first line so `fmt` round-trips it.

- **A heading referenced only from a footnote body keeps its `{#id}` in the
  Markdown target.** The prepass walked `ast.children` alone, so the reference
  still rendered as a link and the output carried a dangling anchor.

- **The Markdown renderer no longer de-escapes underscores inside verbatim
  content.** `` `a\_b` `` came back as `` `a_b` ``, and the same happened in
  fenced code blocks, link destinations, image sources and escaped raw HTML -
  each dropping a byte the parser had kept.

- **`carve fmt` stops rewriting documents it should reproduce** (PART 11 §2, §4).
  The headline change: the writer renders the minimal escape form, checks it
  against the conservative one, and keeps an escape only where dropping it would
  change the parse - so `50% faster: yes (ok).` no longer comes back as
  `50\% faster\: yes \(ok\).`. The check is document-scoped and compares the two
  renders against each other. The caret stays escaped in both modes. Also fixed
  in the same pass:

  - A nested list is no longer inflated. Each level was indented twice, so output
    was O(depth^3) bytes where the source is O(depth^2) and a 10 KB ladder at
    depth 100 came back as 344 KB. A ladder now returns byte-identical at every
    depth.
  - One construct is no longer substituted for another: `| %%%` was written
    `| %% %`, splitting a comment fence, and `* %%` became `* +`.
  - A line-initial colon run is escaped once; a mid-line colon is not.
  - A table is written in the native header form (`=` cells plus per-cell
    alignment markers) instead of a GFM delimiter row, so an aligned header no
    longer spills alignment down the column.
  - A line block is written as `::: |` with plain-space indentation, not as a
    `.line-block` div with a literal no-break space.
  - A code fence's title is emitted once, from the fence, not also as an
    attribute block.
  - An escaped space is reproduced as an escape rather than resolved to a
    non-breaking space.
  - A lone table span marker stays padded (`| < |`), so a formatted table cannot
    be read elsewhere as a left-alignment marker.
  - A break inside an ingested heading collapses to a space instead of splitting
    the heading on re-parse.
  - The blessed empty attribute block (`-{} text`) records nothing.

- **Source positions cover more of the tree, and cover the markup that produced
  each node** (PART 12 §4). An inline node's span now covers its trailing
  attribute block - `*x*{#i}` gives the `strong` offsets 0..7, not 0..3 - which
  moves offsets for any consumer indexing on them. Positions are also kept, where
  they used to be dropped entirely, across: a list nested in a `+` continuation, a
  `+`-continued blockquote, a hard-breaks block, a captioned fence or standalone
  equation, a space-indented line-block stanza, an emptied definition description
  through the engine's own ingest, and a stanza whose line ends in a trailing
  space.

- **A tree from another engine decodes and renders.** A carve-php tree carrying
  block `footnote` definition nodes used to throw `unknown block footnote`; such
  nodes are hoisted into the `footnoteDefs` map this engine uses. Which
  representation is canonical is still open (markup-carve/carve#408).

- **Parsing and formatting are faster on the shapes that were slow.** No parse
  result changes - the whole spec corpus renders byte-identically on all five
  targets, with the same SHA-256 over 675 documents before and after.

  - An ordinary bullet list parses in linear time again (carve-js#885). Anchoring
    a container's body to its document offsets inverts the parent's line map, and
    that inversion was rebuilt for every child, so a list paid one full walk of
    its parent per item. A flat 16,000-item list - 64 KB, no unusual syntax, no
    options - cost roughly 18 s where 0.1.2 cost 82 ms, and doubling the input
    quadrupled the time; the map is built once per parent now and the cost per
    doubling is 1.1x to 1.5x.
  - A nested container no longer re-scans its own body once per level. On the
    deepest conforming ladder (depth 200, 40,600 bytes) the layout machinery
    walked 10.9M characters, 267x the document's own size; it now walks 140K.
    Parsing that ladder: 88.0 ms to 49.9 ms.
  - The list-marker patterns no longer backtrack through indentation; the same
    ladder drops a further ~20%.
  - The writer's escape decision costs one parse instead of two where the minimal
    form re-parses faithfully. A 40 KB ladder with one escapable character: ~186
    ms to ~100 ms.
  - A document full of `%%%` openers with distinct widths no longer rescans
    itself per opener. ~1.9 MiB of such input: 8.5 s to 67 ms.

## [0.1.2] - 2026-07-27

### Added

- **Inline literal** via the `` !`…` `` prefix (#359). A `!` immediately before
  a verbatim backtick span renders its content as escaped prose with no
  `<code>` wrapper, so notation that collides with the bare emphasis
  delimiters - phonemic transcription `/kaet/`, glob patterns, paths - needs no
  per-character escaping. It mirrors the `$`-math prefix: content is captured
  verbatim, HTML-escaped, and emitted by every renderer, and a trailing `{…}`
  is the ordinary inline attribute block. A literal `!` immediately before a
  backtick span is written `\!`.
- **Lint rule for indented fenced-code delimiters** (`fence-delimiter-indentation`)
  (#367).
- **SVG `img` fence** (Tier-3, opt-in via `imgFence()`, off by default) (#366,
  #378). An `` ```img `` block renders a sanitized SVG instead of showing the
  source. Sandbox by default: the sanitized SVG is encoded into a
  `data:image/svg+xml` `<img>` the browser isolates (no script, no fetch, no DOM
  access); a host may opt into a live inline `<svg>` (`imgFence({ allowInline:
  true })`) for `currentColor` / CSS theming. When no `{alt=…}` is given, the
  alt text falls back to the SVG's `<title>`.
- **PlantUML preset and an open static-renderers map** (#360, #363). A
  build-time diagram renderer can be plugged in via the css-class-keyed
  renderers map, and static diagram output is wrapped in a uniform `<div>`.
- **Source-line tracking** for editor scroll-sync (#349, #339):
  `data-source-line` is stamped on nested blocks and list items, emitted after
  author attributes for cross-implementation parity.
- The ordered-list delimiter is now recorded in the AST (#342).

### Changed

- **BREAKING: AST node type discriminants now follow the spec node-type
  vocabulary** (#369). The AST is public API (`export * from './ast.js'`), so
  any code that matches on `node.type` must be migrated. Twenty discriminants
  were renamed:

  ```text
  abbreviation-def    -> abbreviation_def
  blockquote          -> block_quote
  caption-number      -> caption_number
  citation-group      -> citation_group
  code-block          -> code_block
  critic-delete       -> delete
  critic-insert       -> insert
  critic-substitute   -> substitution
  crossref            -> heading_ref
  definition-list     -> definition_list
  extension           -> inline_extension
  hard-break          -> hard_break
  list-item           -> list_item
  literal-inline      -> literal_inline
  raw-block           -> raw_block
  raw-inline          -> raw_inline
  soft-break          -> soft_break
  table-cell          -> table_cell
  table-row           -> table_row
  thematic-break      -> thematic_break
  ```

  A mechanical hyphen-to-underscore replacement is **not** sufficient. Five
  nodes were given genuinely new names (`crossref`, `extension`, and the three
  `critic-*` nodes), and `blockquote` contains no hyphen at all, so a naive
  replacement leaves it untouched and silently broken.

  **This fails at runtime, not at compile time.** Consumers that type the
  discriminant as a plain `string` rather than a union get no compiler error
  from a stale name - the branch simply never matches, and the node is silently
  dropped. Two downstream repositories were already broken this way: both
  carve-lsp and pandoc-carve had migrated to the new vocabulary while still
  resolving the published carve-js 0.1.1 (which ships the old names), leaving
  their default branches red. When upgrading, migrate the names and the
  dependency together.

  Known inconsistency: `critic-comment` was left unchanged and is now the only
  discriminant still using kebab-case, even though the three sibling
  `critic-*` nodes were renamed. It is unchanged in this release.

### Fixed

- **Strict column-0 rule for block-attribute lines, image captions, and
  reference/footnote definitions**. A block-level construct opener fires only
  when it begins at its container's content column (column 0 at the top level).
  carve-js previously recognized three such constructs while indented above that
  column, diverging from carve-php (which already implements the rule) and the
  spec oracle: an indented `{…}` block-attribute line attached to the following
  block; an indented image + `^ caption` formed a `<figure>`; and an indented
  reference-link or footnote definition was collected/consumed (resolving a
  reference and rendering nothing) instead of staying literal paragraph text.
  All three now stay literal when indented, while a flush (column-0) attribute
  line, caption, or definition keeps opening exactly as before. carve-js now
  matches carve-php byte-for-byte on these shapes.
- **A below-content-column wrapped definition-list term folds with its leading
  whitespace stripped**. When a `:: term` inside a list item is followed by a
  lazy continuation line that sits below the item content column, that line is a
  lazy continuation and its leading whitespace is now removed before it folds
  into the `<dt>` - matching how a lazy paragraph continuation is stripped, and
  matching carve-php, carve-rs, and the spec oracle. carve-js previously kept
  the stray leading space (`<dt>term\n wrapped</dt>`), producing bytes that
  diverged from the other engines.
- **A sole-image block only absorbs a *glued* trailing attribute block** (carve#295).
  `![a](/u){k=v}` attaches `k="v"` to the bare `<img>`, but `![a](/u) {k=v}` (with a
  space) now keeps the `{k=v}` literal and inlines the image in a paragraph, matching
  the inline glue rule and carve-rs/carve-php; carve-js previously absorbed the
  space-separated block onto the image.
- **A trailing `{…}` after an inert inline node no longer vanishes** (carve#295).
  An attribute block following a mention `@user`, a tag `#tag`, or a soft/hard
  break was attached to that node and then silently dropped at render (those
  renderers emit no attributes). It now stays literal text, matching carve-rs
  and carve-php - mentions and tags are inert stable spans that do not take
  attributes. Legitimate attachment (`` `code`{.c} ``, `[span]{.c}`, `!`x`{.c}`,
  emphasis, symbols, links, images) is unchanged.
- **A definition-list term (`::`) is now a first-class block opener** (carve#295).
  It interrupts an open paragraph or heading like a heading/quote/fence does, so
  `text` / `:: term` opens a definition list and a `:: term` at a list item's
  content column nests a definition list inside the item (previously it folded
  into the item as lazy text). An INDENTED `:: term` below the content column
  still folds, matching heading/quote at the same position. Aligns carve-js with
  carve-rs/carve-php and resolves a cross-engine divergence.
- A post-blank block attached to a nested list item no longer loosens the
  outer item (#322). List looseness is decided per level; a descendant's
  looseness (from a post-blank block or an inner-list blank) no longer
  propagates up to an ancestor item. Matches carve-php and carve-rs.

- **Post-blank list continuation now uses the content-column model** (carve#295).
  A block opener (quote, heading, fence, table, thematic break) or a sublist
  marker must reach the parent item's content column to belong to the item: at
  the content column it nests, below it lazily continues (no blank) or ends the
  item and parses at document level (after a blank), and above it folds in as
  lazy paragraph text. This holds whether or not a blank line precedes the
  child - the blank only decides tight vs loose. It is an intentional divergence
  from djot, which attaches a block opener at any indent past the marker, and
  resolves the B1-B4 divergence classes in carve#295.

- **`carve fmt` no longer corrupts verbatim spans whose content is entirely
  spaces.** The parser's single-space strip now skips all-space content, and
  the serializer pads only where the parser strips. Previously `` `  ` ``
  stripped to an empty verbatim span, which has no representable Carve source
  (a bare `` `` `` reparses as a two-backtick opener), so an all-space inline
  literal degraded across successive `fmt` passes - `` !`  ` `` became
  `` !`` `` and then `` \!`` ``, silently changing the document and breaking
  both the `carveToHtml(fmt(x)) === carveToHtml(x)` invariant and idempotence.
  All-space content is now preserved verbatim: `` `  ` `` renders
  `<code>  </code>` rather than `<code></code>`. The all-space guard matches
  the executable spec's `codeText()` and the CommonMark rule it derives from.
- The definition prepass now tracks list content columns, fixing a
  nested-fence-inside-a-list-item limitation (#364).
- A fenced-code delimiter sits at its container's content column, and a
  list-nested fence keeps its indent through Markdown migration (#361, #362).
- A definition marker requires a literal space after the colon, not a tab
  (#353).
- An ordered list item continues on a 2-space indent after a blank line (#352).
- A trailing backslash at end of input is a hard break; a bare same-level `#`
  continues a heading (#345).
- A thematic break is a contiguous column-zero run only; `markdownToCarve`
  normalizes to `---` (#346).
- Empty and space-initial bold-italic (`/*…*/`) are rejected, matching the spec
  and carve-php (#343).
- A blank line may separate a term from its definition, and a multi-line term
  folds continuation lines like a heading (#335, #336).
- Definition descriptions continue like a list item (loose and `+` forms) and
  support the `:  +` first-block form (#332, #334).
- Definition and footnote bodies continue like list items (#329).
- A profile `maxLength` is enforced before parsing; untrusted presets are
  capped (#331).
- Fixed quadratic parsing of inline tails and block attributes, so pathological
  input parses in near-linear time (#328).
- The formatter preserves the authored list marker (bullet character and
  ordered delimiter) and keeps verbatim content byte-exact through
  normalization (#351, #341).

## [0.1.1] - 2026-07-15

- BREAKING: Rename symbol shortcodes from `emoji` to `symbol` in the AST
  (`type: 'emoji'` -> `type: 'symbol'`), HTML renderer option (`emoji` ->
  `symbols`), and profile construct name.
- Add a leading word-boundary guard for symbol shortcodes so text such as
  `a:b:c`, `10:30: x`, and `word:rocket:` stays literal.
- Preserve attributes on HTML-rendered symbol shortcodes by wrapping mapped or
  literal output in a `<span>` when attributes are present.
- Gate the Djot-semantic-shift migration warnings in `carve lint` behind a new
  `--from-djot` flag. By default `carve lint` reports only constructs that
  mis-render in Carve (`**bold**`, `~~strike~~`, `^sup^`, `+` bullets); valid
  Carve that merely differs from Djot (`_x_`, `~x~`, `{=x=}`) surfaces only with
  `--from-djot`. `MigrationWarning` gains a `category` field and
  `MigrationCategory` is exported.

## [0.1.0] - 2026-07-14

Initial release of the **reference TypeScript implementation** of the
[Carve](https://github.com/markup-carve/carve) markup language.
carve-js is the spec oracle: the JS output is the ground truth that all other
implementations are byte-matched against.

### Core parsing and rendering

- Linear-time block and inline parser producing a typed `Document` AST
- Full Tier-1 feature set: headings (H1-H6), paragraphs, emphasis (`/italic/`,
  `*bold*`, `_underline_`, `~strikethrough~`, `^super^`, `,sub,`, `=highlight=`,
  `/*bold-italic*/`), blockquotes with attribution captions, unordered and ordered
  lists, task lists, tables (with colspan/rowspan), inline code and fenced code
  blocks, images (inline and block with captions), horizontal rules, hard breaks,
  YAML frontmatter, admonitions (`::: note`/`tip`/`warning`/`danger`), abbreviations
  (`*[ABBR]:`), mentions (`@user`), hashtags (`#tag`), display and inline math
  (`$$`/`` $` ``), inline extensions (`:type[...]`), attribute blocks (`{#id .class
  key=val}`), raw HTML passthrough (`=html`), comment lines (`%%`), and reference
  links/images
- Inline footnotes (`^[...]`) and block footnote definitions
- Editorial / critic markup (`{+ +}` insert, `{- -}` delete,
  `{~ old~>new ~}` substitute, `{= =}` highlight, `{# #}` comment)
- Smart typography: curly quotes, em/en dashes, ellipsis
- HTML renderer (`renderHtml` / `carveToHtml`) producing canonical output matched
  by all other implementations
- Markdown renderer (`carveToMarkdown`), plain-text renderer (`carveToPlainText`),
  ANSI-colored renderer (`carveToAnsi`)
- Static render mode (`{ mode: 'static' }`) for self-contained HTML without
  client-side scripts; interactive constructs degrade gracefully

### Tier-2 opt-in extensions

- `mathBlock` - fenced ` ```math ` block rendered as `<div class="math display">`
  with author-attribute passthrough (core `$$` display math is always-on Tier-1)
- `citations` - `[@key]` reference citations with typed locators, explicit
  suffixes, and integral/group-level markers (§22)
- `codeCallouts` - annotated callout markers inside fenced code blocks

### Tier-3 opt-in extensions

- citations `bibliography` option - supplying a CSL-JSON pool renders a
  cite-ordered `<ol>` with back-links (a citations capability, not a standalone
  extension)
- `glossary` - `::: glossary` blocks with `:term[word]` inline markers linking to
  `gloss-{slug}` anchors
- `index` - `:index[term]` invisible span markers with a sorted `::: index` block
  collecting back-links
- `headingNumbers` - opt-in section auto-numbering (`1.`, `1.1.`, ...) and
  numbered `</#id>` cross-references via `<span class="section-number">`
- `colorSwatch` - `:color[value]` inline showing a color preview chip; validates
  against the CSS named-color set; configurable position, shape, and tint; auto-
  contrast label variant
- `spoiler` - `:spoiler[text]` inline and `::: spoiler` block (native
  `<details class="spoiler">`)
- `details` - `::: details "Title"` rendered as HTML5 `<details>/<summary>`
- `fencedRender` - generic client-render factory with presets for Mermaid, D2,
  Graphviz, WaveDrom, ABC, Vega-Lite, and Chart.js
- `listTable` - `::: list-table` converts nested lists to `<table>` with full
  block content in cells; supports header-rows/cols and span markers
- `tableOfContents`, `headingPermalinks`, `autolink`, `externalLinks`,
  `wikilinks`, `tabNormalize` - standard document-enhancement extensions

### CLI and tooling

- `carve` binary: `render` (default), `fmt`, `fix`, `lint` subcommands
- `carve fmt` - canonical formatter; semantic-preserving rewrite (trailing
  whitespace, blank-line runs, list markers, fence lengths, attribute spacing);
  `-w` in-place and `--check` CI-gate mode; `carveToCarve(src)` programmatic API
- `carve lint` - validator for broken cross-references, duplicate heading ids,
  unresolved reference links, missing/duplicate footnotes, misplaced attribute
  blocks, and legacy fence syntax; exits non-zero for CI use
- `carve fix` - auto-corrects Djot/Markdown delimiter collisions
- `markdownToCarve` migration helper and `djotToCarve` collision warnings

### Security (always-on, §25-§26)

- URL scheme denylist covering `javascript:`, `data:`, `vbscript:`, and OS
  protocol-handler schemes
- Dangerous attribute stripping (`on*`, `srcdoc`, `formaction`) on all elements
- CSS `expression()` and `url()` neutralization in style attributes
- Trojan-Source hardening: NFC normalization of heading/footnote ids; bidi and
  zero-width Unicode control characters stripped from text and code content (§26)
- Uniform nesting depth cap of 200

[Unreleased]: https://github.com/markup-carve/carve-js/compare/0.1.3...HEAD
[0.1.3]: https://github.com/markup-carve/carve-js/compare/0.1.2...0.1.3
[0.1.2]: https://github.com/markup-carve/carve-js/compare/0.1.1...0.1.2
[0.1.1]: https://github.com/markup-carve/carve-js/compare/0.1.0...0.1.1
[0.1.0]: https://github.com/markup-carve/carve-js/releases/tag/0.1.0
