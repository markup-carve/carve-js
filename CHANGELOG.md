# Changelog

All notable changes to carve-js are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Table column metadata** (#1206, markup-carve/carve#1391). Positional alignment, vertical alignment and widths reach the AST as `table.columns` and `table_cell.valign`, render as `<colgroup>`, carry through ListTable, and are covered by new lint rules.
- **Semantic table row partitions** (#1223). Pipe tables take `{header-rows=N footer-rows=N}` for explicit head/body/foot ranges; a ListTable cell takes `{align= valign=}` over the positional column default. The consumed attributes do not leak into the HTML.
- **Local ListTable headers** (#1220, markup-carve/carve#1248). `header-row` on a row's first cell starts a header-led body group; `header` on any cell emits a single `<th>`.
- **`?` inherits a column's horizontal alignment** (#1218, markup-carve/carve#1408), so `?^`, `?~` and `?v` set only `valign`. A lone `?` stays visible cell content.
- **`SourceUnspellableError`, exported** (#1209). The canonical Carve writer refuses an empty `raw_inline` - which has no Carve spelling and reparsed as a different node - instead of emitting one.
- **A `labels` render option carries the strings the engine writes itself**
  (markup-carve/carve#1456, PART 9 §16a). Values are text and are escaped where
  they land, unlike the raw `symbols` map.

### Changed

- **A `css`-mode tabs or code-group panel carries its tab's name**
  (#1265, markup-carve/carve#1489, PART 11 §13.2). Each panel gains
  `role="group"` and an `aria-label` holding its tab's own label,
  attribute-escaped. Under `css` nothing else binds a panel to the radio that
  reveals it. An `aria`-mode panel is unchanged and takes neither (§13.3): it is
  already bound by `aria-labelledby`, and a second name would give one element
  two. A `"static"` render takes neither mode.
- **`codeGroup()` takes the `mode` option it used to accept and ignore**
  (#1265). `codeGroup({ mode: 'aria' })` rendered the radio markup byte for
  byte; it now renders the ARIA shape, mirroring Tabs. `css` remains the default
  in both, and **an unknown `mode` is now rejected rather than falling back to
  `css`** - `tabs({ mode: 'aira' })` threw nothing and rendered the default.
- **Three blank lines are a hard list boundary** (markup-carve/carve#1430,
  §11 N1a). A run of three or more before a compatible sibling marker opens a
  new list instead of loosening the current one, at every level. One and two
  blank lines are unchanged.
- **The canonical writer separates two adjacent sibling lists with that
  boundary** instead of indenting the later one by a space. The old offset was
  what existed before a separator was spelled; it returned a list at a column
  the author never wrote, and it could not survive a third list.
- **The doubled run is the canonical arrow, in both families** (#1241, markup-carve/carve#1442). `<--` `-->` `<-->` and `<==` `==>` `<=>` convert. **BREAKING: `=>` no longer converts** - `key => value` and `x => x + 1` were silently becoming `⇒` in rendered output only. `<=` keeps `≤`, and a highlight no longer opens before `>`.
- **An empty brace pair is text, and `{--}` is an en dash** (#1242, markup-carve/carve#1447, markup-carve/carve#1450). `{//}`, `{**}`, `{^^}` and the rest render literally; a pair holding content is still the construct.
- **Admonitions, task checkboxes, the footnote section and math carry accessible names** (#1253). A canonical admonition takes `aria-labelledby` on its title or an `aria-label` for its kind, a task checkbox is named by its item text, the endnotes section is labeled, and a math span takes `role="math"`. An authored `role`, `aria-label` or `aria-labelledby` always wins. The `labels` map grows nine keys for those strings.
- **A tab set, a code group and a rendered diagram carry an accessible name**
  (markup-carve/carve#1468). Each tab was already named by its own `<label>`
  and the GROUP was anonymous; a diagram fence emitted its source with no role,
  so a reader heard the markup as prose. `tabs()` and `codeGroup()` take a
  `groupLabel` (defaults `Tabs` / `Code examples`) and write
  `role="group"` plus that name - `aria` mode keeps `role="tablist"`. A
  `fencedRender()` element takes `role="img"` and a `label`, defaulting to the
  fence word. In every case an `aria-label`, `aria-labelledby` or `role` the
  author wrote on the block wins, and the engine's attributes are APPENDED so
  they never move one the author placed.
- **One `labels` map localizes every engine-written string.** The map grows the
  `indexBackref`, `tabsGroup` and `codeGroup` keys, and the extensions that
  write those strings read it, so a German document sets `labels` once instead
  of finding four separate call sites and silently missing one. An option
  passed to an extension still wins over the map. PART 9 §16a already required
  this - "an extension MUST NOT require the host to configure the same text
  twice" - and nothing had walked through it.
- **A row is a row, in every table section** (markup-carve/carve#1459, PART 10
  §7). `<thead>` and `<tfoot>` now write one row per line, as `<tbody>` always
  did. Nothing renders differently - whitespace between rows in table context is
  not rendered - but the emitted HTML is consistent and diffs read cleanly. Both
  table paths move: pipe tables and the list-table extension.
- **A table cell's marker run ends at a space** (markup-carve/carve#1259, PART 9
  §5 T11). The kind marker `=`, the alignment run and the attribute block are
  one run, and a cell carrying any of them must follow it with a space; without
  one there is no run and every character of it is content. `|=hot= |` is the
  highlight its author wrote rather than a header cell holding `hot=`, `|=a |`
  is a data cell, and `|{#x}=R|` is literal text. The run is atomic, so a
  rejected alignment run takes the `=` with it. A cell with no run is unchanged,
  and the canonical writer already pads every cell, so a formatted document
  needs no migration.
- **A table cell's alignment run is horizontal-first** (#1219). Reverse-order pairs such as `^<`, `v>` and `~>` stay literal cell content instead of being normalized silently.
- **A vertical table-cell marker requires a horizontal partner.** Lone `^` and `v` prefixes remain visible content; paired two-axis runs are unchanged.
- **Common Tier-1 documents render through a borrowed HTML layout** (#1247). `carveToHtml` probes a conservative fast path before allocating an AST; on the shared 48 KiB Tier-1 comparison document the render time drops from about 23.6 ms to 4.7 ms locally. Anything the probe does not accept takes the ordinary path unchanged.
- **Document IDs are carried through conversion instead of rebuilt** (#1239), removing one full AST traversal from the source-to-HTML path. Public `parse` / `resolve` / `renderHtml` composition is unchanged.
- **Core inline parsing skips punctuation dispatch for ordinary prose runs.**
  With no extension matcher active, consecutive ASCII letters, digits and
  horizontal whitespace are appended together instead of probing smart
  typography, emphasis and every other inline recognizer byte by byte. The
  shared 49 KiB Tier-1 benchmark improves by about 25% locally.

### Deprecated

- **The single-hyphen arrows `<-`, `->` and `<->`** (#1241). They still render, so documents written before the doubled-run rule keep working; prefer `<--`, `-->` and `<-->`.

### Removed

- **`escapedLeadingCaret` is gone from the parse tree** (#1259). The
  parser-internal flag had no reader left - the one guard that consulted it
  could not fire - and it was set after any two adjacent escaped carets, where
  no caret leads. An escaped caret is still literal: the `escaped_text` node
  holding `"^"` states it. It never crossed the wire (#735), so no published
  output moves.

### Fixed

- **The canonical writer spells two sibling sub-lists inside a list item**
  (markup-carve/carve#1501, §11 N1a and §10i). A tight item wrote its sub-lists
  behind the `+` marker at column 0, where a compatible marker dissolves them
  into the list around the item; they are written at the item's content column
  now, separated by the boundary. The same repair covers a sub-list below a
  blockquote in a tight item, which was read as the quote's lazy continuation.

- **An HTML import no longer bakes a derived accessible name into source**
  (#1278, markup-carve/carve#1500, markup-carve/carve#1511, PART 9 §16a and
  Extensions §1.5). An attribute whose value equals what the renderer derives
  for that element is dropped and every other one is kept, so a diagram fence's
  own class word, a tab set's or code group's default name, a `css`-mode
  panel's tab label, an index back-link's composite name, a titled admonition's
  counter id, and the `role` beside each stop coming back as authored source. A
  name that DIFFERS - an author's own, or one rendered from a non-default
  `labels` map - is kept, and nothing is diagnosed.

- **A math span survives an HTML import** (#1277, PART 9 §18). Carve's own
  `<span class="math inline">\(x\)</span>` - which djot.js and pandoc write
  too - and the `math display` / `<div class="math display">` block form now
  read back as `math` nodes rather than as generic attributed spans, so the
  non-HTML writers see math again. Recognition needs the class pair and a
  matching payload to agree.

- **The Markdown importer replaces an authored U+0000 with U+FFFD** (#1291,
  #1290, markup-carve/carve#678), which CommonMark 2.3 requires and `parse`
  already did for Carve source. A raw NUL used to reach the output while `&#0;`
  was replaced, and it answered the converter's own NUL-wrapped placeholders: a
  document carrying one came back with a code span from elsewhere in it spliced
  over the author's characters, and one authored inside a code span never
  returned at all.
- **The BBCode importer's stash key is picked per post, not a fixed
  U+E001/U+E002 pair** (#1290, #1289, markup-carve/carve-rs#1210,
  markup-carve/carve#678). A post carrying those two code points around a number
  answered the stash's restore pass and was replaced by a span from elsewhere in
  the same post, while the tag that owned the slot lost its own restore. A post
  that leaves no private-use run free is now refused with the exported
  `BbcodeSentinelSpaceExhaustedError` rather than converted with a colliding key.
- **The writer's marker-column tag and the Markdown target's escape carriers are
  picked per document, not fixed** (#1280, #1281, markup-carve/carve-rs#1210,
  markup-carve/carve#678). An authored U+E005 opening a list item's continuation
  line was eaten and the paragraph written back outside the item; the Markdown
  target deleted an authored U+E004..U+E008 outright. Both runs are now chosen
  from code points the document does not contain.
- **A tab control is `type="button"`, and two marked items select one tab**
  (#1285, markup-carve/carve#1504, Extensions §13.3 and §13.5). An `aria`-mode
  control carried no `type`, so a tab set or code group inside a `<form>`
  submitted the form instead of switching panels. And several `{selected}`
  items each got their own selection - the first mark now wins and later ones
  are ignored, in both modes and both extensions, with no diagnostic for a
  document that over-specifies. `css` mode is unaffected by the first half: its
  control is an `<input type="radio">`.
- **`ParseOptions.positions` is honored** (#1263). It was declared, documented
  and written by four call sites, and read by none, so `positions: false` still
  came back fully positioned. It now suppresses every position on the returned
  tree - `pos`, plus `footnoteDefPos`, `termSpans`, `definitionSpans` and
  `definitionLines`. Default is unchanged (`true`), and `carveToHtml`,
  `carveToAstJson` and `lintCarve` force it back on because each reads
  positions; `carveToHtml` now does so even without `sourceLine`, since the
  strict column-0 figure rule reads an image's `startColumn`.

- **`package.json` is importable, so the installed version can be read back**
  (#1257). The subpath was not in `exports`, so reading it threw
  `ERR_PACKAGE_PATH_NOT_EXPORTED` - which reads as the package being absent
  rather than the subpath being closed. Only that one file is opened; every
  other path stays refused.
- **The index back-link says where it goes** (markup-carve/carve#1469). A
  `↩` with no accessible name is announced as "leftwards arrow with hook", or
  skipped - and an index entry has one per occurrence, so a reader met a row of
  identical unnamed arrows. The k-th back-link is now named `Back to {term} {k}`
  and shows `↩<sup>k</sup>`, mirroring PART 9 §16's footnote rule. The leading
  words are the new `backrefLabel` option on `index()`.
- **The footnote backlink has an accessible name** (markup-carve/carve#1455,
  PART 9 §16). `role="doc-backlink"` was right and the name was the `↩` glyph,
  so a screen reader announced its Unicode name or skipped the link. The name is
  now the label plus what the link visibly says: `Back to reference` for a lone
  backlink, `Back to reference 2` for the second of several.
- **A table alignment run requires a literal space separator** (#1213). Tabs and other JavaScript whitespace now remain visible cell content, matching the grammar and the PHP and Rust engines.
- **A duplicate table alignment axis rejects the whole run** (#1211, markup-carve/carve#1344), rather than keeping the part that parsed.
- **A content-column heading leaves no paragraph open** (#1210, markup-carve/carve#1377, markup-carve/carve#1392), so a following line is not swallowed into the item.
- **An all-blank raw payload renders, and survives `fmt` unchanged** (#1212, #1214, markup-carve/carve#1401).
- **A hyphen run that opens a word after whitespace is a flag, not a dash**
  (markup-carve/carve#1443, PART 9 §8). `git log --oneline` and
  `--force-with-lease` keep their hyphens; every other position converts as
  before, including `pages 1--10` and a trailing `text --`.
- **The braced en dash keeps the spelling its author typed** (#1243). It is the same `smart_punctuation` node the bare run produces, so `carve fmt` writes `{--}` back instead of the resolved glyph.
- **A continuation marker attaches only a flush-left block** (#1244, markup-carve/carve#1436, §17 L3). A line at any other column falls through to the ordinary column rules, as if the marker line had been a comment.
- **A lazy marker line's definition defines nothing** (#1229 via #1230, markup-carve/carve#1428, markup-carve/carve#1429). A link-reference definition behind a list marker on a line folded into an open paragraph rendered as text and still registered in the link table; the same line inside a block quote both vanished from the paragraph and went active document-wide.
- **The lazy guard no longer depends on whether an extension is registered** (#1231 via #1234, markup-carve/carve#1435, markup-carve/carve#1437). Registering any block matcher used to bring the defect back, so six executable-spec documents answered differently with and without an extension.
- **A definition hosted by an emptied marker item is written back into it** (#1233, markup-carve/carve#620, PART 11 §1), instead of the writer spelling the item with a continuation marker.
- **Definitions collected at a list item's content column close its paragraph**
  (markup-carve/carve#1376). A following line below that column no longer uses
  the comment-only continuation path; bare-dot items use the bullet column.
- **Three parser seams found by the combinatorial corpus** (#1226, markup-carve/carve#1418, markup-carve/carve#1419, markup-carve/carve#1421): an unclosed inline literal is one literal-inline node to the end of its block rather than a literal bang plus a code span; a quoted line comment closes the block quote's lazy paragraph; and a terminal comment-only verse line keeps the newline an open verbatim run carries. The guard that carries that newline no longer leaves an empty text leaf in the AST (#1227).

## [0.1.4] - 2026-08-18

### Added

- **Composite figures: a bare `::: figure` fence is ONE figure of ordered panels** (markup-carve/carve#1122, PART 9 §4c). New `figure_group` node; the `^ ` line after the closing fence captions the group, panels number by letter, and five `figure-group-*` lint rules name the shapes that do less than they look like they do.
- **An AST-first HTML importer and `carve migrate` CLI** (#985), with `htmlToAst`, `htmlToCarve` and a diagnostics report.
- **`bbcodeToCarve` importer** (#1014), and **`carve migrate --from`** reaching the Markdown and BBCode importers.
- **Structural three-way AST merge and patches** (#970).
- **A browser IIFE bundle**, published alongside the ESM build.
- **`semanticSpan()` extension** (markup-carve/carve#1146) and **compact semantic spans**.
- **The `{:TAG}` language attribute** (markup-carve/carve#1114).
- **`smartQuotes` locale extension**, with locale-aware quote pairs.
- **Structural short captions are preserved in AST JSON** (#1006).
- **Delimited inline comments, `{% … %}`** - BEHAVIOR CHANGE: `foo {% bar %} baz` used to render its braces and now hides the middle. New lint rule `braced-comment-in-a-template-source` reports the likely collision with Liquid, Nunjucks or Twig source.
- **New lint rule `footnote-labels-differ-only-in-whitespace`**.
- **`AstJsonPartitionError`** - `fromAstJson` refuses a `table.rowGroups` whose counts do not consume the table's rows (PART 12 section 15).

HTML import gained, each previously unwrapped, dropped or silently wrong:

- **MathML as math**, from the TeX the producer already carried; an assumed `alttext` encoding is reported as `encoding-assumed`, a new `HtmlImportDiagnosticCode`.
- **A table's row grouping** as `table.rowGroups`, where it says something a renderer would not derive anyway.
- **A table's spans**, mapped to the continuation cells (`^`, `<`) the model already had.
- **A table's own caption**, and **the attributes its sections and rows have a slot for**.
- **`<details>/<summary>`** as the `details` admonition, keeping `open`.
- **`<q>`** as the typographic quotation marks a browser draws.
- **`<ins>` and `<del>`** as `insert` and `delete`, leaving `~x~` to `<s>`/`<strike>`.
- **`<ol type>` and `<ol start>`**, the latter read by HTML's integer rules.
- **`<dl>`** as a definition list.
- **`<blockquote cite>`** as a block-attribute line (markup-carve/carve#1286).
- **The tightness the source spelled** (markup-carve/carve#1210); every list used to import loose.
- **The seven semantic elements** as the span attribute that spells them (markup-carve/carve#1140), and **every attribute the language can hold** (#1156).
- **An authored table-cell `scope` position cannot explain** (markup-carve/carve-js#1032).
- **The DPUB-ARIA footnote roles in every adapter**, `generic` included (markup-carve/carve-js#1105), plus the `word` and `google-docs` adapters reading vendor footnote HTML (markup-carve/carve#1210, porting markup-carve/carve-php#1303).
- **A named `<colgroup>` drop** (markup-carve/carve#1092) and **a reported figure wrapper** (markup-carve/carve#1211, PART 12 §16) instead of silence.
- **An unwrapped element now reports the attributes it takes with it**, and BBCode keeps the backslash, brace and backtick a post typed.

### Changed

- **A `[@key]: entry` bibliography line is a `citation_definition` node** (markup-carve/carve#1276, PART 12 §18). Tier-2; no rendered output moves, but the AST and the canonical writer do.
- **BREAKING: a table cell's attribute block binds after its kind and alignment markers** (markup-carve/carve#1226, spec §5 T10). `|={.total}Total|` is the authored order now.
- **Every table cell pads its content in the canonical form** (PART 11 §6e): `|= Heading |`, not `|=Heading|`. The canonical writer also spells an attributed header cell natively.
- **A table's `rowGroups` is validated on ingest, at every depth** (markup-carve/carve-js#1055).
- **Semantic spans split by tier**: core registers no `:name[…]` handler at all, `code` and `mark` leave the built-in registry (markup-carve/carve#1146), leftover attributes ride the outermost element, compact semantic span attributes become portable core syntax, and the nine-name registry is now spec- and corpus-pinned across all engines.
- **The Markdown target's authored escape narrows on the line** (PART 11 §8b, markup-carve/carve#1322). An `escaped_text` node keeps its backslash only where its character could open markup at the position reached, so `C\# is a language` writes `C# is a language`.
- **The Markdown target escapes `<` only where it would open markup** (PART 11 §8a M1e, markup-carve/carve#1148), and **leaves a bare ampersand alone**.
- **Bidi control characters are stripped from presentation targets** (#964), and ANSI widths ignore the controls they are about to strip.
- **Plain-text and ANSI targets preserve list structure** (#966).

### Removed

- **The dead `portable-quote-marker-space` lint collector** (markup-carve/carve#1142). It could not fire.

### Security

- **A list-valued attribute is probed at every candidate, not at its head** (markup-carve/carve#1320, §25). `srcset`, and the three other list-valued URL attributes, vouched for the whole value from its leading scheme, so `srcset="javascript:alert(1) 1x, safe.png 2x"` passed the probe on its second entry.

### Fixed

Block structure and containers:

- **A marker on a block quote's lazy continuation is text** (#1200). `- > q` / `  - s` no longer ends the quote and opens a sub-list; a bare marker folds into the open quoted paragraph, in every marker dialect.
- **A block at a container's content column ends the paragraph it sits under** (#1189, ruled as markup-carve/carve#1364 with markup-carve/carve#1348, markup-carve/carve#1349, markup-carve/carve#1357 and markup-carve/carve#1363). What the block RENDERS is not a parameter, so `- a` / `  %% c` / `tail` stops swallowing `tail`. Covers a table ending on a continuation row, a quote nested in a quote, a footnote definition's whole body, and a description marker's content column.
- **A marker-line block that leaves no paragraph open ends its container** (markup-carve/carve#1280, corpus category 326).
- **A continuation marker attaches one block, bounded by that block** (markup-carve/carve#1290, corpus category 327), and **an attribute line is the interruption it was for**.
- **A floating attribute is scoped to the container that holds it** (markup-carve/carve#1281, corpus category 329); an unconsumed one is dropped and reported.
- **An attribute block before a nested list attaches to that list** (markup-carve/carve#1238, markup-carve/carve-js#1100).
- **A tab after a fence or frontmatter opener is decided by its position** (markup-carve/carve#1295; #1121), and **a code fence line ending in a tab is not a fence**.
- **A fence running to the end of a container keeps its trailing blank lines** (#989), and **an invisible child does not change a list item's or a block quote's framing** (#991, #992).
- **Adjacent sibling lists stay separate through `fmt`** (#981).

The definition prepass, which collects link reference, footnote and abbreviation definitions before the document is parsed:

- **A link reference definition reaches its column by composing the strips** (#1199, markup-carve/carve#1372). Under an alternating quote/list prefix the prefix walk lost the inner items, so a definition registered at a column where the parser prints it as text.
- **A comment fence is read behind its whole container prefix** (#1181, markup-carve/carve#1309), and **a definition inside a quoted comment fence registers nothing** (markup-carve/carve#1341). A definition hidden inside a comment used to resolve anyway.
- **A comment fence hides its body wherever it stands, and closes with its container** (markup-carve/carve#1309; #1118, #1146).
- **A prepass tracker ends with the container that holds it** (#1135, #1139), **a fence delimiter continuing a paragraph opens no fence** (#1136), **an open code fence answers first** (#1132), **a bare-dot ordered item is a container it can see** (#1120), **a raw block is opaque to it** (#973), and **a definition past the content column is visible to the looseness scan** (#979).

Tables:

- **A row's verbatim run closes on a run of its own length** (PART 9 §22), **the row closing pipe is not part of an unterminated run** (markup-carve/carve#1284), and **a continuation row is cut while the base row's run is still open** (corpus category 333).
- **A continuation row's carried text keeps its own span** (#1153), and **a `^` standing under a merged `<` is absorbed by the cell above it**.

Line blocks:

- **A line block hardens a soft break at every depth** (#1174, markup-carve/carve#1351, PART 9 §23). A closed inline construct spanning a boundary used to swallow the break, so two spellings of one boundary rendered differently. Reverses four rows pinned by #1127.
- **A line block's nested inline is measured and captured from its own source** (#1182, #1183). Nested node positions drifted past the first emptied comment line, and `rawRef` was sliced from the joined text, so `carve fmt` destroyed the author's characters.
- **A verse comment nested under an inline container keeps its text**, and **a line block's comment line is removed at the block layer, so its hard break keeps its backslash** (#1170, markup-carve/carve#1333).
- **A line block's stanza is one inline run, so an unclosed run reaches its end** (markup-carve/carve#1282; #1116), and **its footnotes are numbered like any other block's** (#1117).

Inline and rendering:

- **An unresolved reference publishes no comment written in its label** (#1192). All four render targets emitted `rawRef` verbatim, so a `%%` line inside the label was published as text.
- **A bang before a code span no longer escalates the whole document** (markup-carve/carve-js#1175, PART 9 §27).
- **An empty link text is still a reference** (#1119), and **a footnote inside an unresolved reference no longer counts as a reference** (markup-carve/carve-js#1064, ruled in markup-carve/carve#1198 as PART 9R R2).
- **Footnote labels are matched exactly, without trimming their ends** (PART 9 §16), **a footnote reference no longer crosses a source newline**, and **the footnote-definition lint rules see definitions inside containers**.
- **A definition term keeps its trailing run on a folded line** (#1145).
- **A line's content position is after its container prefix** (markup-carve/carve#1330, PART 11 §8b). `> \# heading` re-read as a real heading, returning the author's text as structure; the scans that measured it are bounded too.
- **A referenced abbreviation definition splits by target on plain text and the terminal** (markup-carve/carve#1185, PART 11 section 10f), **an authored `abbr` wins on the Markdown and ANSI targets** (markup-carve/carve#1176), and **an abbreviation expands inside the `:name[…]` form** (markup-carve/carve#1151).
- **Presentation targets no longer discard authored text** (markup-carve/carve#1179), and **a table caption, a fence title and a fence grouping label survive every target** (PART 11 §10e).
- **A nested list is indented once on the Markdown target, not twice** (PART 11 §7), and **the Markdown target writes no marker line ending in a space** (markup-carve/carve#1147).
- **A `details` block carrying `{open}` renders it once in a static render**.
- **`lintCarve` reports the semantic-attribute rules against the render the caller configured** (markup-carve/carve#1167), **explains a near-miss footnote label**, and **the `semantic-attribute-outside-span` diagnostic names the value the renderer writes** (markup-carve/carve-js#1058).
- **`LIB_VERSION` reports the version that is running**.

Performance:

- **A line of markers is walked by offset, not by re-slicing** (#1190). The marker-line strip read to the end of the line and reallocated its tail once per marker, so a line of N markers cost O(N * line length). Per-byte cost across five marker spellings drops from roughly 3.5x-4.2x per doubling to about 1.0x.

The canonical writer (`fmt` / `carveToCarve`):

- **A bare delimiter rule does not escape what the source already escaped** (#1160, #1162; the answer carve-php reached in markup-carve/carve-php#1213). A doubled backslash rendered as a literal backslash AND freed the delimiter the first escape suppressed.
- **`carveToCarve` writes no `+` continuation marker where a block-attributes line already interrupts** (markup-carve/carve#1275).
- **A flattened block boundary keeps a separator** (markup-carve/carve#1325, PART 11 §1b). Two paragraphs flattened into a caption used to join into one word, and two emphasis or code runs into one holding the delimiters that ended them.
- **`fmt` writes a code fence with no space before its info string**, **no longer escapes into a run whose content is raw** (markup-carve/carve#1197, markup-carve/carve#1206), **writes a caret before a TAB bare**, **escapes a braced opener with no closer on its line**, **keeps a delimiter the calling converter handles brace-bare**, and **no longer over-escapes a definition list it did not parse**.
- **A value-less attribute is written as a boolean, and an attribute needs a separator before it** (#1025, #1029).

Importers:

- **An at-sign in source text is not a Carve mention** (markup-carve/carve-php#1380, ported), as a hash is not a tag.
- **The Markdown importer keeps the constructs Carve spells the way the source does**, **keeps a hard break and an indented code block** (#1015), **stays on CommonMark plus GFM**, and **makes no table from a pipe row that has no delimiter row** (markup-carve/carve-js#1061).
- **The Markdown importer converts a setext heading a block quote or a list item holds** (markup-carve/carve-js#1052), **reads a block-level HTML element inside a container as a block** (markup-carve/carve-js#1045), **re-bases a tab-indented fenced code block to its item's column**, **recognizes indented code inside a block quote**, and **writes a block held by a list item at that item's content column** (markup-carve/carve-js#1048).
- **`applyMigrationFixes` converts Djot's braced subscript instead of doubling its braces**, and **`djot-migrate` reports an intraword underscore instead of losing it silently** (#997).
- **The Markdown migration table documented the pre-dialect behavior**; it describes what the importer does now.

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

[Unreleased]: https://github.com/markup-carve/carve-js/compare/0.1.4...HEAD
[0.1.4]: https://github.com/markup-carve/carve-js/compare/0.1.3...0.1.4
[0.1.3]: https://github.com/markup-carve/carve-js/compare/0.1.2...0.1.3
[0.1.2]: https://github.com/markup-carve/carve-js/compare/0.1.1...0.1.2
[0.1.1]: https://github.com/markup-carve/carve-js/compare/0.1.0...0.1.1
[0.1.0]: https://github.com/markup-carve/carve-js/releases/tag/0.1.0
