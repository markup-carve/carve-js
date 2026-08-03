# Changelog

All notable changes to carve-js are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **An abbreviation definition written inside a container is now a child of the
  document** (carve-php#631, spec markup-carve/carve#518). PART 12 §7 puts a
  definition at document level even when it was authored inside a div, a list
  item or a block quote, because its scope is the document wherever it sits. A
  footnote definition already worked that way here; an `abbreviation_def` was
  left nested, which is what split the engines - all three rendered identical
  HTML, so nothing about the document changes, only the tree. `pos` still
  records where the author wrote it.

  The hoist is part of `parse()`, not of serialization: §6 requires
  `parse(x)` serialized and deserialized to equal `parse(x)`, so hoisting on the
  way out would satisfy §7 and break §6 on the same document - the mistake §1a
  already records for text-run coalescing.

### Added

- **Bare-dot ordered markers** (proposal for markup-carve/carve#315, DRAFT -
  the spec PR is markup-carve/carve#347 and is not accepted yet). A bare `.`
  with no value is a decimal ordered item counting from 1, the AsciiDoc-style
  shorthand:

  ~~~
  . first
  . second
  ~~~

  Only `.` may drop its value; `) text` stays paragraph text, the same
  asymmetry that keeps `(1)` from being a marker. The bare dot shares the
  decimal-dot dialect, so it mixes with `1.`/`2.` in one list, and li-attributes
  attach exactly as they do elsewhere (`.{#x} text`).

  `fmt` writes back the spelling the author used. The two forms parse to the
  same list on purpose, so the tree carries which one opened it - a `bareMarker`
  flag on the list node, set by the FIRST item like `start` and `olType`. PART
  11 §6 makes the choice the author's rather than the writer's, and the AST is
  where such a choice is recorded: the same remedy the combined bold-italic form
  needed (`boldItalic`, carve#375). An existing `1.`/`2.`/`3.` document is
  therefore untouched by a format. Author NUMBERING is still not preserved -
  `1.`/`1.`/`1.` comes back renumbered, as it always did.

  The flag stays OFF the serialized AST. PART 12 is interchange, pinned by the
  spec's `ast-schema.json` with `additionalProperties: false`, and neither the
  schema nor carve-php / carve-rs knows this field yet - publishing it would
  fail validation the moment a bare-dot document reached the corpus. The writer
  reads the runtime tree, so source -> `fmt` keeps the spelling; only a JSON
  round trip forgets it and falls back to `1.`, the same stated loss the other
  codecs already carry for authored form. If the proposal is accepted the field
  belongs in the schema beside `delim` and `bulletChar`, published by all three.

  **This is a breaking change to the language.** After a blank line, a paragraph
  beginning with `. ` - an ellipsis fragment, a wrapped sentence, a deliberate
  leading dot - now opens an `<ol>`. A paragraph opening with `.{` plus a valid
  attribute block and a space does too. Both are stated and tested rather than
  discovered.

### Changed

- `fmt` collapses a break inside a heading to a space instead of emitting it.
  No parse produces such a heading, but an ingested AST can (PART 12 permits any
  inline in a heading), and writing it out verbatim split the heading and moved
  text out of the title on re-parse. Only an odd run of backslashes before the
  newline is a hard break's marker, so a literal backslash ending a line
  survives.

- **BREAKING: a heading ends at the newline** (spec markup-carve/carve#451,
  markup-carve/carve#434). Nothing folds into a heading any more - neither a
  plain line nor a same-count `#` line - so `# Title` with prose beneath is a
  heading plus a paragraph, and its id comes from the heading line alone
  (`Title`, not `Title-Some-text`). Documents that relied on the fold change
  meaning; anything with a blank line after the heading is unaffected.

  The fold was a silent corruption for anyone arriving from Markdown: the title
  text and the derived id were both wrong, `</#id>` cross-references and TOC
  anchors broke, and the intended body paragraph disappeared into the title with
  nothing to report. Lazy continuation now means one thing across the language -
  it continues an open paragraph - and a heading is not a paragraph.

  A flush-left line after a heading nested in a list item still belongs to that
  item; it is now the item's own content beside the heading instead of title
  text (corpus 73-list-nesting-and-looseness-4).

### Added

- **Two `--from-djot` lint rules for heading continuation lines**
  (`djot-heading-continuation`, `djot-heading-continuation-marker`). A Djot
  document that wraps a heading renders differently under Carve, and the fix
  joins the lines back onto the heading - stripping the `#` marker on the
  same-count form, as Djot's fold does. Both are `djot-shift`, so `carve lint`
  shows them only with `--from-djot`.

- **`carve lint --portable`**, the outbound twin of `--from-djot`: an
  advisory rule for a document that has to stay valid Djot source.
  `portable-quote-marker-space` flags a `>` blockquote marker with no space
  after it - Carve treats it as a real quote marker regardless, but a Djot
  processor only recognizes it when followed by a space, a tab, or the end
  of the line, and otherwise leaves the `>` as literal text. Nothing here is
  a defect: the document renders exactly as written in Carve either way. Off
  by default, and composes with `--from-djot`.

### Fixed

- **A block that renders to nothing no longer leaves a blank line inside its
  container.** A comment, a comment block, an abbreviation definition or a
  non-HTML raw block rendered as the empty string, and the container joined it
  in, so `::: note` holding a `%%%` block came out as
  `<aside …>\n\n  <p>body</p>`. The list item filtered these out already; the
  div, admonition, line block, block quote, definition body and the extension
  API's `renderChildren` did not. Output now matches carve-php everywhere. A
  container whose whole body renders to nothing still renders exactly as a
  childless one does, so genuinely empty containers are unchanged.

- **A fence opened with a non-Tier-1 word classifies as `div` for profiles,
  not `admonition`.** Only the eight Tier-1 canonical kinds (`note`, `tip`,
  `warning`, `danger`, `info`, `success`, `example`, `quote`) are callouts
  (grammar PART 9 §12); `::: sidebar` is a generic container. The profile
  classifier used to treat every named fence as an `admonition` regardless of
  kind, so `denyBlock(['admonition'])` stripped `::: sidebar` along with every
  real callout - a cross-engine divergence from carve-php, which already made
  this classification (markup-carve/carve-php#513, carve#431).

  **Migration:** `denyBlock(['admonition'])` previously stripped *every* named
  fence and now strips only Tier-1 callouts. To keep the old behavior exactly,
  deny both `admonition` and `div`; `denyBlock(['div'])` still catches callouts
  through the existing supertype rule.

  This is a trust-class change only: the serialized AST is unchanged -
  `::: sidebar` still publishes `{"type":"admonition","kind":"sidebar"}`, and
  the HTML renderer's choice of `<aside>` vs `<div>` (already Tier-1 aware) is
  untouched. Verified byte-identical rendering across the full spec corpus.

### Added

- **`sections: false` renders headings without the `<section>` wrapper**
  (markup-carve/carve#427, spec PART 9 §13). The id goes back on the `<h*>`
  alongside its other attributes, and the blocks that would have been section
  children stay as siblings. Default unchanged, so existing callers are
  unaffected.

  The wrapper is the one output change that breaks a site whose source migrated
  cleanly: CSS and JS assuming rendered blocks are direct children of the
  content container - the `.stack > * + *` spacing idiom, `:first-child`,
  `nth-child()` counting, `element.children` walks - stop matching once a
  `<section>` sits in between. djot users unwrap the node with a filter;
  carve-js has no such escape, because the element is synthesized at render
  time from a flat AST with no `section` node, which left post-processing the
  HTML as the only option.

  Implemented as one branch in the existing wrapping pass rather than a second
  renderer, because with the option off a top-level heading renders exactly the
  way a heading inside a blockquote or div already does. The endnotes
  `<section role="doc-endnotes">` is a different construct and is unaffected.

### Fixed

- **`markdownToCarve` preserves leading YAML frontmatter instead of destroying
  it.** The converter had no frontmatter rule, so the opening `---` was migrated
  as a thematic break and the closing one as a setext underline: a page opening
  with `title:` / `description:` came back as a rule, a paragraph, and an `##`
  heading, with the metadata gone. Frontmatter is opaque in Markdown and in
  Carve alike, so it now passes through byte-for-byte and only the body is
  converted.

  The fence is recognized with the parser's own open/close rules, including the
  format label (`---toml`, `--- toml`), and must enclose at least one non-blank
  line. An empty pair (`---\n---`, `---\n\n---`) carries no metadata and stays
  two thematic breaks, as before.

- **`denyBlock(['frontmatter'])` and `denyBlock(['footnote'])` are honoured
  instead of silently ignored.** `profiles.md` lists both in the normative Block
  vocabulary, so a profile can name them, but this engine keeps frontmatter and
  footnote definitions on the `Document` rather than in `children` - and the
  filter walked only `children`. Naming either produced no violation and no
  change (carve#422).

  Denial REMOVES rather than degrades: both render nothing, so there is no text
  form to fall back to. The rendered HTML is therefore identical either way;
  what changes is the tree, the serialized AST, and the violation report. That
  distinction is now documented in `profiles.md` upstream.

  This matters most for frontmatter, which is exactly the content a host
  restricting untrusted input would want gone before it reaches its own
  templating - the path Security PART 9 §25 already requires a safe loader and
  escaping for.


### Fixed

- **`denyInline(['escaped_text'])` is honoured instead of silently ignored.**
  `canonicalType()` folded `escaped_text` into `text`, so a profile naming it
  produced no violation and no change in output. `profiles.md` lists the type
  in the normative inline vocabulary, and `ast.ts` already explained why the
  type exists at all - the escape carries intent the bare character does not -
  so the engine contradicted both the spec and itself.

  Under the default `to_text` action the rendered bytes do not change, because
  the text form of an escaped character is that character. The deny is no
  longer a no-op: it is reported, and `strip` and `error` act on it.

  The neighbouring `smart_punctuation` fold is unchanged and correct -
  `profiles.md` explicitly lists that type as one the vocabulary does not
  include.


### Changed

- **An escaped pipe in a table cell is an `escaped_text` node, like every other
  escape.** The row splitter resolved `\|` itself, which made a cell the one
  place in the engine where an escape does not become its own node - and left
  the cell's text one character shorter than its source, so no position could be
  anchored to it. The splitter now keeps the escape; stopping the pipe from
  SPLITTING the row was always its job, resolving it was not. Rendered output is
  unchanged on every target: `\|` still renders as `|` (carve-js#462).

### Fixed

- **A list nested inside a `+` continuation keeps its positions.** The line map
  a container passes can hold the same document line twice - the continuation's
  synthetic blank separators borrow the line they sit against - and inverting it
  picked whichever index came first, which was a blank where the real content
  line was meant. The suffix test then failed and the nested block lost its
  positions. The inversion now chooses among the candidates for a line number
  the one that keeps document order AND actually ends with the line
  (carve-js#462).

### Added

- **`toAstJson(doc)`**: serialize a parsed document to the PART 12 exchange
  shape. The root comes out as exactly `type`, `children` and `srcByteLength`,
  with frontmatter and footnote definitions as block nodes in the tree, which
  is what PART 12 §7 requires (carve#411, carve#418).

  The runtime `Document` is unchanged. It keeps `frontmatter` and
  `footnoteDefs` on the root, where the renderers, the profile filter and
  downstream consumers already read them; reshaping the in-memory tree would be
  a breaking change made to serve a wire format, and §1 explicitly allows an
  implementation whose internals differ to map on the way out.

  Consumers needing conformant JSON must call this rather than stringifying
  `parse()` directly.

### Fixed

- **A `+`-continued blockquote keeps its positions.** The continuation splices a
  flush-left block into the quote body and inserts blank separators, so the
  body's lines stop being a contiguous run of the document's - and the offset
  mapping, which walked `start + i`, fell off the source at the first splice and
  dropped every following line's position. It now uses the per-line map the
  caller already passes for line numbers. A map that runs backwards is declined
  rather than emitted, so an invalid span cannot replace a missing one
  (carve-js#462).

### Fixed

- **A hard-breaks block keeps the span of the break it converts.** `::: ` plus a
  backslash turns every line ending into a hard break, and building a fresh node
  for it dropped the position the soft break already carried - the same slip the
  line block had fixed earlier (carve-js#462).

### Fixed

- **A captioned fence and a captioned standalone equation place the block they
  wrap.** A caption turns the block into a `figure`, and the block loop attaches
  the span to the figure - so the target inside had none, which PART 12 §4 wants
  on every node but the root. The captioned image and blockquote already did
  this (carve-js#462).
- **A space-indented line block stanza keeps its positions.** The indent is
  rewritten to one U+E000 sentinel per space, so the line is not a verbatim
  slice but every character still sits at its own offset. Requiring verbatim
  lines left a whole stanza unplaced over a single indented line. A TAB-indented
  stanza still declines, because a tab expands to up to four sentinels and
  shifts everything after it (carve-js#462).

### Fixed

- **A tree carrying block `footnote` definition nodes renders.** `footnote` is a
  BLOCK type in the spec vocabulary and carve-php puts a definition in the tree
  as one, so a carve-php tree threw `unknown block footnote` - it could not be
  rendered at all. Such nodes are now hoisted into the `footnoteDefs` map this
  engine uses. Which representation is canonical is still open (carve#408);
  this only makes the exchange work either way.

### Fixed

- **A stored AST carrying the pre-split `footnote` type still renders.** The
  split into `footnote_ref` / `inline_footnote` made every tree serialized by
  0.1.2 unrenderable - the renderers threw `unknown inline footnote` rather
  than degrading. A consumer switching on the type is code someone can update;
  a stored tree is data someone already has. The legacy name is accepted on
  INPUT and mapped by the node's own shape (a body means inline, a label means
  a reference). It is never produced, and `parse` emits only the new types
  (carve#405).

### Changed

- **BREAKING (AST): the `footnote` node type is split into `footnote_ref` and
  `inline_footnote`.** One identifier named both `[^label]` and `^[content]`,
  and `footnote` is ALSO the block type for the definition - so a single string
  named three different things, `footnote_ref` and `inline_footnote` named
  nothing despite being in the vocabulary, and a profile could not deny one
  form without denying the other. `profile-filter.ts` already disambiguated the
  two by hand, which is the shape of the problem (carve#405).

  Fields are unchanged: a `footnote_ref` carries `id`, an `inline_footnote`
  carries `inline`, and both carry `number` and `refId`. A `Footnote` union
  alias is exported, so code that only needs "a footnote reference" keeps
  compiling. Rendered output does not change on any target.

### Fixed

- **A link label's closing `]` is found past an editorial comment.** The scan
  already skipped code spans, because a `]` inside one is content. An editorial
  comment holds literal content too, and was not skipped, so `[{#a]b#}](u)`
  ended the label at the comment's bracket and formed no link. There was no
  spelling that worked: `{# ... #}` resolves no escapes, so `\]` put a real
  backslash in the comment (carve#403).

- **A heading referenced only from a footnote body keeps its `{#id}` in the
  Markdown target.** The target emits the id only for headings a
  cross-reference resolves to, and the prepass that decides this walked
  `ast.children` alone - not footnote definition bodies, which render as block
  content just the same. The reference still rendered as a link, so the output
  carried a dangling anchor: exactly what emitting the id prevents (carve#352).

### Changed

- **BREAKING (AST): the `critic-comment` node type is now `critic_comment`.**
  It was the last hyphenated type in the vocabulary, held back pending a spec
  decision on whether CriticMarkup's comment should fold into `comment`
  instead. It should not - folding loses which syntax the author wrote, the same
  objection that keeps `autolink` separate from `link` (carve#401) - so the type
  stays distinct and takes the snake_case spelling every other type uses.
  Consumers that switch on the AST `type` string need the new spelling.

  The rendered CSS class is deliberately unchanged and stays
  `<span class="critic-comment">`: it is user-visible styling that the docs
  theme, the Prism grammar and the published examples select on, so nothing
  about existing stylesheets or HTML output changes.

### Fixed

- **A document full of comment-fence openers with distinct widths no longer
  rescans itself per opener.** The closer lookahead added in carve#463 scanned to
  end of input for every `%%%` opener. Where every opener has a different width
  no line can close any other, so every scan ran to the end: ~1.9 MiB of such
  input took 8.5s, growing about 7x per 4x of input. It is now answered from a
  width to last-index map built in one pass, which takes the same input to 67ms.
  Since a closer must match the opener width exactly, any later line of that
  width IS a valid closer, so the map is exact rather than an approximation.

  The per-width negative cache that shipped with carve#463 is removed. It could
  never help: its hit condition is a second opener of the same width after a
  proven-no-closer point, and a second line of the same width is itself a closer
  for the first, so the condition is unreachable. The perf test guarding it
  repeated one width, which meant line two closed line one and the lookahead was
  never even reached - it passed no matter what that code did. The replacement
  uses distinct widths and fails against the old scan.

### Fixed

- **`markdownToCarve` no longer turns plain Markdown text into Carve markup.**
  CommonMark defines no `/…/`, `=…=`, single-`~…~`, `%%…%%` or braced
  `{X…X}` syntax, so all of those are literal text on the way in - and the
  converter passed them through for Carve to parse as markup. `a {,y,} b` came
  out as a subscript, `a /it/ b` as emphasis, and `a %%c%% b` lost its text
  entirely, because `%%` opens a comment. The first delimiter of each construct
  is now escaped, which is the rule carve-php#420 applied to the bare dollar
  pair: the converter must not introduce a construct that was not in the input.
  Escaping runs after code spans, links, URLs and math are protected and before
  the Markdown rewrites, so `**b**`, `_em_`, `~~s~~`, `==h==`, `^sup^` and the
  HTML inline tags still convert, while `a/b/c`, `1/2`, `x = y`, `~5`, `50%` and
  non-http URLs are left alone. Note the behavior change: Markdown that
  contained Carve inline syntax and previously passed through verbatim is now
  escaped.

- **A `%%%` comment opener with trailing text no longer leaks the comment body
  and drops the next block.** `%%% html` and `%%% notes` were not accepted as
  fence lines, so the `%%` line-comment rule ate the opener, the body rendered
  as an ordinary paragraph, and the following `%%%` opened an unterminated
  block that swallowed the rest of the document. A comment fence is now a
  delimiter plus an insignificant tail: only the leading run of `%` is
  structural, so `%%% TODO` opens and `%%% end` closes. Percent fences carry no
  info string - a raw block is a code fence with `=FORMAT` - so `%%% html` is a
  comment and its body stays hidden.

  An opener with no matching closer ahead now opens nothing and degrades to a
  line comment, so following blocks still render instead of vanishing, matching
  the existing `:::` rule. An opener's tail is kept as the body's first line so
  `fmt` round-trips it; a closer's tail is dropped (carve#463, PART 9 §28).
- **The canonical writer no longer emits a code fence's title twice.** The
  opener's quoted title is resolved onto `attrs.title` at parse time so it
  reaches every consumer, but the fence carries it too - and the writer emitted
  both, turning ```` ```php "src/Auth.php" ```` into a `{title=src/Auth.php}`
  line plus the same quoted title on the fence. Longer than the author wrote,
  and it re-parsed with an attribute order the source never had. The fence is
  the authored spelling, so it wins (carve#369).

  Corpus round trip goes from 493/498 to **497/498**.

### Fixed

- **The canonical writer reproduces an escaped space instead of resolving it.**
  `10\ kg` came back carrying a literal non-breaking space, which re-parses as
  a literal rather than as an escape - the same HTML, a different text node.
  The parser draws the distinction (the escape gets its own placeholder, a
  literal nbsp stays itself) and the writer was collapsing both. Round-trip
  goes from 484/498 to 486/498 on the corpus (carve#369).

### Changed

- **BREAKING (AST): an escaped character is now its own node.** `\-` parses to
  `{type: 'escaped_text', value: '-'}` instead of being flattened into the
  surrounding text. Consumers that read `text.value` see the run split at each
  escape; the character itself is unchanged, and every renderer's output is the
  same except Markdown (below).

  The backslash carries intent the character does not: `\-\-` was written
  precisely so a downstream processor with smart punctuation on would not read
  an en dash. Flattening it lost that, and this engine emitted the trigger bare
  where carve-php reproduced the escape (carve#350). `escaped_text` is in the
  inline vocabulary in the spec's profiles.md.

- **Markdown output reproduces the author's escapes** (PART 11 §7 M2).
  `A \" B \-\- C` now renders as `A \" B \-\- C` rather than `A " B -- C`.
  A document that escapes nothing gains no backslashes.

### Changed

- **BREAKING (AST): a line block is now its own node type.** `::: |` parses to
  `{type: 'line_block', children}` instead of a `div` carrying a `.line-block`
  class. Consumers that matched on the class have to match on the type instead.

  The class could not express the construct: inside a `::: |` fence every
  newline is a hard break, while a plain div an author gave that class keeps
  soft breaks. With only the class to go on, the writer could not tell the two
  apart, emitted the generic `:::` form, and a formatted line block re-parsed as
  an ordinary div - one of the four constructs breaking
  `parse(fmt(x)) == parse(x)` (carve#359). It also brings carve-js in line with
  the block vocabulary in the spec's profiles.md, which lists `line_block`, and
  with carve-php, which already had the node.

  **Rendered output is unchanged** in every target: the HTML is still
  `<div class="line-block">`, with a structural class that trails the author's
  own attributes exactly as before (`{.foo #v}` renders
  `class="foo line-block" id="v"`, matching carve-php and carve-rs).

### Fixed

- **The canonical writer round-trips 9 more corpus cases.** Measured over the
  whole 494-case corpus, `parse(fmt(x)) == parse(x)` goes from 468 to 477;
  `to_html(fmt(x)) == to_html(x)` and `fmt(fmt(x)) == fmt(x)` stay at 494/494.
  Together with the `line_block` node this closes all four constructs named in
  carve#359.

  *Tables* are written in the native header form (`=` cells plus per-cell
  alignment markers) instead of a GFM delimiter row. A delimiter row's
  alignment applies to the whole column, header and body alike, while the AST
  records alignment per cell - so an aligned header over unaligned body cells
  came back with every body cell aligned. The two header shapes with no native
  spelling (a promoted span marker, a header cell carrying attributes) keep the
  delimiter row, now emitted bare so it cannot spill alignment down the column.

  *The blessed empty attribute block* (`-{} text`) records nothing, matching the
  four other sites in the parser that already drop an attribute block declaring
  nothing, and matching carve-rs.
- **`autolink` and `admonition` are deniable by name** (carve#362). Both folded
  into `link` / `div` before the profile's allow/deny check, so naming them was
  a silent no-op - a host restricting untrusted input could deny autolinks, get
  no error and no violation, and still emit them. They stay covered by the
  broader name: denying `link` still strips autolinks and denying `div` still
  strips admonitions, so no profile written against the broad name is widened.

- **The canonical writer reproduces a line block as a line block** (carve#359).
  It emitted a bare `:::` plus a `.line-block` class, and resolved the indent
  placeholder to a literal non-breaking space - which re-parses as text rather
  than as indentation, so the text node came back different. `::: |` and its
  leading spaces now round-trip byte for byte.

### Fixed

- **The Markdown renderer no longer de-escapes underscores inside verbatim
  content.** The intraword-underscore cleanup matched a literal `\_` anywhere in
  the assembled document, so a backslash the author wrote was rewritten along
  with the escapes the renderer added: `` `a\_b` `` came back as `` `a_b` ``,
  and the same happened in fenced code blocks, link destinations, image sources
  and escaped raw HTML. Each of those dropped a byte the parser had kept - a
  code span does not process escapes, so its value carries the backslash
  literally. The cleanup now decides on a sentinel only the text escaper emits,
  so it sees exactly the escapes the renderer wrote.

- **The canonical writer no longer escapes punctuation that needs no escape**
  (PART 11). `carve fmt` turned ordinary prose into backslash soup - a sentence
  reading `50% faster: yes (ok).` came back as `50\% faster\: yes \(ok\).`,
  where every one of those escapes re-parses to exactly the same document.
  The writer now renders the minimal form, checks it against the conservative
  form, and keeps the escapes only when dropping them would change the parse.

  Three details are worth knowing, because each is forced rather than chosen:

  The check is document-scoped. Verifying a single block would lose the
  document's link and footnote definitions, so a paragraph carrying a reference
  link comes back with an empty href and reports a difference escaping never
  caused.

  It compares the two renders rather than comparing against the source AST. The
  writer does not satisfy `parse(fmt(x)) == parse(x)` for every construct today -
  tables with a colspan, doubled alignment markers, one list-item-attribute shape
  and one line-block shape all re-parse to a different AST while rendering
  identical HTML. Comparing against the original would inherit those defects and
  flip the escaping decision between passes, breaking idempotence for a reason
  unrelated to escaping.

  The caret stays escaped in both modes. Its escape carries information the AST
  records separately - a text node whose leading caret came from an escape is
  flagged, so an image followed by a caret line is not promoted to a figure.
  Comparing that flag would escalate any document whose text begins with a
  caret; ignoring it would silently turn the image case into a figure.

## [Unreleased]

### Changed

- **Smart typography is represented as AST nodes instead of character
  substitution** (carve#339). A `smart_punctuation` inline node carries the
  resolved `kind` and the author's source `value`, so `renderCarve` reproduces
  what was written (`...`, `->`, `--`, `"`) instead of normalizing it to the
  glyph. `carveToHtml(fmt(x))` still equals `carveToHtml(x)` and `fmt` stays
  idempotent.

  HTML, Markdown, plain text and ANSI resolve the kind back to the same glyph,
  so their output is unchanged - verified byte-identical against the pinned spec
  corpus and against carve-php across the full transform matrix. Quote glyphs
  are locale-dependent and resolved during parsing, so a quote node also carries
  `glyph`.

  Covers the ellipsis, the eleven operators, the em/en dash ladder and the quote
  directions. A dash run partitions into one node per resolved glyph, each
  carrying the hyphens it came from.

  Consumers that accumulate visible text (`inlineText`, the citation entry
  flattener) contribute the resolved glyph, so heading ids and derived text are
  unchanged. Citation entry attribute blocks (`{author= year=}`) are now matched
  across the leading run of nodes rather than a single text node, since the
  quotes inside them are their own nodes.

  For profiles, `smart_punctuation` folds into the `text` trust class - the
  normative vocabulary is unchanged.

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
