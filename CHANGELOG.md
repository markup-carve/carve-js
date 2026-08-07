# Changelog

All notable changes to carve-js are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **`carve lint` gains two platform-autolink rules: opt-in, platform-scoped,
  DEFAULT OFF** (markup-carve/carve#297). The source is the only place the
  author's intent still exists - no render-time construct prevents a host from
  re-linkifying published output, so a bare hash-number becomes a link to an
  unrelated issue and a bare at-sign word becomes a mention that notifies an
  uninvolved person.

  ```ts
  lintCarve(src)                            // never emits a platform rule
  lintCarve(src, { platforms: ['github'] }) // opts in
  ```

  ```sh
  carve lint --platform github doc.crv   # repeatable; an unknown name is an error
  ```

  Two ids, `platform-mention-token` and `platform-issue-reference`, because the
  two token shapes have different false-positive profiles and an author will
  want to silence one without the other. They look in prose AND in inline code
  spans, which are not reliably safe on every host surface; they do not look in
  fenced code blocks, raw blocks or comments. Each message suggests fencing the
  example, stripping the sigil, or rewording an enumerated reference.

  Off by default is the ruled behavior rather than a convenience: every other
  lint rule reports a silent failure in Carve, while these are target-specific,
  and an over-eager rule people disable wholesale would be worse than none.

- **`carve portability` - does this document mean the same thing in Djot?**
  (carve-js#546). A first attempt answered this with a lint rule that *reasoned*
  about it: flag a block opener directly under a paragraph line, since Carve
  interrupts the paragraph there and Djot folds the opener into it. The rule
  was withdrawn before merge. Its predicate tested a property of the **Carve**
  tree while the divergence is a statement about **Djot's** block model, and
  those come apart wherever Djot absorbs the paragraph into what precedes it (a
  multi-line heading, a `: term` list, a footnote-definition lazy continuation);
  its remedy split a blockquote in two; and its opener set included shapes the
  two engines already agree on, where every firing was a false positive *and*
  the advice changed the Carve document. Measured false positives ran 11.5% to
  36.5% depending on the generator.

  So this does not reason about it. It renders the document with both engines
  and reports the first place they disagree, which is the property the rule was
  approximating - there is no predicate left to be unsound. Every shape the old
  rule got wrong (`- item`, `1. item` and an unterminated `` ``` `` fence under
  a paragraph line) now comes out portable, and it prescribes no edit, so there is
  no advice left to be wrong either. Reports a line, both renderings, `--json`,
  and exit 1 on divergence.

  Carve's deliberate departures from Djot (`/italic/`, `=mark=`, quoted link
  titles) are genuine divergences and are reported as such. Differences in how
  the two renderers *write* the same document are not: attribute order, boolean
  attribute spelling, a self-closing slash and whitespace at a block boundary are
  normalized away, while whitespace between inline siblings and inside `` <pre> ``
  is content and is compared as-is.

  Needs djot.js, declared as an **optional peer** - `npm install @djot/djot`.
  `carve` still installs nothing at runtime: the engine is injected into
  `checkPortability`, and only the CLI imports it, lazily.

### Changed

- **An explicit `[text][label]` no longer reaches the heading index**
  (markup-carve/carve#742). PART 9R R1 scopes the implicit-heading fallback to
  the COLLAPSED `[text][]` spelling and to nothing else, so an explicit label
  that matches no `[label]: url` definition is unresolved and renders as its
  literal source text, at every spelling - folded or exact.

  ```
  # Getting Started

  [text][Getting Started]
  ```

  renders the paragraph `[text][Getting Started]` where it used to render an
  anchor to `#Getting-Started`. The collapsed form is unaffected, and an
  explicit label naming a real definition resolves exactly as before.

  The asymmetry is R1's own: a collapsed label is the author quoting prose from
  elsewhere in the document, which is why its matching is loose; an explicit
  label is an identifier the author wrote twice and can keep identical. An
  identifier that names nothing names nothing.

  `carve lint` now reports the shape as `unresolved-reference-link`, which it
  stayed silent on before.

- **An invalid attribute block on a reference definition makes the line prose**
  (markup-carve/carve#933). `[space, attributes]` in `reference_definition`
  names the `attributes` production, and a balanced `{...}` that production does
  not accept is not an instance of it. It is leftover content, and the
  end-of-line anchor disposes of it like any other leftover.

  ```
  [a]: /u {#}

  [a][]
  ```

  now renders the paragraph `[a]: /u {#}` and leaves `[a][]` unresolved. Before,
  the block was peeled off, discarded, and the line defined anyway, so the
  author's braces vanished from the page. The same holds for `{ }`, `{=}` and
  `{}`. The same characters already read this way one construct away: `x {#}` in
  a paragraph keeps the braces as text.

  A VALID block still defines and still transfers its attributes.

  A document relying on a definition line with an unparseable attribute block
  resolves one fewer reference. Recorded and accepted in the clause.

### Changed

- **Whitespace means the same four characters in every construct: U+0020,
  U+0009, U+000A and U+000D. A VERTICAL TAB (U+000B) and a FORM FEED (U+000C)
  are CONTENT** (markup-carve/carve#977, PART 7; the ruling on
  markup-carve/carve#963).

  Nine sites read the host language's whitespace class instead - a native
  `.trim()`, a regex `\s`, or `\s` with one character carved back out - and each
  gave a different answer from the construct beside it:

  - `# <FF>` and `^ <FF>` were not a heading and not a caption, though
    `# <VT>` and `^ <VT>` were.
  - `<VT>- a` was a LIST, the vertical tab read as indentation, and `carve fmt`
    wrote the character away. Every Unicode space did the same.
  - `^[<VT>]` was literal text where `^[<NBSP>]` was an inline footnote.
  - `` ` <VT> ` `` kept its padding, because the all-space guard called the
    content all-space; `` ` x ` `` strips it.
  - `^ Figure<FF> #` and `^ Figure #` shared one counter, so the second figure
    rendered "Figure 2" with no "Figure 1" beside it.
  - `%%<VT>note` lost the character, and `carve fmt` wrote a space in its place.
  - The Markdown, plain-text and ANSI targets dropped a trailing vertical tab or
    form feed that the HTML target kept.

  The carve-outs go with the class that needed them: NBSP and U+FEFF were
  removed from `\s` one bug at a time, and naming the four characters directly
  makes both unnecessary - along with U+1680, U+2000-U+200A and U+3000, which no
  carve-out had reached.

- **`carve fmt` writes a frontmatter opener with its format token: `---yaml`,
  not a bare `---`** (markup-carve/carve#977, PART 11 §6b; the ruling on
  markup-carve/carve#961). This REMOVES a special case rather than adding one:
  the writer already spelled every other format out - `---toml`, `---json`, any
  custom word - and dropped the token for `yaml` alone. carve-rs already wrote
  `---yaml`.

  ```
  ---            ->   ---yaml
  title: T            title: T
  ---                 ---
  ```

  The reader is unchanged: `---`, `--- yaml` and `---yaml` all still open
  frontmatter, and the closer stays bare. What moves is what the round trip
  says - a document parsed with `defaultFrontmatterFormat: 'toml'` and written
  back bare came back as `yaml` on the next pass, under the option's default.

### Fixed

- **A label, node type or role that names a key on `Object.prototype` no longer
  reaches a table it was never in** (carve-js#886). `[^__proto__]` - twelve
  bytes, the default `carveToHtml` path, no options - threw an uncaught
  `TypeError` on all four targets, and so did `[^constructor]`, `[^toString]`,
  `[^valueOf]`, `[^hasOwnProperty]` and every other inherited key. A caller
  without a try/catch returned a 500 or dropped the worker.

  The footnote definition map is a plain object indexed by the label the
  document supplies, so `defs['__proto__']` answered `Object.prototype`: truthy,
  so the "is there a definition" guard passed, and not iterable, so the walk
  over the supposed body threw.

  The same read appears wherever a table is keyed by author text, so the fix is
  the class rather than the one construct. Also corrected:

  - `carve lint` dropped its `unresolved-footnote` diagnostic for such a label -
    `[^nosuch]` reported it, `[^toString]` reported nothing.
  - An AST-JSON payload whose node `type` named a prototype key threw a bare
    `TypeError` instead of `AstJsonUnknownNodeTypeError`, and skipped the
    closed-field check on the way there.
  - An AST-JSON footnote definition labelled after a prototype key was judged a
    duplicate and silently discarded, so a legal tree lost a definition with no
    error.
  - With any extension carrying a `renderers` record loaded, `:__proto__[x]`,
    `:valueOf[x]` and `:hasOwnProperty[x]` threw, while `:constructor[x]`
    rendered `[object Object]` and `:toString[x]` rendered `[object Undefined]`.
  - Under the `symbols` option, `:constructor:` emitted
    `function Object() { [native code] }` **raw**, because symbol bodies are
    trusted-raw by design.
  - The SVG sanitizer expanded `&constructor;` to a function's source text
    inside the string its URL and reference checks read. A reference-valued
    attribute is checked per `;`-separated segment, and the fabricated text
    carries no `;`, so it welded the segments together and an external URL rode
    through: `fill="red&constructor;https://evil.example/y"` was kept where
    `fill="red;https://evil.example/y"` was blanked.

  A definition, symbol or role the author or the caller genuinely wrote under
  one of these names still resolves; only the inherited hit is gone.

- **An ordinary bullet list parses in linear time again** (carve-js#885). A flat
  16,000-item list - 64 KB, no unusual syntax - took roughly 18 seconds where
  0.1.2 took 82 milliseconds, and doubling the input quadrupled the time. It was
  reachable from a plain `carveToHtml(input)` with no options, so a service
  rendering user-supplied Carve could be stalled by a single ordinary paste.

  Anchoring a container's body to its document offsets inverts the parent's line
  map. That inversion walks every line of the PARENT, and it was rebuilt for
  every child, so a list paid one full parent walk per item. It reads only the
  parent, and the parent's lines never change once it is built, so it is now
  built once per parent and shared by its children.

  Same input, same process, on a loaded machine, before and after:

  | items | before | after |
  |---|---|---|
  | 2,000 | 188 ms | 64 ms |
  | 4,000 | 625 ms | 68 ms |
  | 8,000 | 3,638 ms | 100 ms |
  | 16,000 | 18,281 ms | 136 ms |

  The wall-clock figures describe a busy machine and are not a benchmark; the
  scaling is the point. Per doubling the cost grew 3.3x, 5.8x and 5.0x before,
  and 1.1x to 1.5x after.

- **A COMMENT fence's body in a list item no longer leaks onto the page, and
  `carve fmt` no longer breaks its delimiter across a space** (carve-js#878).
  PART 9 §28 makes a comment fence's body verbatim, and §24's S1/S2 place a line
  by the COLUMN it reaches without reading its first character - the derivation
  markup-carve/carve#975 pinned for the code fence, one construct over. The
  marker test consulted the code-fence state and not the comment state, so a
  marker line inside a comment split the item in two: the body rendered as a
  NESTED LIST out of a construct that renders nothing.

  Input:

  ```
  - %%%
    - x
    %%%
  ```

  Output before:

  ```html
  <ul>
    <li>
      <ul>
        <li>x</li>
      </ul>
    </li>
  </ul>
  ```

  Output after, which is what the same document with a plain-text body already
  produced:

  ```html
  <ul>
    <li></li>
  </ul>
  ```

  The `fmt` corruption was the SAME defect, not a second one. Each severed
  `%%%` became an unterminated comment fence, which §28 degrades to an inline
  `%%` comment whose content is the leftover `%`; the writer re-spelled that
  node faithfully as `%% %`, and the document stopped round-tripping. It now
  writes the source back unchanged and idempotently. The `+` continuation
  marker's two attach paths carried the same defect and are fixed with it.

- **A list marker at a list item's content column, inside a fence that item
  opened, is code text** (markup-carve/carve#975, markup-carve/carve-php#1007).
  PART 9 §24's S1 and S2 place a line by the COLUMN it reaches and neither reads
  its first character, so inside a fenced body `- x` is the same continuation
  that a plain `x` is. carve-js tested for a marker with no fence guard, so the
  marker line split the item's collected lines in two: the opener was left alone
  as an EMPTY code block, the marker opened a nested list, and the closer trailed
  it as an inline code span.

  Input:

  ```
  - ```
    - x
    ```
  ```

  Output before:

  ```html
  <ul>
    <li>
      <pre><code>
  </code></pre>
      <ul>
        <li>x
  <code></code></li>
      </ul>
    </li>
  </ul>
  ```

  Output now:

  ```html
  <ul>
    <li>
      <pre><code>- x
  </code></pre>
    </li>
  </ul>
  ```

  The same fix covers the fence opened after a blank line inside the item, and
  the flush-left block a `+` continuation marker attaches, where two further
  collection loops severed a fence body the same way.

- **A collapsed reference that reaches a heading by the heading's rendered text
  now publishes that derived label in `ref`** (markup-carve/carve#962). PART 12
  §3a defines `ref` as the label the reference RESOLVES BY, with the authored
  spelling kept in `rawRef`; carve-js published the authored spelling in both,
  so the one field defined as the resolution key named a string the reference
  did not resolve by.

  ```
  # `code()` heading

  [`code()` heading][]
  ```

  The link node now carries `ref: "code() heading"` beside
  ``rawRef: "[`code()` heading][]"``, where it previously repeated the authored
  spelling in `ref`.

  Scoped to the references whose authored spelling is not what reached the
  heading. A `[label]: url` definition keys on the label AS WRITTEN and does not
  derive, an unresolved reference resolves by nothing and does not derive, and a
  full `[text][label]` does not reach the heading index at all
  (markup-carve/carve#742). A label with no markup derives to itself, so no
  plain reference changes. Rendered HTML, the canonical source and `lint` are
  unchanged.

- **An unquoted `key=value` in a definition's trailing attribute block no longer
  swallows the closing brace.** `[a]: /u {k=v}` published `k="v}"`: the block was
  validated on its interior and parsed from the braced text, and an unquoted
  value is a non-whitespace run, so the two readings differed by one character.
  Both now read the interior, which is the string `parseAttrs` takes everywhere
  else.

- **A definition body answers PART 0 S4 like the other two containers**
  (markup-carve/carve#956). NO OPEN PARAGRAPH, NO LAZY LINE binds every
  container that collects an indented block, and a definition body carried no
  model of it: the lazy branch asked only whether the incoming line was a block
  opener, never what the `dd` currently ended in.

  ```
  :: t
  :  ```
  body
  ```
  ```

  `body` supplies none of the body's column, so the containers close, the `dd`
  holds an EMPTY code block, and `body` re-parses at document level - byte for
  byte the answer corpus 276 already pins for the `- ` fence spelling. Before,
  every flush-left line folded into the code text, body and closer both.

  Four more shapes move with it, each already answered this way inside a list
  item: a raw fence on the marker line, a CLOSED fence at the body column, an
  empty block quote, and a block-attribute line. A body that does hold an open
  paragraph still takes the lazy line.

- **A nested link and an autolink stay nodes in the published AST**
  (markup-carve/carve#817). "Links never nest" is a RENDERING rule: an anchor may
  not contain another anchor, and that binds the renderer, not the encoder. A
  link or an autolink inside a link's label is now serialized as the node the
  author wrote, and every renderer unwraps it at the render seam.

  `[[x](y)](z)` published a link to `z` whose only child was the text `x`, so
  `y` was gone from the tree entirely:

  ```
  fmt(parsed document)  -> [[x](y)](z)
  fmt(same via the AST) -> [x](z)
  ```

  Two spellings of one source, which is the section 6 round trip failing. An
  autolink flattened the same way returned as a bare URL, and that is a different
  document: a bare URL stays literal where an autolink is a link.

  A `heading_ref` inside a link was already exempt for exactly this reason, and
  an image and a code span in a label were never flattened, so this extends an
  existing exemption rather than adding a rule about what a label may contain.
  Nothing on the wire marks the inner link as unclickable; a consumer infers it
  from context.

  RENDERED OUTPUT DOES NOT MOVE. Every target still unwraps, so there is no HTML,
  Markdown, plain or ANSI consequence. What moves is what a consumer of the TREE
  receives.

- **A bottom-positioned table of contents is emitted at document level, after
  the last section** (markup-carve/carve-js#728). `tableOfContents({ position:
  'bottom' })` appended the `<nav>` to the document's block list, so the
  `<section>` a heading opens took it in - one option produced four placements,
  decided by what the document happened to end with: inside the last section,
  inside the INNERMOST of two nested sections, inside the section of a heading
  several paragraphs back, or at document level when there were no headings at
  all. `position: 'top'` never had the problem, for the accidental reason that
  nothing has opened a section yet when it is inserted.

  A `<section>` is a rendering artifact, not a container the author wrote, so
  "the bottom of the document" is not captured by one. The nav is now the last
  thing in the output, after the endnotes section too, which is byte-identical
  to carve-php.

  ```ts
  carveToHtml('# A', { extensions: [tableOfContents({ position: 'bottom' })] })
  ```

  ```html
  <section id="A">
    <h1>A</h1>
  </section>
  <nav class="toc"> … </nav>
  ```

  The in-document `::: toc` directive is unchanged: it still renders where the
  author wrote it, which all three engines already agreed on. Markdown, plain
  text and ANSI output is unchanged - none of them emits sections, so there was
  nothing for the nav to escape from.

- **An emptied definition description keeps its position through the engine's
  own ingest** (markup-carve/carve-js#857). A `<dd>` whose only content hoisted
  to the document root has no children, so its position lives only in the extent
  the parser recorded - and `fromAstJson` threw that away while `toAstJson` wrote
  it. The PART 12 §6 round trip was not identity on this engine's own output.

  Formatting was affected as well as serializing: `carve fmt` writes a hoisted
  definition back onto its `:  ` line by looking the line up, so an INGESTED tree
  emitted a bare `:`, which re-parses into the term above it. The same document
  formatted two ways depending on whether it had been through JSON.

- **A trailing space no longer costs a line-block stanza all of its positions**
  (markup-carve/carve-js#857). The alignment test that decides whether a `::: |`
  stanza can be placed ran after the trailing-whitespace drop had shortened the
  line, so a single trailing space read as "the offsets no longer line up" and
  every inline in the stanza came back unplaced - including ones on lines the
  space was not on. A tab still unanchors the stanza, which is PART 12 §4's
  actual case.

- **A fence opened on a list marker line no longer swallows a below-column body
  and its closer** (markup-carve/carve#950). PART 9 §24's STEP algorithm needed
  no new rule: S1 stops the prefix walk at the ITEM, so S2's fenced-body branch
  never fires, and S4's lazy branch continues an open PARAGRAPH - which a
  verbatim body is not. The item holds an EMPTY code block and the residue
  re-parses at document level, which is the answer the BLOCK QUOTE spelling
  already gave.

  ```
  - ```
  x
  ```
  ```

  The guard is on the OPEN FENCE rather than on "did the marker line open one":
  once the body has collected a line at the item's content column, a reader
  tracking the item's paragraph state sees a paragraph open again and folds.

  §10's CLOSER LOOKAHEAD applies here as it does in a block quote, so an
  unterminated fence mid-item is still an inline verbatim run that is part of
  the item's paragraph, and a below-column line still folds into it.

- **A collapsed reference whose label carries markup now reaches a
  heading-derived definition** (markup-carve/carve#949). PART 9R R1 keys the
  heading index by each heading's RENDERED PLAIN TEXT, so `# *bold* heading` is
  registered as `bold heading`; R1 also says the LABEL enters that comparison
  as its rendered plain text, i.e. its inline markup is stripped exactly as the
  heading's was. Without that step no heading containing emphasis, a code span
  or a link was reachable by its collapsed spelling at all.

  ```
  # *bold* heading

  [*bold* heading][]
  ```

  now links to `#bold-heading`. Eleven inline markup kinds move, not the two
  the report showed, and a FULL reference resolves by the same key.

  The lookup is a RETRY: the label as written is tried first, so a heading
  whose text literally contains the markup characters still wins. The strip is
  scoped to the heading index - `linkDefs` matching is unchanged and keys on
  the label as written, and the tie-break is unaffected. `carve lint` mirrors
  the resolver and no longer reports a resolvable reference as unresolved.

- **BREAKING: a quoted attribute value stops at the newline, inline and on a
  block-attribute line** (markup-carve/carve#888). `quoted_value` excludes a
  newline in BOTH of its alternatives: the value ends at the closing quote on
  the same line, and a break inside the quotes ends the production, so the whole
  attribute block is unrecognized. This engine kept the break and rendered it
  into the attribute; carve-php and carve-rs collapsed it to a space, which no
  production in either normative file describes.

  A block attribute may still span lines. `continuation` is where a newline is
  admitted and it sits BETWEEN two tokens, never inside one, so `{.a` / `.b}`
  is still a single block and a completed quoted value may still be followed by
  one.

  Eleven surfaces let the break through, where the report named two. The
  INLINE EXTENSION (`:name[x]{…}`) was one of them because it had no attribute
  validity check at all: its payload went straight to the parser, so it also
  separated two attributes on a TAB after the rule above narrowed every
  sibling, and turned `{#1a}` into a bogus `a=""` where §14 makes it literal
  everywhere else. An invalid payload there is no longer consumed - the
  extension parses without attributes and the braces stay literal text.

- **BREAKING: an INLINE attribute block's interior is space-only - a tab no
  longer pads or separates it** (markup-carve/carve#906). PART 4 spells every
  whitespace slot of the inline block `space`, and all five of them sit AFTER
  the first non-whitespace character of their line, where PART 7 already says a
  tab is not syntax. A tab at any of them makes the block unrecognized and its
  braces show:

  ```
  *x*{.a	.b}
  ```

  ```html
  <p><strong>x</strong>{.a	.b}</p>
  ```

  The five are separate positions, not one separator rule: the run after `{`,
  the run between two attributes, the run before `}`, the boundary after an
  UNQUOTED value, and the blessed empty block `{ }`. Fourteen surfaces carry
  the block - an emphasis tail, a span tail, a code-span tail, a link, an
  image, both reference forms, an autolink, a footnote reference, a
  marker-abutting list item block, a table cell, a table row, and a link or
  image definition's trailing block - and all fourteen narrow together.

  The block-attribute LINE does NOT narrow, and that is the ruling rather than
  an omission: it is the one attribute block with a `continuation`, so the
  whitespace after its newline IS a leading indentation run. A tab inside a
  QUOTED value is content and does not move either.

- **An autolink body admits non-ASCII and excludes format and control
  characters** (markup-carve/carve#844, measured in markup-carve/carve#860).
  PART 3's `url_char` is `unicode_url_char - format_char - control_char`, and
  this engine had the first half but neither subtraction: an invisible
  character inside `<https://…>` or inside a bare URL was carried into the
  `href`, so the host on the page and the host in the link came apart. A
  General_Category Cf or Cc character now ends the body.

  Ninety codepoints move, on both surfaces - the core angle autolink and the
  bare-URL extension - where the report named five. The C1 block is the half
  worth stating: U+0080-U+009F are non-ASCII and non-whitespace, so a rule
  written as "non-ASCII and not a format character" keeps all thirty-two of
  them.

  `link_destination` is a DIFFERENT production and does not move: a format
  character in an inline destination or a reference definition is still an
  ordinary destination character. `scheme` stays ASCII, the nine ASCII
  exclusions stay excluded, and an IDN host, an accented host, a non-ASCII path
  and a non-ASCII non-letter all still autolink.

- **A CLOSED or EMPTY container inside a block quote no longer swallows the
  flush-left line below it** (markup-carve/carve#920). PART 1 S4's NO OPEN
  PARAGRAPH, NO LAZY LINE is written about the OPEN STACK, not about which
  container kind is on it, and the LIST ITEM spelling of the shape already
  answered it correctly. Inside a quote it did not: a container a quoted line
  had just opened swallowed the line, and a CLOSED one kept it inside the quote.

  ```
  > quote
  > ::: note
  > body
  > :::
  tail
  ```

  `tail` is now a top-level paragraph rather than a third child of the quote.
  Twelve shapes moved, not the two the report named - the quote's lazy-state
  tracker never modelled a colon fence's CLOSER at all, so the no-paragraph-above
  spelling was wrong too, and code, raw and comment fences answered the same way
  once closed. An OPEN container that holds a paragraph still takes the line, an
  UNTERMINATED fence mid-paragraph is still inline verbatim and still takes it,
  and an absorbed `:::note` still holds the paragraph open across the prose
  below it.

- **BREAKING for a producer of malformed trees: `fromAstJson` validates the whole
  payload against the AST schema** (markup-carve/carve#881). PART 12 §12(d) makes
  an ingest check types and required fields together at decode, refused with the
  same typed error §12(a)-(c) already use. This engine accepted five invalid
  shapes outright - a root `srcByteLength` of the wrong type or negative, a root
  `children` that was a string or `null`, an `attrs` that was not an object, a
  `pos` missing `endOffset` - and five more reached the RENDERER and failed there
  with a bare `TypeError`, which §9(b) forbids. All of them now throw the new
  exported `AstJsonSchemaError` at decode. `children: null` in particular was
  read as an empty document, which is §12's own objection: a reader that supplies
  a default has turned a truncated document into an empty one. A `srcByteLength`
  that is present but simply wrong stays accepted, and every tree this engine's
  own parser produces still round-trips.

- **A definition body continuation indented past its column is lazy text**
  (markup-carve/carve#918). The body's column is the one `:  ` establishes;
  `definition_indent` reaches that column and does not measure how far past it a
  line went. A line indented further therefore continues the body's open
  paragraph and carries inline content, so a stray four-space indent no longer
  silently opens a block quote. This engine stripped the whole indentation run,
  so a line one column past arrived byte-identical to one written at the column -
  which means it was not only the block quote: a heading, thematic break, table
  row, div fence, comment fence, code fence and definition term were all nesting
  there too. At the body's own column a block still opens, flush left the body
  still ends, and a blank line followed by an indented block still nests, which
  is how a `dd` holds more than one block.

- **An unterminated comment fence inside a block quote no longer opens a block**
  (carve-js#832). PART 9 §28 says a `%%%` opener with no matching closer ahead
  does not open a block - it degrades to a line comment, so every following block
  still renders. The block parser has always looked ahead; the block quote's
  lazy-state tracker could not, because it runs while the quote's lines are being
  collected. So an unterminated fence in a quote swallowed the quote's paragraph
  and a lazy line that should have continued it became a sibling paragraph
  instead. A terminated fence still opens a block, and the closer still has to
  match the opener's width exactly.

- **Trailing whitespace is dropped on every content line, not only a block's
  last** (markup-carve/carve#926). A space or tab run at the end of a content
  line does not reach the output and is not content, so `abc<SP>` followed by
  `def` and `abc` followed by `def` are the same document - the run before a
  SOFT BREAK was kept until now. It applies in every block, not only a
  paragraph: a heading, a list item, a block quote line, a definition term and
  description, a footnote body line, a table caption and a line block. Only
  U+0020 and U+0009 drop; every other invisible character is content and
  survives, which fixes two places that disagreed - a trailing FORM FEED was
  dropped from a heading and a caption, and a definition TERM dropped a trailing
  no-break space, byte-order mark, ideographic space or any Unicode space.
  Verbatim content is untouched: a code block, a code span and the run before a
  backslash hard break all keep it, and a line block's two-or-more-column gap is
  already non-breaking-space content before this rule is reached.

- **The abbreviation and footnote definition separator is a run of ASCII spaces**
  (markup-carve/carve#892). Both productions now spell the marker-to-content slot
  `space+`, which is a correction rather than a widening - they said `space`
  while every reader consumed a run. What changes is where the run STOPS: the
  first character that is not an ASCII space ends the separator and begins the
  content, and both patterns had been consuming a Unicode run past the mandatory
  space. So `*[HTML]: <NBSP>Hyper` puts the character in the title and
  `[^f]: <NBSP>note` starts the note body with it, where both were swallowed
  before. A tab immediately after the marker is still not a separator, so
  `*[HTML]:<TAB>x` stays a paragraph. `carve lint`'s own footnote-definition
  pattern accepted a tab there and no longer does, so it stops reporting a
  duplicate definition for a line the parser reads as a paragraph.

- **A reference definition is anchored at end of line**
  (markup-carve/carve#911). `reference_definition` ends in `newline` and always
  did, but the pattern ended in a tail that swallowed anything, so `[a]: /u zzz`
  registered a definition with trailing junk nothing in the grammar authorized -
  as it did in carve-php, carve-rs and the executable spec. Such a line is an
  ordinary paragraph now. This also makes PART 7's promised failure mode
  reachable at this line for the first time: the clause says a slot that fails to
  match falls back to prose rather than silently dropping metadata, and the tail
  had been eating whatever a failed slot rejected. The tab form and both mixed
  runs at the title and attribute slots are therefore paragraphs too. A trailing
  run of spaces or tabs is still fine - that is the line ending, not content.

- **A padding slot spelled `space` takes exactly one space**
  (markup-carve/carve#912). Four productions spell their padding slot with a bare
  `space` - the link and image title, the code fence's slot before its info
  string, `frontmatter_open`'s slot before the format token, and a reference
  definition's slot before its trailing attributes - and this engine accepted a
  RUN at every one of them, as carve-php, carve-rs and the executable spec did.
  So ``` ```<SP><SP>php ``` opened a php fence, `---<SP><SP>yaml` opened
  frontmatter, and `[a]: /u<SP><SP>{.c}` attached the attribute block. Each now
  falls back the way PART 7 promises rather than silently taking the metadata: an
  invalid fence becomes an inline verbatim span, a frontmatter opener becomes
  paragraph text with its metadata still visible, and a reference definition
  keeps its destination without the rejected slot. One space is unaffected
  everywhere, and the slots spelled `space+` - the fence's own header and label,
  and the colon fence's separator - keep their run.

- **`carve fmt` keeps every character the renderer keeps** (markup-carve/carve#890,
  markup-carve/carve#924). `whitespace` in this language is a space or a tab, and
  the writer answered that question three different ways, each of them with a
  Unicode set. A blank-line test spelled `.trim() === ''` made a line holding one
  U+1680 count as blank, so the line above it was trimmed as block-final - on a
  run of such lines each one erased the one before it, and a paragraph came back
  split in two. The trim itself was Unicode whitespace minus NBSP minus U+FEFF,
  two exceptions each added after a document stopped round-tripping. And
  `escapeText` deleted every C0 and C1 control except tab, newline and return:
  61 of those 63 characters broke `toHtml(fmt(x)) === toHtml(x)`, since the HTML
  renderer emits all of them and the writer emitted none. Only U+0000 and U+000D
  are still dropped, because a parse replaces the first and normalizes the
  second, so neither can round-trip in any spelling.

- **A nested container no longer re-scans its own body once per level**
  (markup-carve/carve#752). Parsing a container handed its body to a nested
  parse as a joined string, which the nested lexer split straight back apart -
  two full copies of the body at every level - every level re-measured each
  line's whole indentation run to compare it against a column two or three wide,
  and the position anchor asked the same suffix question of the same line twice.
  All three are `O(depth)` character work per line per level. On the deepest
  ladder a conforming document can reach (depth 200, 40,600 bytes) the layout
  machinery walked 10,865,804 characters, 267.6x the document's own size and
  still climbing with depth; it now walks 140,298, 3.5x, and its counted growth
  per depth doubling is 3.99x against the document's own 3.94x. Parsing that
  ladder went from 88.0 ms to 49.9 ms, and the nesting penalty against
  size-matched flat prose from 13.6x to 7.6x.

  The penalty is reduced, not removed: the remaining per-line predicates read
  through the indentation too, so growth per depth doubling is 5.36x where a
  linear parse would be 3.94x. Every parse result is unchanged - the whole spec
  corpus renders byte-identically on all five targets (HTML, AST JSON, Markdown,
  Carve, plain text), the same SHA-256 over 675 documents before and after, and
  83,521 generated container-shaped documents agree on all three of HTML, AST
  JSON and Carve.

- **A blank line is space and tab and nothing else** (markup-carve/carve#890).
  The grammar names the class twice - `blank_line = {whitespace}, newline` over
  `whitespace = ' ' | '\t'` - and PART 1 states the U+FEFF row of it outright:
  "ONE, and only there: a U+FEFF anywhere else is an ordinary zero-width
  character." The blank-line test trimmed with `\s` minus U+00A0 instead, and in
  JavaScript `\s` is Unicode White_Space PLUS U+FEFF MINUS U+0085 - a legacy
  set, not a property. So a line holding only a byte order mark ended the
  paragraph in this engine and nowhere else, while the same mark rendered as
  ordinary text inside a paragraph; eleven further characters (U+000B, U+000C,
  U+1680, U+2000, U+2009, U+200A, U+2028, U+2029, U+202F, U+205F, U+3000) ended
  one too. All twelve now read as content, which is what carve-rs does.

- **A fence closer, an autolink body and a continuation marker each read the
  JavaScript whitespace set instead of Carve's** (carve-js#805, carve-js#810,
  carve-js#811). One cause, three subsystems: JavaScript's `\s` is Unicode
  White_Space PLUS U+FEFF MINUS U+0085 - a legacy set, not a property - while the
  grammar spells the class `whitespace = ' ' | '\t'`. So a byte order mark closed
  a fence, opened a raw block and passed for a list-continuation marker, as did a
  vertical tab, a form feed, a no-break space and every Unicode space; and on the
  other side of the same set difference, an autolink linked a URL with a U+0085
  inside it and carried the invisible character into the `href`. Fence
  delimiters - code, colon, raw and frontmatter, opener and closer alike - now
  take spaces and tabs only, the continuation marker likewise, and the autolink
  body ends at the Unicode White_Space property. carve-rs and carve-php agree on
  every row that moved. Whether an autolink may hold a non-ASCII character at all
  is markup-carve/carve#860 and is deliberately unchanged.

- **A no-break space after a reference-definition separator space is skipped**
  (markup-carve/carve#892). `resources/grammar.ebnf:1325-1339` puts the run
  between the mandatory separator space and the destination under the Unicode
  White_Space property, and U+00A0 has it. `RE_LINK_DEF` carved that one
  character out by hand, and because the destination right after the run is
  `\P{White_Space}+`, a no-break space there could neither be skipped nor
  started on: the pattern failed outright, so `[r]: <NBSP>https://e.com/` was not
  a definition at all and every reference to `r` went unresolved. carve-rs and
  carve-php both define it, and this engine already agreed with them on U+2009,
  U+202F and U+3000. U+FEFF and U+200B are not White_Space and stay in the
  destination, unchanged; a leading no-break space before the `[` is still
  content, not indentation.

- **An ingested node with a missing or non-string `type` is refused at decode**
  (PART 12 §12(c), markup-carve/carve#881). The clause puts the refusal at
  decode and says why: "Not in a renderer, one step later. The renderer's error
  names a RENDERING problem for what is really a payload problem, and it only
  ever arrives for a caller who renders." This engine implemented it only for a
  `type` that IS a string the schema does not name; a missing `type`, or one
  carrying a number, `null`, an array, an object or a boolean, fell through to
  `renderHtml: unknown block undefined`, and never surfaced at all for
  `carve fmt --from-json`, a linter or an indexer. It now throws the new
  `AstJsonNodeTypeError`, naming the path, alongside the existing
  `AstJsonUnknownNodeTypeError`. carve-rs and carve-php both already refused at
  decode.

  The positions where the schema itself puts a record with no `type` - a
  citation group's items - are unaffected, as is the older definition-list
  grouping form stored trees carry. The wrong-TYPE rows of that ticket (a
  non-array `children`, a `null` or string child) are a separate open question
  and are unchanged.

- **A definition body's continuation is measured in columns, not characters**
  (carve-js#812). `definition_continuation` is a leading indentation run, so a
  tab is syntax there and advances to the next multiple of 4 (carve#888's
  signoff, reaffirmed by carve#901). This engine counted characters, so whether
  a body continued depended on how a run was spelled rather than where it
  landed: a lone tab reaches column 4 and ended the body, while three spaces
  reach column 3 and continued it, and two spaces then a tab (column 4)
  continued while a tab then a space (column 5) did not. Both spellings of the
  rule - the blank-line lookahead and the fold branch - now read columns.

- **Ingest rejects a foreign AST root instead of adopting it** (PART 12 §9). The
  clause names the exact case: "An ingest accepting some other root (`doc`, say,
  which is ProseMirror's) will half-read a foreign format rather than reject it."
  `fromAstJson` wrote `type: 'document'` into the tree it returned whatever
  arrived, so a ProseMirror payload was accepted AND had the evidence normalized
  away - the caller got a valid Carve document back with no way to learn its input
  had not been one. It now throws `AstJsonRootError`, naming the type it found and
  the one the root is fixed at. carve-rs and carve-php both already rejected it.

- **The list-marker patterns no longer backtrack through indentation**
  (carve-js#641, parse half). They begin with a greedy `([^\S ]*)` so they
  tolerate indentation; on a line they do NOT match, that prefix backtracks -
  giving back one whitespace character at a time and retrying every marker
  alternation at each position. `RE_ORDERED` cost 20 ns per call at indent 0 and
  2055 ns at indent 400, and 15% of the whole parse of a 200-level ladder.

  The prefix is now atomic (the `(?=(...))\1` idiom), which is
  semantics-preserving here because every alternation after it begins with a
  NON-whitespace character - a shorter whitespace run can never let the rest
  match, so backtracking into it could only ever fail. Group numbering is
  unchanged: the lookahead's group takes slot 1 and holds the same indent.

  Parsing a 200-level ladder drops about 20% (72 ms to 60 ms, best of 25).
  Output is unchanged: `fmt` byte-identical across all 600 corpus documents, and
  the corpus HTML is clean.

- **`fmt` keeps a lone table span marker padded.** Glued to the opening pipe,
  `<` is also the LEFT-ALIGNMENT sigil, and the two readings differ: the
  executable spec reads `|<|` as alignment on an empty cell where all three
  engines read a colspan (markup-carve/carve#710). The writer was turning the
  unambiguous `| < |` the author wrote into the ambiguous form, so a document
  formatted here and read anywhere else could change meaning. `^` takes the
  same shape - it is not an alignment sigil, but a row of span cells stays
  readable that way. With a cell attribute the block stays glued to the pipe,
  where the grammar puts it, and the space goes between it and the marker.

- **The writer's escape decision costs one parse, not two** (carve-js#641,
  residual half). `renderCarve` chooses between the minimal and conservative
  escape forms by PARSING both and comparing the trees (PART 11 §4). Two full
  parses, paid by every document holding a single escapable character in text -
  which is nearly all of them.

  A middle tier answers it with one parse where it can: if the minimal form
  re-parses to the tree the writer was handed, it is faithful and there is
  nothing left to compare. Strictly stronger than "the two renders agree", and a
  miss falls through to the same comparison as before - the single parse of the
  minimal form is reused, so a miss still costs two, never three.

  Measured on a 40 KB `- x` ladder: the ladder alone formatted in ~6 ms and one
  `-` in a paragraph took it to ~186 ms; now ~100 ms. `fmt` output is
  byte-identical across all 600 corpus documents.

- **The canonical writer no longer inflates a nested list** (carve-js#641). Each
  level was indented twice - once by an absolute `'  '.repeat(listDepth)` and
  again by the parent item's continuation prefix - with a two-space strip as
  partial compensation, so the per-level indent GREW: `0 2 4 6 8 10` came back
  as `0 4 10 18 28 40`. Output was O(depth^3) bytes where the source is
  O(depth^2), and a 10 KB ladder at depth 100 came back as 344 KB.

  A ladder now returns byte-identical at every depth. That was also most of what
  made `fmt` look superlinear in depth - time was roughly linear in the bytes it
  emitted, and the bytes were the defect: depth 200 went from ~1.0s to ~0.18s,
  and depth 400 completes at all. A residual superlinear factor above output
  size remains and is separate.

  Nothing caught it because every existing check compared HTML or asserted
  idempotence, and the inflated form is equivalent HTML and a fixed point. The
  new guard is on BYTES, which is deterministic, rather than wall clock.

- **A definition past the content column is text, quoted or not**
  (carve-js#648). Past a list item's content column a definition is literal
  text, and this engine declined it outside a block quote while COLLECTING it
  inside one - so `> - a` / `>    [r]: /u` rendered the line as prose and
  resolved a reference through it at the same time. Content columns are measured
  inside the quote (carve#658), so the quote must not change the answer.

  The prepass guard asked `kept === raw`, which really means "does this line
  carry a marker of its own?" - the exemption that keeps `- [ref]: /url`, where
  the definition IS the item's content. A quote prefix makes those two differ
  for the same reason a marker does, so every quoted line skipped the guard. It
  now compares against the quote-stripped view.

- **An empty footnote label is not a footnote** (carve#589, carve-js#631).
  `footnote_label` is one-or-more characters, so `[^]: /x` is a LINK reference
  definition whose label is `^` - it registers as one, leaves no node in the
  tree, and emits nothing on the non-HTML targets, matching carve-rs.

  This engine read it as a footnote with an empty label, on PART 11 §10a's
  then-example `[^]: %`. The clause has since withdrawn that example for this
  exact reason, and §10a covers only the definition kinds that HAVE a node.
  Building the node made `renderMarkdown` and `renderPlainText` emit `[^]: %`
  where the other engines emit nothing - which looked like §10a compliance and
  was its opposite. `[^ ]: x`, whose label is a space, is still a footnote.

- **The invisible-line looseness rule stops at two boundaries it was crossing**
  (PART 9 §17 L1, markup-carve/carve#621, follows #619). Both were measured
  against carve-php, which agrees on both.

  A `+`-injected separator is not a blank line the author wrote. The
  second-paragraph scan had always exempted it, but the sibling clause did not,
  so `- a` / `+` / `%% note` / `- b` went loose where the identical document
  without the comment is tight - the comment was changing an answer it has no
  say in.

  A bare `{.c}` attribute line renders nothing, so it belongs in the invisible
  set; it was missing, and an item holding one came back wrapped in `<p>`.
  Unlike a comment it is COLUMN-STRICT (§15): one column past its container's
  content column it is literal paragraph text that really does render
  `<p>{.c}</p>`, so it is a visible second paragraph and still loosens. Only
  that arm carries the column test.

- **The canonical writer escapes a colon only where one can open something**
  (PART 11 §4, carve-js#614). A colon opens a construct at the START of a line -
  `:: term`, `:  def`, a `:::` fence - and is ordinary punctuation anywhere
  else, so escaping every colon in a text run is the over-escaping §4 forbids.
  `\^ Figure 1: moon` was written `\^ Figure 1\: moon`, where the caret on
  that line is already escaped, the line is therefore a paragraph, and nothing
  downstream reads the colon. carve-rs already wrote the minimal form.

  Dropping the colon from the candidate set outright is NOT the fix: seven
  corpus round-trips hold a line-initial `::` or `:::` inside a text run and
  need it. The escape now applies to a line-initial colon RUN, once - `:::`
  needs only its first colon neutralized to stop being a fence.

- **A definition only opens AT its content column** (carve-js#613). A
  definition-shaped line indented PAST a list item's content column rendered as
  item text - correctly - and was collected anyway, so the same line was both
  visible content and an active definition: a reader saw `[r]: /u` as prose
  while a reference elsewhere silently resolved through it. A definition renders
  nothing, so a line that renders was never taken as one.

  The column comparison is EXACT now rather than "at least"; the below-column
  half of the same rule was already fixed in carve-js#597. The pre-pass also
  counts EVERY marker on a line - `- - see` has a content column of 4, not 2 -
  so a definition written at a doubly-nested item's real column still resolves.

- **An invisible construct in a list item does not loosen it** (PART 9 §17 L1,
  carve#621). §17 L1 loosens on a blank-line-separated second PARAGRAPH, and a
  comment renders nothing at all, so

  ```
  - a

    %% just a note
  ```

  stays tight. An item wrapped in `<p>` because of a line that produces no
  output was the blank line showing through. A link reference definition in the
  same position was already tight here, so the two invisible kinds disagreed for
  no stated reason.

  The blank is still REMEMBERED: with a sibling item after it, L1's other clause
  applies - the item is followed by a blank before the next marker, and an
  invisible line in the gap does not fill it - so the list is loose. A visible
  paragraph BEHIND the invisible line still loosens too; the scan looks past the
  comment rather than stopping at it.

- **A definition one column in folds as text** (PART 1 S4, carve-js#597). A
  definition line below every content column is lazy text, the same as any
  other opener there - a construct opens only AT its container's content
  column. The footnote and link forms used to end the list and reappear as a
  document paragraph:

  ```
  - - a
   [^f]: x
  ```

  now folds the line into the item's open paragraph, as the heading, quote,
  table row, colon fence and bullet in that position already did.

  Both went through `RE_LINK_DEF`, which is whitespace-tolerant on purpose -
  other passes need it to see a quoted or nested definition - and whose leading
  character class is "whitespace except NBSP", so it matched a leading SPACE
  where every other predicate's anchor rejected one. `[^f]: x` has the link-def
  shape too, which is why the flush-anchored footnote pattern never had to
  match for the footnote case to break.

  The line is also no longer COLLECTED, so a reference elsewhere in the
  document does not resolve against a line the renderer prints verbatim. A
  definition that IS an item's content (`- [ref]: /url`) is unaffected: it sits
  on the marker line, at its content column by construction.

- **A below-column line folds at every depth, not only one column in**
  (PART 9 §24 C3, carve#603). A folded line kept its own indentation, which two
  columns in REACHED the sub-list's content column inside the re-parsed stream
  and opened a list there - `-   x` / `    - a` / `  - b` nested `b` under `a`,
  as it did in all three engines. C3 does not ask how deep the indent is, and
  C4 scopes Rule B's "any indent" to where a TOP-LEVEL list may open. A folded
  line now carries exactly one column, which reaches no content column at all.

- **A floating attribute skips what renders nothing** (§15 A2a,
  markup-carve/carve#571). `{#i}` followed by a reference, footnote or
  abbreviation definition, a line comment or a comment block now attaches to the
  next VISIBLE block, so

  ```
  {#i}
  [^f]: note

  e
  ```

  gives `<p id="i">e</p>`. §15 said "the NEXT block element" and left open
  whether an invisible construct is one; three engines answered three ways and
  none was self-consistent across the five kinds. carve-js was the consistent
  one and also the only one that threw the attribute away, which A4 reserves for
  the single case where there is genuinely nothing left - end of document.

- **A flush-left line with nothing open closes the item** (PART 1 S4,
  markup-carve/carve#576). A lazy continuation needs an OPEN PARAGRAPH, and a
  block-attribute line renders nothing and opens nothing. So

  ```
  . {i}
  X
  ```

  closes the item and re-classifies `X` at the top level, where it used to fold
  in and take the attribute with it. The empty-quote half of the same rule
  already shipped; a `{1a}` line is literal text (§15 A6) and still holds a
  paragraph open.

- **Over-cap openers group as one paragraph** (§25, markup-carve/carve#547).
  Past `MAX_NESTING_DEPTH` an opener "becomes literal paragraph text", so it
  groups by the ordinary paragraph rule: consecutive flattened openers and any
  text after them form ONE paragraph ending at the first blank line. carve-js
  emitted one paragraph per opener except the last, which grouped with the
  following text - an artifact of where the degrade path handed back to the
  block parser rather than a rule.

- **`[^]: %` is a footnote definition** (PART 10 §10a,
  markup-carve/carve#577). An empty label sent the line to the
  reference-definition rule, which captured `^` as a label and consumed it, so
  the construct vanished from every target including HTML. It now renders with
  its caret on the Markdown, plain-text and terminal targets, matching `[^ ]: x`
  which already produced a footnote with an empty label.

- **An unresolved reference IMAGE is an image node, and every target writes its
  source** (PART 12 §3a, carve-php#624). The link half of §3a shipped; the image
  half did not. `resolve()` still replaced `![alt][nope]` with a text node, so
  the HTML path looked correct while the image node had no renderer arm at all -
  and the serialized tree kept the image, so a document decoded from JSON
  rendered `<img src="">` where the same document parsed from source rendered
  `![alt][nope]`. One document, two shapes, decided by the entry point. The node
  now survives, and the HTML, Markdown, plain-text and ANSI writers reproduce
  the authored source the way the Carve writer already did. A lone unresolved
  reference image is still not promoted to a block image, so it keeps its `<p>`.

- **An unresolved reference is published as a `link`, not as text**
  (markup-carve/carve#486, spec markup-carve/carve#518 §3a). `parse()` always
  produced a `link` carrying `ref` and `rawRef`; `resolve()` then replaced it
  with a text node, and every wire path resolves first - so the serialized tree
  lost it. `see [a][] here` came out as three adjacent text nodes, breaking
  three rules at once: §3a (the wire could not tell a reference from literal
  text the author typed), §1a (the runs were adjacent and unmerged) and §6 (the
  parsed tree held a link, so the wire shape and the tree disagreed). It went
  unnoticed because encoding the PARSED tree was always an identity - the loss
  only happened on the resolving path.

  No rendered output changes. Every target - HTML, Markdown, plain text, ANSI,
  Carve - writes the reference back out as the author wrote it, which is what
  the surviving `rawRef` is for. A reference nested inside a link label also
  keeps its literal source rather than being unwrapped to its label, since
  "links never nest" now meets a node that is not really a link.

### Changed

- **The `Link` type no longer declares `fromCrossref`.** Nothing has set or read
  it since a crossref became its own `heading_ref` node carrying `resolvedText`
  (markup-carve/carve-js#608), which left the declaration as the only mention of
  the name in the whole repository. No runtime behavior changes: no node ever
  carried the property, so no output, no AST JSON payload and no consumer that
  reads values is affected. A TypeScript consumer that still names
  `link.fromCrossref` will now see a type error, and the answer is that the
  property was never populated - read the `heading_ref` node instead. The sibling
  defect in the Rust engine, where the same name was live on the wire and refused
  by that engine's own ingest, is markup-carve/carve-rs#776.

- **BREAKING: a renderer REFUSES at the render ceiling instead of truncating**
  (§25, markup-carve/carve#548). `renderHtml`, `renderMarkdown`, `renderCarve`,
  `renderPlainText` and `renderAnsi` now throw `RenderDepthError` - exported
  alongside `MAX_RENDER_DEPTH` - when a tree reaches the ceiling. This makes the
  five renderers fallible, which is a signature change rather than an internal
  one, and it costs nothing on any path a document travels: the ceiling exceeds
  `MAX_NESTING_DEPTH` by construction, so no tree from `parse` can reach it, and
  `fromAstJson` already refuses a deeper ingested tree. What is left is a tree
  built through the API, where the caller built it and can act on the error.

  Four of the five used to emit the nested markers and delete only the BODY, so
  the output looked complete and was not - and one of them is `renderCarve`, the
  canonical writer. `renderHtml` had no ceiling at all and recursed until the
  host stack gave out with a `RangeError`, the "crashing" §25 forbids. The
  pre-passes those renderers run first are bounded too, since a pre-pass that
  overflows refuses nothing.

  Depth is counted against the HOST STACK, so an extension that calls
  `renderHtml()` recursively spends from the same budget rather than restarting
  it.

- **An inline node's span covers its trailing attribute block** (PART 12 §4,
  markup-carve/carve#596). `*x*{#i}` gives the `strong` offsets 0..7, not 0..3.
  The braces are where the node's `attrs` came from, so a span stopping at `*x*`
  said the node ended before the markup that gave it half its content. A
  consumer could not select the styled text from an inline span without knowing
  which engine produced the tree.

- **The canonical writer does not substitute one construct for another, and
  escapes less** (PART 11 §2, markup-carve/carve#581). `| %%%` was written
  `| %% %`, splitting a comment opener run into an opener plus a stray
  character; it now writes the run whole. `}^p` was written with two escapes and
  `[^` with one, and both re-parse identically bare, so §2's test says neither
  needs escaping - the caret is a candidate escape now rather than an
  unconditional one, and keeps its escape only where dropping it would change
  the parse (a caption line after a resolvable image). All three defects held
  `to_html(fmt(x)) == to_html(x)` while the output was wrong, which is what
  "necessary, not sufficient" means.

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
