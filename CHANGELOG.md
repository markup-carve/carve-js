# Changelog

All notable changes to carve-js are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Releases up to 0.1.6 are in [CHANGELOG-0.1.md](CHANGELOG-0.1.md).

## [Unreleased]

### Added

- Node identity, annotation range, and provenance sidecar APIs for AST JSON. Editor snapshots include session-scoped node identities, and `parseWithProvenance` measures top-level source bytes.
- `renderCarveWithConversionReport` names AST structures and fields that Carve source cannot spell.

### Fixed

- `applyAstPatch` rejects unknown operations and malformed pointers before applying a patch.

## [0.1.8] - 2026-09-25

### Breaking

- The serialized `footnote_ref` target field is `label`, not `id`, and ingest refuses the old wire spelling (#1965; markup-carve/carve#2213).
- `RenderLoss` is discriminated by `code`, and `format` exists only on a `raw-format-dropped` loss (#1972, #1980), so reading `loss.format` unconditionally no longer type-checks.
- `renderCarve` throws `SourceUnspellableError` for an empty emphasis-family mark instead of writing an empty brace pair, which read back as literal text (#1879, #1881). A mark whose content touches whitespace takes the braced form.
- AST ingest refuses a bare `table_row` at the document root and a `footnote_ref` with no target, and accepts a `citation` with no `pos` (#1960; markup-carve/carve#2197).
- A `citation` outside `citation_group.items` is refused at decode with `AstJsonMisplacedNodeTypeError`, instead of being accepted and throwing in a renderer (#1976).
- A generated-content `:::` kind decodes and re-encodes as `directive` rather than `admonition`, over the six kinds CARVE-P12-057 names (#2006; markup-carve/carve#2225).
- Every empty block container renders one blank HTML body line (#1934; markup-carve/carve#2184).
- The HTML importer's diagnostics cap emits a `diagnostics-truncated` row instead of throwing `HtmlImportLimitError`, which narrows to the depth and node limits (#2034, #2044).
- Twelve runtime symbols that never left their declaring module lost their `export` (#1916, #1917). None of them was reachable through the package's exports map.

### Fixes

- The Markdown target keeps every block a list item holds. A continuation line is
  padded from the item's marker rather than from a task item's checkbox, and a
  block below a nested list gets the blank line that stops GFM reading it as a
  continuation of the last sublist item (#2085).
- A node pulled in by a sliced include reports positions in its own file's coordinates (#1862).
- A reference definition reads its destination through the same `link_destination` production as an inline tail, and a still-open parenthesis leaves the line a paragraph (#1868, #1872).
- A tab does not satisfy a list or task marker separator, and a tab guards a bare delimiter on both sides (#1870, #1887).
- A fence's closer is searched for only inside the container that opened it, so a fence in a list item or a description body no longer reaches a later entry (#1880, #1883, #1890).
- A `:::` on an item's marker line whose body arrives by lazy folding stays text, and a closer at the content column does not rescue it (#1889).
- An empty term marker followed by a space folds into a description body like the bare marker (#1891).
- An escaped delimiter closes no braced pair, in all nine kinds, and leaves no stray hard break (#1897, #1902).
- A `%%` comment inside a bare emphasis run consumes the rest of the line, and the Carve writer braces such a span so it reads back (#1899, #1906).
- A `%%` line comment's content drops trailing spaces and tabs and the one leading space or tab that separates it from the marker, while a `%%%` block comment keeps its bytes and a no-break space survives either way (#2079; markup-carve/carve-rs#1951).
- A caption's `#` glued to the word before it is numbered where no tag name follows (#1900).
- A `boldItalic` strong takes the nested spelling when its content cannot sit against `/*` (#1877).
- An attribute block after an editorial substitution or comment stays literal text (#1876; markup-carve/carve#2138).
- The CLI runs when launched through a symlink, which is how `npx`, a `.bin` shim and a global install invoke it (#1909).
- A blank line inside a fence in a nested or sibling sub-list no longer loosens the outer list (#1938, #1951).
- `fromAstJson()` rejects an array in `figure.target` instead of handing renderers a malformed tree (#1959).
- A node-matrix position is validated one level deeper (#1994).
- Footnotes, citation definitions and code callouts are found inside nested sections and block table cells (#1985).
- A profile denial reaches `block_extension` and `directive`, which the vocabulary had no name for and `isTypeAllowed` therefore answered yes about, and ingest admits `line_block.lines` (#1984).
- The BBCode importer spells the four formatting tags the way the Carve writer would, escapes what a post's own text forms beside a converted tag, marks the links it writes, escapes a brace run or a line-initial block opener the author never typed, and writes a bare `>` for an empty or whitespace-only quote line instead of a marker with a trailing space (#1884, #1885, #1893, #1896, #1898, #1904, #2076).
- The Markdown importer writes tables, fences, list markers, nested quotes, continuation lines and reference definitions the way `carve fmt` does, so an imported document passes `fmt --check` (#1918, #1920, #1921, #1929, #1932, #1952).
- The Markdown importer reads item shapes, setext headings, indented code, tab columns, ordered interrupts and bold-italic nesting the way cmark-gfm does (#1935, #1937, #1941, #2049).
- The Markdown importer measures quoted lines from the item that holds them, keeps quoted item fences and lazy lines, and preserves an item's looseness (#1943, #1946, #1947).
- The Markdown importer drops an all-blank GFM table row and reports it as `structure-unspellable`, and fits each body row to the header's column count (#1919, #1920).
- The Markdown importer keeps a code block's blank lines, ends a paragraph run at an `=` setext underline, folds a link reference definition at any indent, and opens no false fence (#2002, #2003, #2009, #2017).
- The Markdown importer escapes a list marker only Carve recognizes, keeps a non-1 ordered marker after a lazy item line as text, moves link reference definitions to the document end, and keeps a shortcut reference's link (#1981, #1982, #1983).
- The Markdown importer keeps raw HTML blank lines and terminal newlines, retains a list item holding an empty-destination definition, and writes footnote definitions at the document end (#1990, #1991, #1992, #1993).
- The Markdown importer folds a quoted heading at any item depth, writes a folded block opener bare, and keeps a task box from opening a block (#2011, #2013, #2026).
- The Markdown importer respells a nested `+` bullet on the line that opens it, so `- + a` reads as two list levels rather than an item of prose (#2061).
- A task pair cmark-gfm reads as text stays text, in a quoted item and behind a second marker (#2047, #2048).
- A thematic run on a paragraph continuation line is escaped, and a doubled quote marker a list item holds is respelled (#2032, #2042).
- A block opener is read at the position its container gives it, and a quote's slack is read as the quote's, with intraword emphasis braced (#2037, #2039).
- A list's tight or loose shape survives the Markdown target: a tight item's separator is dropped above every opener that interrupts a paragraph and kept above one that underlines or glues instead, and a loose list is written loose (#2050, #2056).
- Tight nested lists survive Markdown output (#1968).
- `LinkPolicy` reads the host a browser reads (#2010).
- A denied-scheme destination is imported as its content rather than dropped (#2015; markup-carve/carve#2255).
- A raw-kept element reports its refused attributes, an attribute-preserved row reports preserved fidelity, and a style in kept bytes goes through the refusal policy (#2021, #2024, #2043).
- A style's `url()` arguments are read off the same comment-stripped, escape-decoded text the renderer's sanitizer acts on, so a row cannot name a refusal the renderer did not make (#2058).
- An imported table cell keeps multiline HTML on one Carve row, unwrapping what raw HTML would otherwise split the row on and reporting the flattening (#2054).
- An ordered task item keeps its checkbox as bracket text and reports the loss, from the HTML importer (#2053) and the Markdown importer (#2064), in one wording at both entry points (#2062).
- Pipe and list table span resolution agree, and a rowspan crossing a row-group boundary renders in one HTML body group (#1975, #1979).

### Improvements

- An include warning carries `includedBy`, the directives that pulled its file in, root first (#1956; markup-carve/carve-lsp#224).
- `carve lint` reports a fence opener that fell back to inline text, as rule `fence-opener-fallback` (#1914).
- `carve lint` reports a `::: footnotes` or `::: references` marker inside a container, which renders a plain typed div and places nothing, and takes `--extension citations` so the references rule is reachable from the command line (#2045, #2068).
- Directives retain quoted titles through the AST and render them inside the region they place (#2014, #2019, #2027, #2038).
- The versioned AST envelope is read and written (#1987, #1989).
- Ruby annotations survive interchange as ordered base and annotation pairs, with a `base(annotation)` fallback reported as `ruby-flattened` and accepted by `carve render --allow-loss` (#1972).
- `small_caps` is accepted as a structural inline node and rendered as native HTML (#1965).
- Labeled display equations receive numbers in caption order and render them on every target (#1969).
- AST JSON accepts explicit `section` blocks and block content in table cells, with the flattening reported on the targets that cannot hold them (#1971).
- Citation items carry `mode` through parsing and AST JSON, and HTML rendering uses each item's mode (#1973).
- A spanning table cell publishes its resolved extent (#1964).
- Parsed line blocks publish their inline lines beside `children` (#1988).

## [0.1.7] - 2026-09-18

### Changed

- **BREAKING:** Migration reports move to schema version 2 (#1671, #1673). `carried` is renamed `preserved`, `normalized` marks semantics-preserving rewrites, opaque `raw-preserved` content counts as `degraded`, and the diagnostic `code` type widens for cross-importer codes. Markdown, Djot and BBCode emit an explicit fallback finding, so an empty diagnostics array no longer means verified fidelity.
- **BREAKING:** The migration CLI writes version 2 reports for every importer, and `--check-loss` exits 1 only when a report holds degraded or dropped content (#1671).
- A missing include target's dependency id names where the file would be (#1781): `fileSystemResolver` answers `{ source: null, id }` with the canonical path instead of `null`, and a path escaping the root keeps its spelling.
- A mention or tag URL that the denylist refuses renders the inert span (#1769) instead of an anchor with an empty `href`, even when general URL sanitization is off.
- The Markdown target spells emphasis and strike differently in several shapes (#1683, #1692, #1707, #1711, #1718, #1730, #1732, #1737, #1738, #1740, #1752, #1753, #1754, #1760; markup-carve/carve#2043, markup-carve/carve#2045, markup-carve/carve#2046). Padding moves outside the delimiters and whitespace-only content falls back to inline HTML, as does a run that cannot flank or that merges with a neighbor (the second of two abutting runs, a nested child of the same strength), and a literal tilde or an underscore pair a reader would take as emphasis is escaped. Rendered bytes change; what a reader gets back does not.
- `carve fmt` writes several shapes the way the other engines do (#1663, #1680, #1686, #1731, #1749; markup-carve/carve#1970): a tight item's opening block stays on the marker line, trailing item content continues at two spaces, a first line drops the marker-column tag, a comment below a sub-list keeps its column, and a span whose bare opener cannot open is braced.
- The native `|=` header form survives a trailing colspan run (#1747) in the Carve writer and the HTML importer; a leading span or a real cell after a header span still uses the delimiter row.
- A raw-HTML profile error names the Carve construct it refused (#1724) instead of the HTML it produced.
- `renderCarve` throws `SourceUnspellableError` for an empty code span its open run cannot end at (#1789), and the HTML importer drops such a span with a `structure-unspellable` warning and trims the whitespace behind a span it keeps (#1796).
- A hard break inside a table cell is written as one space (#1797, #1803; markup-carve/carve#2067) instead of ending the row, and the HTML importer reports the flattened `<br>` as `structure-unspellable`.
- `renderCarve` throws `SourceUnspellableError` for a span inside a span of the same kind with no braced span of another kind between them (#1804, #1817, #1831, #1841, #1849; markup-carve/carve#2066, markup-carve/carve#2078, markup-carve/carve#2091), and the HTML importer unwraps the inner element with a `structure-unspellable` warning. A braced span starts a scope of its own, so `/a {*b /c/*}/` keeps all three levels and the HTML importer writes `<p>a<em>b<strong>c<em>d</em></strong></em>e</p>` as `a{/b{*c{/d/}*}/}e` with no report.
- `renderCarve` throws `SourceUnspellableError` for a mention or tag glued to a word character on either side (#1807), which no parse builds.
- `renderCarve` throws `SourceUnspellableError` for a mention or tag carrying attributes (#1820; markup-carve/carve-php#2083) instead of dropping them.
- `renderCarve` throws `SourceUnspellableError` for a mention or tag whose name the grammar rejects (#1851; markup-carve/carve-php#2159): a space, an apostrophe, an outer or doubled dot, or a non-ASCII letter. It used to delete those characters and write a different name.
- `renderCarve` throws `SourceUnspellableError` for a table row whose every cell is blank (#1822), and the HTML importer drops the row with a `structure-unspellable` warning; a table, and its caption, goes only when no row survives.
- An opener of an emphasis kind that is already open is content, in the forced `{X X}` form as in the bare one (#1831; markup-carve/carve#2078): `*a {*b*} c*` and `{*a *b* c*}` no longer nest.
- A code span's closer is searched for across the rest of the block (#1828; markup-carve/carve#2079), so a forced or editorial closer inside the span is code.
- **BREAKING:** A `substitution` carries its two halves as `old` and `new`, arrays of inline nodes, in place of the `oldText` and `newText` strings (#1827; markup-carve/carve#2083). `{~/old/~>/new/~}` emphasizes both halves, each half takes part in resolution and carries positions, and an ingest refuses the old fields.
- A `{~ ~}` pair is a substitution only at a top-level `~>` (#1827; markup-carve/carve#2083); an arrow inside code, math, an inline literal, a comment or an escape leaves a forced strike.
- An emphasis kind open outside a braced span is open again inside it (#1841; markup-carve/carve#2091): a closer inside a braced pair cannot close an outer one, and `*a {/b *c* d/} e*` keeps its inner strong.
- An unclosed code span, math run or inline literal ended at a forced or editorial closer keeps its line break inside a line block (#1842; markup-carve/carve#2089).
- The HTML import report lists an element's own row before the rows for its attributes (#1839), the order markup-carve/carve-php#1737 settled.
- The Carve writer adds no escape inside an editorial comment's text, whose content is literal, and refuses one holding a closing brace (#1847).

### Added

- `carve --report-includes FILE` (#1774) writes the complete include dependency list as JSON; resolvers can classify refusals with `IncludeUnresolved.denial`. The Node filesystem resolver now returns that unresolved object instead of `null` for denied targets.
- `resolveMention` and `resolveTag` (#1769) map social tokens through host data, keeping the inert fallback and URL-scheme checks.
- `migrateBbcode()` (#1671) returns BBCode conversion in the shared migration result envelope.
- Include expansion (#356, #1694, #1701, #1733). `expandIncludes()`, `carve flatten`, `findDirectiveSites()`, and rendering a tree the host already holds; an included child is parsed with the caller's extensions.
- Importer fidelity diagnostics (#1671, #1673). Every importer classifies each construct as preserved, normalized, degraded or dropped, with a confidence.

### Fixed

- Footnote bodies claim the right lines (#1653, #1664, #1666, #1667). A nested definition keeps its authored column, a trailing line falls to the reachable note, and a column-0 line after a description-hosted note is a top-level sibling (markup-carve/carve#1946, markup-carve/carve#1971, markup-carve/carve#1974).
- A bare delimiter pairs across only what PART 9 §9 E2a names (#1726, #1729, #1746, #1751, #1762; markup-carve/carve#2027, markup-carve/carve#2046). Code spans, raw inlines, braced inlines, link destinations and autolinks are opaque; plain braces, attribute blocks and link labels are not.
- An attribute block after an escaped character stays literal (#1771): `x\*{a}` renders `x*{a}` instead of dropping `{a}`.
- A link, image or span after a backtick an earlier construct used up is read (#1815), where the paragraph's later brackets used to stay literal.
- Include resolution refuses what it cannot contain (#1690, #1702, #1703, #1704, #1714): a blank or relative root is refused, a directive closes at the first pair outside a quoted run, the byte budget counts what was read, and every filesystem denial reaches the caller as a warning.
- An inline include leaves one text run and one span (#1739, #1741), and host text cut around it publishes only its own span (#1764).
- The Djot importer keeps Djot-only block markers and document structures (#1669, #1670).
- The BBCode input limit is measured in UTF-8 bytes (#1672).
- A hash is escaped on the Markdown target where the line would open or close an ATX heading (#1768, #1779), including an unnumbered caption placeholder (#1767).
- The Carve writer round-trips three more shapes (#1759, #1763, #1773): an emphasis wrapping a strong, a caret before an escaped closing brace, and an emphasis ending in an empty code span.
- The HTML importer keeps a space after an element that ends in a `<br>` (markup-carve/carve-rs#1706), as carve-php and carve-rs do: `<p>a <strong>x<br></strong> b</p>` no longer loses the space before `b`.
- The Carve writer escapes a caret before a node written with `[`, and a dollar before a backtick run or inline math (#1795). A caret before an imported link no longer reads back as an inline note.
- The Carve writer escapes the colon of a text-final `:name` before a node written with `[` (#1808), so it no longer reads back as an inline extension.
- The Markdown importer writes a link with an empty destination as its text and an image as its plain alt text (#1800, #1811), since Carve reads `[x]()` as literal text. A title keeps a span, a reference to an empty-destination definition is unwrapped and the definition dropped, and spaces around an inline destination are no longer percent-encoded.
- The Markdown importer keeps a lazy continuation line in its block quote and escapes a continuation line shaped like a link definition (#1812), which Carve would otherwise read as a definition and drop.
- An emphasis ending in a hard break keeps its closer (#1786) in the Carve writer and the HTML importer.
- A hard break at the edge of an inline construct in a table cell keeps its space (#1856; markup-carve/carve#2067, markup-carve/carve-php#2172). Only a break that is a direct child at the cell's edge writes nothing, so `<td><ins><br></ins></td>` is written `{+ +}` rather than the empty brace pair `{++}`, which reads back as literal text.
- Two touching backtick runs, such as adjacent code spans, are separated by an empty comment `{%  %}` (#1818, #1833) in the Carve writer and the HTML importer, instead of merging into one span.
- The Markdown importer ends a fence in a list item where the item ends (#1823), measures a fence's indent from its item's content column (#1825), and writes a fence on an item's first line as code without converting its body (#1836).

[Unreleased]: https://github.com/markup-carve/carve-js/compare/0.1.8...HEAD
[0.1.8]: https://github.com/markup-carve/carve-js/compare/0.1.7...0.1.8
[0.1.7]: https://github.com/markup-carve/carve-js/compare/0.1.6...0.1.7
