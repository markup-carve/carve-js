# Changelog

All notable changes to carve-js are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Releases up to 0.1.6 are in [CHANGELOG-0.1.md](CHANGELOG-0.1.md).

## [Unreleased]

### Breaking

- Image alt text resolves ASCII punctuation escapes, including `\|` in
  tables. Literal backslashes before punctuation must be doubled. Native
  writers preserve the decoded value when formatting.

- The include rename warning reports `include-id-rename`, replacing `include-heading-id-rename`. The pass covers explicit ids on any element, so the old id named only part of what it reported (markup-carve/carve#2772).

### Fixed

- An include rename no longer rewrites a `</#id>` cross-reference that resolves to nothing when the included file is read on its own. `</#id>` reaches headings, so one naming a renamed paragraph, span or other element is authored literal text and stays as written; link and image destinations still follow the rename (#2564).

### Performance

- Replaced repeated whitespace searches in parsing, HTML import, writers, URL checks, lint, migrations and code callouts with linear scans. Leading HTML text nodes are removed in one slice; Djot bullet detection keeps its diagnostic and edit spans while avoiding repeated lookbehind scans.

## [0.1.10] - 2026-10-06

### Compatibility and migration

With the new engine, lint existing documents before deploying their output.
`fmt --migrate` repairs unambiguous case-only reference misses. Review changes
to collapsed link text and image alt text; include selectors, glossary
references and external fragment links need manual review. See the
[migration guide](https://github.com/markup-carve/carve-js/blob/main/docs/cli.md#exact-case-reference-migration).

### Breaking

- Heading cross-references, numbered caption and equation references, and collapsed
  references that fall back to heading text now compare case exactly.
  Link-definition labels, footnote labels and include fragment selectors already
  did in the previous published engine.
  A case-only mismatch is unresolved; `{#Tip}` and `{#tip}` identify separate
  targets. Default heading slug derivation, whitespace normalization and NFC are unchanged (#2520; markup-carve/carve#2732).
- An include renames a colliding explicit id on any element, not only a heading id or a footnote label, and an include fragment selects any block carrying that id. The first occurrence in expanded order keeps the name, each later copy takes its own least free `-N` suffix with a warning, and a reference written in the same inclusion follows the rename (#2512; markup-carve/carve#2727, markup-carve/carve#2729).
- A glossary reference matches its term exactly, under the same comparison as every other name lookup, and a glossary id keeps its case, so two terms differing only in case take two ids and a reference links to the entry it matched (#2524, #2525; markup-carve/carve#2739).
- A destination the URL scheme denylist blanks takes one render-loss row under the new code `destination-denied`, on every target that emits a destination, carrying the normative message `Blanked a denied destination scheme` for a link or an autolink and `Blanked a denied image source` for an image. `RenderLossCode` has a third member, `carve render --strict-losses` fails on a document that holds such a destination, and `--allow-loss` will not waive the code (#2432, #2433, #2435; markup-carve/carve#2679, markup-carve/carve#2681, markup-carve/carve#2686).

### Fixes

- The upgrade guide distinguishes newly exact lookups from labels that already
  matched case exactly, and explains migration limits. Tests keep case-distinct
  numbered captions and equations separate (#2553).

- AST merges and patches intern subtree comparisons once and build paths only for conflicts or operations. Provenance ancestry, line-block boundaries and envelope extension checks use indexes instead of repeated scans (#2551).

- A list item ends on a block the author wrote past its content column. An
  over-indented heading, table row or thematic break classified as prose and
  left an open paragraph, so the flush-left line below folded into the item as
  text; that line is now the document's own paragraph, and a nested marker's
  own content column is no longer read as an authored over-indent
  (#2542, #2548).
- A description body folds a flush-left line below it whatever block kind its nested lead carries (#2534).
- A flush-left line below a description item's content column is the item's lazy continuation and no longer opens a block of the body's own (#2539; markup-carve/carve#2535).
- A description body ends when the quote holding its nested list ends (#2541; markup-carve/carve#2540).
- An over-indented block below a quote that has stopped collecting is no longer read as quoted prose; the quote releases the lines under it (#2538; markup-carve/carve#2536).
- A flush-left fence line below a closed nested fence in a description body is read as the body's content, and a terminated fence at that column ends the body, for a bare run and a language-tagged one alike (#2514, #2516; markup-carve/carve#2741).
- A repeated heading is selected by its deduplicated slug, so a cross-reference to the second heading of the same text reaches it (#2511; markup-carve/carve#2506).
- The fold is recorded for every declared node type outside the vocabulary, not only the types the vocabulary names (#2508; markup-carve/carve#2499).
- The bbcode importer escapes the smart punctuation a post's own text forms, so an authored quote or dash is not re-read as a Carve construct (#2513; markup-carve/carve#2509).
- `fmt --migrate` rewrites a case-only reference against the rendered heading ids rather than the authored text, and treats a reference image's label like a link's, so `![a][Label]` migrates with `[a][Label]` (#2526, #2528; markup-carve/carve#2522, markup-carve/carve#2523).
- `lintCarve` reports a reference image with no matching definition under `unresolved-reference-link`, the rule that already covered reference links. `![alt][label]` and `![alt][]` take the same case-only hint under no new rule id (#2533; markup-carve/carve#2740).
- `lintCarve`'s `broken-fragment-link` rule reads ids off the caller's own render, carrying the extensions passed to the linter, so a link absent from that render is not checked (#2503; markup-carve/carve#2730, markup-carve/carve#2731).
- Canonical Carve output keeps the parentheses and backslashes inside a denied URL scheme, so formatting `[x](javascript:alert(1))` no longer rewrites the destination to `javascript:alert%281%29` (#2438; markup-carve/carve#2685).
- The Carve writer leaves a backslash single inside a quoted attribute value, a quoted title and bibliography metadata when the character after it is not ASCII punctuation, so a title of `t\zu` no longer reads back one character short (#2414).
- The Carve writer preserves bare emphasis inside a link label when the text around the label carries the same emphasis kind (#2424; markup-carve/carve#2522).
- `resolve()` coalesces adjacent text in substitution arms, citation fields, definition-list terms and descriptions, figure targets and short captions, so a tree built in code no longer keeps split text in those places (#2437).
- A verse fence's closer is read in the container that opened it, so a quoted, list-marked, indented or wider literal fence inside a verse stays text instead of registering its lines as reference definitions. A malformed `:::|` opener is no longer accepted (#2439).
- A reference definition's source position is correct after a CRLF or CR line ending and after a leading BOM (#2429).
- `lintCarve` reports `list-item-block-overindented` once, on the block's first line, and a table or quote continuation shares its opener's finding (#2416; markup-carve/carve#2643).
- `lintCarve`'s `unattached-block-attribute` no longer advises deleting a footnote or description body that holds nothing but an attribute block. PART 11 §7d makes the report itself correct there, but a bare marker is not a marker, so deleting the line drops the `<dd>` and turns a footnote definition and its references into text. The message now points at the `{empty}` sentinel that `fmt` writes. Reported lines and columns are unchanged (#2412).
- Markdown import keeps a reference label's raw identity and first-definition priority, keeps a heading, quote, HTML block or interrupting list marker out of a multiline title, accepts an escaped title delimiter, and falls back to the destination when a title on the following line is invalid. A nested quote held by a list item stays intact (#2411; markup-carve/carve#2522, markup-carve/carve#2593).
- Markdown import keeps inline links and references when later paragraph text resembles a reference definition (#2415).
- Markdown import keeps CommonMark emphasis inside a resolved link label, keeps a span that crosses an unresolved bracket, keeps a lazy line in an open quoted paragraph when the line below resembles a setext underline, and classifies a thematic break at the container column it reaches (#2418).
- Markdown import keeps the brackets and destination of an outer link that an inner link deactivates as text, while an image label stays active, and keeps a blank empty list item with its siblings (#2423).
- Markdown import keeps a quote followed by a fence inside its list item without inserting a blank line, and keeps the sibling items after the fence tight (#2419).
- Markdown import keeps the source indentation after an empty list marker, so a heading, fence, nested list or indented code below it keeps its block boundary, and tight siblings keep their spacing (#2425).
- Djot import pairs emphasis by Djot's own delimiter ownership and converts orphan attributes, empty definition fences, image alt text and reference links in their source context, while code, destinations and fenced metadata stay opaque and a paragraph boundary stops delimiter matching (#2427; markup-carve/carve#2522).
- Djot import keeps a code fence opaque when ordinary prose such as `Mr. Smith` precedes an indented fence, recognizes Djot's numeric, single-letter and Roman list markers, and tracks each enclosing quote separately so a quote inside a list keeps the item's ownership (#2428; markup-carve/carve#2522).
- Reserve table head, footer, document, and trailer ids before assigning heading ids in constructed trees (#2490).
- Keep footnote labels and attribute names that match position-field names when positions are disabled (#2489).

- Keep reference definitions inside code samples literal when a mixed backtick/tilde run appears in the payload (#2484).

- Preserve multiple table bodies, intermediate body headers, empty bodies, and per-body row-header counts with positional source attributes. Keep authored conflicts and report partition loss (#2453, #2462, #2463, #2468, #2469, #2470).

- Preserve source-spellable table heads, single bodies, and footers during canonical conversion and HTML import. Diagnose conflicting column attributes and keep fractional widths exact through percentage conversion. Keep decimal percentages precise in HTML output (#2460).
- Report explicit table row groups dropped by canonical source conversion as a `field-unspellable` diagnostic for `rowGroups` (#2457, #2459).
- Share schema child slots across AST conversion, diffs, sidecars, and text coalescing. Diffs report edits inside substitution arms, citation fields, short captions, and extension fallbacks at their child paths. AST depth checks cover singleton children (#2442).
- Keep literal verse definitions consistent through lazy list continuations and attached opaque spans (#2442).
- A colon closer inside a closed code or comment span stays inside verse, matching the executable spec (#2442).
- A list marker payload keeps Unicode separator characters during parsing (#2488).
- A citation group matches its items without treating an escaped character as an item marker, and a citation bracket map stays inside the parse context that built it (#2450, #2452).
- A container whose opener metadata is invalid is recovered instead of dropped, a migrated fence closer is preserved including on a marker line, and an authored Djot fence is classified with its nested structure intact (#2447).
- A header flag dropped on a table span placeholder is reported as a conversion diagnostic instead of being lost silently (#2464).

### Improvements

- Track description-body closers and literal colon lines incrementally instead of repeatedly scanning growing bodies (#2555).
- Speed up editor batches with many edits and empty-include linting across many inline spans (#2544).
- Avoid repeated scans of malformed links, attributes, references and footnotes (#2543).
- Speed up source-layout export, editor attribute mapping and AST merges on large documents, and recognize editor attribute lines after bare CR endings (#2543).
- Bound large AST diff matching while preserving single-move detection. Matching choices can differ for large edits with repeated content (#2543).
- Preserve platform-lint offsets after astral characters (#2543).
- Index list-table spans and imported table groups (#2529).
- Retain delimiter tables across inline frames and index repeated inline scans (#2518).
- Lighten the line-ownership probe and the codepoint position walk (#2501).
- Stop rescanning a deep line's indent in the list-marker tests, which bounds the nesting-cap cost at a constant per level (#2502).
- `carveToHtml` renders a document whose reference definitions sit in one adjacent run through the HTML fast path instead of the full AST pipeline, and reference-definition parsing reuses indexed line starts and successful lexical matches rather than rescanning the preceding lines. A definition line with an escaped title or an unsupported layout still takes the full parser. See the [measurements](reports/reference-definitions.md) (#2429).
- Skip cycle-set and schema lookup work for text-only arrays during document ID collection. IDs added after resolution still participate in collision checks (#2494).

- Extract colon-group extent scanning from list-body rebasing while preserving folded-line ownership, opaque payload tracking, and closer caches (#2481).
- Extract quote and code-fence extent scans from list-body rebasing while preserving scan order, callbacks, and closer caches (#2480).
- Add a separate table-preservation assessment and checked output API. Diagnose merged cells, caption associations, header ordering, and other declared fields without changing the render-loss schema (#2475).
- Skip ordinary inline and block position construction for `positions: false`; copy the remaining position-bearing records without deleting AST fields (#2489).
- Collect document ids through explicit schema child slots and reuse that visitor during heading resolution (#2490, #2492).
- Stop definition ownership scanning after the last candidate, strip container prefixes by offset, and dispatch block opener checks by first character (#2491).

- Reuse failed colon states at every stack depth and skip plain lines through the attachment event index (#2487).
- Share attachment closer indices across indentation columns and borrowed bodies. Reuse failed colon tails, including tails containing balanced containers (#2485).
- Cache attachment fence boundaries and failed code lookahead across repeated `+` blocks. Reject mixed runs as possible code closers (#2484).
- Fast HTML eligibility uses one native ASCII/control scan and avoids repeated heading and paragraph checks (#2467).
- Fast HTML list lookahead skips blank lines by index instead of copying the remaining lines at each list boundary (#2461).
- `lintCarve` reports a fragment link whose target names no element in the document, under the new `broken-fragment-link` rule. The rule reads ids off the rendered HTML, so heading slugs, footnote ids, ids on spans and list items and ids inside raw HTML count exactly as a browser sees them, and a case-only near miss is named in the message. `#`, `#top`, text directives and links into other files are not reported, and the rule stays silent when an extension may generate ids. `broken-crossref` now says when a target id exists on an element a cross-reference cannot reach and suggests a plain link instead of reporting no match (#2497).
- `carve --version` and `carve -V` print `carve-js <version>` and exit 0. Both spellings used to fail as an unknown render option with exit 2, so a package manager or a bug report had no way to ask which engine answered (#2458).
- The fast HTML renderer accepts a list that holds a blank line before a nested bullet, renders plain Unicode and trimmed paragraphs through borrowed strings, and collects the HTML id namespace only when core rendering needs it. Rendered HTML is unchanged (#2456, #2472, #2473).
- Attribute parsing, table span resolution, consecutive attribute folds, combined-span closers and missing comment closer scans are bounded, and failed cross-reference scans are memoized (#2454, #2476, #2493, #2496).
- Nested lexer views defer unused local offsets and share colon fence boundaries and source geometry, and nested colon lines are borrowed through a shared bounded fence lookahead (#2477, #2478, #2483).
- Verse ownership discovery avoids repeated inline callbacks, verse whitespace expansion avoids identity position maps, and gap restoration allocates less (#2443, #2444, #2445).
- Heading id assignment and HTML rendering no longer repeat parser work, and only the affected image branches are copied (#2474).
- Default attribute merging indexes existing classes and attribute slots and
  copies key-value attributes once per node. Markdown reference definitions in
  lists update only their continuation lines instead of copying or searching
  the whole line array for each definition, complex definitions reuse cached
  source offsets and an advancing generated-label cursor, and malformed nested
  labels and whitespace in destinations and titles are scanned once (#2547).

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

[Unreleased]: https://github.com/markup-carve/carve-js/compare/0.1.10...HEAD
[0.1.10]: https://github.com/markup-carve/carve-js/compare/0.1.9...0.1.10
[0.1.9]: https://github.com/markup-carve/carve-js/compare/0.1.8...0.1.9
[0.1.8]: https://github.com/markup-carve/carve-js/compare/0.1.7...0.1.8
[0.1.7]: https://github.com/markup-carve/carve-js/compare/0.1.6...0.1.7
