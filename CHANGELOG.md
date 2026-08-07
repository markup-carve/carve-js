# Changelog

All notable changes to carve-js are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Breaking

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

## [0.1.0] - YYYY-MM-DD

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

[Unreleased]: https://github.com/markup-carve/carve-js/compare/0.1.0...HEAD
[0.1.0]: https://github.com/markup-carve/carve-js/releases/tag/0.1.0
