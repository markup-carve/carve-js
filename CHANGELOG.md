# Changelog

All notable changes to carve-js are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Releases up to 0.1.6 are in [CHANGELOG-0.1.md](CHANGELOG-0.1.md).

## [0.1.9] - 2026-09-30

### Fixes

- `lintCarve` no longer reports `unattached-block-attribute` on the `{empty}` sentinel, the spelling PART 11 §7b and §7d define for an empty footnote definition body and an empty description body. An attribute block that reaches no block is still reported (#2408).
- Markdown import resolves a reference chain against the definitions that exist, and reads a definition whose label is escaped or spans lines and whose title carries parentheses or spans lines (#2409; markup-carve/carve#2522, markup-carve/carve#2593).
- Markdown import keeps a bracketed autolink's destination and the parentheses inside it, and keeps tab residue and nested quote markers inside a quoted block (#2409; markup-carve/carve#2522).
- An editorial substitution is bounded by the bracket run that encloses it (#2409; markup-carve/carve#2645).

### Improvements

- Reduced position-removal time by visiting children before deleting fields. Container lexers share immutable line arrays, ordinary Unicode text uses the plain-text inline paths, and reference resolution avoids redundant passes and replacement arrays. Short deep-quote scaling guards use longer timing batches without relaxing their threshold. See the [paired measurements](reports/parser-next-five.md) (#2407).
- Reduce position-removal key arrays, definition prepasses on ordinary bracket text, unused container maps and plain-paragraph scanner setup. The [follow-up measurements](reports/parser-followups.md) include CPU and allocation profiles, definition controls and multiple nesting depths (#2390, #2391, #2392, #2393).

## [0.1.8] - 2026-09-29

### Breaking

- `code_block.content` is the payload's literal text, so a nonempty payload keeps the break before its closer and one that ends mid-line keeps none, on every target and in an extension fragment (#2373, #2383).
- The serialized `footnote_ref` target field is `label`, not `id`, and ingest refuses the old wire spelling (#1965; markup-carve/carve#2213).
- `RenderLoss` is discriminated by `code`, its enum closes at `raw-format-dropped` and `ruby-flattened`, and `carve render --allow-loss` accepts two code names where it accepted six (#1972, #1980, #2111; markup-carve/carve#2252).
- A dropped table-section attribute, a flattened table cell's blocks, a dropped math label or number and a flattened section are reported as conversion diagnostics instead (#2111).
- `renderCarve` throws `SourceUnspellableError` for an empty emphasis-family mark instead of writing a brace pair that read back as text; a mark whose content touches whitespace takes the braced form (#1879, #1881).
- `renderCarve`'s minimal form escapes a lone bracket inside span, link or inline note content and drops idle escapes, so documents that already round-tripped emit different bytes (#2118; markup-carve/carve#2358).
- The Markdown writer separates a table cell's blocks with a space instead of joining them with a break tag (#2119, #2126).
- AST ingest refuses a bare table row at the document root, a footnote reference with no target, a citation outside a citation group and a directive without children, and accepts a citation with no position (#1960, #1976, #2097; markup-carve/carve#2197, markup-carve/carve#2333).
- A generated-content `:::` kind decodes and re-encodes as a directive rather than an admonition, over the six kinds the spec names (#2006; markup-carve/carve#2225).
- Every empty block container renders one blank HTML body line (#1934; markup-carve/carve#2184).
- The HTML importer's diagnostics cap reports a truncation row instead of throwing, and the error it threw now covers only the depth and node limits (#2034, #2044).
- An escaped space and a preserved line-block column are their own node kind, and U+E000 is literal content everywhere, so a stored tree using U+E000 for a generated space must be reparsed from source (#2100; markup-carve/carve#2337).
- Twelve runtime symbols that never left their declaring module lost their export; none was reachable through the package's exports map (#1916, #1917).

### Fixes

- Braced formatting spans respect bracket-run boundaries. HTML import now escapes crossing brackets beside reference-link shapes on the first pass, so its output formats to itself (#2400, #2401).
- Reduce HTML eligibility scanning, definition-prepass work, nested lexer allocation and text-position passes (#2389). Long interior whitespace runs no longer trigger repeated regex backtracking. See the [measurements](reports/parser-costs.md).
- A container label's trailing `%%` comment is cut where its own inline run ends, so a `%%` inside a closed construct keeps the construct and the text after it (#2372).
- Markdown import keeps list item shapes, tightness, markers and task boxes as a GFM reader sees them (#1935, #1937, #1941, #1943, #1946, #1947, #1968, #1981, #1982, #2011, #2013, #2026, #2047, #2048, #2050, #2056, #2061, #2295, #2314).
- Markdown import preserves inline text: emphasis, quotes, character references, escaped backticks, terminal backslashes, autolink escapes and the whitespace a heading holds (#2285, #2288, #2290, #2319, #2323, #2324).
- Markdown import preserves links: boundaries, reference targets and fallback, URL encoding, destination parentheses, parenthesized and multiline titles, and case-folded reference labels (#1983, #2294, #2296, #2299, #2321, #2322).
- Markdown import keeps code and fences: payload whitespace, blank lines, line endings in a code span, decoded language labels, and a hint it cannot validate is omitted whole rather than shortened to a different language (#2002, #2017, #2297, #2302, #2331; markup-carve/carve#2522).
- Markdown import reads headings, HTML blocks and inline HTML the way CommonMark does, retaining an empty heading as raw HTML (#2003, #2009, #2303, #2304, #2315, #2320).
- Markdown import writes tables, quotes, thematic runs and reference definitions the way `carve fmt` does, so an imported document passes `fmt --check` (#1918, #1919, #1920, #1921, #1929, #1932, #1952, #1990, #1991, #1992, #1993, #2032, #2037, #2039, #2042, #2049).
- Djot import preserves escaped delimiters in emphasis, attributes attached to words, folded heading continuations and a malformed hashtag attribute as text (#2291, #2303, #2318, #2329).
- HTML import keeps what an element holds: an unsupported wrapper is unwrapped in place, a formula with no TeX is read as its text, and a cell keeps its alignment and its multiline content (#2015, #2054, #2104, #2120, #2122, #2137, #2147, #2160, #2169, #2172, #2175, #2194, #2203, #2309; markup-carve/carve#2255, markup-carve/carve#2341, markup-carve/carve#2361).
- HTML import recognizes explicit code-language hints on code blocks and on Sphinx, GitHub and MediaWiki wrappers, with validated tokens and a deterministic fallback (#2143; markup-carve/carve#2387).
- HTML import reports what it refuses or preserves in one wording at every entry point, over raw-kept elements, retained attributes, style URLs and ordered task checkboxes (#2021, #2024, #2043, #2053, #2058, #2062, #2064, #2206, #2226).
- HTML import leaves a link's or span's edge whitespace outside it, drops an empty list rather than writing an attribute line with no block, drops an empty heading, and joins two adjacent definition lists the source spells as one (#2120, #2127, #2135; markup-carve/carve#2365, markup-carve/carve#2367).
- BBCode import spells formatting tags the way the Carve writer would, escapes what a post's own text forms beside a converted tag, and writes a bare marker for an empty quote line (#1884, #1885, #1893, #1896, #1898, #1904, #2076).
- The Carve writer emits source that reads back as the tree it was given, over text runs, figures, link padding, autolinks, line-block text, attributes inside emphasis and whitespace Carve cannot spell (#2134, #2136, #2145, #2151, #2156, #2171, #2174, #2217, #2244, #2282, #2367).
- The Carve writer escapes a link-shaped run's opening destination parenthesis, including around emphasis, and no longer rescans an unclosed destination to the end of the input (#2114, #2115; markup-carve/carve#2357, markup-carve/carve#2359). Where a bracket pair crosses a formatting span, its opening bracket is escaped and the destination parenthesis is not, whatever spelling the crossed span takes, and a nested crossing pair's closer is escaped too, so the import re-reads as the document it was given (#2397, #2399).
- The Markdown writer emits what a GFM reader reads, over block cells, quote markers, cell breaks, list-tables, frontmatter and a link whose fragment names no heading (#2113, #2116, #2121, #2130, #2138, #2144, #2146, #2149, #2150, #2158, #2166, #2170, #2254; markup-carve/carve#2363).
- The Markdown target keeps every block a list item holds, padding a continuation line from the item's marker and separating a block below a nested list (#2085).
- A comment keeps its payload, its span and its owner inside every container: a list item, a quoted item, a definition term, a description body and a nested marker (#2185, #2202, #2262, #2270, #2280, #2287, #2298, #2300, #2312, #2327, #2335, #2354, #2360, #2376, #2382).
- A fence is measured from the base its own container gives it, so a closer, a payload line and a below-column run land in the block that owns them (#2201, #2208, #2213, #2220, #2223, #2224, #2242, #2256, #2257, #2258, #2265, #2266, #2284, #2361, #2364), and rebasing an item leaves code, raw and comment boundaries alone where an over-indented quote marker follows an opaque head (#2386).
- A fence's closer is searched for only inside the container that opened it, a fenced quote's explicit closer is inside its source span, and a `:::` on an item's marker line whose body arrives by lazy folding stays text (#1880, #1883, #1889, #1890, #2345).
- A quote keeps its nested state across lazy paragraph lines, and a lazy line no longer closes a fence it was spliced into or continues past a container fence (#2268, #2274, #2277, #2325).
- A definition term folds an indented block opener, a comment and a definition past its column at every depth, an empty term marker followed by a space folds like the bare one, and a description body ends at two blank lines (#1891, #2161, #2185, #2221, #2306, #2317; markup-carve/carve#2411).
- A container label closes on a balanced bracket in both spellings and publishes its inline run, and emphasis is bounded by the bracket run around it (#2347, #2349, #2356, #2362, #2366).
- A blank line inside a fence, a note body or a sub-list no longer loosens the list that holds it, and an item's tightness is read at every column its paragraph text reaches (#1938, #1951, #2235, #2241, #2332, #2339, #2344, #2346, #2358, #2363).
- A list item's content column is measured from the marker, not from a block attached to it (#2131, #2142).
- A whitespace-only code line keeps its content in a list item and a footnote body, measured from the fence opener (#2196, #2201).
- An unfinished code fence keeps its trailing blank lines on every target, ANSI included, and an empty raw block keeps its line (#2328, #2353, #2357, #2365, #2370).
- An escaped delimiter closes no braced pair, in all nine kinds, and leaves no stray hard break (#1897, #1902).
- A `%%` comment inside a bare emphasis run consumes the rest of the line, and the Carve writer braces such a span so it reads back (#1899, #1906).
- A `%%` line comment's content drops trailing whitespace and one leading separator, while a `%%%` block comment keeps its bytes and a no-break space survives either way (#2079; markup-carve/carve-rs#1951).
- A reference definition reads its destination the same way an inline tail does, and a still-open parenthesis leaves the line a paragraph (#1868, #1872).
- A tab does not satisfy a list or task marker separator, and a tab guards a bare delimiter on both sides (#1870, #1887).
- A caption's `#` glued to the word before it is numbered where no tag name follows (#1900).
- A bold-italic strong takes the nested spelling when its content cannot sit against the delimiter (#1877).
- Attribute blocks reject unquoted values containing pipes, backslashes or quotes, fold a class key-value into the class slot, contribute no token for an empty or refused class, and stay literal text after an editorial substitution or comment (#1876, #2191, #2192, #2193, #2199; markup-carve/carve#2138).
- Source positions count lone surrogates separately, reach a tab stop by codepoints, and map text after a BOM or a lone carriage return against the original source (#2139, #2178).
- A retained marker in a nested list and a line block holding a tab keep their source offsets, a generated verse column stays unplaced, and an authored attribute named `pos` survives a position walk (#2108, #2110, #2179, #2377).
- A node pulled in by a sliced include reports positions in its own file's coordinates, and the CLI runs when launched through a symlink, which is how a global install and a package runner invoke it (#1862, #1909).
- Footnotes, citation definitions and code callouts are found inside nested sections and block table cells, and the reference and abbreviation passes reach extension content, ruby pairs and citation fields (#1985).
- A profile denial reaches block extensions and directives, which it used to answer yes about; ingest admits a line block's lines, and a link policy reads the host a browser reads (#1984, #2010).
- Pipe and list table span resolution agree, and a rowspan crossing a row-group boundary renders in one HTML body group (#1975, #1979).
- A structural wrapper class trails the attributes the author wrote instead of leading them (#2096, #2099; markup-carve/carve#2328).
- Parser options and caches belong to each call, so a failed option getter leaks no quote setting and nested calls use their own options.
- `applyAstPatch` rejects unknown operations and malformed pointers before applying a patch (#2091).
- AST JSON ingest and export handle lists with hundreds of thousands of items without overflowing the argument stack (#2153, #2159).
- `fromAstJson` rejects an array in a figure's target and validates a node-matrix position one level deeper (#1959, #1994).
- A figure in a table cell keeps its caption order, an ingested cross-reference keeps its text, and an empty grouping label writes nothing (#2249, #2271). A `::: list-table` whose grouping label the extension does not consume renders that label above the table instead of dropping it (#2387, #2388).
- The indentation lint names an over-indented fence opener with a glued info string, including unterminated fences (#2341).
- The term-fold lint measures a BOM's width and skips verbatim spans, and the fence-ownership and nesting-cap diagnostics agree with the parser, as do the formatter's own (#2165, #2218, #2249, #2301).

### Improvements

- `carve lint` reports a fence opener that fell back to inline text, and a `::: footnotes` or `::: references` marker inside a container that places nothing; `--extension citations` makes the references rule reachable (#1914, #2045, #2068).
- `renderCarveWithConversionReport` names the AST structures and fields Carve source cannot spell (#2091).
- Node identity, annotation range and provenance sidecar APIs for AST JSON, with session-scoped identities in editor snapshots and top-level source-byte measurement in `parseWithProvenance` (#2091).
- Editor sessions reuse unchanged blocks for supported plain-paragraph edits and report semantic changes; session AST snapshots are deeply frozen, so clone one before annotating or editing (#2232, #2234).
- Annotation offsets use a fixed codepoint projection independent of JSON key order, over image alt text, math, breaks and generated spaces (#2100).
- The versioned AST envelope is read and written (#1987, #1989).
- Directives retain quoted titles through the AST and render them inside the region they place (#2014, #2019, #2027, #2038).
- Ruby annotations survive interchange as ordered base and annotation pairs, with a flattened fallback that `carve render --allow-loss` accepts (#1972).
- Small caps is accepted as a structural inline node and rendered as native HTML (#1965).
- Labeled display equations receive numbers in caption order and render them on every target (#1969).
- AST JSON accepts explicit section blocks and block content in table cells, with the flattening reported on the targets that cannot hold them (#1971).
- Citation items carry their mode through parsing and AST JSON, and HTML rendering uses it (#1973).
- A spanning table cell publishes its resolved extent, and parsed line blocks publish their inline lines beside their children (#1964, #1988).
- Table heads, bodies and feet keep their attributes through AST exchange and HTML import, with the other targets reporting what they cannot represent (#2103; markup-carve/carve#2339).
- A list-table can be imported as a table rather than a list (#2149).
- An include warning carries the directives that pulled its file in, root first (#1956; markup-carve/carve-lsp#224).
- `fromAstJson` accepts unknown input and validates it before decoding (#2173).
- The escape narrowing search probes a pruned window instead of re-rendering the document, with byte-identical output: re-parsed source over ten benchmark pages falls from 42.3 MB to 16.4 MB (#2109, #2112, #2118, #2154, #2162, #2164, #2182, #2184, #2279).
- Parsing does less repeated work on containers, definitions, quotes and lists: tail matching, prefix classification, lazy-continuation tracking and sentinel scans run only where their answers are used (#2167, #2225, #2252, #2259, #2260, #2276, #2375, #2378, #2379).
- HTML rendering streams through a bounded buffer (#2232).

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

[0.1.9]: https://github.com/markup-carve/carve-js/compare/0.1.8...0.1.9
[0.1.8]: https://github.com/markup-carve/carve-js/compare/0.1.7...0.1.8
[0.1.7]: https://github.com/markup-carve/carve-js/compare/0.1.6...0.1.7
