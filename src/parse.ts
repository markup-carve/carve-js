/*
 * Carve parser — linear-time, block + inline.
 *
 * Block lexer reads line by line; inline parser does a single scan
 * over each block's text content. No backtracking.
 */

import type {
  SmartPunctuation,
  Abbreviation,
  AbbreviationDef,
  Admonition,
  Attrs,
  AutoLink,
  BlockNode,
  BlockQuote,
  CodeBlock,
  CriticComment,
  CriticDelete,
  CriticInsert,
  CriticSubstitute,
  CrossRef,
  CaptionNumber,
  Comment,
  DefinitionItem,
  DefinitionList,
  Div,
  EscapedText,
  LineBlock,
  Document,
  Emphasis,
  Extension,
  Figure,
  FigureGroup,
  Heading,
  HeadingLevel,
  Image,
  InlineNode,
  Link,
  List,
  ListItem,
  Math,
  Mention,
  Paragraph,
  Position,
  RawBlock,
  RawInline,
  LiteralInline,
  Span,
  SymbolInline,
  Table,
  TableCell,
  TableRow,
  Tag,
  Text,
  ThematicBreak,
  FootnoteRef,
  InlineFootnote,
  LinkReferenceDefinition,
} from './ast.js'
import { SMART_PUNCTUATION_GLYPHS } from './ast.js'
import type { CarveExtension, MatcherContext, InlineMatch } from './extension.js'
import type { AsciiHeadingIdMode } from './heading-ids.js'
import { utf8ByteLength } from './abbr-budget.js'
import { entriesToWire } from './definition-list-wire.js'
import { isCarveWhitespace, trimNonNbsp } from './trim-non-nbsp.js'
import { ownValue } from './own-property.js'
import { normalizeRefLabel } from './label-key.js'
export { normalizeRefLabel } from './label-key.js'

export interface ParseOptions {
  /**
   * Record source positions on the returned tree. Default true.
   *
   * PART 12 section 4 lets an implementation gate position tracking behind a
   * parse option, and `false` is that gate. The document comes back with no
   * `pos` anywhere, and none of the bookkeeping that travels beside it: the
   * root `footnoteDefPos` map, and a definition item's `termSpans`,
   * `definitionSpans` and `definitionLines`. Emptying one of those while
   * leaving the other four would make the option true of a field rather than
   * of the tree (carve-js#1263).
   *
   * IT IS A SMALLER TREE, NOT A FASTER PARSE. The spans are recorded and then
   * dropped at the document boundary; see `dropPositions` for why the gate is
   * there rather than threaded through the scanner.
   *
   * WHAT IT DOES NOT GATE. Section 4 permits the tracking gate and forbids a
   * serialization one, and two more paths in this package read positions to
   * decide something other than a position, so all three force it back on and
   * ignore a `false` they are handed:
   *
   * - `carveToAstJson` - "JSON it is handed carries positions"; a tree without
   *   them is one an editor or language server cannot navigate.
   * - `carveToHtml` - resolution applies the strict column-0 figure rule from
   *   the image's own `startColumn`, and falls back to promoting when there is
   *   no position (which is right for an ingested tree, and wrong for a parse).
   *   Without the force, ` ![a](p.png)` over ` ^ cap` renders a `figure` where
   *   the default path renders a paragraph.
   * - `lintCarve` - every warning it emits is an offset into the source.
   *
   * The same caveat reaches a hand-composed `parse` + `resolve` + `renderHtml`:
   * positions are an INPUT to that pipeline, so suppressing them changes what
   * it renders. Use the convenience entry points, or leave the option alone.
   *
   * No parse DECISION depends on it. The tree is the same shape either way -
   * the spans are attached to it, never consulted while building it.
   */
  positions?: boolean
  /** Format label applied to a bare `---` frontmatter fence. Default 'yaml'. */
  defaultFrontmatterFormat?: string
  /**
   * Lowercase auto-generated heading ids (GitHub/SSG-style anchors), folded per
   * code point so it stays portable. Default false: ids are case-preserving.
   * Cross-references resolve case-insensitively either way.
   */
  lowercaseHeadingIds?: boolean
  /**
   * Fold auto-generated heading ids to ASCII for share-safe URL/CSS-fragment
   * portability. Default false (off). `true` / `'fold'` is best-effort:
   * transliterate non-ASCII, but scripts the map can't handle (Greek, CJK,
   * Arabic, emoji) are kept verbatim. `'strict'` additionally drops that
   * unmappable residue, guaranteeing a pure-ASCII id (a heading made entirely
   * of unmappable script then falls back to `s`). Orthogonal to
   * `lowercaseHeadingIds`; combine both for a fully lowercase ASCII slug.
   */
  asciiHeadingIds?: AsciiHeadingIdMode
  /**
   * Extensions whose parse-stage matchers (`matchInline` / `matchBlock`) add
   * syntax to the parse. Extensions with only render/transform hooks need not
   * be passed here; `carveToHtml` forwards them automatically.
   */
  extensions?: CarveExtension[]
  /**
   * Called for each colon-fence container opener that is still open when its
   * containing parse reaches end of input. This reports parser state that is
   * intentionally not serialized into the AST.
   */
  onUnclosedContainer?: (container: UnclosedContainer) => void
}

export interface UnclosedContainer {
  kind: 'div' | 'admonition' | 'line block' | 'hard-break block' | 'block quote'
  line: number
  column: number
  startOffset: number
  endOffset: number
  fenceWidth: number
}

// Active extension matchers for the current parse() call. A module-level hook
// keeps the ~15 recursive scanInline call sites and every sub-lexer free of an
// extra threaded parameter. Parsing is synchronous; parse() saves/restores the
// previous values in a finally so nested and sequential parses stay isolated.
let activeMatchers: CarveExtension[] = []
let activeMatcherCtx: MatcherContext | null = null

/**
 * The document being parsed, for the one field that promises VERBATIM SOURCE.
 *
 * `rawRef` on an unresolved reference is the authored spelling, and the writer
 * emits it unchanged - so it has to come from the document, not from the text
 * the scanner walks. Those are the same string almost everywhere; a line block
 * is where they part, because the block layer empties every comment-only line
 * before the stanza is scanned as one inline run (carve-js#1183).
 *
 * Saved and restored in the same `finally` as the matchers above, so a nested
 * parse cannot leave a later slice reading another document's bytes.
 *
 * SLICED BY UTF-16 INDEX, which is what a span holds while parsing. Positions
 * are published in CODEPOINTS (PART 12 §4), but `toCodepointPositions` converts
 * them once at the end of `parse()`, long after this is read - so slicing here
 * needs no conversion, and adding one would break every astral document.
 *
 * The text carries a stripped BOM back, because positions index the FILE rather
 * than the stripped view (carve#876), and it carries the NUL replacement,
 * because that is the document every other reported span describes.
 */
let activeDocument: string | null = null

// A definition pre-pass probe parses a source fragment through the block layer.
// Matchers remain active during that parse, but its own definition scan must not
// start another probe (a matcher may recursively call ctx.parseBlocks too).
let probingLazyParagraph = false

// Content must carry at least one non-ASCII-whitespace character, mirroring
// RE_CAPTION: `# ` / `#   ` (marker + whitespace only) and `#\t…` are NOT
// headings, exactly like the caption rule. Leading spaces are folded into the
// ` +` delimiter, so the content group starts at the first non-space; a NBSP
// (U+00A0) counts as content, as everywhere else in the parser.
const RE_HEADING =
  /^(#{1,6}) +((?=[ \t]*[^ \t\n\r]).+?)(?:[ \t]+\{((?:[^}"'\n]|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')+)\})?[ \t]*$/
// Thematic break: a COL-0 line of 3+ CONTIGUOUS identical `-`, `*`, or `_`
// (`---`, `***`, `___`, `----`), followed only by optional trailing
// whitespace and end of line (grammar §262 thematic_break). No leading
// indent and no internal spaces: a spaced/indented `* * *` / ` ***` is NOT a
// break and falls through to normal parsing (list / paragraph). The chars
// must all match, so a mixed `-*-` is not a break. Matches the executable-
// spec oracle `/^(-{3,}|\*{3,}|_{3,})[ \t]*$/`. Tested against the RAW line
// (NOT trimStructural), so leading whitespace correctly disqualifies it.
const RE_HR = /^([-*_])\1{2,}[ \t]*$/

// THE TRAILING RUN ON A DELIMITER LINE IS `whitespace`, i.e. space and tab.
//
// A fence delimiter -- opener or closer, backtick / tilde / colon / `---` --
// ends at `newline` in the grammar: `code_fence_close = (backtick_fence |
// tilde_fence):close`, `colon_fence_close = colon_fence:close`,
// `frontmatter_close = "---", newline`. None of them names a trailing slot at
// all, so whatever run the engines tolerate there cannot be WIDER than
// `whitespace = ' ' | '\t'` (grammar.ebnf:2206), the widest class the grammar
// spells anywhere on a line.
//
// It was `\s`, and in JavaScript specifically `\s` is Unicode White_Space PLUS
// U+FEFF MINUS U+0085 -- a legacy set rather than a property. So a byte order
// mark closed a fence here (carve-js#805), as did a vertical tab, a form feed,
// a no-break space and every Unicode space; carve-rs and carve-php read all of
// them as content. PART 1 rules the U+FEFF row out in as many words: "ONE, and
// only there: a U+FEFF anywhere else is an ordinary zero-width character."
//
// `[ \t]*$` is not a new spelling: `RE_HR` above, `RE_ADMONITION_OPEN` and
// `RE_LINE_BLOCK_OPEN` already carry it, the last two set by carve-js#794 /
// carve-js#798. Those narrowed the colon fence's OPENER and left its closer at
// `\s`, which is how one rule came to have two answers -- `::: note<BOM>` was
// prose while `:::<BOM>` closed the block it never opened. The opener's
// spelling is the one that stays.
//
// THE TAB ROW IS DECIDED FOR THE CODE FENCE ONLY, and `FENCE_TRAILING_WS`
// below carries it. Whether this run is `whitespace` or the narrower `space`
// is the same question PART 7 answers for NAMED slots ("a tab is syntax ONLY
// in a line's LEADING INDENTATION RUN") and that carve#886 / #894 / #905 have
// been settling one construct at a time. carve#1285 settles the code fence's
// row and no other, so this class stays as it is for every construct that is
// not a ` ``` ` / `~~~` line: carve-rs accepts a tab after `:::`, after `+`
// and after `%%%`, and this engine already agrees with it on all three.
const TRAILING_WS = '[ \\t]*$'

// POSITION DECIDES, NOT THE CONSTRUCT (carve#1295). The grammar's DEFINITION
// MARKER SEPARATOR clause is NORMATIVE that a marker-to-content separator is
// the `space` terminal (U+0020) only and that "a tab does NOT satisfy `space`
// (`space = ' '`)", mirroring the heading, list and task markers. carve#1285
// added the fence line to that family.
//
// WHAT THE CLAUSE GOVERNS IS A SEPARATOR - whitespace standing BETWEEN a marker
// and content on the same line. It says nothing about a line ENDING, and PART 2
// drops trailing whitespace before any of this is asked. So the same tab after
// the same marker reads two ways, decided purely by what FOLLOWS it:
//
//   ```<TAB>php   content follows  ->  separator  ->  does NOT open
//   ```<TAB>       nothing follows  ->  trailing   ->  opens, ordinary fence
//   ```php<TAB>    content precedes ->  trailing   ->  opens, ordinary fence
//   ```<TAB>       as a CLOSER      ->  trailing   ->  closes
//
// WHICH IS WHY THE SEPARATOR, NOT THE TRAILING RUN, CARRIES THE RULE. This was
// first read as "one run seen from two ends" (carve-js#805) and narrowed at
// both ends together, spelling the trailing run ` *$` everywhere. That refused
// three of the four rows above: ```` ```<TAB> ```` opened nothing, a closer
// padded with a tab was swallowed as content of the block it should have ended,
// and an info string followed by a tab was prose. The separator slot is a
// single literal space (the `' ?'` in `RE_FENCE` / `RE_RAW_FENCE`), which a tab
// can never satisfy, so it already refuses the one row that must be refused -
// and the trailing run is free to be `whitespace` at BOTH ends, which is what
// PART 2 says it is. carve-php is the reference (markup-carve/carve#1295,
// markup-carve/carve-js#1132).
//
// THE CLOSER INDEX MUST WIDEN WITH THE MATCHER. `RE_ANY_FENCE_CLOSER` is
// deliberately a SUPERSET because it only ever REFUTES ("no closer ahead"). A
// superset that rejects a line the real matcher accepts does not merely cost a
// scan, it answers WRONG - an opener is told no closer exists and runs past one
// that is really there.
//
// SCOPE IS THE BACKTICK/TILDE FAMILY, all six spellings in this file: `RE_FENCE`
// and `RE_RAW_FENCE` (openers), `fenceCloseRe`, the two bare closers and
// `RE_ANY_FENCE_CLOSER` (closers). The colon fence (`RE_ADMONITION_CLOSE`), the
// continuation marker (`RE_CONTINUATION_MARKER`) and the comment fence
// (`RE_COMMENT_BLOCK_ANY`, which takes any tail at all) use `TRAILING_WS`
// above, and no clause has moved them.
const FENCE_TRAILING_WS = '[ \\t]*$'

/**
 * The closer for a code fence opened with `marker`: the same character, at
 * least as long, and nothing after it but the trailing run above.
 *
 * ONE producer on purpose. This regex was built at eight call sites and spelled
 * out at four more, and a narrowing pass that reaches twelve of thirteen leaves
 * exactly the drift carve-js#805 reports.
 *
 * The CODE fence is the only caller: the comment fence matches its closer on
 * EXACT length through `commentFenceRun`, and the colon fence has
 * `RE_ADMONITION_CLOSE`. This is a CLOSER, so it takes
 * `FENCE_TRAILING_WS` - a tab after the run is trailing, never a
 * separator, because no content follows a closer's marker.
 */
function fenceCloseRe(marker: string): RegExp {
  return new RegExp(`^${marker[0]}{${marker.length},}${FENCE_TRAILING_WS}`)
}

// Info string is a single language token, optionally followed by a bracketed
// `[label]` (structured metadata; e.g. ```php [NPM] or ```[NPM]). The charset
// covers real-world tags with punctuation (c++, c#, f#, asp.net, text/html).
// After the language the opener admits, in this fixed order, an optional quoted
// "header" (carried to the `title` attribute on the <pre>; PART 9 §2) and an
// optional bracketed [label] (structured metadata a group extension may use).
// The header/label must be SPACE-separated from the preceding token; a
// glued quote/bracket (```php"x", ```php "x"[y]) or wrong order (```php [l] "h")
// is NOT a fence and falls back to inline parsing. A key="value" pair
// (```js title="x") is likewise not a fence. The first token may sit directly
// against the fence (```php / ``` php / ```[NPM] / ```"notes"). An info string
// of the form `=FORMAT` is a raw passthrough block (RE_RAW_FENCE), matched
// before this; a leading `=` therefore never starts a language token.
//
// EVERY SLOT ON THIS LINE IS `space`. PART 7's MARKER SEPARATORS AND PADDING
// SLOTS decides the terminal by POSITION, not by role: "A tab is syntax ONLY
// in a line's LEADING INDENTATION RUN. From the first non-whitespace character
// of the line onward a tab is not relevant to syntax at all." All three slots
// here -- the one before the info string and `code_fence_info`'s own "header"
// and [label] slots -- sit after the fence run, so all three are padding (the
// fence run has already decided the block) and all three take `space`.
//
// They were spelled `\s`, which is wider than a tab in JavaScript specifically:
// `\s` is Unicode White_Space plus U+FEFF minus U+0085, so it also admitted a
// form feed, a vertical tab and every Unicode space, none of which the grammar
// names at any position (#806). Narrowing to `[ \t]` would not be the fix here,
// because the tab has to go too; the terminal the clause writes is a literal
// space. `#795`/`#798` did the same to the colon fence's slots (spec carve#894
// widened the padding slots and carve#905 reverted them).
//
// The label slot appears in two alternatives and is ONE slot with one role, so
// both spellings carry the same terminal -- otherwise ```js "T" [L] and
// ``` "T" [L] would disagree about a tab for no reason a reader could state.
//
// AND THE OPENER SLOT IS EXACTLY ONE SPACE (carve#912). `fenced_code_block =
// code_fence_open, [space], [code_fence_info]` spells that slot with a bare
// `space`, and this read ` *` - so ``` ```<SP><SP>php ``` opened a php fence
// here, as it did in carve-php, carve-rs and the executable spec. The ruling
// is that the production is right and the four lax artifacts narrow. With two
// spaces the second one reaches `language_info`, whose class holds no space,
// the opener matches no shape, and the INVALID-FENCE FALLBACK applies: an
// inline verbatim span in a paragraph.
//
// `code_fence_info`'s OWN two metadata slots - the ones before the quoted
// header and before the [label] - stay ` +`. Those are spelled `space+` in the
// production, and carve#912 ruled only the four slots spelled with a bare
// `space`. Cardinality is per-production, not global; the colon fence's
// separator keeps its run for the same reason (carve#892).
//
// The TRAILING run before end-of-line is not a slot in `fenced_code_block`
// either, and carries `FENCE_TRAILING_WS` above: it was left at `\s` when the
// slots were narrowed, so ```` ```<BOM> ```` opened a fence in this engine while
// carve-rs and carve-php both read the line as prose. Opener and closer are
// one run seen from two ends (carve-js#805), and carve#1285 took the tab out of
// this run too.
// Groups: 3 lang, 4|6 header (quoted, incl. quotes), 5|7|8 label (incl. brackets).
const RE_FENCE = new RegExp(
  '^()(`{3,}|~{3,}) ?(?:([a-zA-Z0-9_+#/.-]+)(?: +("[^"]*"))?(?: +(\\[[^\\]]*\\]))?' +
    '|("[^"]*")(?: +(\\[[^\\]]*\\]))?|(\\[[^\\]]*\\]))?' +
    FENCE_TRAILING_WS,
)
// Bullets are `-` and `*` only. Unlike Markdown/djot, `+` is not a Carve bullet
// -- it is reserved as the list-continuation marker (PART 9 §17), so a lone `+`
// is unambiguous and a `+ x` line is ordinary paragraph text. A marker is a list
// item only with non-empty content: a content-less marker (`-`, `- `, `-   ` --
// bare or trailing whitespace only) is NOT a list, it is paragraph text.
// The leading indentation is matched ATOMICALLY, via the `(?=(...))\1` idiom.
// A plain `([ \t]*)` is greedy and BACKTRACKS: on a line the pattern does
// not match, the engine gives back one whitespace character at a time and retries
// the marker at every position, so the test costs O(indent) attempts rather than
// one. Deeply indented lines are exactly where these run most - a nested list
// tests every marker shape on every line at every level - and it dominated
// parsing a list ladder: RE_ORDERED alone took 2.1 us per call at indent 400
// against 20 ns at indent 0, and 15% of the whole parse.
//
// Semantics are unchanged, and provably so: every alternation after the prefix
// begins with a NON-whitespace character, so a shorter whitespace run can never
// let the rest of the pattern match. Backtracking into it could only ever fail.
// The capture numbering is unchanged too - the lookahead's group takes slot 1 and
// holds the same indent the old group did.
// INDENTATION IS `whitespace`: A SPACE OR A TAB (markup-carve/carve#977, PART
// 7 -- ONE WHITESPACE DEFINITION, IN EVERY CONSTRUCT; the `indent` production
// is named there among the eleven that read it). The content slot after the
// marker is the same definition read the other way round: MARKER REQUIRES
// CONTENT (PART 2) is satisfied by ANY character that is not one of the four,
// U+000B and U+000C included.
//
// THESE CLASSES USED TO BE THE HOST LANGUAGE'S, MINUS ONE EXCEPTION AT A TIME.
// They read `[^\S\u00a0\ufeff]` - JavaScript's `\s` with NBSP and U+FEFF
// carved back out, each carve-out added by its own bug (#790: a U+FEFF before a
// marker was skipped here as indentation while carve-php and carve-rs kept the
// line literal). What the exceptions could not reach was everything else `\s`
// holds: a VERTICAL TAB before a bullet was indentation, so `<VT>- a` was a
// list and `carve fmt` wrote the character away, and every Unicode space did
// the same. Naming the two indentation characters directly retires both
// exceptions and the class that needed them.
//
// Scoped to marker RECOGNITION on purpose. `RE_BLANK_LINE` below decides what a
// BLANK LINE is, which moves document structure rather than what a line opens;
// it spells the same two characters, which is now the point rather than a
// coincidence.
const RE_UNORDERED = /^(?=([ \t]*))\1[-*] +[ \t]*([^ \t].*)$/
// Ordered marker: decimal, a single letter (alpha), or a roman-numeral
// run, then `.` or `)`. The dialect is fixed by the FIRST item (see
// olKindOf); letter/roman markers are ambiguous w.r.t. paragraphs (§10).
//
// BARE-DOT MARKER (Carve addition; proposal for carve#315). The value may be
// EMPTY when the delimiter is `.`: a bare `. ` is a decimal ordered marker that
// counts from 1. The empty branch is the zero-width lookahead `(?=\.)`, so it
// fires only before a `.` and a bare `)` can never match -- `) text` collides
// with prose parentheticals far more often, and AsciiDoc (the source of the
// shorthand) uses `.` only. Capture groups are unchanged, so every call site
// keeps working: [1] indent, [2] value ('' when bare), [3] delimiter, [4] content.
const RE_ORDERED =
  /^(?=([ \t]*))\1([0-9]+|[ivxlcdm]+|[IVXLCDM]+|[a-z]|[A-Z]|(?=\.))([.)]) +[ \t]*([^ \t].*)$/
// Task states (matches djot-php): `x`/`X` are checked; ` `, `-`, `_`,
// `>`, `?` are all accepted and render as an unchecked checkbox.
const RE_TASK = /^(?=([ \t]*))\1[-*] +\[([ xX\-_>?])\] +[ \t]*([^ \t].*)$/
// A list-item attribute block ABUTTING the marker: a bullet (`-`/`*`) or an
// ordered marker directly followed by `{...}` (no space), then the marker's
// required space and content. The brace attaches its attributes to the <li>
// (Carve addition, grammar `item_attributes`). The brace body uses the same
// quote-aware subpattern as the inline span tail (RE_SPAN_TAIL).
// The ordered branch carries the same bare-dot alternative as RE_ORDERED, so
// `.{#x} text` is an item like `1.{#x} text` and `-{#x} text` are: the shape is
// marker + [attrs] + space + content, and the block sits BEFORE the required
// space rather than competing with it. A block with nothing after it is not a
// marker in any form (`.{#x}text`, `1.{#x}text`, `-{#x}text` are all text).
const RE_ITEM_ATTR =
  /^([ \t]*)((?:[-*])|(?:[0-9]+|[ivxlcdm]+|[IVXLCDM]+|[a-z]|[A-Z]|(?=\.))[.)])\{((?:[^}"'\n]|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')*)\}( +[^ \t].*)$/
// Strip a valid abutting `{...}` from a marker line so the bare marker regexes
// match, returning the stripped line plus the parsed attributes. Returns null
// when there is no abutting brace or the brace is not a valid attribute payload
// (then `-{...}` is not a marker and the line stays ordinary text, mirroring the
// inline-span disambiguation, grammar §14).
function extractItemAttr(line: string): { stripped: string; attrs: Attrs | undefined } | null {
  const m = RE_ITEM_ATTR.exec(line)
  if (!m) return null
  if (!isValidInlineAttrPayload(m[3]!)) return null
  const attrs = parseAttrs(m[3]!)
  // The blessed empty block (`-{} text`) exists to STRIP the braces, not to
  // record anything: it declares no id, class or key. Recording an empty attrs
  // object would make `-{} x` and `- x` different documents that render the
  // same, and the writer emits the shorter of the two - so a formatted item
  // came back without the object and `parse(fmt(x)) == parse(x)` did not hold
  // (issue 359). carve-rs already records nothing here.
  return { stripped: m[1]! + m[2]! + m[4]!, attrs: isEmptyAttrs(attrs) ? undefined : attrs }
}

/**
 * ONE WHITESPACE DEFINITION, IN EVERY CONSTRUCT (markup-carve/carve#977, PART
 * 7). Carve's whitespace is four characters - U+0020, U+0009, U+000A and
 * U+000D - and EVERY OTHER CHARACTER IS CONTENT, with U+000B and U+000C named
 * there as the two an implementation is likeliest to admit by accident.
 *
 * This was `[ \t]`, the host language's `\s` minus U+00A0. A class with
 * one exception carved out of it is still the host language's class: a vertical
 * tab, a form feed, an OGHAM SPACE MARK and every Unicode space were whitespace
 * to the emptiness tests that call this and content everywhere else in the
 * parser. An inline footnote `^[<VT>]` came out literal text where
 * `^[<NBSP>]` came out a footnote, on the same reading of the same rule.
 *
 * The NBSP exception is gone because it is no longer an exception: U+00A0 is
 * simply not one of the four, so nothing has to remember it.
 */
const TRIM_STRUCTURAL_RE = /^[ \t\n\r]+|[ \t\n\r]+$/g

function trimStructural(text: string): string {
  return text.replace(TRIM_STRUCTURAL_RE, '')
}

// A TABLE CELL PADS WITH A SPACE. `delimiter_cell`, `header_cell`, `data_cell`,
// `rowspan_marker` and `colspan_marker` each spell their padding slots `{space}`
// (grammar.ebnf), and PART 7's MARKER SEPARATORS AND PADDING SLOTS says a tab is
// syntax ONLY in a line's leading indentation run. Every one of these slots sits
// after the row's opening `|`, so every one of them is inline and takes a space.
//
// It was `trimStructural`, i.e. `\s` minus U+00A0, so a tab satisfied a padding
// slot in this engine and in the other two - the production was ahead of every
// implementation of it (carve#910, carve-js#803).
//
// A tab here is not a rejection, it is CONTENT: it stops being padding and stays
// where it was written. At `delimiter_cell` the consequence is structural rather
// than textual - the cell is no longer a delimiter cell, so its row promotes no
// header and assigns no alignment, and the `---` run is prose that smart
// typography renders as an em dash.
//
// A RUN, not a first character. Spelled as "the first character must be a space"
// this passes `<TAB>a` and still lets `<SP><TAB>a` through; corpus 256 carries a
// mixed run beside each tab-first case at both ends of all five productions.
const trimCellPadding = (text: string): string => {
  let start = 0
  let end = text.length
  while (start < end && text.charCodeAt(start) === 0x20) start++
  while (end > start && text.charCodeAt(end - 1) === 0x20) end--
  if (start === 0 && end === text.length) return text

  return text.slice(start, end)
}

// A BLANK LINE IS SPACE AND TAB AND NOTHING ELSE. The grammar names the class
// twice over: `blank_line = {whitespace}, newline` (grammar.ebnf:246) over
// `whitespace = ' ' | '\t'` (:2206). Nothing widens it for this position.
//
// It was `trimStructural(line) === ''`, i.e. `\s` minus U+00A0, which in
// JavaScript specifically is Unicode White_Space PLUS U+FEFF MINUS U+0085 - a
// legacy set rather than a property. Twelve characters the grammar calls content
// therefore ended a paragraph here, and a U+FEFF ended one in this engine alone,
// while the very same mark rendered as ordinary text INSIDE a paragraph: content
// in one position and absence of content in another, which PART 1 rules out in
// as many words ("ONE, and only there: a U+FEFF anywhere else is an ordinary
// zero-width character", grammar.ebnf:85-90). carve-rs reads exactly this class
// already; carve-php reads it but for U+000B (markup-carve/carve#890).
//
// A literal class, not a trim, because a trim is what let a wider set in: there
// is no `String.prototype` method that spells THIS class, and the native `trim()`
// fast path `trimStructural` takes carries the legacy set too.
const RE_BLANK_LINE = /^[ \t]*$/

function isBlankLine(line: string | undefined): boolean {
  // A non-existent line (past EOF) is NOT a blank line: lookahead loops must
  // terminate at EOF, not treat it as an endless run of blank lines.
  //
  // This is asked of every line at every nesting level, so on a deep container
  // it is one of the parse's hottest paths (markup-carve/carve#752) - 17.8% of
  // a depth-200 ladder's parse. Rewriting it as the hand loop the class
  // describes was measured and was SLOWER, reproducibly: 54.8 ms against 49.9
  // on that ladder, three runs each. V8 compiles this class to native code, and
  // the loop's per-character `charCodeAt` does not beat it. Left as the regex.
  return line !== undefined && RE_BLANK_LINE.test(line)
}

// THE CONTINUATION MARKER IS A LONE `+` (PART 9 §17). `continuation_marker =
// '+', newline` names no whitespace at all; the leading run is the line's
// INDENTATION (`whitespace`, where a tab IS syntax) and the trailing run is the
// same tolerated `TRAILING_WS` every delimiter line carries.
//
// It was a `trimStructural(l) === '+'` at four sites and a `raw.trim() === '+'`
// at a fifth -- `\s` minus U+00A0, and the native trim's full `\s` -- so
// `+<BOM>` opened a continuation here and stayed prose in carve-rs and carve-php
// (carve-js#811), as did `+<VT>`, `+<FF>`, `+<OGHAM SPACE>` and every Unicode
// space. The two spellings did not even agree with each other: a `+<NBSP>` line
// was a marker to the definition prepass and prose to the block lexer, so a
// definition after it was collected by one and rendered by the other.
//
// ONE predicate, for the reason `fenceCloseRe` is one producer.
const RE_CONTINUATION_MARKER = new RegExp('^[ \\t]*\\+' + TRAILING_WS)

function isContinuationMarker(line: string): boolean {
  return RE_CONTINUATION_MARKER.test(line)
}

const RE_BLOCKQUOTE = /^>(?: (.*)|)$/
// Fences are a run of 3+ colons (group 1). A longer opener nests: a
// `::::` block contains `:::` blocks, and only a bare closer of equal-or-
// greater length closes it (djot fence-length rule).
// A `:::` opener carries NO inline `{...}` attributes (strict djot): the fence
// line is `colon_fence [space type [space "header"] [space [label]]]` and
// nothing else. Any trailing `{...}` (or other text not matching that shape)
// makes it not a fence, so the line is an ordinary paragraph. Class/id attach
// via a PRECEDING `{...}` block-attribute line.
// The "header" keeps its role (admonition title / summary). The type word must
// be separated from the fence by at least one literal space or tab; a glued
// `:::note` is paragraph text. The [label] is an inert grouping id a group
// extension (tabs) consumes -- the canonical replacement for the tabs
// `{label="..."}` / heading convention. A label on a typed opener must be
// whitespace-separated from the preceding token (PART 9 §12); a typeless label
// may sit against the fence and is handled by RE_DIV_OPEN.
// The type word is a grammar `identifier`: `(letter | '_'), {letter | digit
// | '_' | '-'}`, so it may start with an underscore (matches carve-php /
// carve-rs). Groups: 2 kind, 3 header (quoted), 4 label (bracketed).
// TWO ROLES ON ONE LINE, ONE TERMINAL. PART 7's MARKER SEPARATORS AND
// PADDING SLOTS decides the terminal by POSITION, not by role: "A tab is
// syntax ONLY in a line's LEADING INDENTATION RUN. From the first
// non-whitespace character of the line onward a tab is not relevant to
// syntax at all." Every slot on this line sits after the fence run, so
// every slot is `space`:
//
//   - the slot immediately after the fence run is a MARKER SEPARATOR,
//     because the token after it selects which of the four blocks the
//     line opens;
//   - the admonition's title and label slots are PADDING, because the
//     type word has already decided the block.
//
// The roles survive, but only to decide what a FAILED match means. A
// separator that does not match leaves the line unrecognized as that
// construct; a padding slot that does not match leaves a token unconsumed
// and the surrounding production then rejects the line. Both land on
// prose, which is what `admonition_open`'s own prose states outright:
// "`::: note<TAB>\"T\"` is not an admonition opener -- the line stays
// prose". Neither slot may be spelled `\s` either: in JavaScript that also
// admits a form feed, a vertical tab and every Unicode space, none of
// which the grammar names at any position (#786, #795; spec carve#886
// widened the padding slots and carve#905 reverted them).
const RE_ADMONITION_OPEN = /^(:{3,}) +([a-zA-Z0-9_][\w-]*)(?: +("[^"]*"))?(?: +(\[[^\]]*\]))?[ \t]*$/
// The closer takes the OPENER's trailing run (`TRAILING_WS`), not `\s`. This is
// the pair carve-js#805 names: carve-js#794 / carve-js#798 narrowed
// `RE_ADMONITION_OPEN` above to `[ \t]*$` and left this one wide, so a mark that
// could not open a block could still close one.
const RE_ADMONITION_CLOSE = new RegExp('^(:{3,})' + TRAILING_WS)
// Line block: the opener is `::: |` ONLY (a bare pipe type token). The old
// `::: line-block` keyword is no longer special -- it falls through to the
// admonition branch and renders as an ordinary `<div class="line-block">`
// with NO hard-break / stanza / leading-whitespace handling. Output of the
// pipe form is unchanged (`<div class="line-block">` with `<br>` breaks).
// Mirrors carve#119 / carve-php#124.
const RE_LINE_BLOCK_OPEN = /^(:{3,}) +\|[ \t]*$/
// Hard-break block: `::: \` (colon fence + a single trailing backslash). Like
// the line block it emits a `<div>`, but with class `hardbreaks`: the body is
// parsed as ordinary blocks and soft breaks become hard breaks ONLY in the
// div's DIRECT paragraph children (nested blocks keep ordinary soft breaks),
// with no leading-whitespace preservation. carve spec #207 / 88-line-blocks;
// matches carve-rs / carve-php (carve-js was the lagging impl).
const RE_HARDBREAKS_OPEN = /^(:{3,}) +\\[ \t]*$/
// Fenced block quote: a colon fence plus a bare '>' type token. A second
// SPELLING of the block quote, not a new block: the body is parsed as ordinary
// blocks and the node is the one a '> ' prefix produces, so the two forms are
// the same tree. Third member of the sigil-fence family beside the line block
// and the hard-break block, and it takes the same required space before the
// token (markup-carve/carve#1718).
const RE_QUOTE_BLOCK_OPEN = /^(:{3,}) +>[ \t]*$/
// Generic fenced div: a bare `:::` opener with NO type word (djot's generic
// container). A typed `::: word` routes to parseAdmonition. An inline
// `::: {.class}` is NOT a div (strict djot) -- use a preceding attribute
// line. A bare opener MAY carry an inert `[label]` (a typeless tab member,
// `::: [First]`) which a group extension consumes. As the FIRST token after
// the fence the label may sit directly against it (`:::[First]`), exactly as a
// code fence allows ```[NPM]; a label after a TYPE word needs a space and is
// handled by RE_ADMONITION_OPEN. Shares the `:::` closer.
// Groups: 2 label (bracketed).
const RE_DIV_OPEN = /^(:{3,}) *(\[[^\]]*\])?[ \t]*$/
// Definition list (§4.5). A TERM line is exactly two colons + space(s)
// + text — the `(?!:)` keeps it distinct from a `:::` div/admonition. A
// DEFINITION line is a colon + two-or-more spaces + text.
// PART 9's MARKER REQUIRES CONTENT rule applies to `::` as it does to a bullet:
// a marker line with trailing whitespace only is paragraph text, and the rule
// "ignores trailing whitespace" so `::` and `:: ` behave identically. Without
// the `(?=\S)`, `:: ` was a paragraph and `::··` a definition list - stripping
// one trailing space changed the document's structure, which is what the rule
// exists to prevent (markup-carve/carve#512).
// The separator after `::` is the SPACE character, per
// `definition_term = "::", space, inline_content` and `space = ' '`. A tab
// does not satisfy it and the line stays paragraph text - the same rule the
// bullet, ordered, heading, quote and definition markers already follow
// (carve#532).
// The separator is ONE literal space; whitespace after it is stripped, not
// content. `(?=\S)` straight after ` +` required the term to start on a
// non-space, so `:: <TAB>x` fell through to a paragraph while `::   x` was a
// term (carve-js#722, spec markup-carve/carve#794).
//
// The leading space stays REQUIRED - `::<TAB>x` is still a paragraph, because
// a tab does not satisfy the marker's separator at all (corpus
// 176-a-marker-separator-is-a-space-never-a-tab). What changed is only what
// may follow that space.
// The content test is `[^ \t]`, not `\S`. A TERM WHOSE WHOLE CONTENT IS ONE
// VERTICAL TAB IS A TERM: PART 7's ONE WHITESPACE DEFINITION, IN EVERY
// CONSTRUCT makes U+000B and U+000C content, and spells out that a
// MARKER REQUIRES CONTENT rule is SATISFIED by one. `\S` read `:: <VT>` as a
// content-less marker and left the whole definition list as a paragraph, while
// `:: <SOH>` - a C0 control the host class happens not to carry - made the
// list. One class, two answers, decided by which control the author typed.
const RE_DEFLIST_TERM = /^::(?!:) [ \t]*(?=[^ \t])(.+)$/
// A CONTENT-LESS marker line: `::` or `:` followed by whitespace and nothing
// else. It is not a marker - both patterns above require content - so it stays
// paragraph text, and it CLOSES any open term or definition rather than folding
// into it (carve-js#731; carve-rs and carve-php both close).
//
// At least one space is required, so a bare `::` is untouched: all three engines
// already agree on that line and it is a different shape.
const RE_DEFLIST_MARKER_EMPTY = /^::?(?!:)[ \t]+$/

// A definition body: `:` plus a SEPARATOR RUN of one or more spaces, then
// content. Group 1 is the run and group 2 the content.
//
// THE SEPARATOR IS ANY RUN OF SPACES, AND ITS WIDTH SETS THE BODY'S CONTENT
// COLUMN (PART 9 §16, markup-carve/carve#1757). The body's column is
// `1 + separator width`, so `: x` establishes column 2, `:  x` column 3 and
// `:    x` column 5, and a continuation qualifies by REACHING its own body's
// column - the PART 9 §24 C1 rule a footnote body and a list item already
// follow. The pattern used to demand TWO spaces and hand every width the same
// fixed column 3, which made the definition body the one marker in the language
// that would not take a single separator space (`- item`, `1. item`, `> quote`
// and `:: term` all do) and the one that measured its separator against a fixed
// width instead of its own. A bullet has always answered this way: `-   first`
// puts its content column at 4 and a continuation at 2 does not reach it.
//
// ONE SPACE IS CANONICAL. A wider run is accepted and the writer narrows it -
// see `renderDefinitionList`, which also carries the body's continuations down
// by the same amount, because narrowing the separator narrows the column.
//
// What changed for `: x` is that it now HAS a meaning. It used to have none,
// and this engine folded it into the `<dt>` above as term text while the spec's
// oracle left it a stray paragraph.
//
// THE SEPARATOR IS GREEDY AND THE CONTENT CANNOT START WITH A SPACE, which is
// one statement, not two: the run is the separator, so nothing is left of it
// for the content to begin with. Written `(.+)` the run BACKTRACKS - `:` plus
// two spaces and nothing else matched as a one-space separator over a
// one-space body, which is a `<dd>` where carve-js#731 rules a CONTENT-LESS
// marker line closes the open term and stays paragraph text, as carve-rs and
// carve-php both do.
//
// It settles the wider content-less line the same way, and that is a change:
// `:` plus three or more spaces used to backtrack into a body of one space,
// which trims to an empty `<dd>`, so the same content-less line answered one
// way at two columns and another at three. Nothing pins either width - no
// corpus document, no test, and the two answers were an artifact of where
// backtracking happened to stop rather than a rule anyone wrote. A content-less
// marker line is content-less at every width now. THE PORTS SHOULD MATCH IT.
const RE_DEFLIST_DEF = /^:( +)([^ ].*)$/

/**
 * The content column a description marker hands its body out at: `:` plus the
 * width of its separator run.
 *
 * Named because the prepass, the fence scope and the body collector all measure
 * against it, and a rule with several spellings is how one of them comes to
 * answer differently (carve#755) - which is exactly what happened to the fixed
 * `3` this replaces.
 */
function deflistContentCol(separator: string): number {
  return 1 + separator.length
}

/** The separator run on a description line, wherever it is indented. */
const RE_DEFLIST_SEPARATOR = /^[ \t]*:( +)/
// A definition marker's separator must START with a literal space (U+0020),
// not a tab (#288) -- matching carve-rs and every marker whose grammar
// delimiter is `space` (heading `# `, list bullets, task `[ ]`). The `]: \s*`
// requires that first space, then folds any further whitespace into the
// separator; `\s+` alone would wrongly accept a leading tab. A tab after the
// colon therefore forms no definition and the line stays a paragraph.
// The term is `(letter | digit)+`, and the grammar enumerates `letter` as ASCII
// a-z plus A-Z: no case rule, no length rule, no Unicode. This required ALL
// UPPERCASE, so `*[d]: dozen` was a paragraph here and a definition in carve-rs
// and carve-php - and a definition renders nothing, so the document quietly
// lost either the line or the expansion when it moved (carve#791).
// The separator run uses the White_Space PROPERTY, not `\s`, for the reason
// RE_DESTINATION_WHITESPACE below spells out: JavaScript's `\s` is White_Space
// plus U+FEFF, so a byte-order mark at the start of an expansion was eaten here
// and kept by carve-rs and carve-php. U+0085 went the other way - it IS
// White_Space, is NOT in `\s`, and stayed in the title. Same swap, same fix,
// one production over from markup-carve/carve#806 (carve#844).
//
// The literal space after `]:` stays literal: the separator MUST start with
// one, which is what makes a tab-first line a paragraph.
//
// THE SEPARATOR IS A RUN OF ASCII SPACES, AND THE NEXT CHARACTER IS CONTENT
// (carve#892). `abbreviation_definition` now spells the slot `space+`, which
// is a CORRECTION rather than a widening: the production said `space` while
// all four readers consumed a run, so the grammar forbade a shape nothing
// rejected.
//
// The half that moves here is the OTHER one. This read `\p{White_Space}*`
// after the mandatory space, so the run swallowed a no-break space, a tab and
// every Unicode space - and the first character that is not an ASCII space
// ENDS the separator and BEGINS the content. `*[HTML]: <NBSP>Hyper` expands to
// a title that starts with the character; carve-php already kept it and this
// engine and carve-rs consumed it.
//
// An `abbreviation_expansion` is a RAW STRING, so a tab after the run survives
// into the title too. The footnote form answers that one differently, and not
// because its separator differs - see RE_FOOTNOTE_DEF below.
//
// CARDINALITY HERE IS THE OPPOSITE CALL FROM carve#912's, deliberately. A
// MARKER SEPARATOR takes a run; a PADDING SLOT takes exactly one. They are
// different positions, not a contradiction: the token after this slot is the
// definition's content, where the slot after a fence run is padding before
// metadata the fence has already decided it will carry.
//
// The literal space after `]:` stays literal and mandatory, which is what
// makes a tab-first line a paragraph.
//
// THE CONTENT CLASS IS `[^]`, NOT `.`. JavaScript's `.` excludes U+2028 and
// U+2029, and those two are the only characters this rule's own table calls
// CONTENT that a dot cannot match. While the separator consumed a Unicode run
// the question never arose - the run ate them before the capture was reached -
// so narrowing the run is exactly what exposed it, and `*[HTML]: <U+2028>Hyper`
// became a paragraph instead of an abbreviation whose title starts with the
// character. Raised by codex review on the change that introduced it.
const RE_ABBR_DEF = /^\*\[([A-Za-z0-9]+)\]: +(?![ \t]*$)([^]+)$/u
// Block-level reference-link definition: `[label]: url "title"` or
// `[label]: url 'title'` (grammar.ebnf link_title allows both quote
// styles). The destination is a bare token; an angle-bracketed `<url>`
// is the separate `autolink` production, not a ref-def destination
// (grammar.ebnf:243,251), so it is intentionally not accepted here.
// A leading `@` label is reserved for citation defs (`[@key]: entry`, #90),
// handled by the citations extension — never a link destination.
// Per grammar.ebnf:738,741,755 the destination ends at the first whitespace;
// a following quoted run is the title. Anything else after the destination is
// ignored (not a valid title), so the definition still registers with the bare
// token as its destination -- it is NOT rejected. carve-rs matches this.
// The title groups allow a backslash-escaped quote inside (`"a\"b"`) so the run
// does not truncate at the first inner quote; the captured value is then run
// through unescapeAttrValue at consumption, matching the inline title path.
/**
 * A link reference definition, as PART 9R's `linkDefs` symbol table describes
 * it: `label -> (url, title?, attrs?)`. `attrs` come from a TRAILING attribute
 * block on the definition line and transfer to every link that resolves the
 * label (PART 9R R1, carve#604).
 */
export interface LinkDef {
  /** Label spelling carried by the winning definition for canonical output. */
  rawLabel?: string
  /**
   * Zero-based index of the line the definition was written on. Kept so PART 12
   * §10's node can carry a `pos` and so the hoisted definitions come out in
   * SOURCE order rather than map order (carve-js#690).
   */
  line?: number
  href: string
  title?: string
  attrs?: Attrs
}

/**
 * Split a TRAILING attribute block off a definition line (carve#604).
 *
 * Scanned rather than matched: an attribute value may hold a `}` inside quotes
 * (`{data-x="}"}`), and a `\{[^}]*\}` pattern stops at that brace and drops
 * every attribute on the line silently. Only a `}` outside quotes closes it.
 *
 * The block must be preceded by whitespace and end the line, so `[a]: /u{.x}`
 * keeps the braces in the DESTINATION, matching the production's
 * `space, attributes`.
 *
 * EVERY rejection here hands the block BACK as content - `[line, null]`, the
 * line untouched. That is the third outcome AN INVALID BLOCK IS NOT
 * `attributes` asks for (markup-carve/carve#933), distinct both from "there was
 * no block" and from "the block was empty". Where those two are the same value
 * the failure has nowhere to be observed: the scan peels the braces off before
 * anything validates them, so a rejected block was already consumed and
 * DISCARDED, and the line went on to parse as a definition with the author's
 * `{...}` gone from the page - the exact outcome PART 7 names as the one to
 * avoid, and the reason the end-of-line anchor exists at all.
 */
function splitTrailingAttrBlock(line: string): [string, string | null] {
  // `[ \t]+$`, not `\s+$`: this is a LINE's trailing padding, so PART 7's four
  // characters and nothing else (a `\n` cannot occur in a line). With `\s` a
  // trailing vertical tab was invisible to the anchor, so `[a]: /u {.c}<VT>`
  // attached the block and `[a]: /u {.c}<SOH>` did not.
  const end = line.replace(/[ \t]+$/, '')
  if (!end.endsWith('}')) return [line, null]
  let quote: string | null = null
  let open = -1
  for (let i = 0; i < end.length; i++) {
    const c = end[i]!
    if (quote) {
      if (c === '\\') i++
      else if (c === quote) quote = null
      continue
    }
    if (c === '"' || c === "'") {
      quote = c
      continue
    }
    if (c === '{') {
      if (open === -1) open = i
      continue
    }
    if (c === '}' && open !== -1 && i === end.length - 1) {
      // THE SLOT IS EXACTLY ONE SPACE (carve#912). `reference_definition` ends
      // `[space, attributes], newline` - a bare `space` - and this accepted any
      // run: it tested ONE character for `\s` and then stripped the whole run
      // with `/\s+$/`. So `[a]: /u<SP><SP>{.c}` attached the block here, as it
      // did in all three engines and in the executable spec.
      //
      // Both ends are checked, deliberately. Testing only the character before
      // the brace accepts `<TAB><SP>{`, and testing only the one before that
      // accepts `<SP><TAB>{`; a rule about a RUN written as a rule about one
      // end has been shipped in this org in three languages on one day. The
      // character before the space must exist and must not itself be padding.
      const pad = end[open - 1]
      const before = end[open - 2]
      if (pad !== ' ' || before === undefined || before === ' ' || before === '\t') {
        return [line, null]
      }
      // And the INTERIOR is space-only too (markup-carve/carve#906): this is an
      // `inline_attributes` block, whose every whitespace slot the grammar
      // spells `space`. Rejecting HERE rather than at `parseAttrs` keeps the
      // braces on the line, so the definition is simply not recognized and the
      // line falls through to a paragraph - dropping them at the parse step
      // would delete the block from the output instead of showing it.
      const inner = end.slice(open + 1, end.length - 1)
      if (inlineAttrPayloadHasTab(inner)) return [line, null]

      // AN INVALID BLOCK IS NOT `attributes`, SO THE LINE IS NOT A DEFINITION
      // (markup-carve/carve#933). `[space, attributes]` names the `attributes`
      // production, and a balanced `{...}` that production does not accept is
      // not an instance of it - it is leftover content, and the end-of-line
      // anchor (carve#911) disposes of it like any other leftover: the line
      // falls back to prose. So `[a]: /u {#}` is NOT a definition and renders as
      // the paragraph `[a]: /u {#}`; the same holds for `{ }`, `{=}` and `{}`.
      //
      // The deciding argument is that the same characters already read this way
      // one construct away: `x {#}` in a paragraph keeps the braces as text,
      // because `attributes` rejects that block there too and inline content
      // keeps what it cannot parse. Two readings of `{#}` one construct apart is
      // what this removes.
      //
      // The gate is the INLINE one, and both halves of it. `isValidAttrPayload`
      // rejects `{#}` and `{=}`, where no token matches; the emptiness test
      // rejects `{ }` and `{}`, which are valid syntax naming no attribute. The
      // inline scanner refuses to consume either kind for the same reason -
      // there they stay literal text - so the two constructs now agree, which is
      // the whole argument for the rule.
      if (!isValidInlineAttrPayload(inner) || isEmptyAttrs(parseAttrs(inner))) {
        return [line, null]
      }

      // The INTERIOR, which is what `parseAttrs` takes everywhere else - the
      // inline scanner hands it the payload between the braces. This handed it
      // the braced text, and the two disagreed about the same block: an unquoted
      // value is a `\S+` run, so `{k=v}` VALIDATED as `k=v` and PARSED as
      // `k=v}`, publishing `k="v}"`. One string for both readings is the same
      // point the clause makes about `{#}`.
      return [end.slice(0, open - 1), inner]
    }
  }
  return [line, null]
}

// What ENDS a link destination: the Unicode White_Space property, and only that.
//
// NOT `/\s/`. JavaScript's `\s` is White_Space PLUS U+FEFF - a legacy addition
// in the language, not a Unicode property - so a byte-order mark inside a
// destination ended it here and the whole link fell back to literal text, while
// U+200B (also invisible, also not White_Space) was accepted. The grammar says
// which test to use in as many words: "ZERO-WIDTH characters (U+200B, U+FEFF)
// are NOT whitespace and ARE ordinary destination characters. The test is the
// Unicode White_Space property, not 'is invisible'."
//
// carve-rs and carve-php both built the link (carve-js#750,
// markup-carve/carve#806). The same rule governs a reference definition, which
// is built from this same production.
const RE_DESTINATION_WHITESPACE = /\p{White_Space}/u

// The AUTOLINK body's share of the same rule, as a character-class FRAGMENT to
// be negated by its users. markup-carve/carve#844 settled `url_char` as
// `unicode_url_char - format_char - control_char`, so the fragment names three
// PROPERTIES: White_Space, which is what ends any URL run, General_Category Cf,
// and General_Category Cc.
//
// EACH OF THE THREE IS LOAD-BEARING, and none subsumes another:
//
//  - Cf is what keeps a host from carrying an invisible character and linking
//    somewhere other than what the page shows. It is a spoofing surface rather
//    than an authoring convenience, and it covers U+FEFF, which used to be
//    named here as a literal because carve#860 had not yet ruled.
//  - Cc is the term the executable spec's own class test caught missing.
//    `unicode_url_char` means "non-whitespace, non-ASCII", and the C1 block
//    U+0080-U+009F satisfies exactly that: those are Cc, are not Cf, and only
//    U+0085 is White_Space. A rule written as "non-ASCII and not Cf" therefore
//    admits fourteen invisible control characters while excluding every C0 one.
//    Cc also carries the C0 block and U+007F, which is where U+0001 goes out.
//  - White_Space still carries U+0085 (Cc too, so doubly out), U+00A0 and
//    U+3000, which are neither Cf nor Cc.
//
// `link_destination` is a DIFFERENT production and does NOT narrow: a format
// character in an inline destination or a reference definition is an ordinary
// destination character (see RE_DESTINATION_WHITESPACE, which keeps
// White_Space alone). `scheme` does not move either and stays ASCII.
//
// Both spellings of the body -- the core angle autolink here and the bare-URL
// matcher in `autolink.ts` -- share this fragment, so the parser and the
// extension cannot answer the question differently.
export const AUTOLINK_BODY_EXCLUDED = '\\p{White_Space}\\p{Cf}\\p{Cc}'

// The SAME production, and therefore the same test. `RE_LINK_DEF` matched the
// destination with `(\S+)`, skipped the separator run with a class built on
// `\S`, and introduced the title with `\s+` - so the rule the scanner above
// now follows stopped at the inline form. A BOM was dropped as separator
// whitespace, truncated the destination where it sat mid-string, and made a
// `<...>` destination collapse to a bare `<`; U+0085, which IS White_Space and
// is NOT in `\s`, went the other way and stayed in the href where carve-php and
// carve-rs both ended the destination on it (markup-carve/carve#806).
//
// THE LEADING CLASS EXCLUDES U+FEFF, and the reason the old carve-out gave for
// keeping it is worth recording, because it was measured on the narrower case.
// It read: "all three engines skip a BOM written before the `[`". True at the
// DOCUMENT START - and there every engine skips it because the parser STRIPS
// the document's leading mark before any line is matched, not because this
// class admits it. On any later line the engines keep the line literal, and
// this one resolved a definition (#790).
//
// So the strip still carries the document-start case, and the class no longer
// has to.
//
// THE LEADING RUN AFTER THE SEPARATOR SPACE ADMITS U+00A0, and this is the one
// slot in the file where the repo-wide "NBSP is content, not indentation" idiom
// does NOT reach. The run used to carve U+00A0 out by hand, and because the
// destination immediately after it is `\P{White_Space}+`, a no-break space there
// could neither be skipped nor started on: the whole pattern failed and the line
// was not a definition AT ALL, so every reference to the label went unresolved.
// carve-php and carve-rs both skip it and define the reference, and carve-js
// already agreed with them on U+2009, U+202F and U+3000 - so the divergence was
// specific to the one character the carve-out named (markup-carve/carve#892).
//
// The clause is explicit about both the behavior and the test, at
// grammar.ebnf:1325-1339 - "Whitespace between the mandatory separator space and
// the destination is leading whitespace and is skipped" - and at :1313-1323 -
// "WHITESPACE HERE IS UNICODE WHITESPACE -- NORMATIVE [...] The test is the
// Unicode White_Space property, not 'is invisible'". U+00A0 has that property.
//
// U+FEFF does NOT, which is why it stays out of this run and stays IN the
// destination: `[r]: <BOM>https://e.com/` keeps the mark in the href on all
// three engines, and `docs/examples/edge-cases.md:9500-9518` pins that as the
// discriminator between the two characters.
//
// The INDENT class at the front of the pattern is untouched: leading U+00A0 is
// still content there, so ` <NBSP>[r]: /u` is still not a definition.
//
// THE TITLE SLOT IS EXACTLY ONE SPACE (carve#912). `reference_definition`
// reaches the title through `link_title = space, ('\"', ...)`, one character,
// and this read `\p{White_Space}+` - so `[a]: /u<SP><SP>\"T\"` took the title
// here, as it did in all three engines and in the executable spec. Narrowing
// the CARDINALITY also settles the terminal at this slot: the run was Unicode
// whitespace, so a tab-first and both mixed runs satisfied it, and one literal
// space admits none of them. That is the shape carve#907 deliberately left
// unpinned at this slot, and it is pinned now.
//
// The slot BEFORE the destination is untouched and stays a Unicode run: the
// grammar calls that one leading whitespace, not a padding slot (the long
// note above).
//
// AND THE PRODUCTION IS ANCHORED AT END OF LINE (carve#911).
// `reference_definition` has always ended in `newline`, so what follows the
// destination and the optional title makes the production FAIL and the line is
// then an ordinary paragraph. This pattern ended `.*$`, which swallowed
// anything - so `[a]: /u zzz` registered a definition with a tail nothing in
// the grammar authorized, as it did in carve-php, carve-rs and the executable
// spec.
//
// It matters beyond tidiness, and the reason is what makes this the FIRST fix
// on this line rather than one of several: PART 7 promises that a slot which
// fails to match falls back to prose rather than silently dropping metadata,
// and here there was no prose to fall back TO. The swallowing tail ate
// whatever a failed slot rejected, so the clause's promised failure mode was
// unreachable at this line and every narrowing dropped metadata instead of
// failing visibly. With the anchor in place the tab and mixed-run forms at
// BOTH slots become paragraphs, which is why carve#907 left them unpinned
// until now.
//
// The ending run is `whitespace` - a space or a tab, the same terminal
// `blank_line = {whitespace}` takes (carve#890) - so `[a]: /u<SP><TAB><SP>` is
// still a definition.
const RE_LINK_DEF =
  /^[ \t]*\[(?!@)([^\]]+)\]: \p{White_Space}*(\P{White_Space}+)(?: (?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'))?[ \t]*$/u

/**
 * Whether `line` is a reference definition - the WHOLE production, trailing
 * attribute block included.
 *
 * `RE_LINK_DEF` cannot answer this on its own any more. The trailing attribute
 * block is taken off the line BEFORE the pattern runs (carve#604), so with the
 * pattern anchored at end of line a bare `RE_LINK_DEF.test(line)` says no to
 * `[a]: /u {.c}` - a definition by every reading, and one the corpus pins as
 * interrupting the paragraph above it.
 *
 * Nine predicates around this file asked that question with a bare `.test`,
 * every one of them meaning the whole production, and they were correct only
 * because the unanchored pattern happened to swallow the braces along with
 * everything else. One producer, so the anchor cannot come apart from the
 * split again.
 */
function isLinkDefLine(line: string): boolean {
  return RE_LINK_DEF.test(splitTrailingAttrBlock(line)[0])
}
// Footnote definition `[^label]: body`. Tested before RE_LINK_DEF, which
// would otherwise capture `^label` as a link reference label.
//
// The label is ONE-OR-MORE characters, per `footnote_label` in the grammar, so
// `[^]: /x` is NOT a footnote: it is a LINK reference definition whose label is
// `^`, and it falls through to RE_LINK_DEF to be collected as one.
//
// This engine briefly read the empty label as a footnote, on PART 11 §10a's
// then-example `[^]: %`. The clause has since withdrawn that example for this
// exact reason - the label was never optional - and §10a covers only the
// definition kinds that HAVE a node, which a link reference definition does
// not. Building the node made the non-HTML targets emit `[^]: %` where carve-rs
// and carve-php emit nothing, which looked like §10a compliance and was its
// opposite. (carve#589, carve-js#631; `[^ ]: x`, whose label is a space, is a
// footnote and is unaffected.)
//
// THE SEPARATOR IS A RUN OF ASCII SPACES, AND THE NEXT CHARACTER IS CONTENT
// (carve#892), exactly as for RE_ABBR_DEF above. This read `\s*`, so the run
// swallowed a no-break space and every Unicode space; carve-php and carve-rs
// both kept it and this engine consumed it.
//
// A TAB AFTER THE RUN is content here as well, and yet it does NOT appear in
// the body - which is not an exception to the rule but a consequence of what
// happens downstream of it. A footnote's `inline_content` is parsed as BLOCKS,
// so a leading tab is that body's own indentation run (PART 9 section 24 C1)
// and is consumed there. An abbreviation expansion is a raw string and has no
// such stage, which is why the two markers give different answers for the same
// separator.
//
// The trap this ticket recorded, and the reason the answer is stated in terms
// of the BODY: the first measurement of it read carve-rs as the
// self-consistent engine because it checked whether the footnote DEFINED
// rather than what its body contained. All three define. Check the rendered
// content, not the construct.
//
// The content class is `[^]` for the reason RE_ABBR_DEF above gives.
const RE_FOOTNOTE_DEF = /^\[\^([^\]]+)\]: +([^]+)$/

// A footnote body's own column: the indent §16 requires of a continuation line.
// The body is dedented by exactly this much, never by the first continuation
// line's actual indent - see `parseFootnoteDef` (carve-js#677).
const FOOTNOTE_BODY_COLUMN = 2
// A caption line mirrors a heading's first line (§4/§553): `^` + one-or-more
// literal spaces (the grammar delimiter is a space, not a tab) + content that
// carries at least one non-ASCII-whitespace character. Leading spaces are
// folded into the delimiter; `^ ` alone (or `^\t…`) is not a caption, exactly
// as `# ` / `#\t…` is not a heading. "Content" is tested against ASCII
// whitespace only ([ \t\n\r\f]) -- a non-breaking space (U+00A0) is content
// here, as it is everywhere else in the parser, so `^  ` IS a caption.
const RE_CAPTION = /^\^ +(.*[^ \t\n\r].*)$/
// NO TRAILING WHITESPACE (PART 2, NORMATIVE; carve#926). A `whitespace` run at
// the END OF A CONTENT LINE is DROPPED. It does not reach the output and it is
// not content.
//
// TWO THINGS WERE NARROWER HERE. The class was `[ \t\f\r]`, and `whitespace` in
// this language is a SPACE OR A TAB and nothing else (PART 1, carve#890) - so a
// trailing form feed was dropped from a heading and a caption while every other
// invisible character survived, for no reason the grammar states. U+000C and
// U+000B are CONTENT, exactly as U+00A0 and U+FEFF already were here.
//
// And the rule held only on a BLOCK'S FINAL LINE. It holds on every content
// line - see `dropTrailingWhitespace` below. PART 12 §7 asserted the opposite,
// twice, claiming a space before a SOFT BREAK renders `<p>a \nb</p>` and
// arguing from that claim that stripping breaks `to_html(fmt(x)) ==
// to_html(x)`. It has been corrected: the executable spec does not render it
// that way, and the PARSER is the half that moves.
const RE_TRAILING_WS = /[ \t]+$/

/**
 * `text` with EVERY line's trailing space-and-tab run removed.
 *
 * The multi-line form of `RE_TRAILING_WS`, for the blocks that accumulate
 * their lines before rendering: a paragraph and a definition term. Their
 * continuation lines end in a SOFT BREAK, and the run before one was kept.
 *
 * It is safe inside an inline construct that crosses a line, because the only
 * thing a line break can be inside a paragraph IS a soft break - verbatim
 * content (a code block, a raw block, a code span's own line) never reaches
 * here as raw source, and a hard break is a BACKSLASH, so the run before one
 * is not trailing.
 *
 * THE STRIP RUNS BEFORE ESCAPE RESOLUTION, INCLUDING FOR AN ESCAPED SPACE
 * (markup-carve/carve#1027). This used to carve `\ ` out of the run, on the
 * reasoning that the escape names a character the author wrote. The clause that
 * decides it is MARKER REQUIRES CONTENT in resources/grammar.ebnf: "an editor
 * stripping the trailing space cannot change the meaning", stated for the
 * bullet marker and stated as general - "the rationale is a property of the
 * separator space and applies wherever one appears". With the carve-out, `x \ `
 * was a no-break space and `x \` - the SAME document once an editor saved it -
 * was a hard break, which is the outcome the sentence exists to prevent.
 * carve-rs and carve-php were stable across that strip; this engine was the
 * odd one out, and the trailing run now goes whatever precedes it.
 *
 * The cost is that an escaped space means a no-break space mid-line and a hard
 * break in the last column. That context-dependence is deliberate and is the
 * same trade already made for the bullet marker and the definition-term marker.
 */
function dropTrailingWhitespace(text: string): string {
  return text.replace(/[ \t]+(?=\n|$)/g, '')
}
const RE_TABLE_ROW = /^\|/
// A complete standard table row opens AND closes with `|` (grammar
// standard_row). A stray leading `|` with no closing `|` (`| a`) is ordinary
// paragraph text, not a table -- so a table opener / interrupter must have the
// trailing pipe, not just a leading one. A row may carry an attribute block
// GLUED to its closing pipe (`| a |{.x}` -> <tr class="x">); rowAttrsFromLine
// validates and strips it, so the gate allows an optional trailing `{...}`.
/**
 * Exported so the linter gates on a COMPLETE row the same way the parser does.
 * A leading `|` alone is a paragraph, and a rule that reported cell syntax in
 * one would be reporting text that has no cells.
 */
export const isTableRow = (line: string): boolean => {
  if (!RE_TABLE_ROW.test(line)) return false
  if (!/\|[ \t]*$/.test(line) && rowAttrsFromLine(line).attrs === undefined) return false
  const cells = splitTableRow(rowAttrsFromLine(line).body)
  // A row needs a non-empty cell OR at least two cells: `|||` (two empty cells)
  // is a valid all-empty body row, but `||` (a single empty cell) is not a
  // table. Matches carve-php / carve-rs.
  return cells.some((cell) => cell.trim().length > 0) || cells.length >= 2
}
// A `+`-prefixed continuation row (multi-line cell). Like the grammar's
// continuation_row it ends with `|`; that trailing pipe distinguishes
// it from a `+ ` list item (which never ends with `|`). Only consumed
// inside parseTable, after a standard `|` row has opened the table.
// The tail after the closing `|` is line padding, so `[ \t]*$` and not `\s*$`
// (PART 7). With `\s` a continuation row whose line ended in a vertical tab was
// still consumed into the cell above, where the same row ending in any other
// control character became a paragraph between two tables.
const RE_TABLE_CONT = /^\+.*\|[ \t]*$/
// The trailing attribute block must be GLUED to the `)` (no intervening space)
// to attach, per the inline glue rule; a space before `{…}` makes it literal
// and the line falls back to a paragraph (inline image + literal braces),
// matching carve-rs/carve-php. Hence `\)` is directly followed by the optional
// attr group, with no `\s*` between them.
// The title slot here is the SECOND spelling of `image_title` in this file, and
// it takes the same one literal space `RE_LINK_REST` takes (carve-js#809,
// markup-carve/carve#912). Two producers for one production is how this class
// of defect starts: with `\s+` still here, a tab-titled image was literal in a
// paragraph and a captioned figure on a line of its own.
// The LINE TAIL takes PART 7's four characters (`[ \t]*$`); the DESTINATION
// keeps `[^)\s]`. Those are different slots and the difference is normative:
// PART 3 marks `unicode_url_char` WHITESPACE HERE IS UNICODE WHITESPACE, so a
// destination ends at any White_Space character, while the padding after the
// `)` is ordinary line padding and ends at nothing else. Narrowing the tail and
// leaving the destination is therefore the whole of what PART 7 asks here.
const RE_BARE_IMAGE = /^!\[([^\]]*)\]\(([^)\s]+)(?: "([^"]*)"| '([^']*)')?\)(?:\{((?:[^}"'\n]|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')+)\})?[ \t]*$/
// Frontmatter open fence: `---` with an optional format token (`---toml`,
// `---json`); bare `---` uses the default format. The space before the token is
// optional (lenient input: both `---toml` and `--- toml` are accepted; the
// no-space form is canonical). The token keeps it distinct from a thematic
// break (`-{3,}`).
//
// That slot is PADDING and takes `space` (PART 7): the `---` pair has already
// decided the block and the token only names the metadata dialect, but the slot
// sits after the first non-whitespace character of the line, where a tab is not
// syntax. `frontmatter_open`'s own prose states the case outright -- "`---<TAB>
// yaml` is not a typed opener; it is a thematic break followed by ordinary
// lines" -- so the tab comes out of the class. A form feed and a Unicode space
// were already excluded here, because this slot had been narrowed to `[ \t]`
// rather than left as `\s`; that narrowing was right as far as it went and only
// the tab had to go.
//
// AND THE SLOT IS EXACTLY ONE SPACE (carve#912). `frontmatter_open = "---",
// [space], [frontmatter_format]` spells one character and this read ` *`, so
// `---<SP><SP>yaml` opened frontmatter here as it did in all three engines.
// With ` ?` the second space reaches `frontmatter_format = (letter | digit)+`,
// which cannot match it, so the line is not a typed opener - and it is not a
// thematic break either, so it is ordinary paragraph text and the metadata
// lines fold into it.
const RE_FRONTMATTER_OPEN = new RegExp('^--- ?(\\w*)' + TRAILING_WS)
// Frontmatter close fence: bare `---` only.
const RE_FRONTMATTER_CLOSE = new RegExp('^---' + TRAILING_WS)
// Raw passthrough block: ```=FORMAT … ``` (§4.15, djot raw-block syntax). The
// info string is `=FORMAT` (a leading `=` immediately followed by the format
// name), so this never collides with RE_FENCE (whose language charset excludes
// `=`). The `=` is the block parallel of the inline raw `{=format}` attribute.
// FORMAT must follow `=` with no intervening space (```= html is not raw).
//
// The slot between the fence run and the `=` is a MARKER SEPARATOR rather than
// padding -- the `=` after it SELECTS a raw block over a code block -- but the
// terminal is the same `space` either way, because the slot sits after the
// first non-whitespace character of the line (PART 7). `raw_block =
// code_fence_open, [space], "=", format_name, newline`. It was `\s`, so a tab,
// a form feed, a vertical tab and every Unicode space opened a raw block.
//
// AND THE SLOT IS EXACTLY ONE SPACE (carve#912), for the same reason and by
// the same clause as the code fence's. `raw_block = code_fence_open, [space],
// "=", format_name` is a bare `space`.
//
// This is the SECOND SPELLING of `code_fence_open`'s padding slot in this
// file - `RE_FENCE` is the first - and the two have to be narrowed together.
// The executable spec does not have the choice: it routes the raw block
// through the SAME `parseFenceInfo` as an ordinary fence and reads the `=`
// off the parsed `lang`, so narrowing that one slot narrowed both. Here they
// are two patterns, so leaving this one at ` *` would have left
// ``` ```<SP><SP>=html ``` opening a raw block against an oracle that reads
// it as a paragraph - a divergence created by the fix for the other spelling.
// The ticket named neither: it named the four PRODUCTIONS, and this engine
// spells one of them twice.
const RE_RAW_FENCE = new RegExp('^(`{3,}|~{3,}) ?=([a-zA-Z][\\w-]*)' + FENCE_TRAILING_WS)
// Comments (§4.13): a `%%%`+ line opens/closes a block comment (matched
// by length); a `%%` line is a line comment. Neither is rendered. A line
// comment may be indented: leading whitespace before `%%` does not matter, so an
// indented line whose first non-whitespace content is `%%` is a comment line
// (it interrupts an open paragraph and renders nothing), matching carve-php /
// carve-rs and the grammar's `comment_line = [whitespace], "%%", …`.
// A comment fence line: the leading run of 3+ `%` is the DELIMITER and any
// trailing text on the line is insignificant (PART 9 §28), so `%%% TODO` and
// `%%% html` are fences, not raw blocks — `%%%` carries no info string (the raw
// block is a code fence with an `=FORMAT` info string). Capture group 1 is the
// delimiter run, whose length must match to close.
//
// Indentation does not matter, exactly as for the line form above: a comment is
// recognized at ANY column (carve#624). Anchoring this one at column 0 left an
// indented `%%%` to the line-comment rule, which consumed the opener and the
// closer one line at a time and rendered everything BETWEEN them — a comment
// that showed its contents while hiding its delimiters (carve-js#630).
const RE_COMMENT_BLOCK = /^(%{3,})(.*)$/
// The same fence seen from a position that CONSUMES it. A comment is recognized
// at any column (carve#624), but where a line ENDS an item or opens a block the
// strict form above still decides, so an indented fence does not close the item
// it sits in.
const RE_COMMENT_BLOCK_ANY = /^[ \t]*(%{3,})(.*)$/
/**
 * The `%` run length of a comment-fence delimiter line, or undefined.
 *
 * ONE PREDICATE, for the reason `fenceCloseRe` is one producer. PART 9 §28 is
 * NORMATIVE and says a `%%%` line is DELIMITER PLUS INSIGNIFICANT TAIL: the
 * leading run of 3+ `%` is the delimiter and ANY remaining text is IGNORED, so
 * `%%% TODO` opens and `%%% end` closes. Both delimiters may also be INDENTED
 * (grammar.ebnf `comment_block_open` / `comment_block_close`, PART 9 §24 C3).
 *
 * `parseCommentBlock` reads exactly this and always has. The two lazy-state
 * TRACKERS did not: they spelled the same line `^(%{3,})\s*$`, which is a
 * BARE run at column 0 - narrower than the production in two directions at
 * once - so a fence with a tail and a fence with an indent were invisible to
 * them while the parser consumed both (markup-carve/carve-js#816).
 *
 * The divergence runs the OPPOSITE way from the legacy-`\s` family swept in
 * carve-js#815: everywhere else `\s` admitted too much, and here `\s*$` admitted
 * less than the path beside it.
 */
const commentFenceRun = (line: string): number | undefined => {
  const m = RE_COMMENT_BLOCK_ANY.exec(line)
  return m ? m[1]!.length : undefined
}
const RE_COMMENT_LINE = /^[ \t]*%%/
// A bare fence-closer line (` ``` ` / `~~~`, no info), used only by the
// paragraph-interruption closer lookahead's negative cache (§10).
const RE_FENCE_CLOSER = new RegExp('^(`{3,}|~{3,})' + FENCE_TRAILING_WS)
// The same line seen by the definition prepass, which has already re-based it to
// the fence's content column and so matches the run alone.
const RE_FENCE_CLOSER_PREPASS = new RegExp('^([`~]{3,})' + FENCE_TRAILING_WS)

// Maximum block-container nesting depth, applied UNIFORMLY to blockquote, list,
// fenced-div / admonition (and footnote) nesting. Each level recurses
// parseBlocks -> parseBlock -> parseContainer -> parseBlocks, so unbounded
// nesting (e.g. `> ` repeated thousands of times, a deeply indented list, or a
// stack of varied-length `:::` fences) would overflow the call stack. Every
// container sub-lexer carries `depth = parent.depth + 1` and re-enters
// parseBlockInner, where this single gate degrades the opener to literal
// paragraph text past the cap - so all container kinds flatten the same way
// rather than crashing. The same constant also bounds the inline recursion
// (see scanInline). Far above any real document; only adversarial input reaches
// it. Exported so callers/tests can assert the exact, shared cap.
export const MAX_NESTING_DEPTH = 200

/**
 * COUNTED instrumentation for the container-layout work (markup-carve/carve#752).
 *
 * Every nesting level hands its body to a nested parse, so a line at depth `d`
 * is handled `d` times. That is unavoidable in this container model; what is
 * not is doing `O(line length)` character work at each of those handlings,
 * which turns `O(bytes)` of document into `O(bytes^1.5)` of work.
 *
 * The regression guard counts those characters rather than timing them. This
 * repo already records why a clock cannot express the bound - see
 * `test/writer-deep-list-perf.test.ts` ("No ratio guard here on purpose... would
 * also fail on the healthy build") and `test/perf-regression.test.ts` (a ratio
 * bound "flaked on nearly every run"). A count is a property of the algorithm,
 * not of the machine: it reproduces byte-identically under any load.
 *
 * Off by default, so a normal parse pays one boolean test per counted call.
 */
export const layoutWork = {
  /** Whether to accumulate. Tests turn this on around a single parse. */
  on: false,
  /** Characters walked by the indentation gate (`indentColumns`). */
  gate: 0,
  /** Characters walked by the column strip (`sliceColumns`). */
  strip: 0,
  /** Characters re-copied at a container recursion seam (join/split/normalize). */
  seam: 0,
  reset(): void {
    this.gate = 0
    this.strip = 0
    this.seam = 0
  },
  get total(): number {
    return this.gate + this.strip + this.seam
  },
}

class Lexer {
  lines: string[]
  lineOffsets: number[]
  lineNumberOffset: number
  sourceLineMap?: number[]
  /**
   * Document offset of each line's CONTENT start, for a sub-lexer over stripped
   * container lines. Without it `lineOffset` reports an offset into the
   * container's own text, so every inline position inside a blockquote, list or
   * admonition pointed at the wrong place (#444).
   */
  sourceOffsetMap?: number[]
  /**
   * Width of the container prefix stripped from each line (`> `, `- `, and so
   * on). Columns are 1-based against the DOCUMENT line, so the inline scanner
   * has to add back what the container removed. It varies per line, since `>`,
   * `> ` and `>  ` are all valid.
   */
  linePrefixWidths?: number[]
  /**
   * The DOCUMENT's own lines, carried unchanged into every sub-lexer.
   *
   * A container's body reaches a sub-lexer DEDENTED, so a line's document
   * column is not recoverable from the view: `* * +` / `x` and `* * +` / `  x`
   * both arrive as `["* +", "x"]` and are byte-identical here. §17 L3 asks for
   * the document column - a continuation marker attaches a block that begins at
   * column 0 and nothing else (markup-carve/carve#1436) - so the question has to
   * be asked of the original line, which `lineNumber` still names.
   *
   * NOT `linePrefixWidths`, which would otherwise answer this: that map is
   * position bookkeeping and is allowed to DECLINE for reassembled content, so
   * parsing through it would make the tree depend on whether positions could be
   * anchored.
   */
  rootLines?: readonly string[]
  suppressPositions = false
  pos = 0
  // Block-container nesting depth of this (sub-)lexer; 0 at the document top.
  depth = 0
  frontmatter?: { format: string; content: string; pos?: Position }
  /** Format applied to a bare `---` fence; set from ParseOptions. */
  defaultFrontmatterFormat = 'yaml'
  parseOptions: ParseOptions
  unclosedContainerKeys: Set<string> | undefined
  abbrDefs: Map<string, string> = new Map()
  /**
   * True only for the lexer over the whole document. PART 12 §7 recognizes an
   * abbreviation definition ONLY at document level: inside a block quote, list
   * item or div the line is ordinary paragraph text. Sub-lexers leave this
   * false, which is what makes a container-authored `*[X]: y` inert.
   */
  atDocumentLevel = false
  linkDefs: Map<string, LinkDef> = new Map()
  /** Document lines admitted only as a block quote's lazy paragraph text. */
  literalLazyLinkDefLines: Set<number> = new Set()
  // Footnote definitions keyed by raw label; value is the parsed note
  // body (def line + indented continuation), set by parseFootnoteDef.
  footnoteDefs: Map<string, BlockNode[]> = new Map()
  /** Where each definition sits in the source, parallel to `footnoteDefs`. */
  footnoteDefPos: Map<string, Position> = new Map()
  // True for sub-lexers over already-nested block content (list item /
  // blockquote / admonition bodies). Informational only: under the §10
  // Markdown-like rule a visible block interrupts a paragraph at EVERY level
  // (top and nested) — startsInterruptingBlock no longer branches on this —
  // but sub-lexers still set it to mark their context.
  nested = false
  /**
   * True while this lexer reads the body of an open `::: figure` group, at any
   * depth (PART 9 §4c: groups do not nest). `parseAdmonition` sets it on the
   * group's body sub-lexer and `nestedSubLexer` carries it into every deeper
   * container, so a bare `::: figure` ANYWHERE inside an open group's body is
   * demoted to a generic container. A sibling after the group parses from the
   * parent lexer, where the flag was never set.
   */
  inFigureGroup = false
  /**
   * True for the sub-lexer over a LIST ITEM's own body, and for that body only.
   *
   * PART 9 §24 C3: "AT content_column: dedented to the body's column 0, a block
   * opener nests and a list marker opens a sublist", and it "holds whether or
   * not a blank line precedes the child". §10 I2 defers to it by name - "TIGHT
   * NESTED LISTS UNAFFECTED: an indented marker inside an open list ITEM opens a
   * sublist with no blank line - that is §24 C3 (content column), not this
   * relation". So an item body is the one context where a marker DOES interrupt
   * an open paragraph, and it is a deliberate divergence from djot rather than a
   * gap in §10.
   *
   * It answered for the FIRST marker in an item only, and by accident: the
   * collector hands everything from the first marker line onward to a separate
   * `parseBlocks`, so that marker met no open paragraph while every later one
   * met §10 I2 with one open and folded. Two documents differing by a sub-list
   * the table between them had already closed then disagreed about what their
   * last line was (markup-carve/carve#1517).
   *
   * NOT CARRIED BY `nestedSubLexer`, which is the whole point. A quote, a div or
   * a definition body inside an item gets its own lexer with the flag clear, so
   * `> q` / `> - a` inside an item still folds exactly as it does at the top
   * level - §10 I6 is unaffected, and only the item's OWN column 0 changes.
   */
  markerOpensSublist = false

  // Negative cache for fenceHasCloser (paragraph-interruption closer
  // lookahead), the same entry the container-local scans keep: per fence
  // CHARACTER, where a scan started and the longest bare run of that character
  // it saw. Once proven, every later opener (pos only advances) whose marker is
  // longer than that run short-circuits, keeping "many unclosed fences" input
  // linear.
  //
  // This was one index, char- and length-agnostic, so a single `~~~` or a
  // single short ``` ``` ``` anywhere ahead pinned it at Infinity forever and
  // the lookahead stayed quadratic: 500 unterminated ` ````js ` openers over
  // one ``` ``` ``` took 25ms and 4000 took 347ms.
  fenceCloserMemo: QuotedFenceCloserMemo = new Map()

  // Where a closer of each fence shape LAST occurs in these lines, built once
  // by `closerIndex`. See `CloserIndex`.
  fenceCloserIndex: CloserIndex | undefined = undefined

  // EVERY line carrying a `%` run, keyed by run length and ascending, built
  // once by `commentRunLines`. `fenceCloserIndex` keeps only the LAST line of
  // each width, which answers "is there one ahead" and cannot answer "is there
  // one before the container ends" - the question `commentCloserInScope` asks.
  commentRunLines: Map<number, { line: number; depth: number }[]> | undefined = undefined

  // Document line number -> every index of THIS lexer's lines carrying it,
  // built once by attachDocumentOffsets when the first child asks for it.
  //
  // BUILT ONCE PER PARENT, NOT ONCE PER CHILD. The inversion is a function of
  // this lexer alone - `lines` and `lineNumber` - and neither changes after the
  // constructor runs, so every child of the same parent was rebuilding a map it
  // could have shared. A list gets one sub-lexer per item, so an n-line
  // document paid n x O(n): 16,000 flat bullets took 18 s where 0.1.2 took
  // 82 ms, on the DEFAULT path (this is not behind the `positions` option).
  //
  // Undefined until asked for, so a document that never nests never allocates.
  lineIndicesByNumber: Map<number, number[]> | undefined = undefined

  constructor(
    source: string | readonly string[],
    opts: ParseOptions = {},
    lineNumberOffset = 0,
    unclosedContainerKeys?: Set<string>,
  ) {
    this.parseOptions = opts
    this.unclosedContainerKeys = unclosedContainerKeys
    this.lineNumberOffset = lineNumberOffset
    this.defaultFrontmatterFormat = opts.defaultFrontmatterFormat ?? 'yaml'
    // ALREADY-SPLIT LINES. A container's body reaches here as the lines its
    // parent collected, so joining them and splitting them again copies the
    // whole body twice per nesting level - `depth` times over for a line at
    // depth `depth` (markup-carve/carve#752). The parent's lines are newline-free
    // by construction (it split on the same normalization), so the join was a
    // round trip with no effect other than its cost.
    //
    // The one thing the round trip DID do is drop a trailing empty line: a
    // terminal `''` element joins to a terminal `\n`, which splits back to a
    // `''` that the pop below removes. Reproduced exactly - one trailing `''`,
    // not a run - or a body ending in a blank line gains a line it never had.
    if (typeof source === 'string') {
      if (layoutWork.on) layoutWork.seam += source.length
      this.lines = normalizeNewlines(source).split('\n')
    } else {
      this.lines = source.slice()
    }
    // Drop the trailing empty line a terminal newline introduces. ONLY for a
    // string source, where that `''` is an artifact of the split: `'a\n'`
    // splits to `['a', '']` and the document has one line, not two.
    //
    // An ARRAY source is a container body whose lines were already collected,
    // so a trailing `''` is a REAL blank line. Popping it discarded the blank
    // the flush above had just handed over, which is why an item-final fence
    // came out one line short (markup-carve/carve-js#988). The old
    // join-then-split round trip lost it the same way; reproducing that here
    // reproduced the loss with it.
    if (typeof source === 'string' && this.lines.length && this.lines[this.lines.length - 1] === '') {
      this.lines.pop()
    }
    // MEASURED ON THE SOURCE AS GIVEN, not on the normalized lines. `+1` per
    // line assumes every ending is one character, but `\r\n` is two - so a
    // CRLF document's offsets were short by one per preceding line and every
    // span landed before the text it named: `abc` on line 3 reported the two
    // characters ending line 2 instead (carve#876).
    //
    // The widths come from the original endings, which is why this walks the
    // raw string rather than the split result. `newline` admits '\n', '\r\n'
    // and a lone '\r', so all three are counted at their real width. Lines
    // handed in already split carry no endings at all, so every width is 1 -
    // which is exactly what the join they replace produced.
    const raw = typeof source === 'string' ? source : undefined
    this.lineOffsets = []
    let offset = 0
    let index = 0
    for (const line of this.lines) {
      this.lineOffsets.push(offset)
      index += line.length
      let width = 1
      if (raw !== undefined && raw[index] === '\r') width = raw[index + 1] === '\n' ? 2 : 1
      offset += line.length + width
      index += width
    }
    // Frontmatter is document-leading only; the root lexer consumes it
    // explicitly in parse(). Sub-lexers (list items, divs, admonitions)
    // must NOT, or nested `---`-fenced content would be swallowed.
  }

  consumeFrontmatter() {
    if (this.lines.length < 2) return
    const open = RE_FRONTMATTER_OPEN.exec(this.lines[0]!)
    if (!open) return
    for (let i = 1; i < this.lines.length; i++) {
      if (RE_FRONTMATTER_CLOSE.test(this.lines[i]!)) {
        const content = this.lines.slice(1, i).join('\n')
        const format = open[1] !== '' ? open[1]! : this.defaultFrontmatterFormat
        // The block runs from the opening fence to the closing one. Frontmatter
        // is document-leading, so it starts at the first byte - but the END has
        // to be measured, and without it the node `toAstJson` builds has no
        // position at all (carve-js#480).
        const closeOffset = (this.lineOffsets[i] ?? 0) + this.lines[i]!.length
        this.frontmatter = {
          format,
          content,
          pos: {
            startLine: 1,
            endLine: i + 1,
            startColumn: 1,
            endColumn: this.lines[i]!.length + 1,
            startOffset: 0,
            endOffset: closeOffset,
          },
        }
        this.pos = i + 1
        return
      }
    }
  }

  peek(offset = 0): string | undefined {
    return this.lines[this.pos + offset]
  }

  consume(): string {
    return this.lines[this.pos++]!
  }

  eof(): boolean {
    return this.pos >= this.lines.length
  }

  lineOffset(lineIndex: number): number {
    return this.sourceOffsetMap?.[lineIndex] ?? this.lineOffsets[lineIndex] ?? 0
  }

  /** 1-based column, in the DOCUMENT line, where this line's content starts. */
  lineStartColumn(lineIndex: number): number {
    return (this.linePrefixWidths?.[lineIndex] ?? 0) + 1
  }

  /**
   * Whether `lineOffset` returns a DOCUMENT offset rather than one into this
   * lexer's own text.
   *
   * True at the root, and for a sub-lexer whose lines were mapped back (see
   * attachDocumentOffsets). An unmapped sub-lexer - a container whose lines were
   * reconstructed rather than stripped - has offsets that are only meaningful
   * locally, and emitting them as document positions is the invented value PART
   * 12 section 4 forbids.
   */
  get hasDocumentOffsets(): boolean {
    return !this.nested || this.sourceOffsetMap !== undefined
  }

  lineNumber(lineIndex: number): number {
    return this.sourceLineMap?.[lineIndex] ?? this.lineNumberOffset + lineIndex + 1
  }

  reportUnclosedContainer(container: UnclosedContainer): void {
    if (!this.hasDocumentOffsets) return
    const seen = this.unclosedContainerKeys
    const key = `${container.startOffset}:${container.endOffset}`
    if (seen?.has(key)) return
    seen?.add(key)
    this.parseOptions.onUnclosedContainer?.(container)
  }
}

/**
 * The document's line endings as the lexer reads them: `\r\n` and a lone `\r`
 * both become `\n`.
 *
 * Named once because a THIRD spelling of it is what a verbatim capture needs.
 * Offsets index the RAW source, endings and all, while every line the scanner
 * walks has already been normalized - so a document slice compared against the
 * scanner's text differs on every line of a CRLF document unless both are read
 * the same way (raised by `codex review`).
 */
function normalizeNewlines(source: string): string {
  return source.replace(/\r\n?/g, '\n')
}

function normalizedSourceLines(source: string): string[] {
  if (layoutWork.on) layoutWork.seam += source.length
  const lines = normalizeNewlines(source).split('\n')
  if (lines.length && lines[lines.length - 1] === '') lines.pop()
  return lines
}

function subLexer(
  source: string | readonly string[],
  opts: ParseOptions,
  lineNumberOffset: number,
  sourceLineMap?: number[],
  unclosedContainerKeys?: Set<string>,
): Lexer {
  const sub = new Lexer(source, opts, lineNumberOffset, unclosedContainerKeys)
  if (sourceLineMap) sub.sourceLineMap = sourceLineMap
  return sub
}

/**
 * A sub-lexer over a container's body.
 *
 * `lines` are the body lines the container already collected. They are handed
 * over AS LINES: every call site used to join them and the Lexer split them
 * straight back, which copied the whole body twice at every nesting level and
 * is the bulk of markup-carve/carve#752's cubic term. Nothing about the round
 * trip was load-bearing - a parent line never holds a newline, because the
 * parent split on the same normalization - except the trailing-blank drop,
 * which the Lexer now reproduces directly.
 */
function nestedSubLexer(
  parent: Lexer,
  lines: readonly string[],
  startLineIndex: number,
  sourceLineMap?: number[],
): Lexer {
  // The default map is parallel to the Lexer's OWN lines, which drop one
  // trailing blank (see the constructor), so it is built to that length -
  // the length `normalizedSourceLines` used to report for the joined text.
  // Parallel to the Lexer's OWN lines, which no longer drop a trailing blank
  // from an array source, so the map covers every line handed over.
  const mapLength = lines.length
  const sub = subLexer(
    lines,
    parent.parseOptions,
    parent.lineNumberOffset + startLineIndex,
    sourceLineMap ?? Array.from({ length: mapLength }, (_l, i) => parent.lineNumber(startLineIndex + i)),
    parent.unclosedContainerKeys,
  )
  sub.abbrDefs = parent.abbrDefs
  sub.linkDefs = parent.linkDefs
  sub.literalLazyLinkDefLines = parent.literalLazyLinkDefLines
  sub.footnoteDefs = parent.footnoteDefs
  sub.footnoteDefPos = parent.footnoteDefPos
  sub.nested = true
  sub.rootLines = parent.rootLines ?? parent.lines
  sub.depth = parent.depth + 1
  sub.inFigureGroup = parent.inFigureGroup
  attachDocumentOffsets(sub, parent, startLineIndex)
  return sub
}

/**
 * Map a sub-lexer's lines back to their DOCUMENT offsets and columns.
 *
 * A container strips a prefix (`> `, `- `, the admonition indent) from each
 * line, and the sub-lexer then measures offsets against that stripped text. Line
 * NUMBERS were already mapped (`sourceLineMap`), which is why a lint diagnostic
 * inside a blockquote had the right line and a column short by the prefix
 * (#444).
 *
 * Only a line that is literally a SUFFIX of its document line gets a mapping:
 * then the prefix width is the length difference and the arithmetic is exact.
 * Anything reconstructed rather than stripped - a line block's expanded leading
 * whitespace, a table's reassembled cells - fails that test and is left alone,
 * because a guessed offset is what PART 12 section 4 forbids. Those keep the
 * behavior they had.
 */
function attachDocumentOffsets(sub: Lexer, parent: Lexer, startLineIndex: number): void {
  // A parent whose own offsets are local cannot anchor a child: the child would
  // inherit local numbers and believe they were document ones, which is how a
  // list inside a `+`-continued blockquote reported "\n- i" for the text "item".
  if (!parent.hasDocumentOffsets) return
  const offsets: number[] = []
  const widths: number[] = []

  // Where a sub-line came from, when its lines are NOT a contiguous run of the
  // parent's. A `+` continuation splices a flush-left block into a quote body
  // and inserts blank separators, and a definition list re-indents its body, so
  // `startLineIndex + i` walks off the real source after the first splice and
  // the suffix test below then fails for every following line - which is why a
  // whole `+`-continued quote came out unplaced (#462).
  //
  // The per-line map already exists: the caller passes it so line NUMBERS are
  // right. This reuses it for offsets by inverting it back to parent indices.
  let previousIndex = -1
  // ALL indices per line number, not one. A `+` continuation's synthetic blank
  // separators borrow the line they sit against, so several sub-lines can carry
  // the same number - and picking one of them blindly chose a blank where the
  // real content line was meant, which failed the suffix test and unplaced a
  // list nested inside the continuation (#462).
  //
  // MEMOIZED ON THE PARENT, because that is all it reads: `parent.lines` and
  // `parent.lineNumber`, both fixed once the Lexer constructor has run. Rebuilt
  // per child it made an ordinary flat list quadratic (see the field's docblock
  // and markup-carve/carve-js#885).
  const parentIndicesOf = sub.sourceLineMap ? parentLineIndices(parent) : EMPTY_LINE_INDICES

  for (let i = 0; i < sub.lines.length; i++) {
    const mapped = sub.sourceLineMap?.[i]
    const subLine = sub.lines[i]
    if (subLine === undefined) return
    // Among the candidates for this number, take the first that both keeps
    // document order and actually ends with this line - the suffix test is what
    // makes the offset arithmetic exact, so it decides which candidate is meant.
    // The suffix test tolerates SYNTHESIZED leading spaces for the same reason
    // the anchor arithmetic below does: a line dedented past a straddling tab
    // carries spaces the source never held, so it is not a literal suffix while
    // its content still is (carve-js#771).
    // The suffix test walks the whole line, and the anchor arithmetic below asks
    // the SAME question of the SAME candidate - so asking twice doubled the cost
    // of anchoring a deep container, where every level re-anchors the same body
    // (markup-carve/carve#752). `find` stops at the first candidate this accepts,
    // so the last verdict recorded here is the chosen candidate's.
    let literalSuffix: boolean | undefined
    const anchorsTo = (candidate: number): boolean => {
      const parentLine = parent.lines[candidate] ?? ''
      literalSuffix = parentLine.endsWith(subLine)
      return literalSuffix || parentLine.endsWith(withoutSyntheticIndent(subLine))
    }
    const parentIndex =
      mapped === undefined
        ? startLineIndex + i
        : (parentIndicesOf.get(mapped) ?? []).find(
            (candidate) => candidate >= previousIndex && anchorsTo(candidate),
          )
    if (parentIndex === undefined) return declinePositions(sub)
    // Document order must not go backwards, or a block spanning first-to-last
    // line reports an end before its start. A map that jumps back is one this
    // cannot reason about, so it declines rather than emitting that.
    if (i > 0 && parentIndex < previousIndex) return declinePositions(sub)
    previousIndex = parentIndex
    const parentLine = parent.lines[parentIndex]
    if (parentLine === undefined) return
    // SYNTHESIZED LEADING SPACES. Dedenting a line whose indentation ends in a
    // tab that straddles the content column re-emits the unconsumed columns as
    // spaces (`sliceColumns` with keepResidual), so the sub-line is no longer a
    // literal suffix of its document line - ` \t- c` dedented by 2 becomes
    // `  - c`. Those spaces are not in the source, and charging them to it is
    // what put a nested paragraph at document offset 0 (carve-js#771).
    //
    // The line's real content still IS a suffix, so the anchor is exact when
    // the synthetic run fits inside the prefix the strip removed. Where it does
    // not, there is no honest offset to record and this declines - which now
    // means NO positions rather than local ones (see below).
    let prefix = parentLine.length - subLine.length
    if (!(literalSuffix ?? parentLine.endsWith(subLine))) {
      // Only reached when the line is NOT a literal suffix, which is the
      // straddling-tab case alone - so the synthetic-indent trim is computed
      // here rather than for every line.
      const trimmed = withoutSyntheticIndent(subLine)
      const synthetic = subLine.length - trimmed.length
      if (synthetic === 0 || !parentLine.endsWith(trimmed)) return declinePositions(sub)
      // NEGATIVE IS THE ORDINARY CASE FOR A TAB, NOT A FAILURE. `prefix` is the
      // base the sub-line's index 0 is charged to, and the synthetic spaces
      // stand in for the source characters the strip consumed - so it goes
      // negative exactly when the run re-emits MORE columns than the characters
      // it replaced. One tab does: `- item` has content column 2, a `<TAB>more`
      // continuation dedents to `  more`, and two synthetic spaces stand in for
      // one source character, giving -1.
      //
      // The arithmetic is still exact for every character that HAS a source:
      // sub-index `synthetic` lands on `parent.lineOffset + (prefix + synthetic)`,
      // which is the first real character. Only the synthetic run itself has no
      // honest offset, and no node begins inside a line's indentation.
      //
      // Rejecting it dropped every position inside the item - the paragraph and
      // all three of its inlines - while the same document written with two
      // spaces kept them, and while an ORDERED marker kept them too, because its
      // wider content column leaves the tab non-straddling
      // (markup-carve/carve-js#814).
      prefix = parentLine.length - trimmed.length - synthetic
    }

    const offset = parent.lineOffset(parentIndex) + prefix
    const width = parent.lineStartColumn(parentIndex) - 1 + prefix
    // What a negative prefix must NOT do is push a base off the FRONT of the
    // document, which would make every span on the line a lie rather than a gap.
    //
    // NOT REACHABLE TODAY, and kept anyway - stated here rather than presented
    // as tested. A continuation line always has its marker line above it, so its
    // document offset is at least that line's length plus a newline, while the
    // prefix goes no lower than minus the synthetic run. Removing this guard
    // renders all 1373 corpus documents and eleven probes built from the
    // shortest possible marker lines byte-identically, and no published offset
    // in any of them is negative. It is a bound on arithmetic rather than a
    // check on input: the cliff it guards is a negative offset escaping into a
    // published position, which no assertion downstream would catch.
    //
    // The COLUMN base is deliberately NOT clamped the same way. It is a width
    // added to a sub-column, and a sub-column starts at 1, so the first real
    // character still lands on a positive document column - clamping it was the
    // first fix written here and it declined exactly the documents this issue is
    // about.
    if (offset < 0) return declinePositions(sub)

    offsets.push(offset)
    widths.push(width)
  }

  sub.sourceOffsetMap = offsets
  sub.linePrefixWidths = widths
}

/**
 * Every index of `lexer.lines` carrying each DOCUMENT line number, built once.
 *
 * Shared by all of a parent's children rather than rebuilt per child: see the
 * `lineIndicesByNumber` field. The result is treated as read-only by its
 * callers, which only ever `get` a bucket and `find` within it.
 */
function parentLineIndices(lexer: Lexer): Map<number, number[]> {
  const cached = lexer.lineIndicesByNumber
  if (cached !== undefined) return cached
  const built = new Map<number, number[]>()
  for (let i = 0; i < lexer.lines.length; i++) {
    const number = lexer.lineNumber(i)
    const bucket = built.get(number)
    if (bucket) bucket.push(i)
    else built.set(number, [i])
  }
  lexer.lineIndicesByNumber = built
  return built
}

/** Stand-in for the map above when the sub-lexer has no line map to invert. */
const EMPTY_LINE_INDICES: ReadonlyMap<number, number[]> = new Map()

/** A dedented line's content, with any synthesized leading spaces removed. */
function withoutSyntheticIndent(line: string): string {
  return line.replace(/^[ \t]+/, '')
}

/**
 * A sub-lexer that cannot be anchored publishes NO positions.
 *
 * Declining used to mean falling back to the sub-lexer's own local offsets,
 * which are indistinguishable from document ones downstream: a nested paragraph
 * reported `[0, 1]` inside a list item at `[6, 11]`, so a span sat outside its
 * parent and two siblings overlapped. A missing `pos` is a state PART 12 §4
 * already lets a consumer detect; a confidently wrong one is not (carve-js#771).
 */
function declinePositions(sub: Lexer): void {
  sub.suppressPositions = true
}

/**
 * Every field on the tree that holds a source position.
 *
 * `pos` is the one PART 12 section 4 names, and the other four are the same
 * information under other names: the root map from a footnote label to where
 * its definition was written, and a definition item's per-term spans, per-body
 * spans and per-marker lines. A caller who asked for no positions and got a
 * document still carrying four of these has the defect the option is meant to
 * end, one field further along.
 */
const POSITION_FIELDS = [
  'pos',
  'footnoteDefPos',
  'termSpans',
  'definitionSpans',
  'definitionLines',
] as const

/**
 * Drop every source position from a finished document.
 *
 * ONE gate at the boundary, not a flag threaded through the parse. The two
 * existing gates cannot carry this: `suppressPositions` reaches only the block
 * layer, and the inline layer's is a field on an `InlineSource`, which is built
 * in seven places from text that has no lexer in scope. Setting the block one
 * from the option as well was tried and reverted - the walk covers those nodes
 * anyway, so the line changed nothing any test could see, which is the shape of
 * defect this ticket is about.
 *
 * The consequence is stated rather than smoothed over: the positions are still
 * TRACKED, and `positions: false` buys a smaller tree rather than a faster
 * parse. It is not free either - it replaces `toCodepointPositions`, which
 * walks the same fields, so the cost is one boundary walk in both directions.
 */
function dropPositions(doc: Document): void {
  const seen = new Set<object>()
  const walk = (value: unknown): void => {
    if (!value || typeof value !== 'object') return
    if (seen.has(value)) return
    seen.add(value)
    if (Array.isArray(value)) {
      for (const item of value) walk(item)
      return
    }
    const record = value as Record<string, unknown>
    for (const field of POSITION_FIELDS) delete record[field]
    for (const key of Object.keys(record)) walk(record[key])
  }
  walk(doc)
}


/**
 * Rewrite every `pos` from UTF-16 code units to CODEPOINT positions.
 *
 * PART 12 section 4 pins the unit. The scanner counts UTF-16 code units, because
 * that is how JavaScript indexes strings, and the two agree for everything in
 * the Basic Multilingual Plane - so `é` and `한` are already right and only
 * astral characters (emoji, rare CJK extensions) differ. That is why nothing
 * caught this: a fixture has to contain a surrogate pair to tell them apart.
 *
 * Codepoints rather than bytes or UTF-16 because a codepoint index always lands
 * on a character boundary. A byte offset can point into the middle of a UTF-8
 * sequence and a UTF-16 offset into the middle of a surrogate pair; both let a
 * consumer slice a document into garbage. It also matches djot.lua, which builds
 * a byte-to-charpos table specifically so it can report characters from a
 * byte-indexed language.
 *
 * Columns are recomputed from the converted offset rather than converted
 * separately, so a column can never disagree with the offset on the same node.
 *
 * Documents with no surrogate pairs take an identity fast path: one scan, no
 * allocation, which is the overwhelmingly common case.
 */
function toCodepointPositions(doc: Document, source: string): void {
  let hasAstral = false
  for (let i = 0; i < source.length; i++) {
    const code = source.charCodeAt(i)
    if (code >= 0xd800 && code <= 0xdbff) {
      hasAstral = true
      break
    }
  }
  if (!hasAstral) return

  // codepointAt[i] is the number of CODEPOINTS before UTF-16 index i.
  const codepointAt = new Uint32Array(source.length + 1)
  let count = 0
  for (let i = 0; i < source.length; i++) {
    codepointAt[i] = count
    const code = source.charCodeAt(i)
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < source.length) {
      // A surrogate pair is one codepoint; the low half shares its index.
      codepointAt[i + 1] = count
      i++
    }
    count++
  }
  codepointAt[source.length] = count

  const map = (offset: number): number => codepointAt[Math.min(offset, source.length)] ?? count

  // Codepoint index of each line's start, so a column can be recomputed from an
  // offset instead of converted on its own.
  const lineStartCodepoint: number[] = [0]
  for (let i = 0; i < source.length; i++) {
    if (source.charCodeAt(i) === 10) lineStartCodepoint.push(map(i + 1))
  }

  const convert = (pos: Position): void => {
    const startOffset = pos.startOffset
    const endOffset = pos.endOffset
    if (typeof startOffset === 'number') {
      pos.startOffset = map(startOffset)
      const lineStart = lineStartCodepoint[pos.startLine - 1]
      if (lineStart !== undefined && pos.startColumn !== undefined) {
        pos.startColumn = pos.startOffset - lineStart + 1
      }
    }
    if (typeof endOffset === 'number') {
      pos.endOffset = map(endOffset)
      const lineStart = lineStartCodepoint[pos.endLine - 1]
      if (lineStart !== undefined && pos.endColumn !== undefined) {
        pos.endColumn = pos.endOffset - lineStart + 1
      }
    }
  }

  // A generic walk rather than a per-node-type visitor: a node type added later
  // must not silently keep UTF-16 positions, and this file has been bitten
  // before by walkers that could not see every node.
  //
  // A POSITION IS RECOGNIZED BY ITS SHAPE, NOT BY THE KEY IT HANGS FROM. It was
  // recognized by the key `pos`, which meant every position stored under any
  // other name kept UTF-16 offsets while its neighbours were converted - one
  // document, two units. `footnoteDefPos` is a root-level MAP of positions and
  // was wrong for exactly that reason: with one emoji ahead of it, a footnote
  // definition published a span one codepoint late, slicing to `^f]: body` where
  // the heading beside it sliced correctly. Nothing could see it, because the
  // only fixture that can tell the two units apart is one carrying a surrogate
  // pair.
  //
  // This is the same name-keyed miss as `canonical`'s skip list in
  // render-carve.ts, which the identical field tripped in the same change
  // (markup-carve/carve-js#813). Recognizing the shape is what stops there being
  // a fourth.
  const seen = new Set<object>()
  const walk = (value: unknown): void => {
    if (!value || typeof value !== 'object') return
    if (seen.has(value as object)) return
    seen.add(value as object)
    if (Array.isArray(value)) {
      for (const item of value) walk(item)
      return
    }
    const record = value as Record<string, unknown>
    if (typeof record['startLine'] === 'number' && typeof record['endLine'] === 'number') {
      // A Position and nothing else: no node type in this engine carries
      // `startLine` directly, they all carry it inside a `pos`. Its fields are
      // scalars, so there is nothing below it to walk.
      convert(record as unknown as Position)
      return
    }
    for (const key of Object.keys(record)) walk(record[key])
  }
  walk(doc)
}

/**
 * True when `source` would be read as OPENING A FRONTMATTER BLOCK.
 *
 * The Carve writer needs this to decide the spelling of a thematic break from
 * the bytes it is about to emit rather than from the source it was given, and
 * "would this be read as frontmatter" is a question only the lexer can answer:
 * the opener needs a CLOSER somewhere below it, so it is a property of the whole
 * text, not of line 1. A first-line regex answers a different question and
 * answers it wrongly in both directions (markup-carve/carve-js#899).
 *
 * The lexer's own `consumeFrontmatter` is run rather than reimplemented, so this
 * cannot drift from the parse it is predicting - which is the whole point of
 * asking the parser instead of pattern-matching.
 */
export function opensFrontmatter(source: string, opts: ParseOptions = {}): boolean {
  // Frontmatter is document-leading, so nothing that does not start with the
  // fence can open one. The gate keeps the line split off the common path.
  if (!source.startsWith('---')) return false
  const lexer = new Lexer(source, opts)
  lexer.consumeFrontmatter()
  return lexer.frontmatter !== undefined
}

export function parse(source: string, opts: ParseOptions = {}): Document {
  newlineIndexCache.clear()
  const previousQuoteCharacters = activeQuoteCharacters
  activeQuoteCharacters = opts.extensions
    ?.map((extension) => extension.quoteCharacters)
    .filter((quotes): quotes is readonly [string, string, string, string] => quotes !== undefined)
    .at(-1) ?? previousQuoteCharacters
  // Strip a single leading UTF-8 BOM (U+FEFF) at the DOCUMENT start so `﻿# T`
  // is a heading, not literal text. Only here in the root entry -- nested
  // sub-lexers (blockquote/admonition/extension bodies) keep a leading BOM
  // literal (`> ﻿# T` stays a quoted paragraph), matching carve-php / carve-rs.
  const strippedBom = source.charCodeAt(0) === 0xfeff
  if (strippedBom) source = source.slice(1)
  // Replace any NUL (U+0000) with the U+FFFD replacement character so a control
  // byte never reaches output (decided cross-impl behavior; WHATWG-style).
  if (source.includes('\0')) source = source.replace(/\0/g, '�')
  const lexer = new Lexer(
    source,
    opts,
    0,
    opts.onUnclosedContainer ? new Set<string>() : undefined,
  )
  // POSITIONS STILL INDEX THE FILE, not the stripped text. Slicing the mark off
  // shifted every offset in the document by one codepoint, so a consumer that
  // sliced the original bytes by a reported span got the character before the
  // one the node holds - `text` at 2..3 was the space, where the node said `T`
  // (carve#876). All three engines did this the same way.
  //
  // `sourceOffsetMap` is the mechanism a container sub-lexer already uses to
  // map its stripped view back to the document; the BOM is the same problem
  // with a fixed width of one, so it reuses it rather than adding a second
  // spelling. `linePrefixWidths` moves with it: the mark occupies the first
  // column of the first line, so the content of that line starts at column 2.
  if (strippedBom) {
    lexer.sourceOffsetMap = lexer.lineOffsets.map((offset) => offset + 1)
    lexer.linePrefixWidths = lexer.lineOffsets.map((_offset, index) => (index === 0 ? 1 : 0))
  }
  lexer.atDocumentLevel = true
  // Consume leading frontmatter first so `lexer.pos` marks the end of the
  // metadata region; the def passes and parseBlocks all start from there.
  lexer.consumeFrontmatter()
  const prevMatchers = activeMatchers
  const prevCtx = activeMatcherCtx
  const prevDocument = activeDocument
  activeDocument = strippedBom ? '﻿' + source : source
  // ACTIVATED BEFORE THE DEFINITION PREPASS, not after. The pass itself calls
  // no matcher, but it now asks whether one is registered: an extension's
  // `matchBlock` may claim any line, and a claimed line reads as prose to a
  // line-shape test. `makeMatcherCtx` captures the definition maps by
  // reference, so building it first sees the same tables the pass fills.
  activeMatchers = (opts.extensions ?? []).filter((e) => e.matchInline || e.matchBlock)
  activeMatcherCtx = activeMatchers.length ? makeMatcherCtx(lexer, opts) : null
  try {
    // First pass: collect abbreviation and reference-link definitions so
    // they can be resolved regardless of document order (grammar §6).
    collectLinkDefs(lexer)
    const children = parseBlocks(lexer, 0)
    appendLinkReferenceDefinitions(children, lexer, source)
    const doc: Document = { type: 'document', children }
    // Record the source byte length so renderers can size the
    // abbreviation-expansion budget (DoS guard); see render-html/markdown/ansi.
    doc.srcByteLength = utf8ByteLength(source)
    if (lexer.frontmatter) doc.frontmatter = lexer.frontmatter
    if (lexer.footnoteDefs.size) doc.footnoteDefs = Object.fromEntries(lexer.footnoteDefs)
    if (lexer.footnoteDefPos.size) doc.footnoteDefPos = Object.fromEntries(lexer.footnoteDefPos)
    if (opts.positions === false) dropPositions(doc)
    else toCodepointPositions(doc, source)
    return doc
  } finally {
    activeMatchers = prevMatchers
    activeMatcherCtx = prevCtx
    activeDocument = prevDocument
    activeQuoteCharacters = previousQuoteCharacters
  }
}

/**
 * Hoist every authored `[label]: /url` definition into the document as a
 * `link_reference_definition` node (PART 12 §10, NORMATIVE).
 *
 * It is a NODE rather than a root map because §4 requires a `pos` on everything
 * but the root and a root FIELD cannot carry one - a definition occupies real
 * bytes, and an editor, a formatter and a language server all need to find them.
 * Without it the canonical writer had nowhere to write a definition back from and
 * INLINED every resolved reference instead, which lost `ref`/`rawRef` on the
 * reparse and turned one destination into N (carve-js#690).
 *
 * SOURCE ORDER, not map order: §10 answers "which definition wins" by document
 * order, and the writer has to reproduce the lines where the author put them.
 *
 * Definitions authored inside a block quote or a list item hoist to the document
 * too, which is what §7 already requires of the other two definition kinds; the
 * container keeps the author's remaining content.
 */
function appendLinkReferenceDefinitions(
  children: BlockNode[],
  lexer: Lexer,
  source: string,
): void {
  const authored: LinkReferenceDefinition[] = []
  for (const [key, def] of lexer.linkDefs) {
    // A definition with no recorded line came from somewhere other than the
    // source scan (a sub-lexer copy for extension content), so there is no line
    // to reproduce and nothing to hoist.
    if (def.line === undefined) continue
    const node: LinkReferenceDefinition = {
      type: 'link_reference_definition',
      label: def.rawLabel ?? key,
      href: def.href,
    }
    if (def.title !== undefined) node.title = def.title
    if (def.attrs) node.attrs = def.attrs
    node.pos = wholeLinePos(lexer, def.line, source)
    authored.push(node)
  }
  authored.sort((a, b) => (a.pos?.startOffset ?? 0) - (b.pos?.startOffset ?? 0))
  children.push(...authored)
}

/** The span of a whole source line, for a node reassembled from one line. */
function wholeLinePos(lexer: Lexer, line: number, source: string): Position {
  const text = lexer.lines[line] ?? ''
  let offset = 0
  for (let i = 0; i < line; i++) offset += (lexer.lines[i] ?? '').length + 1
  // Clamp rather than trust the running total: a document whose final line has
  // no trailing newline would otherwise claim one byte past the end.
  const startOffset = Math.min(offset, source.length)
  return {
    startLine: line + 1,
    endLine: line + 1,
    startColumn: 1,
    endColumn: text.length + 1,
    startOffset,
    endOffset: Math.min(startOffset + text.length, source.length),
  }
}

// The MatcherContext handed to an extension's matchers, bound to a specific
// lexer's definition tables. Recursive parsing resolves that lexer's defs so
// extension-parsed content behaves like core nested content, not an isolated
// snippet.
function makeMatcherCtx(lexer: Lexer, opts: ParseOptions): MatcherContext {
  return {
    parseInlines: (t) => parseInline(t, lexer.abbrDefs, lexer.linkDefs),
    parseBlocks: (s) => parseBlockSource(s, opts, lexer),
    linkDefs: lexer.linkDefs,
    abbrDefs: lexer.abbrDefs,
  }
}

// Recursively parse a block source for an extension's ctx.parseBlocks. Reuses
// the current activeMatchers (so nested content sees the same extensions)
// without re-entering parse() — which would reset the matcher context. The
// document's link/abbr defs are seeded first so references defined elsewhere
// resolve inside the snippet (snippet-local defs override on top), and the
// root footnote map is SHARED by reference — exactly as core nested containers
// (blockquotes/lists) do — so a footnote def inside extension-owned content
// reaches the document. While parsing, the matcher context is rebound to the
// sub-lexer so a nested matcher reading ctx.linkDefs/abbrDefs sees the
// snippet-local definitions.
function parseBlockSource(source: string, opts: ParseOptions, root: Lexer): BlockNode[] {
  const sourceLines = normalizedSourceLines(source)
  const anchor = root.pos + 1
  const sourceLineMap =
    sourceLines.length > 0 &&
    sourceLines.every((line, i) => root.lines[anchor + i] === line)
      ? sourceLines.map((_line, i) => root.lineNumber(anchor + i))
      : undefined
  const sub = subLexer(
    source,
    opts,
    root.lineNumberOffset + anchor,
    sourceLineMap,
    root.unclosedContainerKeys,
  )
  if (!sourceLineMap) sub.suppressPositions = true
  // Propagate nesting depth so MAX_NESTING_DEPTH still bounds extension-owned
  // recursion (a self-recursive container matcher would otherwise stack-overflow).
  sub.depth = root.depth + 1
  sub.nested = true
  for (const [k, v] of root.linkDefs) sub.linkDefs.set(k, v)
  for (const [k, v] of root.abbrDefs) sub.abbrDefs.set(k, v)
  sub.footnoteDefs = root.footnoteDefs
  sub.footnoteDefPos = root.footnoteDefPos
  collectLinkDefs(sub)
  if (!activeMatchers.length) return parseBlocks(sub, 0)
  const prevCtx = activeMatcherCtx
  activeMatcherCtx = makeMatcherCtx(sub, opts)
  try {
    return parseBlocks(sub, 0)
  } finally {
    activeMatcherCtx = prevCtx
  }
}

// Offer the active block matchers the line at the lexer cursor, in registration
// order. On a match, advance the lexer by linesConsumed and return the node.
// Core block constructs are dispatched first (see parseBlockInner), so an
// extension only sees lines core declined.
function tryBlockMatchers(lexer: Lexer): BlockNode | null {
  const ctx = activeMatcherCtx
  if (!ctx) return null
  for (const ext of activeMatchers) {
    if (!ext.matchBlock) continue
    const res = ext.matchBlock(lexer.lines, lexer.pos, ctx)
    if (res && res.linesConsumed > 0) {
      for (let k = 0; k < res.linesConsumed && !lexer.eof(); k++) lexer.consume()
      return res.node
    }
  }
  return null
}

// Offer the active inline matchers the position `pos` in `text`, in
// registration order. Returns the first match whose end advances past pos.
function tryInlineMatchers(text: string, pos: number): InlineMatch | null {
  const ctx = activeMatcherCtx
  if (!ctx) return null
  for (const ext of activeMatchers) {
    if (!ext.matchInline) continue
    const res = ext.matchInline(text, pos, ctx)
    if (res && res.end > pos && res.end <= text.length) return res
  }
  return null
}


/**
 * Normalize an explicit `[label]: url` reference label for matching:
 * whitespace-collapsed but case-SENSITIVE. Djot does "no case normalization
 * on reference definitions" (links_and_images spec), and Carve keeps a
 * case-mismatched reference unresolved -> literal (corpus 36). Implicit
 * heading references match heading TEXT and are fuzzier (case-insensitive);
 * they wrap this in heading-ids.ts rather than fold case here.
 */
/**
 * Strip leading block-container prefixes (blockquote `>`, bullet/task and
 * decimal list markers, indentation) so a definition nested inside a real
 * container (introduced after a blank line) is seen by the single
 * forward-reference pass.
 *
 * KNOWN LIMITATION (§10): this pass is line-based and has no block context,
 * so it strips a container marker even when, at the document top level, that
 * marker is really a hard-wrapped prose line (full-djot: a lone marker under
 * prose with no blank line is paragraph text, not a block). A definition
 * jammed directly onto such a line — `1. [r]: /u` or `> [r]: /u` immediately
 * under prose — is therefore still collected, so the prose line resolves the
 * reference even though it renders literally. This over-collection is limited
 * to that pathological no-blank input; real definitions sit after a blank
 * line, where this pass and the block parser agree. Alpha/roman markers are
 * deliberately NOT stripped (a def directly on an `a.`/`i.` line is the same
 * near-impossible input, and skipping the strip avoids the more common false
 * positive of fabricating a def from ordinary prose).
 */
// A definition list's DESCRIPTION marker, which opens entry content exactly as a
// bullet does - so a definition written on that line is collected from it (§801,
// carve-js#730). It is NOT unconditional: a `:` line with no term above it is
// not a description at all but paragraph text, and a definition in it defines
// nothing (corpus 216-a-description-line-needs-a-term-above-it). Hence the
// `afterTerm` gate, which the caller answers from the preceding line.
//
// `::` is the TERM marker and a `:::` fence opener is a fence; both need
// whitespace after a SINGLE colon and neither has it, so neither matches.
const RE_DESCRIPTION_PREFIX = /^[ \t]*:[ \t]+/
export const RE_AFTER_TERM = /^[ \t]*(?:::(?!:)|:)[ \t]/

/**
 * Exported for `lint.ts`, which scans source lines for footnote definitions and
 * has to strip the same prefixes the collector strips - otherwise a definition
 * inside a block quote or list item is invisible to the lint rules while the
 * parser has already collected it (carve-js#1019).
 *
 * The KEEP-INDENT variant is the one lint wants. Residual indentation is what
 * separates `> [^a]: x` (a definition in a quote) from a line merely indented
 * under something, and dropping it would make an over-indented literal line
 * look like a definition.
 */
export function stripContainerPrefixesKeepIndent(raw: string, afterTerm = false): string {
  let line = raw
  let prev: string
  do {
    prev = line
    line = line
      .replace(/^[ \t]*>(?: |$)/, '') // blockquote (NBSP and U+FEFF are content)
      .replace(/^[ \t]*(?:[-*]|\d+[.)])[ \t]+(?:\[[ xX\-_>?]\][ \t]+)?/, '') // list/task (NBSP and U+FEFF are content)
    if (afterTerm) line = line.replace(RE_DESCRIPTION_PREFIX, '')
  } while (line !== prev)
  return line
}

export function stripContainerPrefixes(raw: string, afterTerm = false): string {
  // Residual INDENTATION, which is `whitespace` - a space or a tab and nothing
  // else (markup-carve/carve#977, PART 7). This is the view the definition
  // collector matches against, so a character eaten here resolved a reference
  // on a line the renderer prints verbatim: the definition line rendered
  // literally AND registered (#790). NBSP and U+FEFF were carved out of the
  // host language's class one at a time for that bug; naming the two
  // indentation characters directly makes both carve-outs unnecessary, and
  // takes U+000B, U+000C and every Unicode space out with them.
  return stripContainerPrefixesKeepIndent(raw, afterTerm).replace(/^[ \t]+/, '')
}

/**
 * One top-level pass over the whole source collects every reference
 * definition, so resolution is order-independent (grammar §6).
 * Blockquote markers are stripped first, so a quoted def (`> [r]: /u`)
 * is found here too — and fence tracking runs on the *stripped* line so
 * a definition shown inside a quoted code block stays a literal sample.
 * Admonition bodies and indented list defs already match the
 * whitespace-tolerant RE_LINK_DEF. Because this single pass is complete,
 * sub-lexers must NOT re-collect (that would overwrite a later
 * document-wide definition with a stale nested one).
 *
 * Implicit heading references (`[Heading Text][]` resolves to a matching
 * top-level heading) are handled in resolveHeadingIds, NOT here. That
 * deferred pass walks the parsed AST and uses the real inlineText, so
 * the implicit-ref key always agrees with the heading slug — no regex
 * pre-pass can mirror the inline parser perfectly.
 *
 * A marker-shaped definition is collected only when that marker really opens
 * or continues a container. PART 9 §10 does not let a list interrupt an open
 * paragraph, so `Intro\n- [r]: /u` remains paragraph text and must not enter
 * the reference table. The paragraph state below also remembers which open
 * container owns it: a column-0 sibling marker after item prose does open a
 * new item, while the same marker below document or quoted prose folds in.
 */
// The list marker the definition pre-pass tracks content columns with. Applied
// REPEATEDLY along a line, so `- - a` contributes both of its columns.
//
// THE BARE-DOT BRANCH IS PART OF THE MARKER (carve-js#1120). `RE_ORDERED` spells
// the ordered value `[0-9]+|[ivxlcdm]+|[IVXLCDM]+|[a-z]|[A-Z]|(?=\.)`, the last
// alternative being the Carve-only bare dot (carve#315) - a value-less `. ` that
// counts from 1. `RE_ITEM_ATTR` carries it too. This pattern and `afterMarker`
// below are the two spellings of the same marker that did NOT, so a `. x` line
// opened an item the block lexer could see and this pass could not.
//
// What that costs is not a column: it is the DOCUMENT-LEVEL test. PART 12 §7 is
// normative that `*[TERM]: expansion` "is an `abbreviation_definition` only as a
// direct child of the document. Written inside a block quote, a list item or a
// div, the line is not a definition at all: it is ordinary paragraph text, it
// defines nothing, and it is preserved as the text the author typed." With the
// item invisible here, `listCols` stayed empty under a bare-dot item, the
// abbreviation branch below read document level, and the line was BOTH kept as
// lazy item text AND registered - so it expanded inside its own definition and
// again in every later paragraph. `1. x` and `- x` never did, at the same
// content column, which is how the marker rather than the column was isolated.
//
// The lookahead is zero-width and fires only before a `.`, exactly as in
// `RE_ORDERED`: a bare `)` is never a marker. Group 1 stays the indent.
//
// AND THE ABUTTING BRACE HAS TO BE VALID ATTRIBUTES (group 2, read by
// `prepassMarker` below). `extractItemAttr` is normative for the block lexer:
// when the payload is not a valid attribute payload, `-{...}` "is not a marker
// and the line stays ordinary text, mirroring the inline-span disambiguation,
// grammar §14". This pattern took ANY brace contents, so `.{#} x` / `1.{#} x` /
// `-{#} x` were paragraphs to the block lexer and open list items to this pass,
// and a column-0 `*[A]: d` under one of them was read as item content and never
// registered - a definition rendered as prose that also defines nothing, which
// is the outcome carve-js#657 and #613 are both about.
//
// The bare-dot row is the reason it surfaced here: `1.` and `-` had this defect
// already, and adding the bare dot to the marker without the validity test would
// have moved `. ` from accidentally agreeing with carve-rs to consistently
// diverging with its siblings. carve-rs registers under all three.
const RE_PREPASS_MARKER =
  /^([ \t]*)(?:[-*]|(?:[0-9]+|[ivxlcdm]+|[IVXLCDM]+|[a-z]|[A-Z]|(?=\.))[.)])(?:\{([^}]*)\})? +/
// The same marker with a task box after it, for the `afterMarker` strip below.
const RE_PREPASS_MARKER_STRIP =
  /^([ \t]*)(?:[-*]|(?:[0-9]+|[ivxlcdm]+|[IVXLCDM]+|[a-z]|[A-Z]|(?=\.))[.)])(?:\{([^}]*)\})? +(?:\[[ xX\-_>?]\] +)?/

/**
 * The prepass marker at the head of `text`, or null when there is none.
 *
 * ONE producer, for the reason `fenceCloseRe` is one: an abutting brace has to
 * be tested for validity at every site that reads this marker, or the two sites
 * disagree about whether a line opened an item.
 */
function prepassMarker(text: string, re: RegExp = RE_PREPASS_MARKER): RegExpMatchArray | null {
  const m = re.exec(text)
  if (!m) return null
  if (m[2] !== undefined && !isValidInlineAttrPayload(m[2])) return null

  return m
}

// The prepass's own quote-prefix pattern, named once so the walk below and any
// future reader of it cannot drift apart on which lines carry a marker.
const RE_QUOTE_RUN = /^(?:[^\S ]*>(?: |$))+/

/**
 * The block quote depth of `text` behind its WHOLE container prefix.
 *
 * A line's container prefix is any interleaving of list markers and block quote
 * markers - `- - > `, `- > - > ` - and the quote this pass has to see may sit
 * at the END of it. The two views taken instead answered for ONE marker: the
 * raw line, and the line behind a single `RE_PREPASS_MARKER_STRIP`. So
 * `- - > %%%` read as unquoted at depth 0 while its own closer `    > %%%` read
 * as depth 1; no run at the opener's depth was found, the comment region never
 * opened, and a link reference definition written inside an invisible comment
 * registered (carve-js#1181). `- > - > %%%` failed the same test from the other
 * side, counting one quote on a line that carries two.
 *
 * WALK THE RUN RATHER THAN ADD ANOTHER MARKER. Every widening of this prefix so
 * far has been one more spelling - column 0, then indented, then quoted, then a
 * quote behind one marker - and each one left the next depth to be found. The
 * invariant the prepass is actually enforcing is that a line's container prefix
 * is a RUN and the quote depth is the number of `>` markers anywhere in it, so
 * this consumes the run and counts them.
 *
 * Quote markers are COUNTED and list markers only CONSUMED, because the depth
 * is what tells `> > %%%` from `> %%%`: a fence opened in the inner quote is
 * not closed by a run written one level out (markup-carve/carve#1341). This
 * widens which lines are read as quoted; it never collapses two depths into
 * one.
 */
function containerQuoteDepth(text: string): number {
  let rest = text
  let depth = 0
  // Both arms consume at least one character - a quote run carries its own `>`,
  // and the marker pattern needs a marker character and a space after it - so
  // the walk terminates on every input.
  for (;;) {
    const run = RE_QUOTE_RUN.exec(rest)
    if (run !== null) {
      depth += (run[0].match(/>/g) ?? []).length
      rest = rest.slice(run[0].length)
      continue
    }
    const marker = prepassMarker(rest, RE_PREPASS_MARKER_STRIP)
    if (marker === null) return depth
    rest = rest.slice(marker[0].length)
  }
}

/**
 * WHERE A PREPASS TRACKER WAS OPENED, so a later line can be asked whether it
 * still reaches that container.
 *
 * The pass models containers per line and had no notion of one ENDING, so every
 * tracker it opens - a code fence, a `:::` depth entry, a verse region - stayed
 * open for the rest of the document once its container was gone. The block
 * parser leaves the container and reads the following lines afresh; this pass
 * kept reading them as the container's interior, and each tracker turned that
 * into its own silent failure (carve-js#1135 for the fence, carve-js#1139 for
 * the depth stack).
 *
 * ONE RECORD AND ONE TEST for all three, rather than three ad-hoc tests: the
 * question is the same each time, and it is the spelling-it-N-times that let the
 * fence acquire a container test while the other two never got one.
 */
interface PrepassScope {
  quoteDepth: number
  contentCol: number
}

/**
 * Is `line` a colon fence the BLOCK PARSER really opens?
 *
 * The prepass's own depth tracker is deliberately looser - it takes any run of
 * three or more colons, so `:::note` pushes a level even though the parser
 * renders that line as a paragraph. That looseness predates this pass's
 * container scopes and is left alone; what it may NOT do is decide anything a
 * malformed line has no business deciding. Two such decisions are gated on this
 * instead (both raised by codex review):
 *
 *   - which width a fence takes as its ENCLOSING div's closer, where a phantom
 *     level let a `:::` inside a code sample end the fence and publish the
 *     sample's definitions;
 *   - whether a flush colon line ends an open list item, where a phantom
 *     opener popped a column the parser keeps, and the definition below it was
 *     rejected as top-level indentation.
 *
 * The four arms are the block dispatcher's own, in its order.
 */
function isColonFenceOpener(line: string): boolean {
  return (
    RE_DIV_OPEN.test(line) ||
    (RE_ADMONITION_OPEN.test(line) && !RE_ADMONITION_CLOSE.test(line)) ||
    RE_LINE_BLOCK_OPEN.test(line) ||
    RE_HARDBREAKS_OPEN.test(line) ||
    RE_QUOTE_BLOCK_OPEN.test(line)
  )
}

/**
 * Does `raw` still reach the container a tracker was opened in?
 *
 * `quoteDepth` and `indent` are the line measured the way the tracker's own
 * closer reads it - counted quote markers, and the indent INSIDE the quote,
 * because a content column inside a quote is measured inside it (carve#658).
 *
 * A BLANK LINE holds a column but not a quote depth, and both halves are the
 * block parser's: a blank line is transparent inside a list item, and it ends a
 * block quote.
 */
function scopeHoldsLine(
  scope: PrepassScope,
  raw: string,
  quoteDepth: number,
  view: string,
): boolean {
  return (
    quoteDepth >= scope.quoteDepth &&
    (scope.contentCol === 0 ||
      isBlankLine(raw) ||
      // VISUAL COLUMNS, the way the parser measures reach: a tab is worth up to
      // four. Counting characters read a tab-indented body line as column one
      // against a column of three, ended the fence on it, and published the
      // definitions in the sample below (raised by codex review). The cap keeps
      // it O(the column) rather than O(the indentation run).
      indentColumns(view, scope.contentCol) >= scope.contentCol)
  )
}

/**
 * Does the prepass's view of a line START A BLOCK, so that no paragraph is left
 * open below it?
 *
 * `lineOpensBlock` is the block parser's own answer and does all the work. The
 * arms on top of it are the ones its other caller cannot reach, each measured
 * against the executable spec rather than assumed:
 *
 *   - AN ABBREVIATION DEFINITION is a block only "as a direct child of the
 *     document" (PART 12 §7), so `lineOpensBlock` leaves it out - it serves a
 *     colon-fence body, which is never document level. This pass sweeps the
 *     document, where the line is invisible and leaves no paragraph open, so the
 *     arm comes back at the one depth the construct exists at.
 *   - AN EMPTY CONTAINER LINE (`>`) strips to nothing here. The RAW line is not
 *     blank, so the caller's blank test misses it, and a container line with no
 *     content leaves no paragraph open either.
 *   - A COMMENT LINE (`%% ...`) renders nothing and opens nothing below it.
 *     `lineOpensBlock` carries the `%%%` BLOCK form only.
 *   - A BLOCK-ATTRIBUTE LINE (`{...}`) floats forward to the next block (§15),
 *     so it too is invisible. `peekBlockAttributes` is the real test and needs a
 *     cursor this pass does not have; the leading brace alone is the safe
 *     approximation, since a paragraph line that merely STARTS with `{` is then
 *     read as a block opener and the fence below it opens as it does today.
 *   - A CONTINUATION MARKER (`+`) ATTACHES the block below it (§17 L3/L4), and
 *     an attached fence opens with no closer, exactly as one after any other
 *     block opener does.
 *   - A TABLE CONTINUATION ROW (`+ ... |`) is consumed by `parseTable` as part
 *     of the table above it, so the table - not a paragraph - is what is open.
 *     It reaches no dispatcher entry of its own, which is why `lineOpensBlock`
 *     has no reason to carry it (raised by codex review).
 *
 * EVERY ARM IS CHECKED AGAINST THE BLOCK PARSER, not against a list of
 * constructs, because that is what settles carve-js#1136 in the first place: a
 * delimiter renders as an inline verbatim span exactly when a paragraph was
 * open on it, so `carveToHtml` reports the answer directly. Write the REFERENCE
 * ABOVE the construct when checking - below it, both the definition and the
 * reference land inside the same code block and the document renders the same
 * either way, which is a check that cannot fail.
 *
 * ERRING TRUE IS THE SAFE DIRECTION, and two arms lean on that deliberately:
 *
 *   - The `+` above is prose when there is nothing to attach to, and this
 *     engine then renders the delimiter below it as `<code></code>` in a
 *     paragraph. Telling the two apart needs the attachment rule; erring TRUE
 *     leaves carve-js#1136 unfixed on a STRAY `+`, which the executable spec
 *     refuses outright, rather than risking the attaching form, which is the
 *     common one and has a definite answer.
 *   - The abbreviation is not gated on document level for the same reason. A
 *     list whose item ends at a flush abbreviation leaves this pass's `listCols`
 *     populated while the block parser has already closed the item, so the gate
 *     answered "not document level" on a line the parser read as a definition.
 *
 * A DESCRIPTION MARKER (`:  `) was tried and is deliberately absent: this engine
 * renders the delimiter below one as `<code></code>` INSIDE the description, so
 * a paragraph really is open and the arm made this pass contradict the parser it
 * feeds. carve-rs is self-consistent the same way. The executable spec reads a
 * description differently at the block level, so that document already diverges
 * above this pass and is not this pass's to settle.
 *
 * The caller reads FALSE as "a paragraph is open below this line", which
 * suppresses a fence opener - saying that wrongly would collect a definition
 * written inside a fenced code sample. Saying TRUE wrongly only opens a fence
 * this pass already opens today.
 */
function prepassOpensBlock(line: string): boolean {
  return (
    line === '' ||
    lineOpensBlock(line) ||
    RE_COMMENT_LINE.test(line) ||
    line.startsWith('{') ||
    isContinuationMarker(line) ||
    RE_TABLE_CONT.test(line) ||
    RE_ABBR_DEF.test(line)
  )
}

/**
 * A container the definition prepass has open, by the ABSOLUTE column its
 * content starts at. `quote` separates the two ways a line reaches one: a block
 * quote is reached by writing its marker again, a list item by indentation
 * alone.
 */
interface OpenContainer {
  col: number
  quote: boolean
}

/** One container peeled off a line's own prefix by `composeContainerPrefix`. */
interface PeeledContainer {
  /** The column the container's content starts at. */
  content: number
  quote: boolean
  /** Whether it CONTINUES a container already open, rather than opening one. */
  matched: boolean
}

/**
 * Peel a line's container prefix the way PART 9 §24 C5 hands a body down, and
 * report the column the line's own content starts at.
 *
 * COMPOSE THE STRIPS, DO NOT WALK THE PREFIX (markup-carve/carve#1372). Each
 * strip is taken against the column the one before it HANDS OUT, so a marker
 * counts only where a container really puts one:
 *
 *   - a BLOCK QUOTE marker exactly at the handed-out column. `>   > [r]: /url`
 *     carries ONE quote: the second `>` sits at column 4 of a body that starts
 *     at 2, so it is ordinary text (carve-js#649, one level in), and `> > x` /
 *     `>   > [r]: /url` is the same line one quote deeper;
 *   - a LIST or DESCRIPTION marker wherever it is written, which is the rule the
 *     prepass's own `listCols` walk already applies - indentation before a
 *     bullet opens a nested list rather than disqualifying it.
 *
 * A LIST ITEM IS REACHED BY INDENTATION, A BLOCK QUOTE BY ITS MARKER. So the
 * walk enters every open item whose content column the line's indentation
 * covers, and enters an open quote only where the line writes the marker again.
 * `depth` is how far into `open` it got: a line that stops short of a quote is
 * that quote paragraph's lazy continuation and reaches nothing inside it, which
 * is why `- > x` / `    [r]: /url` is text at the quote's own content column.
 *
 * The `column` that comes back is what the definition gate compares against the
 * columns the walk reached. Under `- > - - x` those are 2, 4, 6 and 8, and a
 * definition written at 7 reaches none of them, so it is the innermost item's
 * paragraph text and defines nothing - while the same line one column further
 * right is a definition (carve-js#1199).
 */
function composeContainerPrefix(
  raw: string,
  afterTerm: boolean,
  open: readonly OpenContainer[],
): { column: number; peeled: PeeledContainer[]; depth: number } {
  const peeled: PeeledContainer[] = []
  let pos = 0
  let depth = 0
  // The column the container behind the walk hands its body out at. The
  // document hands out column 0.
  let handed = 0
  for (;;) {
    const rest = raw.slice(pos)
    const ind = leadingWhitespace(rest)
    const col = pos + ind
    while (depth < open.length && !open[depth]!.quote && open[depth]!.col <= col) {
      handed = open[depth]!.col
      depth++
    }
    const after = rest.slice(ind)
    if (after === '') return { column: col, peeled, depth }
    if (after[0] === '>' && (after.length === 1 || after[1] === ' ')) {
      if (col !== handed) return { column: col, peeled, depth }
      const content = col + (after.length === 1 ? 1 : 2)
      const matched = depth < open.length && open[depth]!.quote && open[depth]!.col === content
      if (matched) depth++
      peeled.push({ content, quote: true, matched })
      handed = content
      pos = content
      continue
    }
    // The DESCRIPTION body column is where the text really starts, not §16's
    // fixed three: the oracle registers a definition under a wider `:   ` too,
    // so the extra spaces are the marker's slot rather than indentation in the
    // body.
    const desc = afterTerm ? /^:[ \t]+/.exec(after) : null
    const marker = desc ?? prepassMarker(after)
    if (marker === null || !/\S/.test(after.slice(marker[0].length))) {
      return { column: col, peeled, depth }
    }
    const content = col + marker[0].length
    const matched = depth < open.length && !open[depth]!.quote && open[depth]!.col === content
    if (matched) depth++
    peeled.push({ content, quote: false, matched })
    handed = content
    pos = content
  }
}

interface LazyProbeFrame {
  levels: string[]
  endsInParagraph: boolean
}

function lazyProbeFrame(blocks: BlockNode[]): LazyProbeFrame {
  const levels: string[] = []
  let current = blocks
  let endsInParagraph = false
  for (;;) {
    const last = current[current.length - 1]
    if (!last) return { levels, endsInParagraph }
    levels.push(`blocks:${last.type}:${current.length}`)
    endsInParagraph = last.type === 'paragraph'
    if (
      last.type === 'block_quote' || last.type === 'div' ||
      last.type === 'admonition' || last.type === 'figure_group' ||
      last.type === 'line_block'
    ) {
      current = last.children
      continue
    }
    if (last.type === 'list') {
      endsInParagraph = false
      const item = last.items[last.items.length - 1]
      if (!item) return { levels, endsInParagraph }
      levels.push(`items:${last.items.length}`)
      current = item.children
      continue
    }
    if (last.type === 'definition_list') {
      endsInParagraph = false
      const item = last.items[last.items.length - 1]
      if (!item) return { levels, endsInParagraph }
      levels.push(`definitions:${last.items.length}`)
      const definition = item.definitions[item.definitions.length - 1]
      if (!definition) return { levels, endsInParagraph }
      current = definition
      continue
    }
    return { levels, endsInParagraph }
  }
}

function lazyProbeCost(lexer: Lexer, candidate: number): { start: number; cost: number } | null {
  let start = candidate - 1
  while (start >= 0 && !isBlankLine(lexer.lines[start]!)) start--
  start++
  if (start === candidate) return null
  let runBytes = 0
  for (let i = start; i < candidate; i++) runBytes += utf8ByteLength(lexer.lines[i]!) + 1
  return { start, cost: runBytes * 2 + utf8ByteLength(lexer.lines[candidate]!) }
}

function spendLazyProbeBudget(lexer: Lexer, candidate: number, budget: number): number {
  const priced = lazyProbeCost(lexer, candidate)
  return priced && priced.cost <= budget ? budget - priced.cost : budget
}

/**
 * Does the block layer fold `candidate` into a paragraph that was already open?
 *
 * THE PROBE IS ALLOWED TO RUN MATCHERS. Grammar PART 9R R1a makes a matcher a
 * pure predicate precisely so a processor may invoke one speculatively, more
 * than once at a position, and discard the result - which core parsing already
 * does when a matcher reports a consumption the parser rejects. Without running
 * them the pre-pass cannot know an extension consumed the line above, and would
 * suppress a definition that is real metadata.
 *
 * WHAT IT HANDS THE MATCHER IS A FRAGMENT, NOT THE DOCUMENT: the run back to
 * the last blank line, rebased to index 0. A matcher keyed on its absolute
 * `start`, or one that reads lines above that blank, therefore sees a different
 * question than it will during the real parse and can answer it differently.
 * Preserving the coordinates means parsing from the top of the document per
 * candidate, which is the quadratic shape the byte budget exists to prevent, and
 * carve-rs and carve-php probe the same fragment - so the limitation is shared
 * rather than an engine quirk (markup-carve/carve#1437).
 */
function lineFoldsIntoOpenParagraph(lexer: Lexer, candidate: number, budget: number): boolean {
  if (probingLazyParagraph) return false
  const priced = lazyProbeCost(lexer, candidate)
  if (!priced || priced.cost > budget) return false
  const before = lexer.lines.slice(priced.start, candidate).join('\n')
  const after = `${before}\n${lexer.lines[candidate]!}`
  const probe = (source: string): LazyProbeFrame => {
    const { onUnclosedContainer: _ignored, ...callerOptions } = lexer.parseOptions
    const options: ParseOptions = { ...callerOptions, positions: false }
    const sub = new Lexer(source, options)
    sub.atDocumentLevel = true
    sub.suppressPositions = true
    const previousCtx = activeMatcherCtx
    activeMatcherCtx = activeMatchers.length ? makeMatcherCtx(sub, options) : null
    try {
      collectLinkDefs(sub)
      return lazyProbeFrame(parseBlocks(sub, 0))
    } finally {
      activeMatcherCtx = previousCtx
    }
  }
  probingLazyParagraph = true
  try {
    const a = probe(before)
    const b = probe(after)
    return b.endsInParagraph && a.levels.join('\0') === b.levels.join('\0')
  } finally {
    probingLazyParagraph = false
  }
}

function collectLinkDefs(lexer: Lexer) {
  // `divWidth` is the width of the innermost `:::` that was OPEN when the fence
  // opened, or null when there was none. A fence inside a div ends at that div's
  // closer, exactly as it ends at the end of a quote or a list item - and the
  // block parser agrees: `:::` / ``` ``` `` / `x` / `:::` renders the code and
  // then leaves the div, while a run of a different width, or one with trailing
  // text, is ordinary fence content.
  let fence:
    | {
        ch: string
        len: number
        contentCol: number
        quoted: boolean
        scope: PrepassScope
        divWidth: number | null
        hasCloser: boolean
      }
    | null = null
  // A LINE BLOCK is verse: a definition written inside one is text the author
  // laid out, not a definition (PART 9 §23). Tracked like a code fence, and
  // closed on its own width so a wider `:::: |` is not closed by a narrower run.
  let verse: { width: number; scope: PrepassScope } | null = null
  // A comment's body is OPAQUE. This pass did not know it, so a `[r]: /u`
  // written inside `%%%` registered and a reference elsewhere resolved against
  // text the author commented out - invisible in the output AND active in the
  // link table (carve-js#634). The footnote path already treats a comment as
  // opaque; this one did not.
  let commentFence: number | null = null
  // The boundary scan `commentCloserInScope` shares between the openers of one
  // container. See `CommentScopeMemo`.
  const commentScopeMemo: CommentScopeMemo = new Map()
  // Div nesting depth, for the abbreviation branch below. A div is the one
  // container that adds NO per-line prefix, so `raw` alone cannot tell a
  // document-level definition from one written inside `:::`. Colon fences close
  // on an exact length match (carve#455), which is what the stack records.
  //
  // EACH ENTRY CARRIES THE CONTAINER IT WAS OPENED IN. The stack was
  // document-wide, so a quoted `> :::` pushed onto it and nothing popped when
  // the quote ended - leaving it non-empty for the rest of the document, and
  // the abbreviation branch requires document level, so every abbreviation
  // below a one-line quoted div stopped registering (carve-js#1139).
  const divs: { width: number; opens: boolean; scope: PrepassScope }[] = []
  // Track the enclosing list item's content column so a fenced-code delimiter
  // is tested at its container's content column (PART 2), not blindly at
  // column 0. Without this the prepass cannot tell a real fence nested at a
  // list item's content column from a merely indented run, and a definition
  // written inside such a fence is spuriously collected. Same content-column
  // stack the Markdown migrator uses. (Blockquote prefixes are handled by
  // stripContainerPrefixes; a list nested inside a blockquote is not tracked
  // here — a rarer residual case.)
  const listCols: number[] = []
  // THE COMPOSED CONTENT-COLUMN STACK, absolute, outermost first - `listCols`
  // read through every container rather than through list markers alone.
  //
  // `listCols` walks a line's list markers on `unquoted`, which strips a
  // COLUMN-0 quote run and stops at the first quote it meets. So under
  // `- > - - x` it records 2 and loses 6 and 8, and the definition gate below
  // fell back to an exemption for any line carrying a prefix of its own - which
  // registered every quoted definition whatever column it was written at
  // (carve-js#1199). This stack is what that gate asks instead; the trackers
  // above keep `listCols`, whose answers they already agree with.
  const openCols: OpenContainer[] = []
  let prevBlank = true
  // Track whether we are inside a footnote body. A footnote continuation is
  // indented, so an indented link def inside a note body must still be collected
  // (the note's content column, not column 0) -- matching the spec oracle, which
  // collects it structurally. Without this the strict top-level rejection below
  // would drop it. A flush footnote opener enters the body; a non-blank line
  // back at column 0 (a new top-level block) leaves it; blank/indented lines
  // stay inside.
  let inFootnoteBody = false
  // A lone `+` at column 0 ATTACHES the following flush-left block to the item
  // above it (PART 9 §17 L3/L4), so that block is item content written at
  // column 0. The column stack still holds the item's own content column, so a
  // definition in the attached block looked below-column and was skipped -
  // while the item collector took the line, leaving it rendered nowhere AND
  // defining nothing (carve#665). carve-php and carve-rs both collect it.
  // The COLUMN of an open `+` continuation marker, or null when none is open.
  // A `+` at column 0 attaches a flush-left block; §17 also lets the marker sit
  // at an item's own content column, and the attached block then sits at THAT
  // column. This was a boolean and the column was assumed to be 0, so a
  // definition under an indented `+` matched no open column: the line was
  // consumed and registered by nobody, so it vanished AND defined nothing
  // (carve-js#736).
  let plusColumn: number | null = null
  // IS A PARAGRAPH OPEN? A bare fence delimiter on a line that CONTINUES one
  // does not open a fence - the block parser reads it as paragraph text and the
  // run becomes an inline code span, while this pass opened a fence and took
  // the rest of the document as its body, collecting nothing from it
  // (carve-js#1136). §10 is the rule: a fence interrupts an open paragraph only
  // with a closer ahead, so BOTH halves are needed - suppressing every opener
  // under an open paragraph would collect the definitions inside a fence that
  // does close, which is the opposite error.
  //
  // The state is "is a paragraph open", not "was the previous line blank": a
  // fence after a heading opens normally, and a blank-line test would reject it.
  //
  // Three-valued, to defer the expensive half: 'no' - nothing continues from
  // the line above; 'yes' - that line is paragraph text for certain; 'ask' - it
  // depends on whether that line started a block, which is the question worth
  // deferring and is asked only where the answer is read.
  //
  // `prepassOpensBlock` runs the block parser's whole opener battery, and
  // asking it per line cost 5-13% of parse time on prose-heavy documents for an
  // answer that only a fence-shaped line ever consumes. Deferred, an ordinary
  // line costs one blank test and one assignment.
  let paraState: 'no' | 'yes' | 'ask' = 'no'
  let paraLine = ''
  // Number of composed quote/list containers that own the open paragraph.
  // This separates a real sibling marker after item prose from a marker that
  // merely looks like a new item while folding into document/quote prose.
  let paraDepth = 0
  // A BLOCK-ATTRIBUTE RUN MAY SPAN LINES (`{.a` / `.b}`), and every line of it
  // is invisible. `prepassOpensBlock` sees only the leading brace, so the
  // continuation lines read as prose and reopened a paragraph over a run the
  // block parser consumes whole (raised by codex review). `peekBlockAttributes`
  // is the real reader and ends the run at the first `}` or a blank line.
  let attrRun = false
  const hasBlockMatchers = activeMatchers.some((e) => e.matchBlock)
  // Parsing every growing blank-free prefix would be quadratic. Price the two
  // parses in UTF-8 bytes and fail toward collecting when the allowance is
  // exhausted (PART 9R R1a).
  let lazyProbeBudget = utf8ByteLength(lexer.lines.join('\n')) * 4 + 4096
  // `codeCloserPossible` over the prepass's own view of a closer, built once per
  // document and only when a paragraph is actually open under a fence-shaped
  // line. A scan per opener is the quadratic shape this index exists to close.
  let prepassClosers: CloserIndex['code'] | null = null
  for (let idx = 0; idx < lexer.lines.length; idx++) {
    // Skip leading frontmatter — `lexer.pos` is its end (0 when there is
    // none, including an unclosed opener that is NOT frontmatter), so a
    // `[ref]: ...` inside it is not collected, while content after an
    // unclosed opener still is.
    if (idx < lexer.pos) continue
    const raw = lexer.lines[idx]!
    // A description continues an entry opened by a `::` term or by a previous
    // description, and only then does its marker open content here.
    // Tested on the PREFIX-STRIPPED previous line, the way the current line is
    // read one line down. Asking the raw line meant `> :: term` did not read as
    // a term, so the `:  ` marker below it was never stripped and the
    // definition on it was neither collected nor hoisted - the `dd` was still
    // emptied, so the author's line vanished and a reference to it stayed
    // literal (carve#840). A div was the one container that worked, because it
    // adds no per-line prefix for this to hide behind.
    const afterTerm = RE_AFTER_TERM.test(stripContainerPrefixes(lexer.lines[idx - 1] ?? ''))
    const line = stripContainerPrefixes(raw, afterTerm)
    // Content columns are measured INSIDE the block quote. `> - a` puts the
    // item's content column at 2 of the quoted content, not of the raw line -
    // which carries the `> ` and matches no marker, so the column stayed 0 and
    // a definition at it was rejected as "indented at top level". The item
    // consumed the line anyway, so it rendered nothing AND defined nothing
    // (carve#658). The footnote prepass already reads the quoted line.
    // Only a COLUMN-0 marker is stripped. An indented one is inside something -
    // `- a` / `  > [r]: /u` puts the quote at the item's content column - and
    // eating that indentation here loses the very column the definition has to
    // reach, which is what emptied the stack and dropped that definition
    // (carve-js#649).
    const unquoted = raw.replace(/^(?:>(?: |$))+/, '')
    const wasPrevBlank = prevBlank
    // `isBlankLine`, not `raw.trim() === ''`: this prepass decides the same
    // `blank_line` the block lexer does, and the native trim carries the wider
    // legacy set (see `RE_BLANK_LINE`). Spelling one rule twice is what let the
    // two answers drift.
    prevBlank = isBlankLine(raw)
    // A fence is quoted if a blockquote marker stands anywhere in the line's
    // container prefix, however many list markers lead it (`- > ``` `,
    // `- - > ``` `), so its closer is blockquote-stripped.
    //
    // THE DEPTH AND THE BOOLEAN COME FROM ONE WALK. A fence opened at two quote
    // levels is not held by a line carrying one: `> :::` under `> > ``` ` has
    // left the inner quote and closes the div outside it, and a boolean cannot
    // tell the two apart - it reports "still quoted" and the closer loses its
    // pop. Reading the raw line and the line behind ONE marker answered both
    // questions for a single marker only (carve-js#1181).
    const rawQuoteDepth = containerQuoteDepth(raw)
    const rawIsQuoted = rawQuoteDepth > 0
    // AN OPEN CODE FENCE ANSWERS FIRST, ahead of every tracker below it.
    // §24 S2 makes a line verbatim once the innermost matched container is a
    // fenced body, and §28 says the same of a comment fence's body; neither
    // asks what the line LOOKS like. The trackers below asked anyway, so a line
    // inside a code sample was read as live structure and changed what got
    // collected AFTER the fence closed - three symptoms of the one ordering
    // (carve-js#1132):
    //
    //   - a `:::` line pushed a div, and the abbreviation branch requires
    //     document level, so every abbreviation below the sample stopped
    //     registering (the reported shape);
    //   - a `%%%` line opened an opaque comment region that ran PAST the code
    //     fence's closer and swallowed the definitions after it;
    //   - a `::: |` line opened a verse region that did the same.
    //
    // Each one leaves a valid definition silently unresolved because of a
    // character inside a code sample, which is the one thing verbatim content
    // may never do. Only the fence's own closer is read here.
    if (fence) {
      // A line under an open fence is VERBATIM CONTENT, not prose, so no
      // paragraph is open on the line below it - including the closer's own.
      paraState = 'no'
      // CLOSER: strip a blockquote prefix only when the fence is quoted, and
      // NEVER a list marker -- a fence delimiter is a continuation line of pure
      // indentation, so a literal `- ``` / `> ``` inside a doc-level code sample
      // is not a closer. Re-base to the column the fence opened at.
      const k = fence.quoted ? raw.replace(/^(?:[^\S ]*>(?: |$))+/, '') : raw
      const ki = k.length - k.replace(/^[ \t]+/, '').length
      const d = ki >= fence.contentCol ? k.slice(fence.contentCol) : k
      // `TRAILING_WS`, not `\s`: this prepass decides the same `code_fence_close`
      // the block lexer does, and a definition written after a fence that only
      // ONE of the two reads as closed is collected by one and rendered by the
      // other.
      const close = d.match(RE_FENCE_CLOSER_PREPASS)
      if (close && close[1]![0] === fence.ch && close[1]!.length >= fence.len) {
        fence = null
        continue
      }
      // THE FENCE ENDS WITH ITS CONTAINER. A fence opened inside a quote, a
      // list item or a div does not hold a line that no longer reaches that
      // container: the block parser has left the container and reads the line
      // afresh, so the fence is over. This pass used to leave it open forever,
      // and an unterminated fence has no closer - so every definition after the
      // container was read as fence body and skipped (carve-js#1135).
      //
      // Asked AFTER the closer, never before: a closer written at column 0 for
      // a fence opened at an item's content column is dedented out of its
      // container by construction, and testing the container first would read
      // that very line as a new opener.
      //
      // EVERY container the fence sits in has to hold the line, not whichever
      // one is easiest to ask about. A quoted fence can also sit at a list
      // item's content column (`> - ``` `), and a following `> :::` keeps the
      // quote while leaving the item.
      //
      // The column is measured on `k`, the same quote-stripped view the closer
      // above reads, because a content column inside a quote is measured
      // inside the quote (carve#658). Reading the raw indent there would
      // compare a column against a line that still carries its `> ` prefix.
      //
      // THE DIV IS THE CONTAINER `scope` CANNOT SEE, because a div adds no
      // per-line prefix and no column - so a fence inside one is held by every
      // test above and outlived the div too. Its closer is the enclosing div's
      // own: a BARE colon run of exactly the width that was open when the fence
      // opened (carve#455's exact-length rule, which is what the depth stack
      // records). A different width, or a run with trailing text, is fence
      // content, and the block parser reads all three the same way.
      //
      // AND ONLY FOR A FENCE THAT NEVER CLOSES. A fence with a closer ahead is
      // opaque all the way to it, so a same-width `:::` written inside such a
      // sample is CODE and the block parser renders it - only an unterminated
      // fence degrades at its container's boundary. Ending the fence there
      // anyway collected the definitions below it out of a visible `<pre>`,
      // which is the worst outcome this pass has (raised by codex review).
      //
      // Matched with the block parser's OWN colon closer, on `d` - the same
      // re-based view the fence's closer above reads. That settles three things
      // at once that a hand-rolled test got wrong: the pattern is anchored, so
      // an INDENTED `:::` inside the body is content rather than the div's
      // closer; it carries the structural trailing-whitespace class, where
      // `trim()` also ate a no-break space the parser keeps as content; and it
      // compares RUN LENGTHS rather than building a `:::` string per body line,
      // which was quadratic in the div's width times the sample's length.
      const divCloser =
        fence.divWidth !== null && !fence.hasCloser ? RE_ADMONITION_CLOSE.exec(d) : null
      const enclosingDivCloses = divCloser !== null && divCloser[1]!.length === fence.divWidth
      // THE INDENT IS MEASURED ON `unquoted`, NOT ON `k`, because the recorded
      // column was. The quote-prefix pattern `k` uses admits a LEADING
      // INDENTATION RUN before the marker, so `k` loses the item's indentation
      // along with the `> ` - and a fence opened behind both (`- > ``` `)
      // records the ITEM's column while its body lines score zero against it.
      // Every body line then looked out of the item, the fence ended on its
      // own first one, and the code sample's definitions went live (raised by
      // codex review). `unquoted` strips only a COLUMN-0 quote marker, so it
      // keeps exactly the indentation the column was measured against - and it
      // is never the SHALLOWER of the two, since `k` removes a superset of what
      // `unquoted` does wherever the fence is quoted at all.
      if (
        scopeHoldsLine(fence.scope, raw, rawQuoteDepth, unquoted) &&
        !enclosingDivCloses
      ) {
        continue // definitions inside fenced code are literal samples
      }
      // Out of its container. The fence is over and this line is read fresh -
      // it may be a boundary the trackers below have to see, a new opener, or a
      // definition site.
      fence = null
    }
    // THE CONTENT-COLUMN STACK IS MAINTAINED HERE, below the fence, and not
    // above it. It used to run first under an `if (!fence)` guard, so the line
    // that ENDS a fence - which the fence no longer holds, and which the block
    // parser reads as ordinary structure - was skipped and left the stack
    // holding the container's column. A definition on that very line then read
    // as below the column and was rejected, which is carve-js#1135 surviving
    // its own repair on the marker-line spelling (`- ```).
    //
    // Every line under an OPEN fence has already been consumed above, so the
    // guard would now be a check that cannot fail.
    // maintain the content-column stack (same rule as the migrator): a
    // marker opens an item at its marker width; a blank is transparent; a
    // dedented line leaves an item when a blank precedes it or it starts a
    // block; code content (inside a fence) never changes it.
    // bullets are `-`/`*` (not `+`, the continuation marker); ordered markers
    // cover every dialect the parser accepts (decimal, roman, single-letter);
    // an optional abutting `{…}` attribute block is part of the marker width
    const marker = prepassMarker(unquoted)
    const indent = unquoted.length - unquoted.replace(/^[ \t]+/, '').length
    let deflistDef: RegExpExecArray | null = null
    // Test the RAW line for a block starter: a blockquote `>` is stripped by
    // stripContainerPrefixes, so check `raw` (trimmed) for it, else a quote
    // interrupting a list item would not pop the stack.
    const rawTrimmed = raw.trim()
    const startsBlock =
      /^#{1,6}([ \t]|$)/.test(rawTrimmed) ||
      RE_BLOCKQUOTE.test(rawTrimmed) ||
      /^(`{3,}|~{3,})/.test(rawTrimmed) ||
      // A COLON FENCE ENDS THE ITEM TOO, and was the one block opener missing
      // from this list. A flush `:::` under an unblanked item opens a SIBLING
      // container - the parser renders the div next to the list, not inside it
      // - so the item's content column is gone. Left here, the column stayed
      // live and the div recorded it as the container it was opened in, which
      // then released at the next blank line and let an abbreviation written
      // INSIDE a visibly rendered div register (raised by codex review).
      //
      // Only a fence the parser REALLY opens: `:::note` is prose, and the
      // parser folds it into the item lazily, so popping the column there
      // rejected the definition below it as top-level indentation.
      isColonFenceOpener(rawTrimmed) ||
      /^(-{3,}|\*{3,}|_{3,})$/.test(rawTrimmed)
    if (marker && /\S/.test(raw.slice(marker[0].length))) {
      // Every marker on the line, not just the first: `- - see` opens TWO
      // items and its content column is 4, not 2. Tracking only the first
      // understated the column, and a definition written at the real one
      // then read as "past the column" (carve-js#613's guard) or as a fence
      // at the wrong base. Each marker pops the stack against its own indent
      // and pushes its cumulative content column.
      let rest = unquoted
      let base = 0
      for (let m2: RegExpMatchArray | null = marker; m2 && /\S/.test(rest.slice(m2[0].length)); ) {
        while (listCols.length && listCols[listCols.length - 1]! > base + m2[1]!.length) {
          listCols.pop()
        }
        base += m2[0].length
        listCols.push(base)
        rest = rest.slice(m2[0].length)
        m2 = prepassMarker(rest)
      }
    } else if ((deflistDef = RE_DEFLIST_DEF.exec(unquoted))) {
      // A DESCRIPTION MARKER OPENS A CONTENT COLUMN, exactly as an item marker
      // does. It was the one container this pass could not see, so a definition
      // written at a description's column read as top-level indentation and was
      // skipped: `:: t` / `:  a` / `   [r]: /u` rendered nowhere and defined
      // nothing, while the same line one column further left registered
      // (markup-carve/carve#1357, corpus 350-5).
      //
      // The column is the marker's OWN width - `1 + separator` - and it is the
      // same number the block parser slices the body at, read from the same
      // helper. It used to be a fixed 3 for every width, on the reading that
      // `:` plus two or more spaces was one marker whose body always started at
      // column 3; carve#1757 replaced that with the bullet's rule, so `: a` now
      // opens column 2 and this pass has to move with it or a definition
      // written at the narrow column reads as top-level indentation again.
      while (listCols.length && listCols[listCols.length - 1]! > indent) listCols.pop()
      listCols.push(indent + deflistContentCol(deflistDef[1]!))
    } else if (
      !isBlankLine(raw) &&
      // A LINK REFERENCE DEFINITION at column 0 ends the item too, so it has
      // to pop the stack like any other block start. It is not in
      // `startsBlock` because it is invisible, and being left out meant the
      // stack still held the item's content column: the definition read as
      // BELOW that column and was skipped, while the block lexer ended the
      // list at it anyway. The line was rendered nowhere and defined nothing
      // (carve-js#657) - the one outcome a definition may never have.
      //
      // At the content column this changes nothing: the `> indent` test pops
      // only what sits DEEPER than the line, so a definition written at the
      // column it belongs to still keeps its item open.
      //
      // The footnote form is already handled - its own prepass reads the line
      // independently - and an ABBREVIATION definition deliberately does not
      // qualify: all four implementations fold `- x` / `*[A]: b` as item text,
      // because PART 12 §7 recognizes one only as a direct child of the
      // document.
      (wasPrevBlank || startsBlock || isLinkDefLine(rawTrimmed))
    ) {
      while (listCols.length && listCols[listCols.length - 1]! > indent) listCols.pop()
    }
    // THE COMPOSED STACK IS MAINTAINED ON THE SAME THREE BRANCHES, over the
    // whole container prefix rather than over list markers alone.
    const composed = composeContainerPrefix(raw, afterTerm, openCols)
    if (isBlankLine(raw)) {
      // A BLANK LINE ENDS EVERY OPEN BLOCK QUOTE, and everything written inside
      // one goes with it. A list item is transparent across a blank, which is
      // why `listCols` treats every blank that way and this stack cannot.
      //
      // NOT LOAD-BEARING, and said so rather than left to be discovered: a
      // mutation that removes this drop changes no output across the suite or
      // 1652 swept prefix shapes, because the walk's own `depth` already refuses
      // to enter a quote the line does not re-mark, and a line that DOES re-mark
      // it peels into the same entry whether or not the blank dropped it. It
      // stays because it states the rule where the state is kept.
      const firstQuote = openCols.findIndex((e) => e.quote)
      if (firstQuote >= 0) openCols.length = firstQuote
    } else if (composed.peeled.length) {
      // The walk confirmed `depth` of the open containers. Anything past that
      // is gone: a sibling list marker at an open item's own column closes that
      // item, and everything written inside it goes with it.
      openCols.length = composed.depth
      for (const one of composed.peeled) {
        if (!one.matched) openCols.push({ col: one.content, quote: one.quote })
      }
    } else if (wasPrevBlank || startsBlock || isLinkDefLine(rawTrimmed)) {
      while (openCols.length && openCols[openCols.length - 1]!.col > composed.column) {
        openCols.pop()
      }
    }
    // strip the enclosing content column so a fence delimiter at that column
    // is recognized (kept-indent view keeps residual indent after markers)
    const contentCol = listCols.length ? listCols[listCols.length - 1]! : 0
    // A comment fence's closer is a leading `%` run of the SAME length;
    // trailing text is allowed, so `%%% end` closes a `%%%` fence.
    if (commentFence !== null) {
      const close = RE_COMMENT_BLOCK_ANY.exec(line)
      if (close && close[1]!.length === commentFence) commentFence = null
      paraState = 'no'
      continue
    }
    {
      const open = RE_COMMENT_BLOCK_ANY.exec(line)
      // Only a fence that CLOSES opens the opaque region. An unterminated
      // `%%%` degrades to a single-line comment, and treating it as open would
      // suppress every definition in the rest of the document.
      //
      // AND THE CLOSER HAS TO ARRIVE INSIDE THE CONTAINER THE OPENER SITS IN.
      // `commentBlockHasCloser` is a document-wide index of the LAST line
      // carrying a run of each width, which is the right question only for an
      // opener at document level - nothing bounds that body but the end of
      // input. For an opener inside a list item or a quote the container bounds
      // it, and asking the document-wide question got both directions wrong at
      // once (carve-js#1146):
      //
      //   - a `%%%` written back at column 0 two blocks below counted as the
      //     closer for an item-scoped fence, so the region opened and swallowed
      //     the definition between them. That definition neither registered nor
      //     rendered - it was gone, which is the worse of the two failure modes,
      //     and the `hidden` line above it still rendered, so the two halves of
      //     the answer did not even agree with each other;
      //   - and the index reads RAW lines, where a `> %%%` closer carries its
      //     quote marker and matches nothing. A quoted fence that closes inside
      //     its own quote therefore read as unterminated, the region never
      //     opened, and a definition the author commented out went live in the
      //     link table - carve-js#634's failure with a quoted spelling.
      //
      // Both kinds this pass collects are fixed by the one change, because the
      // region gates the whole loop body: carve-js registers ABBREVIATIONS here
      // too, where carve-rs registers them in the block parser. The footnote
      // form is unaffected either way - `parseFootnoteDef` runs during block
      // parsing, which reads the fence for itself.
      //
      // THE TWO SCOPES ASK DIFFERENT QUESTIONS, AND EACH GETS ITS OWN INDEX.
      // A document-level opener is bounded by nothing but the end of input, so
      // the document-wide index is the right question there - and it reads RAW
      // lines, which is also right there: a `> %%%` inside a quote cannot close
      // a fence opened at column 0, and counting it would open a region over
      // the definitions between them.
      //
      // AN OPENER INSIDE A CONTAINER IS BOUNDED BY THAT CONTAINER, and asking
      // the raw index first refuted it wrongly. A quoted `> %%%` carries its
      // marker and is not in that index, so a quoted fence whose only closer is
      // quoted read as unterminated: the region never opened and a definition
      // the author had commented out went live in the link table, even though
      // the quote itself renders empty. §5 registers no definition written
      // inside a comment AT ANY COLUMN A FENCE CAN SIT AT (markup-carve/carve#1309);
      // the corpus pinned the column-0 and list-item spellings and all three
      // engines leaked through the quoted one (markup-carve/carve#1341).
      //
      // The tell that it was leakage and not a reading of the rule: it sorted
      // definitions BY KIND. A footnote written in the same quoted fence stayed
      // literal, because `parseFootnoteDef` runs during block parsing and reads
      // the fence for itself, while the link reference definition this pass
      // collects went through. No rule distinguishes them.
      //
      // So the container arm goes straight to `commentCloserInScope`, which
      // reads the `stripContainerPrefixes` view the loop that CONSUMES the
      // region closes on - a quoted `> %%%` counts there exactly as it counts
      // in the parser. The hot-path property the raw index carried is kept
      // inside that helper: it refutes on its own line index before it walks a
      // container, so a run of unterminated openers stays linear.
      //
      // A `+`-ATTACHED BLOCK SITS AT THE MARKER'S COLUMN, not the item's. §17
      // lets `+` attach a FLUSH-LEFT block to an item whose content column is
      // two, and the attached comment then legitimately continues at column 0.
      // Measured at the item's column instead, it read as leaving the container
      // on its own first body line, the region never opened, and the definition
      // inside an invisible comment went live (raised by codex review). This is
      // the same column `atAnOpenContentColumn` below already prefers, and
      // `plusColumn` is set on the marker line above, so it is the marker's own
      // column here and null again after the blank that ends the attachment.
      //
      // THE DOCUMENT-LEVEL ARM IS ALSO WHERE THE CHEAP ANSWER LIVES. It skips
      // BUILDING the stripped line index: an ordinary 300 KB document carrying
      // one `%%%` block pays 127ms on this arm and 137ms without.
      const commentScope: PrepassScope = {
        quoteDepth: rawQuoteDepth,
        contentCol: plusColumn ?? contentCol,
      }
      const atDocumentLevel = commentScope.quoteDepth === 0 && commentScope.contentCol === 0
      const opensRegion =
        open !== null &&
        (atDocumentLevel
          ? commentBlockHasCloser(lexer, open[1]!.length, idx)
          : commentCloserInScope(lexer, open[1]!.length, idx, commentScope, commentScopeMemo))
      if (open && opensRegion) {
        commentFence = open[1]!.length
        paraState = 'no'
        continue
      }
    }
    // THE VERSE REGION AND THE DEPTH STACK END WITH THEIR CONTAINER TOO, on the
    // same rule the fence above uses. Both were document-wide: a `> ::: |` or a
    // `> :::` was pushed and never dropped, so one quoted line silenced every
    // definition below it for the rest of the document (carve-js#1139).
    //
    // The COLUMN each is recorded at is the enclosing content column, not the
    // line's own indent: both open on a MARKER LINE too (`- :::`), where the
    // marker is stripped before the opener is matched and the raw indent is
    // zero - so recording the indent put a quoted-or-nested opener back at
    // document level and it held every line again.
    //
    // The line's own reach is measured on `unquoted` - the quote markers gone,
    // the indentation kept - which is the view these two trackers already read
    // their own closers through.
    if (verse !== null && !scopeHoldsLine(verse.scope, raw, rawQuoteDepth, unquoted)) {
      verse = null
    }
    if (verse !== null) {
      const close = line.trim().match(/^(:{3,})$/)
      if (close && close[1]!.length >= verse.width) verse = null
      paraState = 'no'
      continue
    }
    const verseOpen = line.trim().match(/^(:{3,})[ \t]*\|$/)
    if (verseOpen) {
      verse = {
        width: verseOpen[1]!.length,
        scope: { quoteDepth: rawQuoteDepth, contentCol },
      }
      paraState = 'no'
      continue
    }
    while (
      divs.length &&
      !scopeHoldsLine(divs[divs.length - 1]!.scope, raw, rawQuoteDepth, unquoted)
    ) {
      divs.pop()
    }
    // Track `:::` nesting so the abbreviation branch can require document
    // level. Only the depth matters here, not what kind of div it is.
    const colon = line.trim().match(/^(:{3,})[ \t]*(.*)$/)
    if (colon) {
      const width = colon[1]!.length
      if (colon[2] === '' && divs.length && divs[divs.length - 1]!.width === width) divs.pop()
      else {
        divs.push({
          width,
          opens: isColonFenceOpener(line),
          scope: { quoteDepth: rawQuoteDepth, contentCol },
        })
      }
    }
    // WHETHER A PARAGRAPH IS OPEN ON THE NEXT LINE, decided here because every
    // line that carries verbatim or opaque content has already been consumed
    // above with the flag cleared.
    //
    // The rule reads only the line itself, which is the SAFE simplification of
    // §10's two halves. A paragraph stays open across a line that starts no
    // block, and a line that starts one ends it; the cases where the two halves
    // differ - a list marker opens a block but does NOT interrupt an open
    // paragraph - cannot separate them here, because `line` has the marker
    // stripped already and reads as the item's content either way. That is also
    // the answer §10 wants: `text` / `- a` folds the bullet into the paragraph,
    // and `- a` after a blank opens an item whose paragraph a flush-left line
    // lazily continues. Both leave a paragraph open.
    // A FOOTNOTE BODY TAKES NO LAZY CONTINUATION FROM COLUMN 0. Its content
    // column is §16's own and a flush line has left the body, so the block
    // parser opens a top-level fence there even with a paragraph open inside the
    // note - unlike a list item, whose paragraph a flush line really does
    // continue. `line` has the body's indentation stripped, so without this the
    // two are indistinguishable here (raised by codex review).
    // A FOOTNOTE BODY TAKES NO LAZY CONTINUATION FROM COLUMN 0 - see the note on
    // `paraState`. Read here, where `inFootnoteBody` still describes the line
    // above; the expensive half is deferred to the opener below.
    const paraWasOpen =
      paraState !== 'no' && !(inFootnoteBody && !isBlankLine(raw) && leadingWhitespace(raw) === 0)
    const paraAsk = paraState === 'ask'
    const paraLineAbove = paraLine
    const paraDepthAbove = paraDepth
    // Lists do not interrupt an open paragraph. A matched marker interrupts
    // only when it replaces a container that OWNS that paragraph; a marker
    // deeper than the owner is itself a lazy paragraph line. A newly opened
    // quote interrupts only when every marker before it continues the open
    // paragraph's containers: `para` / `> - [d]: u` does, but `para` /
    // `- > [d]: u` does not because the lazy list marker owns the quote too.
    let markerInterruptsParagraph = false
    let prefixOwnedByParagraph = true
    for (let depth = 0; depth < composed.peeled.length; depth++) {
      const one = composed.peeled[depth]!
      if (one.quote && !one.matched && prefixOwnedByParagraph) markerInterruptsParagraph = true
      if (!one.quote && one.matched && depth < paraDepthAbove) markerInterruptsParagraph = true
      if (!one.matched) prefixOwnedByParagraph = false
    }
    // Only a definition behind a list marker and a fence-shaped line consume
    // this answer. Scoping the probe to those questions avoids observable
    // matcher calls on unrelated lines and keeps the byte allowance useful.
    const matcherProbeCandidate =
      hasBlockMatchers &&
      !probingLazyParagraph &&
      ((composed.peeled.some((one) => !one.quote) &&
        RE_LINK_DEF.test(splitTrailingAttrBlock(line)[0])) ||
        RE_FENCE.test(line) ||
        RE_RAW_FENCE.test(line))
    const paragraphReallyOpen =
      paraWasOpen &&
      !markerInterruptsParagraph &&
      (matcherProbeCandidate
        ? lineFoldsIntoOpenParagraph(lexer, idx, lazyProbeBudget)
        : !paraAsk || !prepassOpensBlock(paraLineAbove))
    if (matcherProbeCandidate && paraWasOpen && !markerInterruptsParagraph) {
      lazyProbeBudget = spendLazyProbeBudget(lexer, idx, lazyProbeBudget)
    }
    const inAttrRun = attrRun
    attrRun = !isBlankLine(raw) && !line.includes('}') && (attrRun || line.startsWith('{'))
    paraState = isBlankLine(raw) || inAttrRun ? 'no' : 'ask'
    paraDepth =
      paraState === 'no' ? 0 : paragraphReallyOpen ? paraDepthAbove : openCols.length
    paraLine = line
    // OPENER: strip container prefixes (blockquote AND list marker) and re-base
    // to the content column, so a fence on a list item marker line (`- ```) or a
    // continuation line at the content column both open. RESIDUAL (line-based
    // approximation): tab-vs-space marker alignment, the post-blank baseIndent+2
    // rule, and lists nested in blockquotes are not modeled -- each errs toward a
    // spurious link (or, for a quoted fence in a deeply/exotically nested list,
    // an unresolved reference). The sound fix is collecting defs during block
    // parsing.
    // An INDENTED `>` is a blockquote marker only at an open item's content
    // column (`- a` / `  > [r]: /u`). Anywhere else the line renders as
    // ordinary text - all three engines publish `> [r]: /u` as prose there -
    // and collecting from it made the definition VISIBLE AND ACTIVE: a
    // reference elsewhere resolved through a line the reader sees as text
    // (carve-js#649). The container strippers are whitespace-tolerant, so the
    // check has to happen here.
    const quoteIndent = leadingWhitespace(raw)
    const quoteAtWrongColumn =
      quoteIndent > 0 &&
      raw.slice(quoteIndent).startsWith('>') &&
      (listCols.length === 0 || quoteIndent < Math.max(...listCols))
    if (quoteAtWrongColumn) continue
    const kept = stripContainerPrefixesKeepIndent(raw, afterTerm)
    const keptIndent = kept.length - kept.replace(/^[ \t]+/, '').length
    // A FOOTNOTE BODY has a content column too, and it is not a list column.
    // `contentCol` tracks only list items, so inside a note body it is 0 and an
    // INDENTED fence opener matched nothing - the fence went untracked and the
    // definition-shaped line inside it was collected as a real definition, so a
    // reference below the note resolved against a code sample (carve-js#667).
    // The opener's own indent is the column to re-base on; the closer check below
    // already re-bases to whatever `fence.contentCol` says.
    const openerCol =
      inFootnoteBody && contentCol === 0
        ? keptIndent
        : contentCol > 0 && keptIndent >= contentCol
          ? keptIndent
          : contentCol
    // A DESCRIPTION HAS A CONTENT COLUMN TOO, and it is neither a list column
    // nor a footnote body's. `:  ` is stripped out of `kept` before the opener
    // is matched, so a fence opened on a description line recorded column 0 -
    // which every following line reaches, so the fence outlived the description
    // and swallowed every definition below the list (carve-js#1135's deflist
    // spelling). Only the tracker's CONTAINER records it: the closer keeps
    // re-basing on `contentCol`, unchanged, since a closer written at the
    // description's own column already matches there.
    // The column is the SEPARATOR'S OWN WIDTH (`1 + run`, carve#1757), read from
    // the same helper the block parser slices the body at. It was §16's fixed
    // body column of three for every spelling; once `: d` opens column 2, a
    // fixed three made a canonical body line at column 2 look dedented and
    // ended the fence on it - the failure that reading fixed instead of derived
    // was originally written to avoid, now with the two readings swapped.
    const descSeparator = afterTerm ? RE_DEFLIST_SEPARATOR.exec(unquoted) : null
    const scopeCol = Math.max(openerCol, descSeparator ? deflistContentCol(descSeparator[1]!) : 0)
    const deIndented = keptIndent >= openerCol ? kept.slice(openerCol) : kept
    // BOTH fence spellings, not just the code one. `RE_FENCE`'s language slot
    // excludes `=`, so a raw block's ```` ```=FORMAT ```` opener matched nothing
    // here and the fence went untracked - and then the CLOSER read as an opener,
    // which put the whole rest of the document inside a fence that never closes.
    // A definition after a raw block was therefore never collected (it did not
    // reach the AST at all), while a definition written INSIDE the raw block was
    // collected and went live in the link table, so a reference below it resolved
    // against opaque passthrough content. That is carve-js#634's failure with a
    // different opener. The two lazy-continuation sites already read both
    // patterns; this prepass was the one place that read only one.
    const open = RE_FENCE.exec(deIndented)
    const rawOpen = open ? null : RE_RAW_FENCE.exec(deIndented)
    const run = open ? open[2]! : rawOpen?.[1]
    if (run) {
      // The innermost depth entry the block parser really opened - a phantom
      // one from a malformed `:::note` decides nothing here. Written as a loop
      // rather than `findLast`, which the compile target does not carry.
      let enclosingDiv: { width: number; opens: boolean; scope: PrepassScope } | undefined
      for (let i = divs.length - 1; i >= 0; i--) {
        if (divs[i]!.opens) {
          enclosingDiv = divs[i]
          break
        }
      }
      // A FENCE INTERRUPTS AN OPEN PARAGRAPH ONLY WITH A CLOSER AHEAD (§10 I4,
      // and `startsInterruptingBlock`'s backtick arm is the block parser's own
      // spelling of it). Without a closer the delimiter is not a fence at all -
      // it is an inline verbatim run inside the paragraph it continues - and
      // opening one here took the rest of the document as its body and
      // collected nothing from it (carve-js#1136).
      //
      // Both halves are load-bearing. Suppressing every opener under an open
      // paragraph instead would leave a fence that DOES close unopened, and
      // then a definition written inside that code sample is collected and goes
      // live in the link table.
      // The index is built at most once, and only when a paragraph is really
      // open under a fence-shaped line - the short circuit keeps every ordinary
      // document from paying for it.
      if (
        !paragraphReallyOpen ||
        codeCloserPossibleIn(
          (prepassClosers ??= buildCodeCloserIndex(lexer.lines, RE_PREPASS_ANY_FENCE_CLOSER)),
          run,
          idx,
        )
      ) {
        fence = {
          ch: run[0]!,
          len: run.length,
          contentCol: openerCol,
          quoted: rawIsQuoted,
          scope: { quoteDepth: rawQuoteDepth, contentCol: scopeCol },
          divWidth: enclosingDiv ? enclosingDiv.width : null,
          // Asked only for a fence INSIDE a div, which is the one place the
          // answer is read - so an ordinary document never builds the index.
          //
          // THE INDEX IS PERMISSIVE, and that is deliberate here. A merely
          // closer-SHAPED line - indented, or inside another container - counts
          // as "a closer may be ahead", so the div boundary declines to end the
          // fence and a definition after it stays uncollected. That direction
          // is a definition this pass does not reach, which is what it did
          // before this change; the other direction ends a live fence early and
          // publishes a definition out of a visible code sample. An exact
          // answer wants a container-bounded scan per opener, which is the
          // quadratic shape this index exists to avoid (raised by codex review,
          // and unchanged from `origin/main` on the document it names).
          hasCloser:
            enclosingDiv !== undefined &&
            codeCloserPossibleIn(
              (prepassClosers ??= buildCodeCloserIndex(lexer.lines, RE_PREPASS_ANY_FENCE_CLOSER)),
              run,
              idx,
            ),
        }
        paraState = 'no'
        continue
      }
      // Not a fence: the line is the paragraph's own text and the paragraph is
      // still open below it. Known outright, so the line below never has to ask.
      paraState = 'yes'
    }
    // Maintain footnote-body context (see `inFootnoteBody` above): a flush
    // footnote opener enters the body; a non-blank line at column 0 leaves it.
    if (RE_FOOTNOTE_DEF.test(raw)) inFootnoteBody = true
    else if (!isBlankLine(raw) && leadingWhitespace(raw) === 0) inFootnoteBody = false
    // An abbreviation def (`*[ABBR]: ...`) is not a link def - it is collected
    // HERE rather than by a scan of its own, because a scan of its own knew
    // nothing about what is opaque: it registered a definition written inside a
    // fenced code SAMPLE, so documenting the syntax changed the prose around it
    // (carve#573).
    // PART 12 §7: an abbreviation definition is recognized ONLY at document
    // level. Tested against `raw`, NOT the container-stripped `line`: stripping
    // is what made `> *[X]: y` register a document-wide expansion, which is the
    // one definition kind with no marker at the use site to point back at it.
    // The anchored pattern rules out an indented (list-item continuation) line
    // on its own; `divs` covers the one container that adds no line prefix.
    // `listCols` covers the remaining container: a flush-left definition line
    // that directly follows an open list item is that item's lazy continuation
    // (text), not a document-level definition. A blank line first pops the
    // stack, and then it is one.
    const abbr =
      divs.length === 0 && listCols.length === 0 && !inFootnoteBody
        ? RE_ABBR_DEF.exec(raw)
        : null
    if (abbr) {
      lexer.abbrDefs.set(abbr[1]!, dropTrailingWhitespace(abbr[2]!))
      continue
    }
    // A footnote def (`[^label]: body`) is parsed as a block in
    // parseFootnoteDef; skip here so RE_LINK_DEF can't capture `^label`.
    if (RE_FOOTNOTE_DEF.test(line)) continue
    // Strict column-0 rule: a definition is a block opener recognized ONLY at
    // its container's content column. At the true document top level
    // (contentCol 0, outside any footnote body) a def indented above column 0 is
    // literal paragraph text -- not collected here (and rendered literally by the
    // block parser, whose RE_LINK_DEF consumption is likewise flush-only), so the
    // flat pre-pass does not resolve a reference against an indented non-def line.
    // Nested defs (list items, footnote bodies, blockquotes) keep the lenient
    // collection: their real content column is >0 or the flat pass cannot model
    // it, and the oracle resolves them, so `deIndented` residual whitespace must
    // NOT reject them.
    const topLevelIndentedDef =
      contentCol === 0 && !inFootnoteBody && /^[ \t]/.test(deIndented)
    // The same rule one level out: a line BELOW the enclosing content column is
    // not a definition either, it is that container's lazy text. Collecting it
    // let a reference resolve against a line the renderer prints verbatim - so
    // `- - a` / ` [r]: /u` folded as text AND defined `r` (carve-js#597). The
    // `contentCol === 0` case above is this same test where the column is zero;
    // it stays separate because it also has to spare a footnote body, whose
    // real content column this flat pass cannot model.
    //
    // Measured on the RAW line, and only when the line supplies no container
    // prefix of its own (`kept === raw`). A def that IS an item's content sits
    // on the marker line - `- [ref]: /url`, corpus 16-reference-link-4 - where
    // stripping the marker leaves indent 0 against a content column of 2, so
    // comparing the STRIPPED indent would reject the one shape that is at its
    // content column by construction.
    //
    // The comparison is EXACT, not "at least". A def PAST the column is item
    // content: the block parser dedents it into the item and the residual
    // indent makes it literal text there, so the line renders - and a line that
    // renders was not taken as a definition. Collecting it anyway is the
    // contradiction carve-js#613 reports: the reader sees `[r]: /u` as prose
    // while a reference elsewhere silently resolves through it. `<` caught only
    // the below-column half of the same rule.
    // ANY open column, not just the innermost. `- - a` opens two items and
    // both their content columns are live under it (2 and 4): a definition at
    // either belongs to that item and renders nothing, and between them it
    // reaches neither and folds as text. Testing only the innermost left a
    // definition at the OUTER column consumed by the item and registered by
    // nobody - the author's line vanished and a reference to it stayed literal,
    // which is the "neither visible nor active" outcome carve#624 named
    // (carve-js#643). The FOOTNOTE prepass here already reads it this way.
    const rawIndent = leadingWhitespace(unquoted)
    if (isContinuationMarker(raw)) plusColumn = leadingWhitespace(unquoted)
    else if (isBlankLine(raw)) plusColumn = null
    // Inside a footnote body the minimum is column two. After carve#1729 a
    // recognized opener at or past it establishes an authored local base, so
    // an over-indented link definition registers just like the exact-column
    // spelling. A line below two still leaves the body and stays literal.
    const openColumn = inFootnoteBody ? FOOTNOTE_BODY_COLUMN : contentCol
    // THE COLUMN IS THE COMPOSED ONE, and it is compared against the columns the
    // line REACHED plus the ones it opened itself. `rawIndent` measures a line
    // behind a COLUMN-0 quote run only, so `  >    [r]: /url` scored 2 - the
    // indent before a marker the block parser strips - and the exemption below
    // let it through on top of that.
    const deepestListColumn = openCols
      .filter((entry) => !entry.quote)
      .reduce<number | null>((deepest, entry) => deepest === null || entry.col > deepest ? entry.col : deepest, null)
    const deepestTrackedListColumn = listCols.reduce<number | null>(
      (deepest, column) => deepest === null || column > deepest ? column : deepest,
      deepestListColumn,
    )
    const reachedOuterListColumn = openCols
      .slice(0, composed.depth)
      .filter((entry) => !entry.quote)
      .reduce<number | null>((deepest, entry) => deepest === null || entry.col > deepest ? entry.col : deepest, null)
    // WITH A LIST COLUMN IN PLAY the test is "at or past the deepest one", not
    // "exactly at an open one": §24 C3 erases an authored base before the item
    // parses the line, so an over-indented definition is the item's definition
    // and registers document-wide (carve#1705). With NO list column open the
    // exact test stands unchanged - a quote's content column is reached, not
    // rebased.
    const reached = (col: number): boolean =>
      deepestTrackedListColumn !== null
        ? col >= deepestTrackedListColumn
        : composed.peeled.some((one) => one.content === col) ||
          openCols.some((e, i) => i < composed.depth && e.col === col)
    const anyReached = composed.peeled.length > 0 || composed.depth > 0
    // An unmarked line may lazily continue a quote's open paragraph, but it
    // does not reach a container inside that quote. Falling back to the outer
    // `contentCol` here made a definition-shaped lazy line both disappear from
    // the paragraph and become active document-wide.
    const stoppedAtQuote =
      !composed.peeled.some((one) => one.quote) &&
      composed.depth < openCols.length &&
      openCols[composed.depth]!.quote
    const atAnOpenContentColumn = stoppedAtQuote
      ? reachedOuterListColumn !== null && composed.column >= reachedOuterListColumn
      : plusColumn !== null
      ? rawIndent === plusColumn
      : anyReached
        ? reached(composed.column)
        : inFootnoteBody
          ? composed.column >= FOOTNOTE_BODY_COLUMN
          : composed.column === openColumn
    // NO EXEMPTION FOR A LINE THAT CARRIES ITS OWN PREFIX. The guard used to
    // apply only where `kept === unquoted`, which asked "does this line carry a
    // marker of its own?" - because `rawIndent` measured the wrong thing on the
    // lines that do, and `- [ref]: /url` had to survive it. It was widened once
    // already, from `kept === raw` to `kept === unquoted`, when a COLUMN-0 quote
    // marker turned out to open the same hole (carve-js#648); an indented quote
    // marker, and a quote behind another one, are the same hole again
    // (carve-js#1199). Composing the strips answers for all of them at once:
    // `composed.column` is where the definition really sits, and on a marker
    // line that is the column the marker just handed out.
    const notAtContentColumn = !atAnOpenContentColumn
    // The trailing attribute block comes off BEFORE the regex runs: the
    // pattern's `.*$` tail would otherwise swallow it (carve#604).
    const [defLine, defAttrText] = splitTrailingAttrBlock(line)
    // NO OPEN PARAGRAPH, NO LAZY LINE (PART 0). Once the block parser would
    // fold this marker into the paragraph above, its definition-shaped content
    // is visible text and cannot also define a reference.
    const m =
      topLevelIndentedDef ||
      notAtContentColumn ||
      (paragraphReallyOpen && composed.peeled.some((one) => !one.quote))
        ? null
        : RE_LINK_DEF.exec(defLine)
    if (m) {
      const def: LinkDef = { href: m[2]! }
      const title = m[3] ?? m[4]
      if (title !== undefined) def.title = unescapeAttrValue(title)
      if (defAttrText) {
        const parsed = parseAttrs(defAttrText)
        if (parsed.id !== undefined || parsed.classes?.length || parsed.keyValues) {
          def.attrs = parsed
        }
      }
      // Link definitions use the shared, case-sensitive ASCII-whitespace key.
      // The raw spelling stays on the winning definition for the canonical
      // writer. Implicit heading references remain a separate, looser path.
      def.line = idx
      def.rawLabel = m[1]!
      lexer.linkDefs.set(normalizeRefLabel(m[1]!), def)
      continue
    }
  }
}

/**
 * A block-attribute run handed BETWEEN two consecutive `parseBlocks` calls over
 * what the author wrote as one stream. `attrs` goes in as the starting `pending`
 * and comes back out as whatever was still pending when the stream ended.
 *
 * Only a caller that SPLIT one author-visible stream into two lexers passes one;
 * everywhere else a dangling run is still dropped (§15 A4). See the split at
 * `firstBlockIdx` in `parseList`, which is the whole reason this exists.
 */
interface PendingAttrCarry {
  attrs: Attrs | null
}

function parseBlocks(lexer: Lexer, baseIndent: number, carry?: PendingAttrCarry): BlockNode[] {
  const out: BlockNode[] = []
  // Leading block-attribute lines (grammar PART 9 §15) accumulate here
  // and attach to the next block. They float across blank lines; a
  // dangling run with no following block is dropped -- unless a `carry` says
  // this stream is only HALF of one the caller split, in which case the run
  // travels to the other half instead of dying at the seam.
  let pending: Attrs | null = carry?.attrs ?? null
  while (!lexer.eof()) {
    const line = lexer.peek()!
    if (isBlankLine(line)) {
      // Blank lines do NOT reset pending block attributes (§15 reach).
      lexer.consume()
      continue
    }
    // Stop at lower indent (caller's responsibility to detect this)
    const indent = leadingWhitespace(line)
    if (indent < baseIndent) break

    const ba = tryCollectBlockAttributes(lexer)
    if (ba) {
      pending = pending ? mergeAttrs(pending, ba) : ba
      continue
    }

    const node = parseBlock(lexer)
    // A2a AN INVISIBLE CONSTRUCT IS NOT THE NEXT BLOCK (§15, carve#529):
    // `pending` floats PAST anything that renders nothing and attaches to the
    // next VISIBLE block, so
    //
    //     {#i}
    //     [^f]: note
    //
    //     e
    //
    // is `<p id="i">e</p>`. The attribute is the author's instruction about a
    // rendered element; attaching it to a construct that emits nothing silently
    // discards it, and A4 reserves discarding for the one case where there is
    // genuinely nothing left -- end of document.
    //
    // Five kinds are invisible. A reference definition and a footnote
    // definition leave NO node (the first pass collected them), so the null
    // return is what identifies them; an abbreviation definition and the two
    // comment forms leave a node that renders nothing.
    const invisible =
      node === null || node.type === 'abbreviation_def' || node.type === 'comment'
    if (node) {
      if (pending && !invisible) {
        // Leading attrs are earlier in source; the block's own trailing
        // attrs win on conflict (id/key last), classes accumulate (§15).
        node.attrs = mergeAttrs(pending, node.attrs ?? {})
      }
      if (node.type === 'table') deriveTableMetadata(node)
      consumeLooseKey(node)
      // A code fence's opener "header" becomes the `title` attribute on the
      // <pre>. Resolved here (after the pending merge) so a preceding
      // {title=...} line wins, and so the title lives on the node attrs --
      // rendered by every code-block path, including inside a code-group or a
      // caption figure (where parseFence returns a Figure wrapping the block).
      const cb =
        node.type === 'code_block'
          ? node
          : node.type === 'figure' && node.target.type === 'code_block'
            ? (node.target as CodeBlock)
            : undefined
      // An explicit {title=} wins: for a captioned block it merged onto the
      // wrapping Figure (node.attrs), otherwise onto the block itself.
      if (
        cb?.header !== undefined &&
        node.attrs?.keyValues?.title === undefined &&
        cb.attrs?.keyValues?.title === undefined
      ) {
        cb.attrs = {
          ...(cb.attrs ?? {}),
          keyValues: { ...(cb.attrs?.keyValues ?? {}), title: cb.header },
        }
      }
      out.push(node)
    }
    // A VISIBLE block absorbs any pending attrs; an invisible one leaves them
    // pending for the next block (A2a, above).
    if (!invisible) pending = null
  }
  // A dangling pending run (no following block) is dropped -- or, when the
  // caller split one stream in two, handed on to the next half.
  if (carry) carry.attrs = pending
  return out
}

/**
 * PART 9 §17 L7: `{loose}` on the preceding block-attribute line is a
 * STRUCTURAL key, and it is CONSUMED - it never reaches the output as an HTML
 * attribute. The precedent is PART 12 §15's `header-rows`, which rides the same
 * line, carries a structural fact as a boolean, and is likewise consumed.
 *
 * It says the container's children render as BLOCKS rather than as inline runs,
 * which reaches the one shape a blank line cannot spell: a ONE-ITEM loose list,
 * and a definition description holding ONE block (a blank line between two
 * ENTRIES does not loosen a `<dl>` at all, so `<dd><p>x</p></dd>` is unspellable
 * at every entry count).
 *
 * THE AXIS EXISTS IN EXACTLY TWO PLACES, so the key applies in exactly two: a
 * LIST and a DEFINITION LIST. On a block quote, a div or anything else the name
 * has no meaning at all and renders `loose=""` like any other boolean - the
 * clause adds a meaning where there is one and reserves the name nowhere else.
 *
 * A BOOLEAN AND AN EMPTY VALUE ARE ONE KEY (PART 4), so `{loose}` and
 * `{loose=""}` both arrive here as `''` and both are consumed. `loose=x` names a
 * value this key does not take, so it stays an ordinary attribute and renders
 * `loose="x"`. There is no error state.
 *
 * REDUNDANT USE IS A NO-OP: on a list the blank lines already loosened, and on a
 * description that already holds two blocks, this changes nothing.
 */
function consumeLooseKey(node: BlockNode): void {
  if (node.type !== 'list' && node.type !== 'definition_list') return
  const attrs = node.attrs
  if (!attrs?.keyValues || ownValue(attrs.keyValues, 'loose') !== '') return

  const keyValues = { ...attrs.keyValues }
  delete keyValues['loose']
  const order = attrs.order?.filter((slot) => slot !== 'loose')
  // An attribute run that held NOTHING but this key leaves no attributes at all,
  // rather than an empty record: `{loose}` is not an authored `{}` and a bare
  // `attrs: {}` would be published on the wire and re-rendered from there.
  const remaining: Attrs = {
    ...attrs,
    ...(Object.keys(keyValues).length ? { keyValues } : {}),
    ...(order?.length ? { order } : {}),
  }
  if (!Object.keys(keyValues).length) delete remaining.keyValues
  if (!order?.length) delete remaining.order
  if (remaining.id === undefined && !remaining.classes?.length && !remaining.keyValues) {
    delete node.attrs
  } else {
    node.attrs = remaining
  }

  if (node.type === 'list') {
    node.tight = false
    return
  }
  // THE DEFINITION-LIST HALF SETS ITS OWN FIELD, and PART 12 §8 publishes it
  // (markup-carve/carve#1624, spec `cfb8d7bf`). The list half above reuses
  // `tight`, which is required and already false-able; a `<dl>` has no such
  // field to reuse, because a blank line between two ENTRIES does not loosen it
  // at any entry count - so the SPELLED fact is the only thing that can say a
  // one-block description wraps, and it is set here and serialized as-is.
  //
  // Written only where the key was spelled: this function runs off the consumed
  // attribute, so a definition list that derived its own looseness never
  // reaches it and publishes nothing (markup-carve/carve-js#1409).
  node.loose = true
}

function deriveTableMetadata(table: Table): void {
  const kv = table.attrs?.keyValues
  if (!kv) return
  const aligns = positional(kv.aligns, new Set(['left', 'right', 'center']))
  const valigns = positional(kv.valigns, new Set(['top', 'middle', 'bottom']))
  const widths = kv.widths?.split(',').map((raw) => {
    const value = Number(raw.trim())
    return Number.isFinite(value) && value > 0 && value <= 100 ? value / 100 : undefined
  }) ?? []
  const count = Math.max(aligns.length, valigns.length, widths.length)
  if (count > 0) {
    table.columns = Array.from({ length: count }, (_, i) => ({
      ...(aligns[i] ? { align: aligns[i] as 'left' | 'right' | 'center' } : {}),
      ...(valigns[i] ? { valign: valigns[i] as 'top' | 'middle' | 'bottom' } : {}),
      ...(widths[i] ? { width: widths[i] } : {}),
    }))
  }

  const rowCount = (value: string | undefined): number | undefined => {
    if (value === undefined) return 0
    if (value.trim() === '') return 1
    return /^\d+$/.test(value.trim()) ? Number(value.trim()) : undefined
  }
  const headRows = rowCount(kv['header-rows'])
  const footRows = rowCount(kv['footer-rows'])
  if (headRows === undefined || footRows === undefined || headRows + footRows > table.rows.length) return
  if (kv['header-rows'] !== undefined || kv['footer-rows'] !== undefined) {
    table.rowGroups = {
      headRows,
      bodies: [{ headRows: 0, bodyRows: table.rows.length - headRows - footRows }],
      footRows,
    }
  }
}

function positional(value: string | undefined, allowed: Set<string>): Array<string | undefined> {
  return value?.split(',').map((raw) => {
    const item = raw.trim()
    return allowed.has(item) ? item : undefined
  }) ?? []
}

/**
 * If the lexer is positioned on a standalone block-attribute line
 * (`{...}`, possibly spanning multiple indented lines until the closing
 * `}`), consume it and return the parsed attributes. Otherwise consume
 * nothing and return null. A block whose content yields no recognized
 * attribute is not a block-attribute line — it falls through to normal
 * block parsing (literal text). Grammar PART 9 §15.
 */
/**
 * Non-consuming check: is the lexer positioned on a standalone block-attribute
 * line? Mirrors tryCollectBlockAttributes' recognition without consuming, so
 * startsInterruptingBlock can break an open paragraph on a trailing `{...}`
 * line (which then floats forward via parseBlocks).
 */
function peekBlockAttributes(lexer: Lexer, firstLine?: string): boolean {
  // Strict column-0 rule: a block-attribute line opens ONLY at its container's
  // content column (column 0 in every parseBlocks context, since nested content
  // is dedented into a sub-lexer). A `{...}` indented ABOVE that column does not
  // attach -- it is literal paragraph text. So require the `{` flush, not `\s*{`.
  //
  // `firstLine` overrides only the line the flush test reads, for the one caller
  // that classifies a line's CONTENT rather than the line at its indent
  // (markup-carve/carve#932). The continuation lines are still the lexer's: a
  // `{...}` block may span lines, and only its first one carries the residue.
  if (!/^\{/.test(firstLine ?? lexer.peek()!)) return false
  let collected = ''
  let n = 0
  let closed = false
  for (;;) {
    const ln = lexer.peek(n)
    if (ln === undefined) break
    if (n > 0 && isBlankLine(ln)) break
    collected += (n === 0 ? '' : '\n') + ln
    n++
    if (ln.includes('}')) {
      closed = true
      break
    }
  }
  if (!closed) return false
  return parseBlockAttributeRun(collected) !== null
}

function tryCollectBlockAttributes(lexer: Lexer): Attrs | null {
  // Strict column-0 rule (see peekBlockAttributes): only a flush `{` opens a
  // block-attribute line; an indented one is literal paragraph text.
  if (!/^\{/.test(lexer.peek()!)) return null
  let collected = ''
  let n = 0
  let closed = false
  // Multi-line collection stops at the first line containing `}`. A
  // quoted attribute value containing a literal `}` that also spans
  // lines (`{key="a}\nb"}`) is not supported across lines -- a
  // pathological case; single-line quoted values are handled by the
  // greedy `{...}` match below.
  for (;;) {
    const ln = lexer.peek(n)
    if (ln === undefined) break
    if (n > 0 && isBlankLine(ln)) break // blank line inside an open brace: not a block
    collected += (n === 0 ? '' : '\n') + ln
    n++
    if (ln.includes('}')) {
      closed = true
      break
    }
  }
  if (!closed) return null
  const attrs = parseBlockAttributeRun(collected)
  if (!attrs) return null
  for (let k = 0; k < n; k++) lexer.consume()
  return attrs
}

function parseBlockAttributeRun(src: string): Attrs | null {
  let i = 0
  // The BELOW-column classifier passes a dedented first-line override while
  // collection still carries the original residual indent. Strip that one
  // leading run; separators between CLOSED brace blocks remain forbidden.
  while (i < src.length && isCarveWhitespace(src[i])) i++
  let count = 0
  // The first block's parsed Attrs is returned as-is for a single-block run so
  // that common path stays byte-identical to the pre-optimization fold (which
  // never called mergeAttrs for one block). For 2+ blocks the values below
  // accumulate into a single mutable builder in ONE pass, avoiding the
  // per-block `mergeAttrs` array recopy that was O(n^2) on runs like
  // `{.c}{.c}{.c}…`. The builder reproduces mergeAttrs' semantics exactly:
  // classes append (no dedup), id/keyValues last-wins, first-seen source order.
  let first: Attrs | null = null
  let id: string | undefined
  const classes: string[] = []
  let keyValues: Record<string, string> | undefined
  const order: string[] = []
  const orderSeen = new Set<string>()

  while (i < src.length) {
    // Multiple brace blocks are the adjacent extension pinned by corpus 114:
    // `{.c}{#i}`. A space between two CLOSED blocks is paragraph content, not
    // attr_separator (which separates attributes inside one `{...}` block).
    // Accepting it here consumed `{.c} {.d}` as a dangling attribute line and
    // made the minimal canonical form lose authored text (carve#1028).
    if (i >= src.length) break
    if (src[i] !== '{') return null

    const start = ++i
    let quote: '"' | "'" | null = null
    let closed = false
    for (; i < src.length; i++) {
      const ch = src[i]!
      if (quote) {
        if (ch === '\\') {
          i++
          continue
        }
        if (ch === quote) quote = null
        continue
      }
      if (ch === '"' || ch === "'") {
        quote = ch
        continue
      }
      if (ch === '}') {
        closed = true
        break
      }
    }
    if (!closed) return null

    const inner = src.slice(start, i)
    // The ENTIRE payload must be valid attribute syntax (attributes +
    // whitespace, nothing else). A line like `{#todo#}` has leftover content
    // and stays literal. Empty `{}` is not a block-attribute line.
    if (!isValidAttrPayload(inner)) return null
    const attrs = parseAttrs(inner)
    if (isEmptyAttrs(attrs)) return null

    count++
    if (count === 1) first = attrs
    // Accumulate this block into the builder (mirrors mergeAttrs field rules).
    if (attrs.id !== undefined) id = attrs.id
    if (attrs.classes) for (const c of attrs.classes) classes.push(c)
    if (attrs.keyValues) {
      if (!keyValues) keyValues = {}
      for (const [k, v] of Object.entries(attrs.keyValues)) keyValues[k] = v
    }
    if (attrs.order) {
      for (const slot of attrs.order) {
        if (!orderSeen.has(slot)) {
          orderSeen.add(slot)
          order.push(slot)
        }
      }
    }
    i++
    // Padding after the final block belongs to the line ending and is legal.
    // The same run before another `{...}` block is authored paragraph content,
    // so do not consume it as a separator between blocks.
    if (i < src.length && isCarveWhitespace(src[i])) {
      let end = i
      while (end < src.length && isCarveWhitespace(src[end])) end++
      if (end === src.length) {
        i = end
        break
      }
      return null
    }
  }

  if (count === 0) return null
  if (count === 1) return first
  const out: Attrs = {}
  if (id !== undefined) out.id = id
  if (classes.length) out.classes = classes
  if (keyValues) out.keyValues = keyValues
  if (order.length) out.order = order
  return out
}

function parseBlock(lexer: Lexer): BlockNode | null {
  const startLine = lexer.pos
  const node = parseBlockInner(lexer)
  if (node) attachBlockPos(lexer, node, startLine, lexer.pos)
  return node
}

function parseBlockInner(lexer: Lexer): BlockNode | null {
  const line = lexer.peek()!

  // Past the nesting limit, stop opening recursive containers and treat the
  // line as paragraph text. Prevents a call-stack overflow on pathologically
  // nested input (e.g. thousands of `> `); see MAX_NESTING_DEPTH.
  if (lexer.depth >= MAX_NESTING_DEPTH) return parseParagraph(lexer, true)

  // Block-level constructs in priority order
  if (RE_RAW_FENCE.test(line)) return parseRawBlock(lexer)
  if (RE_FENCE.test(line)) return parseFence(lexer)
  // Comments (not rendered). Block (`%%%`) before line (`%%`). A `%%%` opener
  // with NO matching closer ahead does not open a block (PART 9 §28) — it falls
  // through to the line-comment rule below, so the following blocks still
  // render instead of being swallowed to EOF.
  const commentFence = RE_COMMENT_BLOCK_ANY.exec(line)
  if (commentFence && commentBlockHasCloser(lexer, commentFence[1]!.length)) {
    return parseCommentBlock(lexer)
  }
  if (RE_COMMENT_LINE.test(line)) {
    const l = lexer.consume()
    // ONE separator character, and it is `whitespace` - a space or a tab
    // (markup-carve/carve#977, PART 7). This read `/^\s/`, the host language's
    // class, so a `%%<VT>note` line had its vertical tab eaten as the
    // separator and `carve fmt` wrote a SPACE back in its place: a character
    // the clause calls content, replaced by one the author did not write.
    return { type: 'comment', block: false, content: l.replace(/^[ \t]*%%/, '').replace(/^[ \t]/, '') }
  }
  if (RE_LINE_BLOCK_OPEN.test(line)) return parseLineBlock(lexer)
  if (RE_HARDBREAKS_OPEN.test(line)) return parseHardBreaksBlock(lexer)
  if (RE_QUOTE_BLOCK_OPEN.test(line)) return parseQuoteBlock(lexer)
  // A typed `::: word` admonition opens immediately; if no exact closer appears
  // ahead, it auto-closes at EOF.
  if (RE_ADMONITION_OPEN.test(line) && !RE_ADMONITION_CLOSE.test(line))
    return parseAdmonition(lexer)
  // Bare `:::` or attributes-only `::: {…}` opens a generic div (the
  // admonition branch above already claimed the `::: word` form).
  if (RE_DIV_OPEN.test(line)) return parseDiv(lexer)
  // PART 12 §7: only at document level. In a container the line falls through
  // to the paragraph branch and is preserved as the text the author typed.
  if (lexer.atDocumentLevel && RE_ABBR_DEF.test(line)) {
    return parseAbbrDef(lexer)
  }
  // Footnote definition: consume the def line + indented continuation
  // and stash the parsed body (tested before RE_LINK_DEF).
  if (RE_FOOTNOTE_DEF.test(line)) return parseFootnoteDef(lexer)
  // Reference-link definitions were collected in the first pass; the
  // line itself produces no block (consume it so it is not a paragraph).
  // Strict column-0 rule: RE_LINK_DEF is whitespace-tolerant (its leading
  // `[^\S ]*` matches spaces/tabs so a quoted/nested def is still
  // recognized in other passes), but a def is a block opener and opens ONLY at
  // its container's content column (column 0 here). An INDENTED `[x]: …` line is
  // literal paragraph text -- and, since RE_LINK_DEF also matches `[^fn]: …`, an
  // indented footnote def (missed by the flush-anchored RE_FOOTNOTE_DEF above)
  // must not be swallowed here either. Require the def flush at column 0.
  if (
    leadingWhitespace(line) === 0 &&
    isLinkDefLine(line) &&
    !lexer.literalLazyLinkDefLines.has(lexer.lineNumber(lexer.pos))
  ) {
    lexer.consume()
    return null
  }
  if (RE_HR.test(line)) {
    lexer.consume()
    const node: ThematicBreak = { type: 'thematic_break' }
    if (line[0] === '*' || line[0] === '_') node.marker = line[0]
    return node
  }
  if (RE_HEADING.test(line)) return parseHeading(lexer)
  // Definition list starts on a `:: term` line (two colons, not three).
  if (RE_DEFLIST_TERM.test(line)) return parseDefinitionList(lexer)
  if (RE_BLOCKQUOTE.test(line)) return parseBlockQuote(lexer)
  if (
    RE_TASK.test(line) ||
    RE_UNORDERED.test(line) ||
    RE_ORDERED.test(line) ||
    extractItemAttr(line) !== null
  )
    return parseList(lexer)
  if (isTableRow(line)) return parseTable(lexer)
  if (isBlockImageLine(line) && imageIsBlock(lexer)) return parseBlockImage(lexer)
  // Extension block matchers run after every core construct, before the
  // paragraph fallback: extensions add syntax, they never hijack core.
  if (activeMatchers.length) {
    const matched = tryBlockMatchers(lexer)
    if (matched) return matched
  }
  // A line that is nothing but a display-math span (`$$`…``) standalone on its
  // block is a candidate EQUATION; when a caption follows it is numbered like a
  // figure/table/listing (#87). Diverted here, before the paragraph fallback,
  // because parseParagraph would otherwise fold the caption line into the math
  // paragraph.
  if (line.trimStart().startsWith('$$`')) {
    const eq = parseEquationBlock(lexer)
    if (eq) return eq
  }
  return parseParagraph(lexer)
}

// Parse a standalone display-math line, optionally wrapping it in a figure when
// a caption follows (a numbered equation). Returns null when the line is not
// solely display math, or when non-blank prose follows with no blank line (so
// the line belongs to a normal multi-line paragraph instead).
function parseEquationBlock(lexer: Lexer): Paragraph | Figure | null {
  // Mirror parseParagraph's leading-whitespace strip + base-position folding so
  // an indented standalone equation is still recognized and the math span keeps
  // its true source offset.
  const lineIndex = lexer.pos
  const raw = lexer.peek()!
  const firstLead = raw.match(/^[ \t]+/)?.[0].length ?? 0
  const inline = parseInline(raw.replace(/^[ \t]+/, ''), lexer.abbrDefs, lexer.linkDefs, {
    anchored: lexer.hasDocumentOffsets,
    baseOffset: lexer.lineOffset(lineIndex) + firstLead,
    startLine: lexer.lineNumber(lineIndex),
    startColumn: lexer.lineStartColumn(lineIndex) + firstLead,
  })
  if (inline.length !== 1) return null
  const only = inline[0]!
  if (only.type !== 'math' || !(only as Math).display) return null
  // First non-blank line after the math line, and how many blanks precede it.
  let la = 1
  while (isBlankLine(lexer.peek(la))) la++
  const after = lexer.peek(la)
  const blanks = la - 1
  const cap = after !== undefined ? RE_CAPTION.exec(after) : null
  const para: Paragraph = { type: 'paragraph', children: inline }
  // §4: a caption attaches across at most one blank line.
  if (cap && blanks <= 1) {
    for (let i = 0; i <= la; i++) lexer.consume()
    // The block loop spans the FIGURE, so the equation paragraph it wraps would
    // otherwise have no position of its own (PART 12 §4). The equation occupies
    // exactly its own line; the figure spans that plus the caption.
    attachBlockPos(lexer, para, lineIndex, lineIndex + 1)
    return {
      type: 'figure',
      target: para,
      caption: parseCaptionInline(lexer, cap[1]!),
    } as Figure
  }
  // Non-blank, non-caption text immediately follows: let parseParagraph fold
  // the math and that text into one paragraph (preserve existing behavior).
  if (after !== undefined && blanks === 0) return null
  // Standalone display math with no caption: a plain single-math paragraph.
  lexer.consume()
  return para
}

/*
 * A CONTAINER ENDS AT ITS LAST PLACED CHILD (PART 12 §4, markup-carve/carve#1522
 * and markup-carve/carve#1524).
 *
 * These three have no closer to end at, so their extent came from the LINES
 * THEY CONSUMED - and a container consumes lines whose content ends up
 * somewhere else. A definition written at an item's content column is collected
 * and hoisted to the document, so it becomes the list's SIBLING while the list
 * went on covering it and two nodes claimed the same offsets; an attribute
 * block that attaches to nothing yields no child at all, and §4 excludes it by
 * name. Every other container ends at a fence closer, a pipe or a delimiter run
 * and is left alone.
 *
 * A HEADING IS IN THE SET FOR THE SAME REASON, over inline children rather than
 * blocks (markup-carve/carve-js#1348). It has no closer either - it ends at its
 * newline by construction - so its extent came from the line it consumed, and
 * that line can end in whitespace PART 2's NO TRAILING WHITESPACE clause rules
 * is "DROPPED. It does not reach the output, and it is not content", naming a
 * heading among the lines it holds for. The run reaches no inline child,
 * because the text the children are parsed from has already had it stripped, so
 * a construct was owning source that is not content. Ending at the last placed
 * child is §4's own answer and takes a trailing tab with it.
 */
const ENDS_AT_LAST_PLACED_CHILD = new Set([
  'block_quote',
  'definition_list',
  'heading',
  'list',
  'list_item',
])

/*
 * What an EMPTIED container of each kind spans instead: the markup that opened
 * it, and the whitespace separating that markup from the content it never got.
 *
 * "Ends at its last placed child" is silent when there is none, and a container
 * can be emptied - a definition written as an item's only content is collected
 * out of it and the item keeps no trace. Zero width was rejected (a shape every
 * consumer special-cases, and it discards the marker the author typed) and so
 * was the extent the author typed, which is what the ruling above rejects for a
 * container that does have children.
 */
const EMPTIED_CONTAINER_MARKUP: Record<string, RegExp> = {
  block_quote: /^[ \t]*>[ \t]*/,
  list: /^[ \t]*(?:[-+*]|[0-9]+[.)]|[A-Za-z]+[.)]|\.)[ \t]*/,
  list_item: /^[ \t]*(?:[-+*]|[0-9]+[.)]|[A-Za-z]+[.)]|\.)[ \t]*/,
}

function attachBlockPos(
  lexer: Lexer,
  node: { pos?: Position },
  startLineIndex: number,
  endLineIndexExclusive: number,
): void {
  if (lexer.suppressPositions) return
  const endLineIndex = Math.max(startLineIndex, endLineIndexExclusive - 1)
  const endLine = lexer.lines[endLineIndex] ?? ''
  node.pos = {
    startLine: lexer.lineNumber(startLineIndex),
    endLine: lexer.lineNumber(endLineIndex),
    startColumn: lexer.lineStartColumn(startLineIndex),
    endColumn: lexer.lineStartColumn(endLineIndex) + endLine.length,
    startOffset: lexer.lineOffset(startLineIndex),
    endOffset: lexer.lineOffset(endLineIndex) + endLine.length,
  }
  // A list parser may receive an authored marker past its local body base.
  // Its lexer is anchored at that body's minimum column, while the marker is
  // still preceded by the residual indentation that selected the authored
  // base. A container span begins at its opening markup (PART 12 §4), not at
  // that indentation. Inline children already account for the residual run;
  // apply the same source adjustment to the list and item containers.
  const type = (node as { type?: string }).type
  if (type === 'list' || type === 'list_item') {
    const startLine = lexer.lines[startLineIndex] ?? ''
    const leadChars = leadingWhitespace(startLine)
    if (leadChars > 0) {
      const markerLine = startLine.slice(leadChars)
      const documentLine = (lexer.rootLines ?? lexer.lines)[node.pos.startLine - 1]
      // A tab straddling a container strip is represented by synthetic spaces
      // in the local line. When the remaining marker text is an exact suffix,
      // measure its column in the untouched document line so those spaces are
      // not charged a second time.
      node.pos.startColumn =
        documentLine !== undefined && documentLine.endsWith(markerLine)
          ? Array.from(documentLine.slice(0, documentLine.length - markerLine.length)).length + 1
          : (node.pos.startColumn ?? 1) + leadChars
      node.pos.startOffset = (node.pos.startOffset ?? 0) + leadChars
    }
  }
  // A paragraph has no opening marker: its extent begins at its first owned
  // inline, not at indentation or a surrounding container's content column.
  if ((node as { type?: string }).type === 'paragraph') {
    const children = (node as { children?: Array<{ pos?: Position }> }).children
    const allPlaced = children?.every((child) => child.pos !== undefined) ?? false
    const first = allPlaced ? children?.[0]?.pos : undefined
    const last = allPlaced ? children?.[children.length - 1]?.pos : undefined
    if (first) {
      node.pos.startLine = first.startLine
      if (first.startColumn !== undefined) node.pos.startColumn = first.startColumn
      if (first.startOffset !== undefined) node.pos.startOffset = first.startOffset
    }
    if (last) {
      node.pos.endLine = last.endLine
      if (last.endColumn !== undefined) node.pos.endColumn = last.endColumn
      if (last.endOffset !== undefined) node.pos.endOffset = last.endOffset
    }
  }
  if (type !== undefined && ENDS_AT_LAST_PLACED_CHILD.has(type)) {
    // The LAST PLACED child, not the last child. §4 lets a reassembled node omit
    // its position, and skipping past one keeps a container from reporting an
    // end shorter than something it really does hold.
    //
    // A DEFINITION LIST'S CHILDREN ARE NOT IN `items` (markup-carve/carve#1530).
    // This engine models an entry as a bare `{terms, definitions, ...}` record
    // with no `type` and no `pos`, so the scan below finds nothing in one and
    // the list took the extent of the lines it consumed - which reached an
    // attribute line no child covers. The children §4 means are the wire nodes
    // `entriesToWire` publishes, so the bound is read from THEM rather than
    // spelled a second time here: a description that kept children ends at the
    // last of them, and one the root emptied ends where the parser recorded.
    const kids =
      type === 'definition_list'
        ? entriesToWire((node as { items?: DefinitionItem[] }).items ?? [])
        : [
            ...((node as { children?: Array<{ pos?: Position }> }).children ?? []),
            ...((node as { items?: Array<{ pos?: Position }> }).items ?? []),
          ]
    const lastOwned = [...kids].reverse().find((child) => child.pos !== undefined)?.pos
    if (lastOwned) {
      node.pos.endLine = lastOwned.endLine
      if (lastOwned.endColumn !== undefined) node.pos.endColumn = lastOwned.endColumn
      if (lastOwned.endOffset !== undefined) node.pos.endOffset = lastOwned.endOffset
    } else if (EMPTIED_CONTAINER_MARKUP[type]) {
      const startLine = lexer.lines[startLineIndex] ?? ''
      const lead = leadingWhitespace(startLine)
      const marker = EMPTIED_CONTAINER_MARKUP[type]!.exec(startLine.slice(lead))?.[0]?.length ?? 0
      node.pos.endLine = node.pos.startLine
      if (node.pos.startColumn !== undefined) node.pos.endColumn = node.pos.startColumn + marker
      if (node.pos.startOffset !== undefined) node.pos.endOffset = node.pos.startOffset + marker
    }
  }
}

function parseHeading(lexer: Lexer): Heading {
  const lineIndex = lexer.pos
  const line = lexer.consume()
  const m = RE_HEADING.exec(line)!
  const level = m[1]!.length as HeadingLevel

  // SINGLE-LINE HEADINGS (NORMATIVE, diverges from Djot): a heading ENDS AT THE
  // NEWLINE. Nothing folds into it -- not a plain line, not a same-count `#`
  // line -- so the next line begins whatever block it begins, exactly as after
  // any other closed block. Lazy continuation therefore means one thing across
  // the language: it continues an open PARAGRAPH, and a heading is not one.
  let text = line.replace(/^#{1,6} +/, '')
  // NO TRAILING WHITESPACE (PART 2; carve#926). A heading is one line by
  // construction, so the single-line form is the whole rule here.
  text = text.replace(RE_TRAILING_WS, '')

  const node: Heading = { type: 'heading', level, children: [] }
  // djot-strict: a heading takes its attributes on the PRECEDING block-
  // attribute line (§15), not as a trailing `{…}` on its own line. A `{…}`
  // at the end of the heading text is therefore ordinary inline content.
  // Column where the content starts on the first line (the marker + spaces).
  const textColumn = line.length - line.replace(/^#{1,6} +/, '').length + 1
  node.children = parseInline(text, lexer.abbrDefs, lexer.linkDefs, {
    anchored: lexer.hasDocumentOffsets,
    baseOffset: lexer.lineOffset(lineIndex) + textColumn - 1,
    startLine: lexer.lineNumber(lineIndex),
    startColumn: lexer.lineStartColumn(lineIndex) + textColumn - 1,
  })
  return node
}

function parseFence(lexer: Lexer): CodeBlock | Figure {
  const fenceStartIndex = lexer.pos
  const open = lexer.consume()
  const m = RE_FENCE.exec(open)!
  const indent = m[1]!.length
  const marker = m[2]!
  const lang = m[3] || undefined
  // Header is the quoted group (with or without a language); label is the
  // bracketed group from whichever alternative matched. Strip the delimiters.
  const headerRaw = m[4] ?? m[6]
  const labelRaw = m[5] ?? m[7] ?? m[8]
  const header = headerRaw ? headerRaw.slice(1, -1) : undefined
  const label = labelRaw ? labelRaw.slice(1, -1) : undefined
  const closeRe = fenceCloseRe(marker)
  const lines: string[] = []
  while (!lexer.eof()) {
    const ln = lexer.peek()!
    if (closeRe.test(ln) && ln.length - ln.trimStart().length <= 3) {
      lexer.consume()
      break
    }
    lexer.consume()
    // Strip the common indent of the opening fence (Djot rule)
    lines.push(ln.slice(Math.min(indent, leadingWhitespace(ln))))
  }
  const fenceEndIndex = lexer.pos
  const cb: CodeBlock = { type: 'code_block', content: lines.join('\n') }
  if (lang) cb.lang = lang
  if (header !== undefined) cb.header = header
  if (label !== undefined) cb.label = label
  // Optional caption (`^ …`): a captioned code block is a numbered LISTING,
  // wrapped in a figure exactly like a captioned image/blockquote/table.
  let lookahead = 0
  while (!lexer.eof() && isBlankLine(lexer.peek(lookahead))) lookahead++
  const next = lexer.peek(lookahead)
  if (next) {
    const cap = RE_CAPTION.exec(next)
    // §4: a caption attaches only when it immediately follows the block
    // or is separated by at most ONE blank line.
    if (cap && lookahead <= 1) {
      for (let i = 0; i <= lookahead; i++) lexer.consume()
      // The block loop spans the FIGURE, so the fence it wraps would otherwise
      // have no position of its own (PART 12 §4). It ends where the caption
      // begins - the same treatment the captioned image and blockquote already
      // get.
      attachBlockPos(lexer, cb, fenceStartIndex, fenceEndIndex)
      return {
        type: 'figure',
        target: cb,
        caption: parseCaptionInline(lexer, cap[1]!),
      } as Figure
    }
  }
  return cb
}

// Raw passthrough block: ```=FORMAT … ``` . Content is verbatim; the
// renderer emits it only when FORMAT matches the output (html).
function parseRawBlock(lexer: Lexer): RawBlock {
  const m = RE_RAW_FENCE.exec(lexer.consume())!
  const marker = m[1]!
  const format = m[2]!
  const closeRe = fenceCloseRe(marker)
  const lines: string[] = []
  while (!lexer.eof()) {
    const ln = lexer.peek()!
    if (closeRe.test(ln)) {
      lexer.consume()
      break
    }
    lexer.consume()
    lines.push(ln)
  }
  // `join` collapses both no payload lines and one blank payload line to the
  // same empty string. They render differently: the former contributes
  // nothing, while every blank line between the delimiters is verbatim raw
  // payload. Preserve the count when the payload is entirely blank so a
  // renderer never has to guess which source shape produced `content: ""`.
  const content = lines.length > 0 && lines.every((line) => line === '')
    ? '\n'.repeat(lines.length)
    : lines.join('\n')
  return { type: 'raw_block', format, content }
}

// A closer of each fence shape, spelled PERMISSIVELY: a leading indentation run
// is tolerated where the real closers anchor at column 0. See `CloserIndex`.
const RE_ANY_COLON_CLOSER = /^[ \t]*(:{3,})[ \t]*$/
// The CODE closer's trailing run matches `FENCE_TRAILING_WS` above: a
// tab after a closer's marker is trailing, so the line IS a closer
// (carve#1295). The leading run stays permissive - that is the dedent this
// index is a superset for.
//
// THE DIRECTION OF THE ERROR IS WHAT MATTERS HERE, and it is not symmetric,
// because `codeCloserPossible` only ever REFUTES:
//
//   index wider than the real matcher  ->  a wasted scan, still correct
//   index NARROWER than it             ->  a WRONG answer
//
// Too wide, a line the real matcher rejects turns "no closer ahead" into "go
// and scan", and the scan runs to end of document. That is only slow - the
// quadratic path this index exists to close, and a document of ` ```js `
// openers under a single ` ```<TAB> ` went from 11ms to 270ms at 4000 lines
// when the real matcher was narrowed and this one was not (carve-js#1121).
//
// Too narrow, an opener is told no closer exists and swallows the rest of the
// document past a closer that is really there. So this constant follows the
// real matcher whenever the real matcher WIDENS, and may lag it only when it
// narrows.
const RE_ANY_FENCE_CLOSER = new RegExp('^[ \\t]*([`~]{3,})' + FENCE_TRAILING_WS)

// THE SAME CLOSER SEEN THROUGH A CONTAINER PREFIX, for the definition prepass.
//
// The prepass matches a closer on a view with the blockquote markers and the
// list marker already stripped, so `> ``` ` and `- ``` ` are closers there and
// are invisible to the pattern above. That direction of error is the harmless
// one for a REFUTING index, and it is the fatal one here: the prepass reads the
// answer POSITIVELY, to decide whether a fence interrupts an open paragraph
// (carve-js#1136), and a missed closer says "does not interrupt" - which leaves
// the fence unopened and collects the definitions written INSIDE it.
//
// So this one tolerates every prefix the prepass strips, and the error runs the
// other way: a line that is not really a closer answers "a closer may be ahead",
// the fence opens as it does today, and nothing is collected that was not
// already.
const RE_PREPASS_ANY_FENCE_CLOSER = new RegExp(
  '^(?:[ \\t]*>)*[ \\t]*(?:(?:[-*+]|[0-9]+[.)]|[A-Za-z][.)])[ \\t]+)*[ \\t]*([`~]{3,})' + FENCE_TRAILING_WS,
)

/**
 * Where a closer of each fence shape LAST occurs in a lexer's lines.
 *
 * A "no closer ahead" answer is what makes the lookahead scans linear. Without
 * it every unterminated opener re-reads the whole suffix, which is quadratic on
 * a document of openers with DISTINCT widths - the shape that took ~1.9 MiB of
 * comment openers from 8.5s to nothing when this map was first built for `%%%`.
 *
 * PERMISSIVE ON PURPOSE. A caller may read a DEDENTED view of these lines,
 * where MORE lines are closer-shaped than in the raw text, so the patterns
 * tolerate a leading run. The index is therefore a SUPERSET of what any view
 * can match, and "no closer ahead" holds for every view. It only ever refutes;
 * a positive answer sends the caller to the real scan.
 *
 * A comment and a colon closer match on EXACT length, so each is a width -> last
 * index map. A CODE closer matches at length OR LONGER, so its entry is the
 * ascending distinct runs paired with the suffix-maximum of their last indices:
 * the answer for length L is the entry of the smallest recorded run >= L.
 */
interface CloserIndex {
  comment: Map<number, number>
  colon: Map<number, number>
  code: Map<string, { runs: number[]; lastAtLeast: number[] }>
}

/**
 * The CODE half of `buildCloserIndex`, over whatever closer pattern the caller
 * reads its lines with.
 *
 * Factored out because there is a second view of these lines: the definition
 * prepass matches a closer after stripping container prefixes, so more lines are
 * closer-shaped there than `RE_ANY_FENCE_CLOSER` admits. Both indexes are the
 * same suffix-maximum structure over a different pattern; spelling that twice is
 * how the two would drift.
 */
function buildCodeCloserIndex(lines: string[], re: RegExp): CloserIndex['code'] {
  const codeLast = new Map<string, Map<number, number>>()
  for (let i = 0; i < lines.length; i++) {
    const f = re.exec(lines[i]!)
    if (f) {
      const run = f[1]!
      let byRun = codeLast.get(run[0]!)
      if (byRun === undefined) {
        byRun = new Map<number, number>()
        codeLast.set(run[0]!, byRun)
      }
      byRun.set(run.length, i)
    }
  }
  const code = new Map<string, { runs: number[]; lastAtLeast: number[] }>()
  for (const [char, byRun] of codeLast) {
    const runs = [...byRun.keys()].sort((a, b) => a - b)
    const lastAtLeast = new Array<number>(runs.length)
    let best = -1
    for (let i = runs.length - 1; i >= 0; i--) {
      best = Math.max(best, byRun.get(runs[i]!)!)
      lastAtLeast[i] = best
    }
    code.set(char, { runs, lastAtLeast })
  }

  return code
}

function buildCloserIndex(lines: string[]): CloserIndex {
  const comment = new Map<number, number>()
  const colon = new Map<number, number>()
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const c = RE_COMMENT_BLOCK_ANY.exec(line)
    if (c) comment.set(c[1]!.length, i)
    const d = RE_ANY_COLON_CLOSER.exec(line)
    if (d) colon.set(d[1]!.length, i)
  }

  return { comment, colon, code: buildCodeCloserIndex(lines, RE_ANY_FENCE_CLOSER) }
}

/** `buildCloserIndex` over a lexer's own lines, built at most once. */
function closerIndex(lexer: Lexer): CloserIndex {
  lexer.fenceCloserIndex ??= buildCloserIndex(lexer.lines)

  return lexer.fenceCloserIndex
}

/** Whether a code/raw closer for `marker` may occur after line index `after`. */
function codeCloserPossible(index: CloserIndex, marker: string, after: number): boolean {
  return codeCloserPossibleIn(index.code, marker, after)
}

/** `codeCloserPossible` against a code index built over any closer pattern. */
function codeCloserPossibleIn(code: CloserIndex['code'], marker: string, after: number): boolean {
  const entry = code.get(marker[0]!)
  if (entry === undefined) return false
  let lo = 0
  let hi = entry.runs.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (entry.runs[mid]! < marker.length) lo = mid + 1
    else hi = mid
  }

  return lo < entry.runs.length && entry.lastAtLeast[lo]! > after
}

/** Whether a closer of EXACTLY `len` may occur after line index `after`. */
function exactCloserPossible(last: Map<number, number>, len: number, after: number): boolean {
  const at = last.get(len)

  return at !== undefined && at > after
}

/**
 * From a `%%%` opener at line `after`, is there a matching closer ahead? A
 * comment closer matches on EXACT delimiter length (longer fences nest), so ANY
 * later line whose delimiter run has that length is a valid closer. Used to
 * reject an unclosed `%%%` as a block opener (PART 9 §28): without this an
 * unclosed opener swallows the rest of the document, silently dropping every
 * following block.
 *
 * `after` DEFAULTS TO THE CURSOR AND IS PASSED EXPLICITLY BY THE PREPASS. Every
 * block-parsing caller asks about the opener it is standing on, so `lexer.pos`
 * is that opener's line for them. The definition prepass is not a cursor: it
 * sweeps the document with an index of its own while `lexer.pos` stays parked
 * at the end of the frontmatter, which is line 0 for a document without any.
 * Asking "is there a closer after line 0" on behalf of an opener on line 7 let
 * the opener match ITSELF - the index stores the LAST line carrying a run of
 * that length, which for an unclosed fence is the opener - so the check could
 * only ever fail for an opener on line 0 (markup-carve/carve-js#1118).
 */
function commentBlockHasCloser(lexer: Lexer, fence: number, after: number = lexer.pos): boolean {
  return exactCloserPossible(closerIndex(lexer).comment, fence, after)
}

/**
 * From a `%%%` opener at line `from`, is there a matching closer BEFORE THE
 * CONTAINER THE OPENER SITS IN ENDS?
 *
 * The definition prepass's own bound, and the reason it cannot use the
 * document-wide index: a fence inside a list item or a quote is bounded by that
 * container, so the closer has to arrive before the first non-blank line that
 * leaves it, with blank lines transparent (carve-js#1146). `scopeHoldsLine` is
 * the same container test the fence, verse and depth trackers in this pass
 * already share, so all four agree on what "still inside" means.
 *
 * THE SCOPE IS ASKED BEFORE THE CLOSER, which is the opposite of the order the
 * CODE fence uses a few hundred lines up - and the two orders are both right,
 * because the two fence kinds close differently. A code fence re-bases its
 * closer on the column it opened at, so a run written at column 0 for a fence
 * opened at an item's content column is its closer by construction and has to
 * be read before the container question. A comment fence has no such re-basing:
 *
 * ````
 * - item
 *   %%%
 *   [r]: /url
 * %%%
 * ````
 *
 * The column-0 run ENDS THE ITEM, so it is not inside the fence's container and
 * closes nothing; the opener degrades to a line comment and `[r]: /url` is an
 * ordinary definition. Reading the closer first opened a region over it and the
 * definition vanished. Verified against the executable spec oracle.
 *
 * A CLOSER IS WHATEVER THE LOOP THAT CONSUMES THE REGION WOULD CLOSE ON, i.e.
 * a `%` run of this width in the `stripContainerPrefixes` view - see
 * `commentRunLines`. Reading raw lines here instead looked like the smaller
 * change and was not: a quoted fence with a quoted closer, plus any raw run of
 * its width later in the document, passed the index and then found no closer in
 * scope, so a definition the author had commented out went live. The raw-line
 * question survives where it belongs, in the index that answers first.
 *
 * The scan is bounded by the container, so it is linear in that container
 * rather than in the document, and it is reached only for an opener that HAS a
 * container - a document-level opener keeps the O(1) index, where the
 * unbounded question is the correct one anyway.
 */
function commentCloserInScope(
  lexer: Lexer,
  fence: number,
  from: number,
  scope: PrepassScope,
  memo: CommentScopeMemo,
): boolean {
  // THE LINE INDEX ANSWERS BEFORE THE CONTAINER IS WALKED. "No `%` run of this
  // width anywhere ahead" refutes an opener outright, and that is the answer
  // for every unterminated opener - so a document that is a run of them stays
  // linear instead of paying a boundary scan each. This is the hot-path guard
  // the RAW document-wide index used to provide one caller up; it has to live
  // here now, because that index cannot see a `> %%%` and refuted the quoted
  // spelling wrongly (markup-carve/carve#1341).
  const at = commentRunLines(lexer).get(fence)
  if (at === undefined) return false
  // The first line of this width strictly after the opener. `at` is ascending,
  // so a binary search answers it without walking the container - which is what
  // keeps a run of openers inside one item linear rather than quadratic.
  let lo = 0
  let hi = at.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (at[mid]!.line <= from) lo = mid + 1
    else hi = mid
  }
  if (lo >= at.length) return false
  // ONLY A RUN AT THE OPENER'S OWN QUOTE DEPTH CLOSES IT, and the two
  // directions fail for different reasons:
  //
  //   - a SHALLOWER run is the line that ENDED the opener's quote. `> > %%%`
  //     is not closed by a `> %%%`, because the inner quote is over by then;
  //   - a DEEPER run is inside a quote of its own, and the block parser reads
  //     it as one. `> %%%` is not closed by a `> > %%%`: the opener degrades
  //     to a line comment, its body RENDERS, and the definition beside it is
  //     ordinary. Accepting it suppressed a definition the parser publishes,
  //     which is the same two-halves-disagree shape this whole change is
  //     about, one quote deeper (raised by codex review at high effort).
  //
  // A non-matching run is skipped and the next one of this width is asked, so
  // an opener is not refuted by a line that was never its closer. Bounded by
  // the container the same way the boundary is: the walk stops at the first run
  // past `end`, so it reads only runs written inside the opener's own scope.
  const end = commentScopeEnd(lexer, from, scope, memo)
  for (let i = lo; i < at.length && at[i]!.line < end; i++) {
    if (at[i]!.depth === scope.quoteDepth) return true
  }

  return false
}

/**
 * Every line carrying a `%` run, keyed by run length and ascending, WITH THE
 * QUOTE DEPTH THE RUN WAS WRITTEN AT.
 *
 * Read through `stripContainerPrefixes`, which is the view the loop that
 * CONSUMES the region closes on - so the scan and the close agree line for
 * line, and a quoted `> %%%` counts here exactly as it counts there. Built once
 * per lexer, and only for a document that opens a comment fence inside a
 * container at all.
 *
 * THE DEPTH IS CARRIED BECAUSE STRIPPING THROWS AWAY THE ONE THING THAT
 * DISTINGUISHES TWO RUNS OF THE SAME WIDTH. `> > %%%` and `> %%%` both strip to
 * `%%%`, and a fence opened in the inner quote is NOT closed by a run written
 * one level out - the inner quote ends first, so that opener leaves its
 * container unclosed and degrades to a line comment (`markup-carve/carve#1341`).
 * Without the depth the shallower run counted, the region opened across the
 * quote boundary, and a definition the parser renders went missing from the
 * link table. It is the quote-marker spelling of the column bound carve-rs
 * `markup-carve/carve-rs#1052` put on the indented one, measured the same way
 * `commentScopeEnd` measures a departure so the two agree.
 */
function commentRunLines(lexer: Lexer): Map<number, { line: number; depth: number }[]> {
  if (lexer.commentRunLines !== undefined) return lexer.commentRunLines
  const m = new Map<number, { line: number; depth: number }[]>()
  for (let i = 0; i < lexer.lines.length; i++) {
    const raw = lexer.lines[i]!
    const afterTerm = RE_AFTER_TERM.test(stripContainerPrefixes(lexer.lines[i - 1] ?? ''))
    const c = RE_COMMENT_BLOCK_ANY.exec(stripContainerPrefixes(raw, afterTerm))
    if (c === null) continue
    const entry = {
      line: i,
      // THE OPENER AND THE CLOSER ARE MEASURED THE SAME WAY, which is the whole
      // point of naming this once: `- - > %%%` measured its own depth as 0 here
      // while its closer `    > %%%` measured 1, so no run at the opener's depth
      // existed and the region never opened (carve-js#1181).
      depth: containerQuoteDepth(raw),
    }
    const at = m.get(c[1]!.length)
    if (at !== undefined) at.push(entry)
    else m.set(c[1]!.length, [entry])
  }
  lexer.commentRunLines = m

  return m
}

/**
 * The scan a `commentCloserInScope` boundary needs, remembered across the
 * openers that share it.
 *
 * The boundary is a function of the lines and the scope alone, so the first
 * line that ends a given scope is the same one for every opener BEFORE it.
 * Openers are visited in ascending order, so one entry per scope is enough: a
 * run of openers inside one container walks it once between them all instead of
 * once each. Without any memo, 2000 openers in one item cost 316ms against
 * 16ms.
 *
 * ONE ENTRY IN TOTAL WAS NOT ENOUGH. A document alternating openers at an outer
 * scope with openers one item deeper evicted the single entry on every unit, so
 * every outer opener rescanned the rest of the document - 2000 such units took
 * 1295ms against 75ms (raised by codex review). Keyed by scope, each container
 * keeps its own boundary and the alternation costs nothing.
 */
type CommentScopeMemo = Map<string, { from: number; end: number }>

/**
 * The first line after `from` at which the opener's container is over.
 *
 * A DEDENT ALONE DOES NOT END IT, which is where this parts company with
 * `scopeHoldsLine` and has to. The trackers that share that helper ask it of a
 * region the parser has ALREADY opened, where a dedent really does leave the
 * container. This one asks about a region that may not open at all, and a plain
 * dedented line inside a list item or below a quote is a LAZY CONTINUATION -
 * the item keeps it, the comment keeps it, and nothing has left anything:
 *
 * ````
 * - a
 *   %%%
 * x
 *   [r]: /url
 *   %%%
 * ````
 *
 * `x` and the definition are both inside the comment - carve-js renders neither
 * - so a boundary that ended at `x` would decide the fence never closed and put
 * a definition the author commented out into the link table. Three rounds of
 * codex review at high effort found four separate spellings of exactly that,
 * each one a lazy line the block parser keeps: a dedent to column 0, a dedent to
 * an enclosing item's own content column, a `+` continuation marker, and a
 * marker line.
 *
 * SO ONLY ONE SHAPE ENDS IT: a blank line followed by a non-blank line that
 * leaves the quote or falls below the column. That is the shape no lazy
 * continuation can wear - a blank line closes the paragraph a lazy line would
 * have folded into, so what follows it at the outer level is a new block there.
 *
 * AND FOR A QUOTED SCOPE THE BLANK LINE IS THE WHOLE TEST, because a blockquote
 * does not survive one. `> a` / blank / `> b` is TWO blockquotes, so a `> %%%`
 * written after the blank is not a closer that arrived late - it is a run in a
 * DIFFERENT quote, and the fence above it never closed:
 *
 * ````
 * > %%%
 * > [r]: /url
 *
 * > %%%
 * ````
 *
 * Measuring the following line's depth instead, that run read as still in
 * scope, the region opened, and a definition the parser renders went missing
 * from the link table. The depth test is the right one for a COLUMN scope,
 * where a dedented line really can be a lazy continuation of the item; a quote
 * has no such line across a blank.
 *
 * The bound this leaves is deliberately LOOSER than the container really is,
 * and that direction is the safe one: a scope that reaches too far can only
 * make a region OPEN that would otherwise have degraded, which hides a
 * definition the parser also hides. The opposite error publishes one out of an
 * invisible comment. It is why a closer written at column 0 with NO blank line
 * above it still closes an item-scoped fence here, which is the one row of
 * carve-js#1146 this does not move.
 */
function commentScopeEnd(
  lexer: Lexer,
  from: number,
  scope: PrepassScope,
  memo: CommentScopeMemo,
): number {
  const key = `${scope.quoteDepth}|${scope.contentCol}`
  const e = memo.get(key)
  if (e !== undefined && from >= e.from && from < e.end) return e.end
  let end = lexer.lines.length
  for (let i = from + 1; i < lexer.lines.length; i++) {
    const raw = lexer.lines[i]!
    // The blank-line half first: it is two array reads, where the quote and
    // column measurements below are regexes, and it rejects almost every line.
    if (isBlankLine(raw) || !isBlankLine(lexer.lines[i - 1] ?? '')) continue
    // AND A CONTINUATION MARKER IS NOT A DEPARTURE. `+` at column 0 after a
    // blank line attaches the next block to the item rather than ending it
    // (PART 17), so the fence is still inside its container and the closer
    // below the marker is still its own. Taken as the boundary, the region
    // never opened and the definition inside it went live while the comment
    // body above it stayed invisible - the leak, one marker over (raised by
    // codex review).
    if (isContinuationMarker(raw)) continue
    // A QUOTED SCOPE IS OVER AT THE BLANK, whatever stands after it. A
    // blockquote does not survive a blank line, so the next non-blank line
    // opens a NEW one even when it carries the same markers - and a `%%%` run
    // there belongs to that quote, not to the fence above.
    if (scope.quoteDepth > 0) {
      end = i
      break
    }
    const depth = containerQuoteDepth(raw)
    const view = raw.replace(/^(?:>(?: |$))+/, '')
    if (
      depth < scope.quoteDepth ||
      // VISUAL COLUMNS, the way the parser measures reach: a tab is worth up to
      // four. The cap keeps it O(the column) rather than O(the indentation run).
      (scope.contentCol > 0 && indentColumns(view, scope.contentCol) < scope.contentCol)
    ) {
      end = i
      break
    }
  }
  memo.set(key, { from, end })

  return end
}

/**
 * Whether a comment fence of width `fence` closes LATER IN THIS QUOTE.
 *
 * PART 9 section 28: a `%%%` opener with NO MATCHING CLOSER AHEAD does NOT open
 * a block, it degrades to a `comment_line`, so every FOLLOWING BLOCK still
 * renders. `parseCommentBlock` honours that because `commentBlockHasCloser`
 * scans ahead first. The blockquote lazy-state tracker did not, because it runs
 * while the quote's lines are being COLLECTED - so an unterminated fence inside
 * a quote opened a block, took the quote's paragraph with it, and a lazy line
 * that should have folded into that paragraph became a sibling (carve-js#832).
 *
 * THE SCAN IS BOUNDED TO THE QUOTE, and both bounds are load-bearing, because
 * this has to agree with what the sub-lexer will do - and the sub-lexer only
 * ever sees this quote's own lines.
 *
 * ONE marker is stripped, not every one. Stripping the whole run made
 * `> > %%%` - a fence one level DEEPER - count as a closer for a fence opened
 * at this level, where the sub-lexer reads it as a nested block quote. Raised by
 * codex review on the change that introduced it.
 *
 * And the scan STOPS at the first unquoted line rather than running to the end
 * of the document, which made a `%%%` sitting after the quote entirely count as
 * its closer. A non-quoted line cannot be part of the quote here in any case:
 * a lazy continuation is collected only while a paragraph is open, and inside a
 * comment none is.
 */
function quotedCommentHasCloser(lexer: Lexer, fence: number, fromIndex: number): boolean {
  for (let i = fromIndex + 1; i < lexer.lines.length; i++) {
    const quoted = RE_BLOCKQUOTE.exec(lexer.lines[i]!)
    if (!quoted) return false
    const run = RE_COMMENT_BLOCK_ANY.exec(quoted[1] ?? '')
    if (run && run[1]!.length === fence) return true
  }

  return false
}

/**
 * Negative cache for the container-local fence closer scans, keyed by fence
 * CHARACTER.
 *
 * `from` is where the recorded scan started and `maxRun` is the longest BARE
 * run of that character it saw. A later opener scans a SUFFIX of that range, so
 * its own longest run can only be shorter - which makes the entry sound for
 * every opener starting at or after `from` whose marker is LONGER than
 * `maxRun`, since no run ahead can close it.
 *
 * Keying on the character alone was not enough: a single short `` ``` `` after
 * a thousand unterminated `` ````js `` openers set "saw one" on every scan and
 * the bound never advanced, so the lookahead stayed quadratic - 500 openers
 * took 41ms and 4000 took 1104ms. Raised by codex review.
 */
interface FenceCloserMemoEntry {
  from: number
  maxRun: number
}
type QuotedFenceCloserMemo = Map<string, FenceCloserMemoEntry>

/**
 * Whether a code or raw fence opened with `marker` closes LATER IN THIS QUOTE.
 *
 * The §10 CLOSER LOOKAHEAD `startsInterruptingBlock` applies through
 * `fenceHasCloser`, restated over the quote's own lines for the same two
 * reasons `quotedCommentHasCloser` gives: the tracker runs while the quote is
 * still being collected, and it has to agree with a sub-lexer that only ever
 * sees this quote's lines. So the scan strips ONE `>` marker per line and STOPS
 * at the first unquoted line.
 *
 * The closer is matched by `fenceCloseRe`, i.e. a run of the SAME character at
 * least as long — the code fence's rule, not the comment fence's exact-length
 * one.
 *
 * THE NEGATIVE CACHE IS LOAD-BEARING, and it is `fenceHasCloser`'s. This runs
 * per fence-shaped line while a quoted paragraph is open, so a quote of N
 * unterminated openers was scanned N times without it: 500 lines took 27ms and
 * 4000 took 397ms, a 3.8x for a 2x input. Every line matching some marker's
 * `closeRe` also matches the bare `RE_FENCE_CLOSER`, so seeing none in the
 * quoted prefix proves no marker of that character closes from here on - and
 * the bound only moves forward, since a later opener scans a suffix of what
 * this one did.
 *
 * The bound is per fence CHARACTER, which is where this differs from
 * `fenceHasCloser`: a single `~~~` closer would otherwise keep the cache from
 * ever advancing for a quote full of unterminated backtick openers. Raised by
 * codex review on this function; the same shape is quadratic through
 * `fenceHasCloser` today, byte-for-byte as it is on main, and that is left
 * alone here rather than folded into a parser fix.
 */
/**
 * Whether a code or raw fence opened inside a LIST ITEM closes later in that
 * item's content stream (PART 9 §10's CLOSER LOOKAHEAD, markup-carve/carve#950).
 *
 * The item's stream is the lines at or past its CONTENT COLUMN, dedented - the
 * same view `parseListItem` collects - so the scan re-bases each candidate the
 * way the collector would before testing it.
 *
 * IT DOES NOT STOP AT A BELOW-COLUMN LINE, and that is deliberate rather than
 * sloppy. Corpus 276-7 puts the closer AFTER such a line, and the answer it
 * pins is that the fence was OPEN when the below-column line arrived: the
 * collector's guard is on the open fence, and only after the item is truncated
 * does §10 I4 decide what the leftover fence means. Stopping the scan there
 * would report the fence unterminated and fold the very line that ends the
 * item.
 *
 * A blank line is skipped for the same reason it is inside any fence: a blank
 * is body, not a terminator.
 *
 * THE NEGATIVE CACHE IS LOAD-BEARING, and it is `fenceHasCloser`'s, keyed per
 * fence CHARACTER as `quotedFenceHasCloser` keys it. This runs per fence-shaped
 * line while the item's paragraph is open, so an item of N unterminated openers
 * was scanned N times: 500 lines took 26ms and 4000 took 449ms, a 3.7x for a 2x
 * input. Every line matching some marker's `closeRe` also matches the bare
 * `RE_FENCE_CLOSER`, so finding none of that character from here on proves no
 * marker of it closes, and the bound only moves forward because a later opener
 * scans a suffix.
 */
function itemFenceHasCloser(
  lexer: Lexer,
  marker: string,
  fromIndex: number,
  contentCol: number,
  memo: QuotedFenceCloserMemo,
): boolean {
  const char = marker[0]!
  const start = fromIndex + 1
  if (fenceCloserMemoRefutes(memo, char, marker.length, start)) return false
  const closeRe = fenceCloseRe(marker)
  let maxRun = 0
  for (let i = start; i < lexer.lines.length; i++) {
    const line = lexer.lines[i]!
    if (isBlankLine(line)) continue
    if (indentColumns(line, contentCol) < contentCol) continue
    const dedented = sliceColumns(line, contentCol, true)
    if (closeRe.test(dedented)) return true
    const closer = RE_FENCE_CLOSER.exec(dedented)
    if (closer && closer[1]![0] === char) maxRun = Math.max(maxRun, closer[1]!.length)
  }
  memo.set(char, { from: start, maxRun })

  return false
}

/** Whether the memo already proves no closer for `len` of `char` from `start`. */
function fenceCloserMemoRefutes(
  memo: QuotedFenceCloserMemo,
  char: string,
  len: number,
  start: number,
): boolean {
  const cached = memo.get(char)

  return cached !== undefined && start >= cached.from && len > cached.maxRun
}

function quotedFenceHasCloser(
  lexer: Lexer,
  marker: string,
  fromIndex: number,
  memo: QuotedFenceCloserMemo,
): boolean {
  const char = marker[0]!
  const start = fromIndex + 1
  if (fenceCloserMemoRefutes(memo, char, marker.length, start)) return false
  const closeRe = fenceCloseRe(marker)
  let maxRun = 0
  for (let i = start; i < lexer.lines.length; i++) {
    const quoted = RE_BLOCKQUOTE.exec(lexer.lines[i]!)
    if (!quoted) break
    const content = quoted[1] ?? ''
    if (closeRe.test(content)) return true
    const closer = RE_FENCE_CLOSER.exec(content)
    if (closer && closer[1]![0] === char) maxRun = Math.max(maxRun, closer[1]!.length)
  }
  memo.set(char, { from: start, maxRun })

  return false
}

// Block comment: a `%%%`+ opener, closed by a line whose delimiter run has the
// SAME length (more `%` nest). Not rendered.
function parseCommentBlock(lexer: Lexer): Comment {
  // A comment fence delimiter is STRUCTURAL, not content: only the leading run
  // of `%` is matched, so neither trailing text (`%%% TODO`) nor a stray
  // non-breaking space can desync the closer and swallow the rest of the
  // document. The opener's trailing text is kept as the body's first line so
  // `carve fmt` round-trips the words instead of deleting them; a closer's
  // trailing text is discarded, like a code fence's closing info.
  const openerLine = lexer.consume()
  const m = RE_COMMENT_BLOCK_ANY.exec(openerLine)!
  const fence = m[1]!.length
  // The body is indented RELATIVE to its fence, the way a code fence's body is:
  // an opener at column 1 makes a body line at column 1 flush, not
  // one-indented. Keeping the absolute text left `- a` / ` %%% n` / ` x`
  // holding `n\n x` here and `n\nx` in carve-rs and carve-php - a cross-engine
  // AST difference that surfaced as `carve fmt` writing the body one column
  // further in on every reformat (carve#653).
  const openerIndent = /^[ \t]*/.exec(openerLine)![0].length
  const dedent = (line: string): string => {
    let cut = 0
    while (cut < openerIndent && (line[cut] === ' ' || line[cut] === '\t')) cut++
    return line.slice(cut)
  }
  const lines: string[] = []
  // PART 7's four characters: a tail of one vertical tab is a NON-EMPTY tail.
  const openerTail = trimNonNbsp(m[2]!)
  if (openerTail !== '') lines.push(openerTail)
  while (!lexer.eof()) {
    const ln = lexer.peek()!
    const c = RE_COMMENT_BLOCK_ANY.exec(ln)
    if (c && c[1]!.length === fence) {
      lexer.consume()
      break
    }
    lexer.consume()
    lines.push(dedent(ln))
  }
  return { type: 'comment', block: true, content: lines.join('\n') }
}

// Footnote definition. The def line's trailing text plus following lines
// indented by >= 2 spaces (single blank lines allowed between chunks)
// form the note body, parsed as blocks. First definition for a label
// wins. Emits no block — the body is stashed on lexer.footnoteDefs and
// rendered in the endnotes section.
function parseFootnoteDef(lexer: Lexer): null {
  const defLineIndex = lexer.pos
  const m = RE_FOOTNOTE_DEF.exec(lexer.consume())!
  // Preserve the raw label as the AST/source-layout spelling. Resolution and
  // duplicate handling derive their shared ASCII-whitespace key separately.
  const label = m[1]!
  const bodyLines = [m[2]!]
  const bodyLineNumbers = [lexer.lineNumber(defLineIndex)]
  let pendingBlanks = 0
  let pendingBlankLineNumbers: number[] = []
  while (!lexer.eof()) {
    const ln = lexer.peek()!
    if (isBlankLine(ln)) {
      pendingBlanks++
      pendingBlankLineNumbers.push(lexer.lineNumber(lexer.pos))
      lexer.consume()
      continue
    }
    // Form B: a lone `+` attaches the FOLLOWING flush-left block to the note
    // with no indentation (the same continuation marker lists and block quotes
    // use); the attached block ends at a blank line, another `+`, or the next
    // footnote definition - unless a fence this block opened is still open, in
    // which case all three are body text (corpus category 279).
    if (/^\+[ \t]*$/.test(ln)) {
      const plusLineNumber = lexer.lineNumber(lexer.pos)
      lexer.consume()
      pendingBlanks = 0
      pendingBlankLineNumbers = []
      const { lines: attached, lineNumbers: attachedLineNumbers } = collectAttachedBlock(
        lexer,
        (a) => isBlankLine(a) || /^\+[ \t]*$/.test(a) || RE_FOOTNOTE_DEF.test(a),
      )
      if (attached.length > 0) {
        bodyLines.push('')
        bodyLineNumbers.push(plusLineNumber)
        for (const a of attached) bodyLines.push(a)
        bodyLineNumbers.push(...attachedLineNumbers)
      }
      continue
    }
    // §16 asks for COLUMNS, not characters, and §24 C1 gives a tab a column
    // value - so a bare tab reaches column 4 and continues the note exactly as
    // two spaces do. Matching characters here accepted `<SPACE><TAB>` and
    // refused a bare tab, while carve-php refused the mixture and took the bare
    // tab: three engines, three readings (carve#796, carve-js#725). A rejected
    // continuation does not indent differently, it LEAVES the note and lands in
    // the document body, so the split moved content between blocks.
    if (indentColumns(ln, FOOTNOTE_BODY_COLUMN) >= FOOTNOTE_BODY_COLUMN) {
      // Dedent by the body's own column, which is TWO - the indent §16 requires
      // of a continuation line - not by whatever the first continuation line
      // happens to carry. Anything beyond two is residual indent the body's
      // blocks read themselves, so an opener one column in is lazy text rather
      // than a block, the same way it is inside a list item (carve-js#677).
      //
      // KEEP THE RESIDUAL COLUMNS of a tab that straddles the two-column
      // boundary (carve-js#1515). §24 C1 gives a tab a column value, and the
      // whole column model is visual, so a bare tab and the four spaces it
      // expands to are the same document. Consuming the tab whole handed the
      // body's blocks a line at column 0 while its four-space spelling arrived
      // at column 2, and the two extra columns are exactly what §24 C3 turns
      // into the body's authored base - so only the spaces got the base. The
      // definition body's own strip has kept its residual since carve#1729;
      // this is that strip's other half.
      for (let k = 0; k < pendingBlanks; k++) {
        bodyLines.push('')
        bodyLineNumbers.push(pendingBlankLineNumbers[k]!)
      }
      pendingBlanks = 0
      pendingBlankLineNumbers = []
      bodyLines.push(sliceColumns(ln, FOOTNOTE_BODY_COLUMN, true))
      bodyLineNumbers.push(lexer.lineNumber(lexer.pos))
      lexer.consume()
    } else {
      break
    }
  }
  if (!lexer.footnoteDefs.has(label)) {
    // A recognized opener at or beyond the note's minimum column establishes
    // its authored column as a local base (carve#1729). The collector has
    // already removed the fixed two-column body margin.
    rebaseOverindentedBlocks(bodyLines, undefined, -1, true, true)
    const sub = nestedSubLexer(lexer, bodyLines, defLineIndex, bodyLineNumbers)
    lexer.footnoteDefs.set(label, parseBlocks(sub, 0))
    // The definition runs from its `[^label]:` marker to the last line it
    // consumed. The body blocks cannot supply that: the marker is not part of
    // any of them, so a span derived from the body would start inside the
    // definition (carve-js#480).
    //
    // Only when this lexer can express a document offset - inside an unmapped
    // container the numbers mean something else, and §4 forbids inventing one.
    if (lexer.hasDocumentOffsets) {
      // THE BLANK RUN THAT ENDS THE DEFINITION IS NOT PART OF IT. PART 12 §4
      // excludes "a following newline, blank line, or unattached attribute
      // block" from a span by name, and the loop above consumes a blank line
      // BEFORE it can know whether the line after it continues the body - so
      // when it does not, `lexer.pos - 1` sits on a line the definition never
      // took. The span then ran one codepoint past the note's last block, over
      // the terminator of its own last line (markup-carve/carve-js#1347): the
      // same defect a list's span carried over the blank run that ended it
      // (markup-carve/carve-js#1304), one container over.
      //
      // Walk back to the last line the body actually holds. The definition
      // line is always one of them, so this never runs past the start, and a
      // blank line INSIDE the body is followed by the content that kept it.
      let lastIndex = Math.max(defLineIndex, lexer.pos - 1)
      while (lastIndex > defLineIndex && isBlankLine(lexer.lines[lastIndex] ?? '')) lastIndex--
      const lastLine = lexer.lines[lastIndex] ?? ''
      const pos: Position = {
        startLine: lexer.lineNumber(defLineIndex),
        endLine: lexer.lineNumber(lastIndex),
        startColumn: lexer.lineStartColumn(defLineIndex),
        endColumn: lexer.lineStartColumn(lastIndex) + lastLine.length,
        startOffset: lexer.lineOffset(defLineIndex),
        endOffset: lexer.lineOffset(lastIndex) + lastLine.length,
      }
      // AND IT ENDS AT ITS LAST PLACED CHILD, which the line arithmetic above
      // cannot see (PART 12 §4, markup-carve/carve-js#1364).
      //
      // A definition written on a continuation line is COLLECTED and hoisted to
      // the document by §7, so it becomes the note's SIBLING - but the note went
      // on covering the line it was written on, and offsets 11..20 of a
      // four-line document were claimed by two document-level nodes at once.
      // The blank walk-back above cannot reach it: the line is not blank, it
      // simply produced no child of this note.
      //
      // NOT A NEW RULE, AND NOT A RULING QUESTION. `attachBlockPos` already
      // applies exactly this to a `block_quote`, so `> note` / `> [r]: /u`
      // publishes a quote spanning `> note` and a definition entirely outside
      // it - the same arrangement, answered. This construct records its extent
      // here instead of going through that function, which is the whole reason
      // it was left out: the marker `[^label]:` is part of no child, so the
      // START cannot come from the body, and the END was taken from the same
      // line arithmetic rather than from the children.
      //
      // markup-carve/carve#1571's exemption is untouched and still needed. It
      // covers a definition claiming source inside the container it was
      // authored in, which is what a note whose body CONTINUES past the
      // definition still does - the interior overlap is exempt, and only the
      // trailing reach is the defect.
      //
      // EMPTIED, THERE IS NO CHILD TO END AT, and the extent above stands. That
      // is carve#1522's arrangement rather than this one, and moving it here
      // would answer a question this does not ask.
      const lastOwned = [...(lexer.footnoteDefs.get(label) ?? [])]
        .reverse()
        .find((child) => child.pos !== undefined)?.pos
      if (lastOwned !== undefined) {
        pos.endLine = lastOwned.endLine
        if (lastOwned.endColumn !== undefined) pos.endColumn = lastOwned.endColumn
        if (lastOwned.endOffset !== undefined) pos.endOffset = lastOwned.endOffset
      }
      lexer.footnoteDefPos.set(label, pos)
    }
  }
  return null
}

function parseAdmonition(lexer: Lexer): Admonition | FigureGroup {
  const openLineIndex = lexer.pos
  const open = lexer.consume()
  const m = RE_ADMONITION_OPEN.exec(open)!
  const fence = m[1]!.length
  const kind = m[2]!
  // PART 9 §4c: a BARE `::: figure` opener - kind only, no quoted title, no
  // `[label]` - is a composite figure group, not an admonition. An opener
  // carrying either piece of metadata does not match the figure production and
  // stays a generic container (the group node has no title/label fields by
  // design). A bare opener inside an OPEN group's body is demoted the same way:
  // groups do not nest, which is what `inFigureGroup` carries through the
  // recursion.
  const isFigureGroup =
    kind === 'figure' && m[3] === undefined && m[4] === undefined && !lexer.inFigureGroup
  // The opener carries an optional quoted title only (grammar
  // quoted_title; PART 9 §12). The quotes delimit the title and are
  // stripped (not part of the rendered text); an explicitly empty `""`
  // still counts as a supplied (empty) title. No inline attributes -- the
  // opener regex already rejected any trailing `{...}`.
  const titleText = m[3] !== undefined ? m[3]!.slice(1, -1) : undefined
  // Optional inert grouping `[label]` (PART 9 §12): a group extension (tabs)
  // uses it as the tab name; core does not render it.
  const label = m[4] !== undefined ? m[4]!.slice(1, -1) : undefined
  const inner = collectColonFenceBody(lexer, {
    kind: 'admonition',
    lineIndex: openLineIndex,
    fenceWidth: fence,
  })
  const subLexer = nestedSubLexer(lexer, inner.map((line) => line.text), openLineIndex + 1)
  if (isFigureGroup) subLexer.inFigureGroup = true
  const children = parseBlocks(subLexer, 0)
  if (isFigureGroup) {
    const group: FigureGroup = { type: 'figure_group', children }
    // The group's CLOSING fence is §4's sixth caption host: a `^ …` line
    // directly after it (or across at most one blank line) attaches as the
    // GROUP caption - the same slot idiom the five parse-time hosts use.
    // A group auto-closed at EOF has no closer line to host the slot, and in
    // that case the lexer is already exhausted, so the lookahead finds nothing.
    let lookahead = 0
    while (!lexer.eof() && isBlankLine(lexer.peek(lookahead))) lookahead++
    const next = lexer.peek(lookahead)
    if (next) {
      const cap = RE_CAPTION.exec(next)
      // §4: a caption attaches only when it immediately follows the block
      // or is separated by at most ONE blank line.
      if (cap && lookahead <= 1) {
        for (let i = 0; i <= lookahead; i++) lexer.consume()
        group.caption = parseCaptionInline(lexer, cap[1]!)
      }
    }
    // A preceding block-attribute line is the only way to attribute the group
    // (same as the admonition below); parseBlocks applies it to the returned
    // node.
    return group
  }
  const node: Admonition = { type: 'admonition', kind, children }
  // `!== undefined` (not truthiness): an explicitly empty quoted title
  // `""` still emits a (empty) <p class="admonition-title"> per §12.
  if (titleText !== undefined) {
    // The title sits inside quotes on the opener line. Without an anchor the
    // scanner measured from offset 0, so the text "Pro Tip" reported the span of
    // `::: tip` - an invented value (PART 12 section 4). The +1 steps past the
    // opening quote, which m[3] includes.
    const titleStart = open.indexOf(m[3]!) + 1
    node.title = parseInline(titleText, lexer.abbrDefs, lexer.linkDefs, {
      anchored: lexer.hasDocumentOffsets && titleStart > 0,
      baseOffset: lexer.lineOffset(openLineIndex) + titleStart,
      startLine: lexer.lineNumber(openLineIndex),
      startColumn: lexer.lineStartColumn(openLineIndex) + titleStart,
    })
  }
  if (label !== undefined) {
    node.label = label
  }
  // No inline opener attributes (strict djot): a preceding block-attribute
  // line is the only way to attribute an admonition, and parseBlocks
  // applies it to the returned node.
  return node
}

/**
 * Drop `pos` from a subtree whose positions cannot be mapped to the document.
 *
 * PART 12 section 4: an implementation that cannot produce a position "MUST NOT
 * emit `pos` with invented values, and MUST NOT omit it silently". Omitting is
 * the conformant half; the omission is recorded in carve-js#441.
 *
 * Both callers re-parse RECONSTRUCTED text - a line block expands each line's
 * leading whitespace, and a table cell is scanned out of a row and re-joined -
 * so the inline scanner measures against a string that does not appear verbatim
 * in the source. The offsets it produced were not merely imprecise: a table
 * cell reported the document's first three characters for every cell.
 */
function stripPositions(nodes: InlineNode[]): InlineNode[] {
  const walk = (value: unknown): void => {
    if (!value || typeof value !== 'object') return
    if (Array.isArray(value)) {
      for (const item of value) walk(item)
      return
    }
    const record = value as Record<string, unknown>
    delete record['pos']
    for (const key of Object.keys(record)) walk(record[key])
  }
  walk(nodes)
  return nodes
}

interface ColonFenceBodyLine {
  text: string
  lineIndex: number
}

interface ColonFenceOpener {
  kind: UnclosedContainer['kind']
  lineIndex: number
  fenceWidth: number
}

function unclosedContainerFromOpener(lexer: Lexer, opener: ColonFenceOpener): UnclosedContainer {
  const startOffset = lexer.lineOffset(opener.lineIndex)
  return {
    kind: opener.kind,
    line: lexer.lineNumber(opener.lineIndex),
    column: lexer.lineStartColumn(opener.lineIndex),
    startOffset,
    endOffset: startOffset + opener.fenceWidth,
    fenceWidth: opener.fenceWidth,
  }
}

function colonFenceOpenerLen(line: string): number | null {
  const m =
    RE_DIV_OPEN.exec(line) ??
    (RE_ADMONITION_CLOSE.test(line) ? null : RE_ADMONITION_OPEN.exec(line)) ??
    RE_LINE_BLOCK_OPEN.exec(line) ??
    RE_HARDBREAKS_OPEN.exec(line) ??
    RE_QUOTE_BLOCK_OPEN.exec(line)
  return m ? m[1]!.length : null
}

function colonFenceKind(line: string): UnclosedContainer['kind'] {
  if (RE_LINE_BLOCK_OPEN.test(line)) return 'line block'
  if (RE_HARDBREAKS_OPEN.test(line)) return 'hard-break block'
  if (RE_QUOTE_BLOCK_OPEN.test(line)) return 'block quote'
  if (RE_ADMONITION_OPEN.test(line)) return 'admonition'
  return 'div'
}

function consumeOpaqueColonFenceBodySpan(
  lexer: Lexer,
  lines: ColonFenceBodyLine[],
  lineIndex: number,
  text: string,
): boolean {
  const rawOpen = RE_RAW_FENCE.exec(text)
  const codeOpen = rawOpen === null ? RE_FENCE.exec(text) : null
  const marker = rawOpen?.[1] ?? codeOpen?.[2]
  if (marker !== undefined) {
    // A closer is required whether or not a paragraph is open. Only a fence
    // that closes is opaque; an unterminated one would otherwise consume the
    // container's own `:::` as content and run to the end of the document,
    // dragging every following block inside (carve#515).
    //
    // The comment-fence branch below has always required its closer. This one
    // asked only when a paragraph was open, so the rule held for a fence that
    // interrupted prose and lapsed for one that opened a body - which is why
    // the `paragraphOpen` argument is gone.
    if (!startsInterruptingBlock(lexer)) return false
    const closeRe = fenceCloseRe(marker)
    const isCodeFence = codeOpen !== null
    lexer.consume()
    lines.push({ text, lineIndex })
    while (!lexer.eof()) {
      const innerLineIndex = lexer.pos
      const innerText = lexer.peek()!
      lexer.consume()
      lines.push({ text: innerText, lineIndex: innerLineIndex })
      if (closeRe.test(innerText) && (!isCodeFence || leadingWhitespace(innerText) <= 3)) break
    }
    return true
  }

  const commentOpen = RE_COMMENT_BLOCK.exec(text)
  if (commentOpen !== null && commentBlockHasCloser(lexer, commentOpen[1]!.length)) {
    const fence = commentOpen[1]!.length
    lexer.consume()
    lines.push({ text, lineIndex })
    while (!lexer.eof()) {
      const innerLineIndex = lexer.pos
      const innerText = lexer.peek()!
      const commentClose = RE_COMMENT_BLOCK.exec(innerText)
      lexer.consume()
      lines.push({ text: innerText, lineIndex: innerLineIndex })
      if (commentClose !== null && commentClose[1]!.length === fence) break
    }
    return true
  }

  return false
}

function collectColonFenceBody(lexer: Lexer, opener: ColonFenceOpener): ColonFenceBodyLine[] {
  const lines: ColonFenceBodyLine[] = []
  const stack: ColonFenceOpener[] = [opener]
  let paragraphOpen: boolean = false

  while (!lexer.eof()) {
    const lineIndex = lexer.pos
    const text = lexer.peek()!
    const interruptsParagraph: boolean = paragraphOpen && startsInterruptingBlock(lexer)
    if (consumeOpaqueColonFenceBodySpan(lexer, lines, lineIndex, text)) {
      paragraphOpen = false
      continue
    }
    const close = RE_ADMONITION_CLOSE.exec(text)

    if (close && close[1]!.length === stack[stack.length - 1]?.fenceWidth) {
      lexer.consume()
      stack.pop()
      if (stack.length === 0) break
      lines.push({ text, lineIndex })
      paragraphOpen = false
      continue
    }

    lexer.consume()
    lines.push({ text, lineIndex })
    const openerLen = colonFenceOpenerLen(text)
    if (openerLen !== null) {
      stack.push({
        kind: colonFenceKind(text),
        lineIndex,
        fenceWidth: openerLen,
      })
      paragraphOpen = false
      continue
    }
    paragraphOpen = !isBlankLine(text) && !interruptsParagraph && (paragraphOpen || !lineOpensBlock(text))
  }

  for (const unclosed of stack) {
    lexer.reportUnclosedContainer(unclosedContainerFromOpener(lexer, unclosed))
  }
  return lines
}

function collectLiteralColonFenceBody(lexer: Lexer, opener: ColonFenceOpener): ColonFenceBodyLine[] {
  const lines: ColonFenceBodyLine[] = []
  let closed = false

  while (!lexer.eof()) {
    const lineIndex = lexer.pos
    const text = lexer.peek()!
    const close = RE_ADMONITION_CLOSE.exec(text)
    lexer.consume()
    if (close && close[1]!.length === opener.fenceWidth) {
      closed = true
      break
    }
    lines.push({ text, lineIndex })
  }

  if (!closed) {
    lexer.reportUnclosedContainer(unclosedContainerFromOpener(lexer, opener))
  }
  return lines
}

function parseLineBlock(lexer: Lexer): LineBlock {
  const openLineIndex = lexer.pos
  const open = lexer.consume()
  const m = RE_LINE_BLOCK_OPEN.exec(open)!
  const fence = m[1]!.length
  interface StanzaLine {
    text: string
    lineIndex: number
    /**
     * The expansion kept every character AT ITS OWN OFFSET, so document offsets
     * still line up.
     *
     * Each preserved space becomes exactly one U+E000 sentinel, so a line with
     * an indent or a medial gap is not a verbatim slice but every character
     * still sits at its own offset - the whitespace is consumed as layout and
     * never reaches a text node's value. A TAB expands to up to four sentinels,
     * which shifts everything after it, so those stay unanchored.
     *
     * Measured BEFORE the trailing-whitespace drop, which is why it is not
     * simply a length comparison against the source line. Dropping a run at the
     * END of a line moves nothing: every character that remains is still at the
     * offset it came from, and the newline after it is placed from line
     * geometry rather than from this text. Comparing the trimmed length instead
     * unanchored the WHOLE stanza over one trailing space on one line - so
     * `abc` on the line above came back unplaced too, even though it is a
     * verbatim slice of the source and nothing about it had changed
     * (corpus 268-trailing-whitespace-on-a-content-line-is-dropped-12).
     */
    aligned: boolean
    /**
     * The comment this line WAS, for a line the block layer emptied.
     *
     * Kept because §23 removes the line from the RENDER and not from the tree:
     * it stays a `comment` node like any other, so the canonical writer can put
     * the author's line back at the column they wrote it at.
     */
    comment?: Comment
  }
  const stanzas: StanzaLine[][] = []
  let stanza: StanzaLine[] = []
  for (const { text: ln, lineIndex } of collectLiteralColonFenceBody(lexer, {
    kind: 'line block',
    lineIndex: openLineIndex,
    fenceWidth: fence,
  })) {
    if (isBlankLine(ln)) {
      if (stanza.length) {
        stanzas.push(stanza)
        stanza = []
      }
      continue
    }
    // A COMMENT-ONLY BODY LINE IS REMOVED HERE, AT THE BLOCK LAYER (PART 9
    // §23, NORMATIVE). `comment_line` is a block - PART 1 lists it among the
    // invisible blocks and §10 I5 rules on it - so the line is decided with
    // the other block-layer decisions, BEFORE any inline content exists.
    //
    // Doing it in the inline pass instead, which is where this engine did it,
    // let an unclosed verbatim run opened on an EARLIER line claim the line
    // under §21's verbatim exclusion and PUBLISH the comment's own text - the
    // one outcome a comment may never have, on a document whose only defect is
    // a stray backtick somewhere above (markup-carve/carve#1333). No inline run
    // can reach a decision taken before it exists.
    //
    // It leaves an EMPTY VERSE LINE rather than dropping the row: the stanza
    // split above has already run, so emptying the line keeps the stanza's
    // shape, which is the layout a line block exists to preserve. The empty
    // line then carries a NEWLINE into an open run like every other break that
    // run swallows (carve#1282).
    //
    // ONLY A LINE WHOSE FIRST CHARACTER IS `%` QUALIFIES. In verse the leading
    // run is CONTENT, so `comment_line`'s optional `[whitespace]` prefix has
    // nothing to consume and an indented `%%` line is ordinary verse text.
    // `%%%` is included: §28 degrades a fence opener with no closer to a
    // comment line, and §23 makes a fence opener ordinary text here anyway.
    //
    // A TRAILING `%%` after content is a DIFFERENT construct - `inline_comment`
    // (PART 3, §21) - and this does not reach it. Inside a verbatim run there
    // is no comment there at all, only two percent characters in content, and
    // an engine may never delete author bytes out of one.
    if (ln.startsWith('%%')) {
      const comment: Comment = {
        type: 'comment',
        block: false,
        content: ln.slice(2).replace(/^[ \t]/, ''),
      }
      if (lexer.hasDocumentOffsets) {
        comment.pos = {
          startLine: lexer.lineNumber(lineIndex),
          endLine: lexer.lineNumber(lineIndex),
          startColumn: lexer.lineStartColumn(lineIndex),
          endColumn: lexer.lineStartColumn(lineIndex) + ln.length,
          startOffset: lexer.lineOffset(lineIndex),
          endOffset: lexer.lineOffset(lineIndex) + ln.length,
        }
      }
      stanza.push({ text: '', lineIndex, aligned: true, comment })
      continue
    }
    const expanded = expandLineBlockWhitespace(ln)
    stanza.push({
      text: dropTrailingSpaces(expanded),
      lineIndex,
      aligned: expanded.length === ln.length,
    })
  }
  if (stanza.length) stanzas.push(stanza)

  const children = stanzas.map<Paragraph>((lines) => {
    // A line's leading whitespace is rewritten to the U+E000 indent sentinel.
    // That is not a verbatim slice, but it is still ALIGNED: one sentinel per
    // space, so every character keeps its own offset and the indent is consumed
    // as indentation rather than reaching a text node's value. Requiring
    // verbatim lines instead left a whole stanza unplaced because one line was
    // indented (#462).
    //
    // A TAB is the exception - it expands to up to four sentinels and shifts
    // everything after it - so a stanza containing one stays unanchored, which
    // is what PART 12 §4 asks for when a position cannot be produced.
    const anchorable = lexer.hasDocumentOffsets && lines.every((l) => l.aligned)

    // THE STANZA IS PARSED AS ONE INLINE RUN (carve-js#1116, ruled on
    // markup-carve/carve#1282). `edge-cases.md:2205` is normative that an
    // unclosed inline verbatim run "renders as a `<code>` span to the end of the
    // block", and a line block is a block like any other. This parsed each LINE
    // on its own and stitched the results with a hard break, so a run could not
    // physically reach past the newline: the engine closed it at the `<br>` and
    // the rest of the stanza came out as prose. The same shape in an ordinary
    // paragraph, which is the control, always carried the run across.
    //
    // The line break is therefore the inline parser's SOFT BREAK, rewritten to a
    // hard break afterwards - exactly what `parseHardBreaksBlock` does for
    // `::: hardbreaks`, its sibling container, which is why that one already
    // agreed with carve-rs on this shape. A newline swallowed by an open run
    // emits no soft break at all and so produces no `<br>`, which is the whole
    // point: the run keeps a LITERAL NEWLINE and the break is gone.
    //
    // Positions are unchanged. Each surviving break is re-posed from LINE
    // GEOMETRY, as before, rather than from the joined text - a line block's
    // text may hold expanded tabs, whose display width is not a source byte
    // length. `lineAnchors` gives every line its own origin so the inline nodes
    // in a continuation line are measured from where that line actually starts,
    // and the break's own `startLine` is what names which boundary it is once
    // some boundaries no longer produce one.
    // Keep the boundary before a terminal emptied comment visible to an open
    // verbatim run. Inline parsing normally trims trailing whitespace from an
    // unclosed run; a private non-whitespace guard lets it retain this newline,
    // then is removed from the one leaf that claimed it immediately below.
    const terminalCommentGuard = lines.at(-1)?.comment ? '\uE001' : ''
    const joined = lines.map((line) => line.text).join('\n') + terminalCommentGuard
    const firstLineNumber = lexer.lineNumber(lines[0]!.lineIndex)
    // The break BETWEEN line `index` and the one after it, from line geometry.
    // Unchanged from when each break was built during the per-line walk, down to
    // the clamp: keep the usual start after the parsed text, so a dropped
    // trailing source space remains part of the break span, but do not let an
    // expanded tab put `startOffset` past the following line's offset.
    const breakPos = (index: number): Position | undefined => {
      if (!lexer.hasDocumentOffsets) return undefined
      const line = lines[index]!
      const next = lines[index + 1]
      if (!next) return undefined
      const lineOffset = lexer.lineOffset(line.lineIndex)
      const sourceLineEnd = lineOffset + (lexer.lines[line.lineIndex]?.length ?? 0)
      return {
        startLine: lexer.lineNumber(line.lineIndex),
        endLine: lexer.lineNumber(next.lineIndex),
        startColumn:
          lexer.lineStartColumn(line.lineIndex) + (lexer.lines[line.lineIndex]?.length ?? 0),
        endColumn: lexer.lineStartColumn(next.lineIndex),
        // A COMMENT LINE IS MEASURED FROM ITS SOURCE, not from the empty text
        // the block layer left behind. The clamp above reads the parsed text's
        // length, which is zero here, so the break would start at the line's
        // FIRST column while its `startColumn` is derived from the source line
        // and reports the last - one span with two answers, overlapping the
        // `comment` node that occupies those same bytes.
        startOffset: line.comment
          ? sourceLineEnd
          : Math.min(lineOffset + line.text.length, sourceLineEnd),
        endOffset: lexer.lineOffset(next.lineIndex),
      }
    }
    // ANCHORS EVEN WHEN THE STANZA IS NOT ANCHORABLE, then stripped below. A
    // stanza holding a tab places none of its inlines (PART 12 §4), but its
    // breaks were always placed from line geometry and still are - and the only
    // way to know WHICH boundary a surviving break sits on is the line the
    // inline parser put it on.
    const parsed = parseInline(
      joined,
      lexer.abbrDefs,
      lexer.linkDefs,
      lexer.hasDocumentOffsets
        ? inlineSource({
            baseOffset: lexer.lineOffset(lines[0]!.lineIndex),
            startLine: firstLineNumber,
            startColumn: lexer.lineStartColumn(lines[0]!.lineIndex),
            lineAnchors: lines.map((line) => ({
              offset: lexer.lineOffset(line.lineIndex),
              column: lexer.lineStartColumn(line.lineIndex),
              line: lexer.lineNumber(line.lineIndex),
            })),
          })
        : inlineSource({ anchored: false }),
    )
    if (terminalCommentGuard) {
      const removeGuard = (nodes: InlineNode[]): boolean => {
        for (let index = 0; index < nodes.length; index++) {
          const node = nodes[index]!
          const record = node as unknown as Record<string, unknown>
          for (const key of ['value', 'content'] as const) {
            const value = record[key]
            if (typeof value === 'string' && value.endsWith(terminalCommentGuard)) {
              record[key] = value.slice(0, -terminalCommentGuard.length)
              // The guard may be the entire final text leaf when no verbatim
              // run claims it. Leaving that synthesized empty node behind also
              // leaves its source span over the comment bytes, overlapping the
              // real comment node reinserted below.
              if (node.type === 'text' && record.value === '') nodes.splice(index, 1)
              return true
            }
          }
          for (const key of ['children', 'inline', 'content'] as const) {
            const value = record[key]
            if (Array.isArray(value) && removeGuard(value as InlineNode[])) return true
          }
        }
        return false
      }
      removeGuard(parsed)
      // AND THE GUARD IS NOT SOURCE, so no span may end past where it sits. It
      // is one synthesized codepoint standing in for the boundary an emptied
      // comment line still ends at, and the scanner measures it like any other
      // character: a verbatim run that swallowed it reported an end one
      // codepoint INTO the `%%` the block layer removed, so the construct owned
      // half a comment marker - and half of one either way.
      //
      // PART 12 §4 ends a span "immediately after the last source codepoint the
      // construct owns". The last one this run owns is the line terminator the
      // guard stands for, and §4's break sentence names that position as column
      // 1 of the FOLLOWING line - which is exactly where the guard sits, at the
      // emptied line's own start (markup-carve/carve-js#1305).
      if (lexer.hasDocumentOffsets) {
        const guardLine = lines[lines.length - 1]!
        const guardOffset = lexer.lineOffset(guardLine.lineIndex)
        const guardColumn = lexer.lineStartColumn(guardLine.lineIndex)
        const guardLineNumber = lexer.lineNumber(guardLine.lineIndex)
        // AT EVERY DEPTH: the run that swallows the boundary may be nested
        // inside emphasis that opened on an earlier body line, and then the
        // container ends there too.
        const clampToGuard = (nodes: InlineNode[]): void => {
          for (const node of nodes) {
            const pos = node.pos
            if (pos && pos.endOffset !== undefined && pos.endOffset > guardOffset) {
              pos.endOffset = guardOffset
              pos.endColumn = guardColumn
              pos.endLine = guardLineNumber
            }
            const record = node as unknown as Record<string, unknown>
            for (const key of ['children', 'inline', 'content'] as const) {
              const value = record[key]
              if (Array.isArray(value)) clampToGuard(value as InlineNode[])
            }
          }
        }
        clampToGuard(parsed)
      }
    }
    // Read the boundary each break belongs to BEFORE any stripping takes the
    // position that says so.
    const breakIndex = new Map<InlineNode, number>()
    // WHICH LINES STILL END AT A BOUNDARY, counting the boundaries the author
    // spelled with a `\` as well as the ones the container hardens. A `\` is
    // not a soft break and never reaches the conversion below, but it is just
    // as much a surviving line end - and the comment reinsertion asks that
    // question, not the conversion's.
    const boundaryLines = new Set<number>()
    // EVERY SLOT AN INLINE NODE HOLDS OTHER INLINES IN, not just `children`: an
    // inline footnote carries its body in `inline` and an inline extension in
    // `content`, and a walk that knows only one name misses two containers.
    // Named once so the two passes below cannot drift apart on it.
    const INLINE_SLOTS = ['children', 'inline', 'content'] as const
    const slotsOf = (node: InlineNode): InlineNode[][] => {
      const record = node as unknown as Record<string, unknown>
      // `content` is a STRING on a comment and on an inline literal, so the
      // array test is the discriminator rather than the name.
      return INLINE_SLOTS.map((slot) => record[slot]).filter(Array.isArray) as InlineNode[][]
    }
    // AT EVERY DEPTH. An inline container that opens on one body line and
    // closes on a later one holds the boundaries between them as its OWN
    // children, so a walk over the stanza's top-level nodes never sees them
    // (carve-js#1174).
    const readBoundaries = (nodes: InlineNode[]): void => {
      for (const node of nodes) {
        if (node.type === 'soft_break' || node.type === 'hard_break') {
          const startLine = node.pos?.startLine
          if (startLine === undefined) continue
          boundaryLines.add(startLine - firstLineNumber)
          if (node.type === 'soft_break') breakIndex.set(node, startLine - firstLineNumber)
          continue
        }
        for (const slot of slotsOf(node)) readBoundaries(slot)
      }
    }
    readBoundaries(parsed)
    if (!anchorable) stripPositions(parsed)
    // REMOVED FROM THE RENDER, NOT FROM THE TREE (PART 9 §23). Every line the
    // block layer emptied above goes back in as the `comment` node it is, at
    // the boundary that ends it, so the canonical writer emits the author's own
    // line back at the column they wrote it at.
    //
    // AND IT KEEPS ITS POSITION IN A STANZA THAT PLACES NOTHING ELSE
    // (markup-carve/carve-js#1323). A stanza holding a tab publishes no
    // position for its inlines, and the reason is right: the verse text is
    // RECONSTRUCTED with expanded tabs, whose display width is not a source
    // length, so PART 12 §4 forbids inventing a mapping for anything measured
    // from it. A comment is not measured from that text. It is a whole source
    // LINE the block layer emptied, its span was taken from the line table
    // above before any of the rewriting happened, and it is the same table the
    // `hard_break` below is re-posed from - a break this engine publishes on
    // exactly these stanzas, at a span whose end is the comment line's first
    // column. Stripping the comment therefore withheld a position the engine
    // had, on the one node in the stanza that never needed the reassembled
    // text, while carve-rs and carve-php published it.
    const pendingComments = new Map<number, Comment>()
    lines.forEach((line, index) => {
      if (!line.comment) return
      pendingComments.set(index, line.comment)
    })
    // BOTH THE REINSERTION AND THE CONVERSION DESCEND (carve-js#1174,
    // markup-carve/carve#1351).
    //
    // Both passes used to walk the stanza's TOP-LEVEL nodes only, so an emptied
    // comment line whose boundary ended up under an inline container - `*` that
    // opened on an earlier body line - found nowhere to sit and was dropped
    // from the tree, and every boundary nested under such a container kept the
    // SOFT spelling the inline parser gave it.
    //
    // §23 HARDENS A LINE BOUNDARY BY NODE KIND, NOT BY DEPTH. Its neighboring
    // clause, A BACKSLASH BREAK IS NOT ADDITIVE, states that ONE line boundary
    // produces ONE break however the boundary is spelled, and makes the
    // exemption a question of node PRESENCE: a backslash break and a newline an
    // open verbatim run swallowed are exempt because they leave no break node
    // to convert, which is a difference in KIND rather than in depth.
    //
    // carve-js violated that against itself. A stanza line ending in a
    // backslash inside emphasis emitted its break inside the `strong`, while
    // the same two lines without the backslash emitted none, because the
    // conversion ran at depth 0 only. It now runs wherever a break node is, so
    // the two spellings of one boundary agree. This reverses the four rows
    // carve-js#1127 pinned; PART 11 §7c is amended alongside, so the writer
    // follows.
    //
    // Depth-first in source order, so `pendingComments` is still consumed in
    // the order the author wrote the lines.
    const place = (nodes: InlineNode[]): InlineNode[] => {
      const out: InlineNode[] = []
      for (const node of nodes) {
        if (node.type !== 'soft_break') {
          const record = node as unknown as Record<string, unknown>
          for (const slot of INLINE_SLOTS) {
            const value = record[slot]
            if (Array.isArray(value)) record[slot] = place(value as InlineNode[])
          }
          out.push(node)
          continue
        }
        const index = breakIndex.get(node)
        // The comment sits BEFORE the break that ends its line: the line is empty
        // now, so there is nothing else on it.
        if (index !== undefined) {
          const comment = pendingComments.get(index)
          if (comment) {
            // A NESTED REINSERTION KEEPS ITS POSITION NOW. It could not before:
            // the nodes it sits among were measured from the JOINED text, which
            // is shorter than the source by exactly the line this comment
            // emptied, so `c` in `*a` / `%% secret` / `c*` reported the offset
            // of `%` and a correct span beside it would have asserted that two
            // nodes hold the same bytes (carve-js#1182). With the anchors
            // carried into the nested scan those siblings are measured from the
            // line they were written on, and the spans nest the way PART 12
            // containment asks.
            out.push(comment)
            pendingComments.delete(index)
          }
        }
        // EVERY SURVIVING BREAK IS HARDENED AND RE-POSED FROM LINE GEOMETRY, at
        // any depth. A nested break left on its scanned span ends where the
        // NEXT line starts, so the one that ends an emptied comment line
        // covered that whole line and overlapped the comment reinserted just
        // above it.
        const hardBreak = { type: 'hard_break' } as InlineNode
        const pos = index === undefined ? undefined : breakPos(index)
        if (pos) hardBreak.pos = pos

        out.push(hardBreak)
      }
      return out
    }
    const inline: InlineNode[] = place(parsed)
    // A COMMENT ON THE STANZA'S LAST LINE has no break after it to sit before,
    // so it goes at the end - the boundary that opens its line is still there,
    // which is what says the line is still there.
    //
    // A COMMENT AN OPEN RUN SWALLOWED does not survive, and that is §23's own
    // account of the shape rather than a loss: what the run carries across the
    // emptied line is a NEWLINE, the same thing it carries across every other
    // boundary it swallows. There is no boundary left in the tree to host the
    // node, and appending one anyway put a span BEFORE the run that contains it
    // and after the node that follows it, which PART 12 containment refuses.
    // The writer keeps the LINE - an empty verse line has exactly one spelling
    // inside an open run, and it is a comment line.
    for (const index of [...pendingComments.keys()].sort((a, b) => a - b)) {
      const isLastLine = index === lines.length - 1
      if (isLastLine && (index === 0 || boundaryLines.has(index - 1))) {
        inline.push(pendingComments.get(index)!)
      }
    }

    const paragraph: Paragraph = { type: 'paragraph', children: inline }
    if (lexer.hasDocumentOffsets) {
      const first = lines[0]!
      const last = lines[lines.length - 1]!
      paragraph.pos = {
        startLine: lexer.lineNumber(first.lineIndex),
        endLine: lexer.lineNumber(last.lineIndex),
        startColumn: lexer.lineStartColumn(first.lineIndex),
        endColumn: lexer.lineStartColumn(last.lineIndex) + (lexer.lines[last.lineIndex]?.length ?? 0),
        startOffset: lexer.lineOffset(first.lineIndex),
        endOffset: lexer.lineOffset(last.lineIndex) + (lexer.lines[last.lineIndex]?.length ?? 0),
      }
      const placed = anchorable ? inline.filter((node) => node.pos !== undefined) : []
      const firstPos = placed.find(
        (node) => node.type !== 'soft_break' && node.type !== 'hard_break',
      )?.pos
      const lastPos = placed[placed.length - 1]?.pos
      if (firstPos) {
        paragraph.pos.startLine = firstPos.startLine
        if (firstPos.startColumn !== undefined) paragraph.pos.startColumn = firstPos.startColumn
        if (firstPos.startOffset !== undefined) paragraph.pos.startOffset = firstPos.startOffset
      }
      if (lastPos) {
        paragraph.pos.endLine = lastPos.endLine
        if (lastPos.endColumn !== undefined) paragraph.pos.endColumn = lastPos.endColumn
        if (lastPos.endOffset !== undefined) paragraph.pos.endOffset = lastPos.endOffset
      }
    }
    return paragraph
  })
  // No inline opener attributes (strict djot); a preceding block-attribute
  // line merges onto this node in parseBlocks.
  const node: LineBlock = {
    type: 'line_block',
    children,
  }
  return node
}

/**
 * Rewrites the whitespace a line block preserves to the U+E000 sentinel.
 *
 * Leading whitespace is always kept, down to a single column. An inner or
 * trailing run of TWO OR MORE columns is a medial gap - the inline alignment a
 * caesura or a column of aligned text is made of - and is kept too. A lone
 * inner space stays an ordinary collapsible space, so a long line can still
 * wrap between words.
 *
 * Use the internal non-breaking-space placeholder (U+E000) - the same
 * private-use sentinel as an escaped space - so preserved columns never collide
 * with a literal U+00A0 in the author's text and are converted per renderer
 * (HTML &nbsp;, Markdown U+00A0, plain/ANSI an ordinary space).
 */
function expandLineBlockWhitespace(line: string): string {
  let out = ''
  let i = 0
  let column = 0
  let seenContent = false
  while (i < line.length) {
    const ch = line[i]
    if (ch !== ' ' && ch !== '\t') {
      out += ch
      seenContent = true
      column++
      i++
      continue
    }
    let width = 0
    while (i < line.length && (line[i] === ' ' || line[i] === '\t')) {
      if (line[i] === '\t') width += 4 - ((column + width) % 4)
      else width++
      i++
    }
    column += width
    out += !seenContent || width >= 2 ? '\ue000'.repeat(width) : ' '
  }

  return out
}

/**
 * NO TRAILING WHITESPACE (PART 2; carve#926), applied to an expanded line.
 *
 * The MEDIAL GAPS rule in `expandLineBlockWhitespace` has already converted a
 * trailing run of TWO OR MORE columns into NBSP CONTENT, which this must not
 * touch - the sentinel is not a space any more. What is left is a ONE-COLUMN
 * trailing run, still an ordinary collapsible space, and that is the run this
 * drops. So `abc<SP><SP>` keeps two non-breaking spaces and `def<SP>` keeps
 * none.
 *
 * SPLIT OUT of the expansion so the caller can measure alignment against the
 * untrimmed form. Folded in, the drop made the expansion shorter than the
 * source line, an equal-length test read that as "the offsets no longer line
 * up", and one trailing space cost the whole stanza its positions.
 */
function dropTrailingSpaces(line: string): string {
  return line.replace(/ +$/, '')
}

// `::: \` hard-break block. Unlike the line block, the body is parsed as
// ordinary blocks (so nested admonitions / lists work); soft breaks are then
// promoted to hard breaks ONLY in the div's DIRECT paragraph children, and
// there is no leading-whitespace preservation. Emits `<div class="hardbreaks">`.
function parseHardBreaksBlock(lexer: Lexer): Div {
  const openLineIndex = lexer.pos
  const m = RE_HARDBREAKS_OPEN.exec(lexer.consume())!
  const fence = m[1]!.length
  const inner = collectColonFenceBody(lexer, {
    kind: 'hard-break block',
    lineIndex: openLineIndex,
    fenceWidth: fence,
  })
  const subLexer = nestedSubLexer(lexer, inner.map((line) => line.text), openLineIndex + 1)
  const children = parseBlocks(subLexer, 0)
  for (const child of children) {
    if (child.type === 'paragraph') {
      child.children = child.children.map((node) => {
        if (node.type !== 'soft_break') return node
        // Keep the break's span: it is the same source, just a different
        // meaning inside a hard-breaks block. Building a fresh object dropped
        // it, which is the same slip the line block already fixed (#462).
        const hardBreak = { type: 'hard_break' } as InlineNode
        if (node.pos) hardBreak.pos = node.pos

        return hardBreak
      })
    }
  }
  return {
    type: 'div',
    attrs: { classes: ['hardbreaks'], order: ['.class'] },
    children,
  }
}

// Fenced block quote. parseDiv's shape exactly, with no label slot and a
// block_quote node instead of a div (markup-carve/carve#1718).
function parseQuoteBlock(lexer: Lexer): BlockQuote | Figure {
  const openLineIndex = lexer.pos
  const m = RE_QUOTE_BLOCK_OPEN.exec(lexer.consume())!
  const fence = m[1]!.length
  const inner = collectColonFenceBody(lexer, {
    kind: 'block quote',
    lineIndex: openLineIndex,
    fenceWidth: fence,
  })
  const subLexer = nestedSubLexer(lexer, inner.map((line) => line.text), openLineIndex + 1)
  const bq: BlockQuote = { type: 'block_quote', fenced: true, children: parseBlocks(subLexer, 0) }
  const quoteEndIndex = lexer.pos
  // §4's seventh caption host. The slot hangs on the CLOSING fence, as the
  // figure group's does, and what it produces is what the PREFIXED spelling
  // produces: a captioned quote is a figure either way, because the two
  // spellings are one node and §4's rule reads the node (carve#1742).
  // A quote auto-closed at end of input has no closer line to host the slot,
  // and there the lexer is already exhausted so the lookahead finds nothing.
  let lookahead = 0
  while (!lexer.eof() && isBlankLine(lexer.peek(lookahead))) lookahead++
  const next = lexer.peek(lookahead)
  if (next) {
    const cap = RE_CAPTION.exec(next)
    // §4: adjacent, or across at most ONE blank line.
    if (cap && lookahead <= 1) {
      for (let i = 0; i <= lookahead; i++) lexer.consume()
      // The TARGET keeps its own span, as every other caption host's does.
      // Wrapping without this left a captioned fenced quote as the one block
      // quote in the vocabulary with no `pos`, which the position rules would
      // report the moment a corpus document reached the shape.
      attachBlockPos(lexer, bq, openLineIndex, quoteEndIndex)
      return { type: 'figure', target: bq, caption: parseCaptionInline(lexer, cap[1]!) } as Figure
    }
  }
  return bq
}

function parseDiv(lexer: Lexer): Div {
  const openLineIndex = lexer.pos
  const m = RE_DIV_OPEN.exec(lexer.consume())!
  const fence = m[1]!.length
  // Optional inert grouping `[label]` on a typeless div (`::: [First]`).
  const label = m[2] !== undefined ? m[2]!.slice(1, -1) : undefined
  const inner = collectColonFenceBody(lexer, {
    kind: 'div',
    lineIndex: openLineIndex,
    fenceWidth: fence,
  })
  const subLexer = nestedSubLexer(lexer, inner.map((line) => line.text), openLineIndex + 1)
  // No inline opener attributes (strict djot): a bare `:::` carries none;
  // a preceding block-attribute line attaches them in parseBlocks.
  const node: Div = { type: 'div', children: parseBlocks(subLexer, 0) }
  if (label !== undefined) {
    node.label = label
  }
  return node
}

// Definition list (§4.5). An entry is 1+ `:: term` lines followed by 1+
// `: definition` lines; a definition continues on lines that REACH its own
// body's column, which is `:` plus the width of the separator it was written
// with (`deflistContentCol`). A `:: term` after a definition starts a new
// entry; a single blank line between entries is allowed, anything else ends the
// list.
function parseDefinitionList(lexer: Lexer): DefinitionList {
  const items: DefinitionItem[] = []
  /**
   * Collect and parse one body.
   *
   * `contentCol` is THE BODY'S OWN COLUMN, passed in rather than read from a
   * constant: the §4 tracker and the three indent tests below all measure
   * against it, and two bodies of the same list may be written at different
   * widths (`: one` beside `:  two`). A run of bare `3`s is how a column rule
   * acquires several spellings, and a single parameter is how it keeps one.
   */
  const parseDefBody = (
    first: string,
    firstLineIndex: number,
    markerContentCol: number,
  ): BlockNode[] => {
    // The body's column, which the marker HANDS OUT and one shape may still
    // lower: a block opener directly under the description line is the
    // description's content at any indent above zero
    // (`isDescriptionPayloadLine`), and taking it in means the body's column is
    // where the author actually put it. Lowering the ONE column is the whole of
    // that rule's effect on this collector - the branch below does nothing else
    // - so every later line, blank lookahead and fence-closer scan keeps
    // measuring against a single value instead of against a special case.
    let contentCol = markerContentCol
    const bodyLines: string[] = []
    const bodyLineNumbers: number[] = []
    // AND A DEFINITION BODY IS SUCH A CONTAINER (PART 0 S4,
    // markup-carve/carve#956). A definition body is the third indented-block
    // collector and answers S4 the same way the list item and the block quote
    // do: NO OPEN PARAGRAPH, NO LAZY LINE. It carried no model of that at all -
    // the lazy branch below asked only "is this line a block opener" - so a
    // fence opened on the `:  ` marker line left every flush-left line folding
    // into the code text, body and closer both, where the identical `- ` list
    // spelling closes the container and re-parses them at document level
    // (corpus 276).
    //
    // The state is the LIST's, driven by the list's own tracker. A definition
    // body is not a different container kind for this rule (carve#920: the
    // container kind is not a parameter), so a second spelling of the model
    // would be a second place for it to drift.
    const lazyState: ItemLazyState = {
      inFence: false,
      fenceClose: null,
      inComment: false,
      commentLen: 0,
      lazyFoldableBeforeComment: false,
      openedCommentAtColumn: false,
      inTable: false,
      invisibleAtColumn: false,
      commentAtColumn: false,
      inFootnoteBody: false,
      quoteInner: null,
      absorbingFence: false,
      divDepth: 0,
      lazyFoldable: false,
      inDefList: false,
      attrRun: null,
    }
    const defFenceMemo: QuotedFenceCloserMemo = new Map()
    /**
     * Feed one collected body line to the S4 tracker.
     *
     * `atContentColumn` is false only for a line the body took LAZILY, from
     * below its content column. An invisible line there adds no block, so the
     * paragraph it was folded into is still open behind it.
     */
    const track = (content: string, atLineIndex?: number, atContentColumn = true): void => {
      trackItemLazyState(
        content,
        lazyState,
        (marker) =>
          atLineIndex === undefined
            ? true
            : itemFenceHasCloser(lexer, marker, atLineIndex, contentCol, defFenceMemo),
        atContentColumn,
      )
    }
    // The boundary set for a `+`-attached block in a definition body: a blank,
    // a further `+`, or the next term / description marker. Whether a line in
    // that set actually ENDS the block is `insideOpenFence`'s answer, layered
    // on by `collectAttachedBlock`.
    const isDefBodyBoundary = (a: string): boolean =>
      isBlankLine(a) ||
      /^\+[ \t]*$/.test(a) ||
      RE_DEFLIST_TERM.test(a) ||
      RE_DEFLIST_DEF.test(a)
    // First-block form (`:  +`, mirroring the list `- +`): when the sole
    // content is a lone `+`, the definition body is the FOLLOWING flush-left
    // block, with no indentation. `:  \+` keeps a literal `+` instead.
    if (/^\+[ \t]*$/.test(first)) {
      const firstBlock = collectAttachedBlock(lexer, isDefBodyBoundary)
      bodyLines.push(...firstBlock.lines)
      bodyLineNumbers.push(...firstBlock.lineNumbers)
      for (const a of firstBlock.lines) track(a)
    } else {
      bodyLines.push(first)
      bodyLineNumbers.push(lexer.lineNumber(firstLineIndex))
      // The MARKER LINE never goes through the tracker in the list either, and
      // for the same reason it is seeded by hand here: nothing precedes it, so
      // no closer lookahead applies and a fence on it opens unconditionally
      // (markup-carve/carve#950). The lead opens a paragraph unless it is one of
      // the shapes that open nothing - PART 1 S4's question, asked here in the
      // ONE spelling the list item asks it in. THE CONTAINER KIND IS NOT A
      // PARAMETER (carve#920): a heading, a table or an attribute block written
      // on the `:  ` marker leaves no paragraph open for exactly the reason it
      // leaves none on a `- ` marker.
      const firstState = markerLineState(first)
      lazyState.lazyFoldable = firstState.leavesParagraphOpen
      lazyState.inTable = firstState.endsOnTableRow
      lazyState.quoteInner = firstState.quote
      const leadFence = RE_FENCE.exec(first) ?? RE_RAW_FENCE.exec(first)
      if (leadFence) {
        lazyState.inFence = true
        lazyState.fenceClose = fenceCloseRe(RE_FENCE.test(first) ? leadFence[2]! : leadFence[1]!)
        lazyState.lazyFoldable = false
      }
    }
    // A definition continues like a list item (PART 9 \u00a717):
    //  - form A: a deeper-indented line (>= the content column) folds in, and a
    //    blank line is tolerated when a later line still continues the body, so
    //    a `<dd>` can hold multiple paragraphs;
    //  - form B: a lone `+` attaches the FOLLOWING flush-left block, so rich
    //    content can join the definition with no indentation (the un-prefixed
    //    analogue of the list-item and block-quote `+` forms; a leading `:  +`
    //    is the same marker opening the FIRST block);
    //  - lazy continuation: a flush-left line with no blank before it that does
    //    NOT start an interrupting block folds into the open paragraph (the same
    //    CommonMark lazy rule list items and block quotes use, matching djot).
    for (;;) {
      if (lexer.eof()) break
      const ln = lexer.peek()!
      // Form B: `+` pull-left continuation.
      if (/^\+[ \t]*$/.test(ln)) {
        const plusLineIndex = lexer.pos
        lexer.consume()
        const { lines: attached, lineNumbers: attachedLineNumbers } = collectAttachedBlock(
          lexer,
          isDefBodyBoundary,
        )
        if (attached.length > 0) {
          bodyLines.push('')
          bodyLineNumbers.push(lexer.lineNumber(plusLineIndex))
          track('')
          for (const a of attached) {
            bodyLines.push(a)
            track(a)
          }
          bodyLineNumbers.push(...attachedLineNumbers)
        }
        continue
      }
      // Form A: an indented continuation line (with no intervening blank).
      // The indent is a COLUMN claim, not a character count: `definition_
      // continuation` is a leading indentation run, so a tab is syntax there and
      // advances to the next multiple of 4 (markup-carve/carve#888's signoff,
      // reaffirmed by markup-carve/carve#901; the same family as #692, #796 and
      // #905). Counting characters made a lone tab - column 4, past the content
      // column - end the body, while three spaces continued it, and made the
      // answer depend on how the author spelled a run rather than where it
      // landed (markup-carve/carve-js#812).
      if (!isBlankLine(ln) && indentColumns(ln, contentCol) >= contentCol) {
        // A CONTINUATION INDENTED PAST THE BODY'S COLUMN IS LAZY TEXT
        // (markup-carve/carve#918). `definition_indent` REACHES the body's
        // column and does not measure how far past it a line went, because
        // there is nothing past that column for indentation to mean. So a line
        // indented further continues the body's OPEN PARAGRAPH, and a paragraph
        // continuation carries inline content.
        //
        // This stripped the WHOLE leading run, which delivered a line one
        // column past the body flush at column 0 - byte-identical to one written
        // AT the body's column - so the two columns could not give different
        // answers and a stray extra indent silently opened a block quote.
        // Slicing exactly the body's own columns and KEEPING the residual is
        // what separates them,
        // and it is the same call the list already makes for every line kind
        // (`sliceColumns(l, contentCol, true)`). The residual column then meets
        // the STRICT COLUMN-0 rule for indented top-level block openers, which
        // is what turns the line into text - so the answer is derived from a
        // rule already in the language rather than from a new special case
        // here.
        //
        // Why not "extra indentation nests", from the signoff: that reading
        // makes indentation depth mean two different things one line apart,
        // since lazy continuation already governs the line above and folds it
        // into the same paragraph. A legitimately nested construct needs the
        // blank-line-then-indented-block form (FORM A above), which is how a
        // `dd` already holds more than one block.
        //
        // A content U+00A0 is still kept: `sliceColumns` counts only spaces and
        // tabs as columns, so a no-break space stops the scan as content.
        const lineIndex = lexer.pos
        const dedented = sliceColumns(ln, contentCol, true)
        bodyLines.push(dedented)
        bodyLineNumbers.push(lexer.lineNumber(lineIndex))
        track(dedented, lineIndex)
        lexer.consume()
        continue
      }
      // Blank line: absorb it as a paragraph separator ONLY when a later line
      // is still an indented continuation. Otherwise leave it in place so the
      // entry-separator rule (a single blank before the next `:: term`) and the
      // outer block stream see it unchanged.
      if (isBlankLine(ln)) {
        let look = 1
        while (isBlankLine(lexer.peek(look))) look++
        const after = lexer.peek(look)
        // The SECOND spelling of the same rule, and it has its own job: this one
        // decides whether the body survives the blank at all, the Form A branch
        // above decides whether a line folds. Both read columns, or a lone tab
        // after a blank ends the body while Form A would have kept it.
        if (
          after !== undefined &&
          !isBlankLine(after) &&
          indentColumns(after, contentCol) >= contentCol
        ) {
          for (let k = 0; k < look; k++) {
            const lineIndex = lexer.pos
            bodyLines.push('')
            bodyLineNumbers.push(lexer.lineNumber(lineIndex))
            track('')
            lexer.consume()
          }
          continue
        }
        break
      }
      // A new term/definition marker ends this definition (the outer loop
      // picks it up).
      if (RE_DEFLIST_TERM.test(ln) || RE_DEFLIST_DEF.test(ln) || RE_DEFLIST_MARKER_EMPTY.test(ln)) break
      // A BLOCK OPENER DIRECTLY UNDER A DESCRIPTION LINE IS THE DESCRIPTION'S
      // CONTENT AT ANY INDENT ABOVE ZERO (markup-carve/carve#1769, corpus
      // `422-a-recognized-opener-in-a-body-needs-no-blank-line-above-it` -7,
      // -8 and -9; markup-carve/carve-js#1518). The predicate is stated once,
      // next to `lineOpensItemBlock`, because the rebase pass asks it too.
      //
      // The BELOW band below this branch is the rule for a payload with
      // something already above it - the body has said what it holds, and a
      // line under its column is the surviving context's. The line DIRECTLY
      // under the `:  ` marker is not that: nothing stands between it and the
      // description for the separator's width to measure.
      //
      // ALL THIS BRANCH DOES IS LOWER THE COLUMN, and then the Form A branch
      // takes the line on the next turn exactly as it takes one at the marker's
      // own column. The payload may own MORE THAN ITS OPENING LINE - a quote's
      // second `>` line, a fence's body and closer - and those continuations
      // reach the lowered column for the same reason the opener did, so one
      // assignment is the whole of it. Admitting only the opener here would
      // have been a second reach rule, and it left a two-line quote's tail
      // outside the `dd`.
      if (
        lexer.pos === firstLineIndex + 1 &&
        bodyLines.length === 1 &&
        isDescriptionPayloadLine(lexer.lines[firstLineIndex] ?? '', ln)
      ) {
        contentCol = indentColumns(ln)
        continue
      }
      // Lazy continuation: a flush-left line (no blank before it) that does not
      // start an interrupting block folds into the open paragraph; a block
      // opener ends the definition.
      //
      // TWO RULES GATE IT, and they ask different questions.
      //
      // NO OPEN PARAGRAPH, NO LAZY LINE (PART 0 S4, markup-carve/carve#956).
      // `lazyFoldable` asks what the body currently ends in: a verbatim body is
      // not an open paragraph, so there is nothing for a below-column line to
      // continue and the containers close instead.
      //
      // BELOW THE BODY'S COLUMN THE BODY ENDS (markup-carve/carve#932). Every
      // line that reaches here is below the body's content column - Form A above
      // took the ones at or past it - so this branch IS the BELOW band, and the
      // band does not measure how far below. Column 0 is not a special case of
      // it, it is the ordinary case.
      //
      // So the classification reads the line's CONTENT, with its sub-column
      // residue removed. `startsInterruptingBlock` is a battery of `^`-anchored
      // patterns, so handing it the raw line asked "does this open a block AT ITS
      // INDENT" - and answered no for one and two spaces where it answered yes
      // for zero. `:: t` / `:  body` / ` > q` folded the quote in as lazy text at
      // one and two spaces and ended the body at zero, which gives a sub-column
      // indent a meaning of its own and makes indentation depth mean two
      // different things one column apart.
      //
      // Ending the body is all that decides. WHERE the line then lands is the
      // surviving context's business: at column 0 the quote opens, and at one or
      // two the top level's STRICT COLUMN-0 rule for indented block openers makes
      // it text. Both are the same classification, run in a context that has its
      // own rule about indentation - which is why the two columns still render
      // differently.
      //
      // Lazy continuation is unaffected by the second rule and is not its other
      // side: a plain line carries no block opener at any indent, so it folds
      // into the body's open paragraph whenever the first rule allows it.
      const below = ln.replace(/^[ \t]+/, '')
      if (lazyState.lazyFoldable && !startsInterruptingBlock(lexer, below)) {
        const lineIndex = lexer.pos
        bodyLines.push(ln)
        bodyLineNumbers.push(lexer.lineNumber(lineIndex))
        track(ln, undefined, false)
        lexer.consume()
        continue
      }
      break
    }
    // The same authored-base rule list items use, now in the definition body's
    // coordinate system after its own content margin was removed - plus
    // the definition entry carrying its own base, which carve#1763 pins for
    // these two bodies and not for a list item (carve-js#1514).
    rebaseOverindentedBlocks(bodyLines, undefined, -1, true, true)
    const sub = nestedSubLexer(lexer, bodyLines, firstLineIndex, bodyLineNumbers)
    return parseBlocks(sub, 0)
  }
  /**
   * The span covering document lines `first`..`last` inclusive, marker and all.
   *
   * `last` is never a blank line, and this does NOT trim one. `parseDefBody`
   * absorbs a blank only when it has already looked ahead and found a line that
   * still continues the body, so the next turn of its loop always consumes that
   * line - the last thing it takes is a content line by construction.
   *
   * A trimming loop was written here first and could not be made to fire: with
   * it removed the engine renders all 1373 corpus documents and eight probes
   * built specifically to leave a trailing blank byte-identically. It came out
   * rather than shipping as a guard nothing can exercise (markup-carve/carve#755).
   */
  function lineRange(lx: Lexer, first: number, last: number): Position | undefined {
    const lastLine = lx.lines[last]
    if (lastLine === undefined) return undefined

    return {
      startLine: lx.lineNumber(first),
      endLine: lx.lineNumber(last),
      startColumn: lx.lineStartColumn(first),
      endColumn: lx.lineStartColumn(last) + lastLine.length,
      startOffset: lx.lineOffset(first),
      endOffset: lx.lineOffset(last) + lastLine.length,
    }
  }

  while (!lexer.eof() && RE_DEFLIST_TERM.test(lexer.peek()!)) {
    const terms: InlineNode[][] = []
    const termSpans: (Position | undefined)[] = []
    const definitions: BlockNode[][] = []
    const definitionLines: number[] = []
    const definitionSpans: (Position | undefined)[] = []
    while (!lexer.eof()) {
      const t = RE_DEFLIST_TERM.exec(lexer.peek()!)
      if (!t) break
      const termLineIndex = lexer.pos
      lexer.consume()
      // A term is multi-line like a heading: a following plain line folds into
      // it with a soft break, instead of ending the list and stranding the
      // definition. A blank line, a new marker (`::` / `:  `), or a block
      // opener ends the term.
      // Each line drops its own trailing layout below, once the fold is
      // complete. In particular, the separator on a content-less marker-shaped
      // continuation (`* `, `. `) is content here.
      let termText = t[1]!
      let continuationLines = 0
      while (!lexer.eof()) {
        const next = lexer.peek()!
        if (
          isBlankLine(next) ||
          RE_DEFLIST_TERM.test(next) ||
          RE_DEFLIST_DEF.test(next) ||
          RE_DEFLIST_MARKER_EMPTY.test(next) ||
          endsHeadingOrQuote(lexer)
        )
          break
        termText += '\n' + next
        continuationLines++
        lexer.consume()
      }
      // Trailing whitespace is not content, and every other block drops it - a
      // paragraph, a heading, a quoted paragraph. The term kept it, so `:: t `
      // published `<dt>t </dt>` where carve-rs and carve-php publish
      // `<dt>t</dt>` (carve#510, found by the fuzzer).
      // NO TRAILING WHITESPACE (PART 2; carve#926). This was `[^\S\n]+$` - the
      // whole Unicode class minus the newline - so a term dropped a trailing
      // NBSP, byte-order mark, ideographic space, vertical tab and every
      // Unicode space, all of which are CONTENT and survive at every other
      // content line in this file.
      //
      // EVERY LINE, NOT ONLY THE MARKER LINE (markup-carve/carve-js#1145). The
      // narrowing above moved the strip onto the marker line's own capture, so
      // a FOLDED continuation - which ends in a soft break exactly as a
      // paragraph's does - kept its run. The term is the second of the two
      // blocks `dropTrailingWhitespace` is written for, and it was the one that
      // never called it. Three things followed, all carve-js alone:
      //   - `:: a` + `b ` published `<dt>a\nb </dt>`;
      //   - `b \` in the last column was an escaped space (a no-break space)
      //     where carve-rs and carve-php read a hard break, because the run the
      //     strip leaves behind is what decides (see carve#1027);
      //   - an unclosed verbatim run folding into the term spanned one
      //     codepoint past its own value, since the value strips the run the
      //     line kept. That last one is invisible to every renderer and shows
      //     only in a position comparison.
      // Trimming line ENDS only: interior runs are the author's, and the start
      // is where the term's own offsets are anchored.
      termText = dropTrailingWhitespace(termText)
      const termStart = lexer.lines[termLineIndex]!.indexOf(t[1]!)
      // A continuation line folds in whole, indent included, and the scanner
      // strips that indent when it builds the text node - so a single base
      // offset drifts by the indent on every line after the first. Each line
      // gets its own origin instead (#441): the term's own line starts after its
      // `::` marker, a continuation line at its left edge.
      const termAnchors =
        continuationLines > 0
          ? [
              {
                offset: lexer.lineOffset(termLineIndex) + termStart,
                column: lexer.lineStartColumn(termLineIndex) + termStart,
                line: lexer.lineNumber(termLineIndex),
              },
              ...Array.from({ length: continuationLines }, (_unused, i) => ({
                offset: lexer.lineOffset(termLineIndex + 1 + i),
                column: lexer.lineStartColumn(termLineIndex + 1 + i),
                line: lexer.lineNumber(termLineIndex + 1 + i),
              })),
            ]
          : undefined
      terms.push(
        parseInline(termText, lexer.abbrDefs, lexer.linkDefs, {
          anchored: lexer.hasDocumentOffsets,
          baseOffset: lexer.lineOffset(termLineIndex) + termStart,
          startLine: lexer.lineNumber(termLineIndex),
          startColumn: lexer.lineStartColumn(termLineIndex) + termStart,
          ...(termAnchors ? { lineAnchors: termAnchors } : {}),
        }),
      )
      termSpans.push(
        lexer.hasDocumentOffsets
          ? lineRange(lexer, termLineIndex, termLineIndex + continuationLines)
          : undefined,
      )
    }
    while (!lexer.eof()) {
      // A blank line before a `:  ` definition is allowed: a definition may be
      // separated from its term (or a previous definition) by a blank line for
      // readability, matching djot. The blank is a separator only - it does not
      // end the entry when a `:  ` definition follows.
      if (isBlankLine(lexer.peek()!)) {
        let look = 1
        while (isBlankLine(lexer.peek(look))) look++
        if (!RE_DEFLIST_DEF.test(lexer.peek(look) ?? '')) break
        for (let k = 0; k < look; k++) lexer.consume()
      }
      const defLineIndex = lexer.pos
      const d = RE_DEFLIST_DEF.exec(lexer.peek()!)
      if (!d) break
      lexer.consume()
      definitionLines.push(lexer.lineNumber(defLineIndex))
      definitions.push(parseDefBody(d[2]!, defLineIndex, deflistContentCol(d[1]!)))
      // The description's own extent, recorded from the lines it CONSUMED
      // rather than derived from the children it produced - because a
      // description whose only content hoists to the root produces none, and a
      // derived span then reports absence for a construct that is still sitting
      // in the source (markup-carve/carve-js#813).
      //
      // `parseDefBody` has returned, so `lexer.pos - 1` is the last line it
      // took. It always takes at least the marker line, so the range is never
      // empty and never runs backwards.
      definitionSpans.push(
        lexer.hasDocumentOffsets ? lineRange(lexer, defLineIndex, lexer.pos - 1) : undefined,
      )
    }
    items.push({ terms, definitions, termSpans, definitionLines, definitionSpans })
    // Allow a single blank line before the next entry's `:: term`.
    if (!lexer.eof() && isBlankLine(lexer.peek()!)) {
      let look = 1
      while (isBlankLine(lexer.peek(look))) look++
      const next = lexer.peek(look)
      if (next && RE_DEFLIST_TERM.test(next)) for (let k = 0; k < look; k++) lexer.consume()
      else break
    }
  }
  return { type: 'definition_list', items }
}

function parseAbbrDef(lexer: Lexer): AbbreviationDef {
  const line = lexer.consume()
  const m = RE_ABBR_DEF.exec(line)!
  // PART 2's NO TRAILING WHITESPACE rule applies to every non-verbatim
  // content line. The expansion is otherwise raw, but an ASCII space or tab
  // at the physical end of its line is not part of that raw value.
  return { type: 'abbreviation_def', abbr: m[1]!, expansion: dropTrailingWhitespace(m[2]!) }
}

type BlockQuoteLazyMode =
  | { kind: 'closed' }
  | { kind: 'paragraph'; absorbingFence: boolean }
  | { kind: 'code_fence'; close: RegExp }
  | { kind: 'comment_fence'; length: number }
  // A QUOTE INSIDE THIS ONE IS ASKED WHAT IT ENDS ON, rather than assumed to
  // end on a paragraph. PART 1 S4 is about the open STACK, and the block at the
  // bottom of it may be several quotes down: `> a` / `> > # H` / `tail` ends the
  // outer quote because the inner one ends on a heading, and `> > | a |` /
  // `> > + b |` because it ends on a table (markup-carve/carve#1357). The inner
  // state is CARRIED across the outer quote's lines, so a nested table spanning
  // two of them is one table rather than two first rows.
  | { kind: 'quote'; inner: BlockQuoteLazyState }

interface BlockQuoteLazyState {
  mode: BlockQuoteLazyMode
  /**
   * Did the line before this one leave a table open?
   *
   * A CONTINUATION ROW IS MORE TABLE, and only where a table is above it
   * (markup-carve/carve#1349). It carries no leading pipe, so `isTableRow` does
   * not see it, and a container whose table ended on one reported an open
   * paragraph its table did not have. With no row above, `+ b |` is prose and a
   * dedented line still folds into it.
   *
   * Cleared at the top of the tracker and re-armed by the two row branches,
   * exactly as the fence absorption is.
   */
  inTable: boolean
  /**
   * The lines so far of a `{…}` block-attribute block that has not closed yet,
   * newline-joined, or null when the tracker is not inside one - the quote's
   * copy of `ItemLazyState.attrRun`, and read the same way.
   */
  attrRun: string | null
  /**
   * Widths of the colon fences open in this quote, innermost last, so a bare
   * `:::` run reads as the innermost container's closer only on an EXACT width
   * match — `collectColonFenceBody`'s rule. A plain counter closed a `::::`
   * container on a `:::` run, which that container reads as a nested opener,
   * and the quote then ended on a line the top level folds in.
   */
  colonWidths: number[]
}

/** Iterative for the reason `trackBlockQuoteLazyState` is: the chain is as deep as the document nests. */
const blockQuoteParagraphOpen = (state: BlockQuoteLazyState): boolean => {
  let level = state
  while (level.mode.kind === 'quote') level = level.mode.inner

  return level.mode.kind === 'paragraph'
}

const closeBlockQuoteParagraph = (state: BlockQuoteLazyState): void => {
  state.mode = { kind: 'closed' }
}

/**
 * Track verbatim/paragraph state across a blockquote's collected inner lines so a
 * non-`>` lazy line only extends an OPEN paragraph (the djot/CommonMark rule).
 * Inside an open code fence/comment, or after a structural line that leaves no open
 * paragraph (a just-opened div, a closed fence), such a line must terminate the
 * quote rather than be swallowed into the fence/div.
 *
 * PART 1 S4's NO OPEN PARAGRAPH, NO LAZY LINE is written about the OPEN STACK,
 * not about which container kind is on it (markup-carve/carve#920): a container
 * a quoted line has just opened is EMPTY and holds no paragraph, and a CLOSED
 * one holds none either. This tracker answered that only when the opener stood
 * where no paragraph was already open, on the reading that "Carve has no
 * paragraph-interrupting block mode". Measured against this engine's own block
 * parser, that reading is false: a `:::` opener, a fence with a closer ahead and
 * a comment fence with a closer ahead all DO interrupt an open quoted paragraph
 * (`startsInterruptingBlock`). Each kind therefore carries its own condition
 * here rather than sharing one gate:
 *
 *  - a colon fence opens UNCONDITIONALLY ("colon-fence containers open
 *    immediately and auto-close at EOF"), and its closer is tracked at all;
 *  - a code/raw fence interrupts an open paragraph only with a matching closer
 *    ahead IN THIS QUOTE, and dispatches unconditionally when none is open — an
 *    unterminated one mid-paragraph is inline verbatim, so the paragraph stays;
 *  - a comment fence needs its closer either way, which is what
 *    `hasCommentCloser` has done since carve-js#832.
 */
/**
 * Track verbatim/paragraph state across a blockquote's collected inner lines.
 *
 * ITERATIVE, NOT RECURSIVE, and that is a requirement rather than a style.
 * `'> '.repeat(20000)` is a 40 KB document the parser handles today, and a
 * tracker that recursed once per nesting level overflowed the stack on it -
 * a denial of service under §25, in the one pass added to answer a question
 * about depth. The descent is a loop over the quote prefix instead; each step
 * hands the next level the text behind its own marker.
 */
function trackBlockQuoteLazyState(
  content: string,
  state: BlockQuoteLazyState,
  hasCommentCloser: (fence: number) => boolean,
  hasFenceCloser: (marker: string) => boolean,
): void {
  let text = content
  let level = state
  for (;;) {
    const descend = classifyQuotedLine(text, level, hasCommentCloser, hasFenceCloser)
    if (descend === null) return
    text = descend.text
    level = descend.state
  }
}

function classifyQuotedLine(
  content: string,
  state: BlockQuoteLazyState,
  hasCommentCloser: (fence: number) => boolean,
  hasFenceCloser: (marker: string) => boolean,
): { text: string; state: BlockQuoteLazyState } | null {
  // Absorption belongs to ONE open paragraph, so it ends wherever that
  // paragraph does: cleared here and re-armed only in the two branches that
  // continue the same paragraph, exactly as `trackItemLazyState` does it.
  const wasAbsorbing = state.mode.kind === 'paragraph' && state.mode.absorbingFence
  // Carried the same way the absorption is, and for the same reason: every
  // other block ends the table, so only the two row branches re-arm it.
  const wasInTable = state.inTable
  state.inTable = false
  if (state.mode.kind === 'comment_fence') {
    // EXACT length, per PART 9 §28: "The CLOSER matches on EXACT delimiter
    // length (§2), so a longer opener nests shorter fences and a too-short line
    // is content, not a closer." This read `>=`, which is the CODE fence's rule
    // (`fenceCloseRe`) and not this one - so a `%%%%` line inside a `%%%`
    // comment closed it here and was body text to the parser.
    const run = commentFenceRun(content)
    if (run === state.mode.length) state.mode = { kind: 'closed' }
    return null
  }
  if (state.mode.kind === 'code_fence') {
    if (state.mode.close.test(content)) state.mode = { kind: 'closed' }
    return null
  }
  // A WRAPPED block-attribute block, tracked ALONGSIDE the classifiers rather
  // than instead of them. See `trackItemLazyState` for the whole of the reason;
  // THE CONTAINER KIND IS NOT A PARAMETER (carve#920), so the quote reads it the
  // same way.
  if (trackWrappedAttributeRun(state, content)) {
    closeBlockQuoteParagraph(state)
    return null
  }
  if (isBlankLine(content)) {
    closeBlockQuoteParagraph(state)
    return null
  }
  // A block-attribute line renders nothing and opens nothing: it collects into
  // `pending` and floats forward to the next block (§15 A1/A2), and it does not
  // survive the container that holds it (markup-carve/carve#1281). So the quote
  // holds no paragraph after one, and a following flush-left line ends the quote
  // rather than joining it - which is what leaves A4 with nothing to attach to.
  // `trackItemLazyState` has read it this way for an item all along; the quote
  // did not, and kept the line inside.
  if (isBlockAttributeLine(content)) {
    closeBlockQuoteParagraph(state)
    return null
  }
  // A quoted line comment is an invisible block, not paragraph content. Once
  // it is the quote's last block there is no paragraph for an unmarked line to
  // continue, so that line belongs outside the quote. A 3+ run is excluded:
  // without a matching closer it degrades to paragraph text below.
  if (RE_COMMENT_LINE.test(content) && commentFenceRun(content) === undefined) {
    closeBlockQuoteParagraph(state)
    return null
  }
  // A heading, table row, or thematic break is an UNCONDITIONAL paragraph
  // interrupter (no matching-closer dependency), so it leaves no open trailing
  // paragraph even directly after quoted prose. A following lazy list marker
  // then ENDS the quote (it has no paragraph to fold into) -- exactly as
  // `# h\n- item` is a heading plus a sibling list at the top level, and as
  // `> a\n> # h\n- item` is a quote (para + heading) plus a sibling list.
  // Mirrors trackItemLazyState.
  if (RE_HEADING.test(content) || isTableRow(content) || RE_HR.test(content)) {
    state.inTable = isTableRow(content)
    closeBlockQuoteParagraph(state)
    return null
  }
  // A TABLE IS A TABLE HOWEVER ITS LAST ROW IS SPELLED. The row test above
  // reads a leading pipe and a continuation row carries none, so `> | a |` /
  // `> + b |` / `tail` kept `tail` inside the quote where the standard-row
  // spelling of the same table sends it out (markup-carve/carve#1348).
  if (wasInTable && RE_TABLE_CONT.test(content)) {
    state.inTable = true
    closeBlockQuoteParagraph(state)
    return null
  }
  // A QUOTED LINE OPENS OR CONTINUES A QUOTE INSIDE THIS ONE, and what THAT
  // quote ends on is what this one ends on. Asked by carrying an inner tracker
  // rather than by re-reading the line, so a nested table, fence or div spanning
  // several lines is one block there as it is here.
  const quoted = RE_BLOCKQUOTE.exec(content)
  if (quoted) {
    const inner: BlockQuoteLazyState =
      state.mode.kind === 'quote'
        ? state.mode.inner
        : { mode: { kind: 'closed' }, inTable: false, colonWidths: [], attrRun: null }
    state.mode = { kind: 'quote', inner }

    return { text: quoted[1] ?? '', state: inner }
  }
  // Two more kinds that leave no paragraph, for the same S4 reason. A
  // definition TERM is bounded like a heading - it holds inline content, not a
  // paragraph - and a reference, footnote or abbreviation definition is
  // invisible, so there is nothing on the page for a lazy line to continue.
  // Without these, `>:: t` / `~` produced `<dt>t ~</dt>` and `>[f]: ~` / `/`
  // put the `/` inside the quote (carve-js#554).
  // No RE_ABBR_DEF: this content is inside a block quote, and PART 12 SS7
  // recognizes an abbreviation definition only at document level - so the line
  // IS a paragraph here, and a lazy line continues it.
  if (
    RE_DEFLIST_TERM.test(content) ||
    RE_FOOTNOTE_DEF.test(content) ||
    isLinkDefLine(content)
  ) {
    closeBlockQuoteParagraph(state)
    return null
  }
  // The colon-fence arm below is `trackItemLazyState`'s, restated for the quote:
  // one construct answering S4 two ways depending on the container kind is the
  // defect markup-carve/carve#920 names, so the two trackers keep the same
  // model - open containers, a bare run reading as the innermost one's CLOSER,
  // and the §12 absorption rule for a malformed opener.
  //
  // A bare run at the innermost container's EXACT width is that container's
  // closer, and a CLOSED container holds no open paragraph. Nothing tracked the
  // closer at all here, so `> q` / `> ::: note` / `> body` / `> :::` / `tail`
  // left the tracker believing the quote's paragraph was still open and kept
  // `tail` inside it.
  const bareFenceRun = /^(:{3,})[ \t]*$/.exec(content)
  const bareFence = bareFenceRun !== null
  if (bareFence && bareFenceRun![1]!.length === state.colonWidths[state.colonWidths.length - 1]) {
    state.colonWidths.pop()
    closeBlockQuoteParagraph(state)
    return null
  }
  if (
    RE_DIV_OPEN.test(content) ||
    (RE_ADMONITION_OPEN.test(content) && !RE_ADMONITION_CLOSE.test(content)) ||
    RE_LINE_BLOCK_OPEN.test(content) ||
    RE_HARDBREAKS_OPEN.test(content) ||
    RE_QUOTE_BLOCK_OPEN.test(content)
  ) {
    // ...unless the paragraph above already absorbed a MALFORMED fence and this
    // line is a bare run, in which case §12 takes it as text too and the
    // paragraph stays open. Corpus 260 pins that shape inside a quote.
    //
    // Reaching here with a bare run already proves it is NOT the innermost
    // container's closer - that branch returned above - so absorption applies
    // inside a container as readily as at the quote's own level.
    if (wasAbsorbing && bareFence) {
      state.mode = { kind: 'paragraph', absorbingFence: true }
      return null
    }
    // A colon-fence OPENER is structural and needs no closer ahead ("colon-fence
    // containers open immediately and auto-close at EOF"), so it interrupts an
    // open quoted paragraph and leaves an EMPTY container holding none either.
    state.colonWidths.push(colonFenceOpenerLen(content) ?? 3)
    closeBlockQuoteParagraph(state)
    return null
  }
  // A fence-shaped line that is NOT a valid opener is ordinary paragraph text
  // (`:::note` fails §12's opener test - a type word needs a space), and from
  // here the paragraph absorbs the next bare fence-shaped line as well.
  if (/^:{3,}/.test(content)) {
    state.mode = { kind: 'paragraph', absorbingFence: true }
    return null
  }
  // A code or raw fence interrupts an OPEN paragraph only when a matching
  // closer follows in this quote (§10 CLOSER LOOKAHEAD, as
  // `startsInterruptingBlock` applies it); with no paragraph open it dispatches
  // unconditionally and an unterminated one runs to the end of the quote. A
  // mid-paragraph fence with no closer is inline verbatim, so it falls through
  // and the paragraph stays open.
  const fence = RE_FENCE.exec(content)
  const raw = fence ? null : RE_RAW_FENCE.exec(content)
  const fenceMarker = fence ? fence[2]! : raw ? raw[1]! : null
  if (fenceMarker !== null && (!blockQuoteParagraphOpen(state) || hasFenceCloser(fenceMarker))) {
    state.mode = { kind: 'code_fence', close: fenceCloseRe(fenceMarker) }
    return null
  }
  // AN UNTERMINATED OPENER DOES NOT OPEN A BLOCK (PART 9 section 28). Every
  // opener was treated as opening here, so `> %%%` with no closer put the
  // tracker inside a comment, `paragraphOpen` went false, and a lazy line
  // that should have continued the quote's paragraph ended the quote
  // instead. The block parser has always looked ahead; this is the same
  // lookahead over the quote's own lines.
  //
  // With no closer the line is still a line comment. Comment classification
  // happens before visible ownership, so it closes the paragraph while the
  // quote frame remains available for a later explicitly quoted line. It must
  // not manufacture a paragraph that an unmarked following line can lazily
  // continue.
  const commentRun = commentFenceRun(content)
  if (commentRun !== undefined) {
    if (hasCommentCloser(commentRun)) {
      state.mode = { kind: 'comment_fence', length: commentRun }
    } else {
      closeBlockQuoteParagraph(state)
    }
    return null
  }
  // Everything else (plain prose, a folded list-marker line, div body text, or
  // a fence/comment-looking line while a paragraph is open) leaves an open
  // paragraph that a following list marker or plain text folds into.
  //
  // And it CONTINUES the paragraph, so absorption survives it: `:::note` /
  // `body` / `:::` is one paragraph at the top level, and dropping the flag on
  // the prose line in between made the bare run open a real div here instead
  // (corpus 260). Absorption ends where the paragraph does, and every branch
  // that ends one returns above this point.
  state.mode = { kind: 'paragraph', absorbingFence: wasAbsorbing }

  return null
}

function parseBlockQuote(lexer: Lexer): BlockQuote | Figure {
  const firstLineIndex = lexer.pos
  const inner: string[] = []
  const innerLineNumbers: number[] = []
  const state: BlockQuoteLazyState = {
    mode: { kind: 'closed' },
    inTable: false,
    colonWidths: [],
    attrRun: null,
  }
  const fenceCloserMemo: QuotedFenceCloserMemo = new Map()
  while (!lexer.eof()) {
    const ln = lexer.peek()!
    const m = RE_BLOCKQUOTE.exec(ln)
    if (m) {
      const lineIndex = lexer.pos
      lexer.consume()
      const content = m[1] ?? ''
      inner.push(content)
      innerLineNumbers.push(lexer.lineNumber(lineIndex))
      trackBlockQuoteLazyState(
        content,
        state,
        (fence) => quotedCommentHasCloser(lexer, fence, lineIndex),
        (marker) => quotedFenceHasCloser(lexer, marker, lineIndex, fenceCloserMemo),
      )
      continue
    }
    // Continuation marker (Carve, PART 9 §17): a lone `+` at column 0 after a
    // quoted line attaches the FOLLOWING flush-left block to the quote -- the
    // un-prefixed analogue of the list-item form, so a real block (list, fenced
    // code, table, ...) can join the quote without repeating `>`. Collect the
    // block's lines (up to a blank line, a `>` line, or a further `+`) and
    // splice them into the quote body behind a blank-line separator, so they
    // parse as their own block instead of folding into the quoted paragraph.
    if (/^\+[ \t]*$/.test(ln)) {
      lexer.consume()
      // A blank line and a further `+` end the attached block - but neither
      // reaches inside a fence it opened, since a fence body is opaque to both
      // (corpus category 279).
      //
      // A `>` LINE IS NOT A BOUNDARY (§17 L3, markup-carve/carve#1782). The
      // marker takes the next flush-left block whatever KIND it is, and a
      // quote is a kind like any other: `> a` / `+` / `> q` attaches an inner
      // quote. Testing for one here made the marker attach NOTHING in exactly
      // that case, so the `+` line vanished and `> q` folded into the quoted
      // paragraph above it - the marker doing nothing at all, where L3 says it
      // only ever ATTACHES. A `>` line after an attached PARAGRAPH still ends
      // up outside the attachment, because the one-block narrowing below stops
      // at the paragraph.
      const { lines: attached, lineNumbers: attachedLineNumbers } = collectAttachedBlock(
        lexer,
        (next) => isBlankLine(next) || /^\+[ \t]*$/.test(next),
      )
      if (attached.length > 0) {
        // `inner` always holds the quote's first content line, so a leading
        // blank separates the attached block from it.
        // The separators are SYNTHETIC - no such blank line exists in the
        // source - so each borrows the line it sits against rather than the
        // `+` marker's. Borrowing the marker's put them BEFORE the attached
        // block in document order, and a block spanning first-to-last line then
        // reported an end offset earlier than its start (#462).
        inner.push('')
        innerLineNumbers.push(attachedLineNumbers[0]!)
        for (const attachedLine of attached) inner.push(attachedLine)
        innerLineNumbers.push(...attachedLineNumbers)
        inner.push('')
        innerLineNumbers.push(attachedLineNumbers[attachedLineNumbers.length - 1]!)
        // The attached block closed any open paragraph: a following unmarked
        // line no longer lazily continues the quote.
        closeBlockQuoteParagraph(state)
      }
      continue
    }
    // Lazy continuation: a non-`>` line folds into the quote ONLY when it is
    // plain text continuing an open paragraph (CommonMark-style; matches
    // carve-php). A blank line ends the quote. A block-opener that INTERRUPTS a
    // paragraph (§10) ends the quote too and starts that block OUTSIDE it --
    // this covers visible blocks (heading/quote/table/fence/div/thematic) and
    // the "invisible" reference/footnote/abbr definitions and comments. A bare
    // list marker is NOT a paragraph interrupter, so it FOLDS into the quoted
    // paragraph as literal text instead of ending the quote -- but ONLY when an
    // open paragraph precedes it (the `paragraphOpen` guard below). When the
    // last quoted block is a heading/table/fence/thematic break/div (no open
    // paragraph), a list marker has nothing to fold into and ENDS the quote,
    // mirroring the top level: `text\n- item` folds, `# h\n- item` is a heading
    // plus a sibling list. A caption `^ …` attaches to the quote.
    if (
      isBlankLine(ln) ||
      RE_CAPTION.test(ln) ||
      colonFenceShapeEndsLazyContinuation(ln) ||
      startsInterruptingBlock(lexer, undefined, false)
    ) {
      break
    }
    // A non-`>` line inside an open fence/comment, or after a block that left no
    // open paragraph (heading/table/fence/thematic/div), terminates the quote
    // instead of being swallowed. This is also what ends the quote on a lazy
    // list marker when no open paragraph precedes it.
    if (!blockQuoteParagraphOpen(state)) break
    const lineIndex = lexer.pos
    lexer.consume()
    const lazyLinkDef = isLinkDefLine(ln)
    if (lazyLinkDef) {
      lexer.literalLazyLinkDefLines.add(lexer.lineNumber(lineIndex))
    }
    inner.push(ln)
    innerLineNumbers.push(lexer.lineNumber(lineIndex))
    trackBlockQuoteLazyState(
      ln,
      state,
      (fence) => quotedCommentHasCloser(lexer, fence, lineIndex),
      (marker) => quotedFenceHasCloser(lexer, marker, lineIndex, fenceCloserMemo),
    )
  }
  const subLexer = nestedSubLexer(lexer, inner, firstLineIndex, innerLineNumbers)
  const children = parseBlocks(subLexer, 0)
  const bq: BlockQuote = { type: 'block_quote', children }
  const quoteEndIndex = lexer.pos
  // Optional caption with ^
  // Allow one blank line between
  let lookahead = 0
  while (!lexer.eof() && isBlankLine(lexer.peek(lookahead))) lookahead++
  const next = lexer.peek(lookahead)
  if (next) {
    const cap = RE_CAPTION.exec(next)
    // §4: a caption attaches only when it immediately follows the block
    // or is separated by at most ONE blank line.
    if (cap && lookahead <= 1) {
      for (let i = 0; i <= lookahead; i++) lexer.consume()
      attachBlockPos(lexer, bq, firstLineIndex, quoteEndIndex)
      return {
        type: 'figure',
        target: bq,
        caption: parseCaptionInline(lexer, cap[1]!),
      } as Figure
    }
  }
  return bq
}

/**
 * True when `line` is a standalone block image: `![…](…)` optionally followed
 * by a trailing attribute block that yields REAL attributes. An empty or
 * whitespace block (`{ }`) or an invalid one (`{=hl=}`) is not consumed — the
 * line falls through to a paragraph and the `{…}` renders literally, matching
 * the inline trailing-attribute rule (and carve-php).
 */
function isBlockImageLine(line: string): boolean {
  const m = RE_BARE_IMAGE.exec(line)
  // A trailing attr block must be a valid, non-empty payload; a digit-first /
  // invalid one (`{2=v}`) is literal (§14), so the line is NOT a bare block
  // image -- it falls back to a paragraph (inline image + literal braces).
  return (
    m !== null &&
    (m[5] === undefined || (isValidInlineAttrPayload(m[5]) && !isEmptyAttrs(parseAttrs(m[5]))))
  )
}

// A bare image line is parsed as a block image (or a figure) ONLY when it
// stands alone — the next line is blank / EOF, a `^ ` caption, or a paragraph
// interrupter (heading/quote/table/fence/div/thematic break). When the next
// line FOLDS instead (plain text, a list marker, another bare image), the image
// stays an inline image inside a paragraph with that content, per grammar
// §1722 I3 ("an image is not a block of its own; it stays inline in the
// paragraph") — a sole-image paragraph is still promoted to a bare block image
// afterwards (promoteBlockImages).
function imageIsBlock(lexer: Lexer): boolean {
  const next = lexer.peek(1)
  if (next === undefined || isBlankLine(next) || RE_CAPTION.test(next)) return true
  // Peek-1 interruption: advance past the image line, reuse the paragraph
  // interruption test, then rewind.
  const saved = lexer.pos
  lexer.pos++
  const interrupts = startsInterruptingBlock(lexer)
  lexer.pos = saved
  return interrupts
}

function parseBlockImage(lexer: Lexer): Image | Figure {
  const imageLineIndex = lexer.pos
  const line = lexer.consume()
  const m = RE_BARE_IMAGE.exec(line)!
  const img: Image = { type: 'image', src: m[2]!, alt: m[1]! }
  const title = m[3] ?? m[4]
  if (title !== undefined) img.title = title
  if (m[5]) img.attrs = parseAttrs(m[5])
  // Optional caption
  let lookahead = 0
  while (!lexer.eof() && isBlankLine(lexer.peek(lookahead))) lookahead++
  const next = lexer.peek(lookahead)
  if (next) {
    const cap = RE_CAPTION.exec(next)
    // §4: a caption attaches only when it immediately follows the block
    // or is separated by at most ONE blank line.
    if (cap && lookahead <= 1) {
      for (let i = 0; i <= lookahead; i++) lexer.consume()
      // The block loop attaches a span to whatever this returns, so a figure
      // gets one and its TARGET would be left without - PART 12 section 4 wants
      // one on every node but the root. The image occupies exactly its own line;
      // the figure spans that plus the caption.
      attachBlockPos(lexer, img, imageLineIndex, imageLineIndex + 1)
      return {
        type: 'figure',
        target: img,
        caption: parseCaptionInline(lexer, cap[1]!),
      } as Figure
    }
  }
  return img
}

/** The unordered/task bullet character (`-`, `*`, or `+`) of a line. */
function unorderedMarkerChar(line: string): string {
  return line.replace(/^\s*/, '').charAt(0)
}

function matchListMarker(
  line: string,
  isTask: boolean,
  isOrdered: boolean,
): RegExpExecArray | null {
  if (isTask) return RE_TASK.exec(line)
  if (isOrdered) {
    // An ordered list is not continued by a task or unordered marker.
    if (RE_TASK.test(line)) return null
    return RE_ORDERED.exec(line)
  }
  // Unordered: not continued by task or ordered markers.
  if (RE_TASK.test(line) || RE_ORDERED.test(line)) return null
  return RE_UNORDERED.exec(line)
}

// The visual content column of a list-marker line (`- x` -> 2, `1. x` -> 3,
// `- [ ] x` -> 6), or -1 if the line is not a list marker. Each marker regex
// captures the item content as its LAST group, so the content column is the
// column width of everything before that content. Used to decide, in the
// looseness scan, whether a line belongs to an item's sub-list (carve#322).
function markerContentColumn(line: string): number {
  // Mirror parseList's own content-column computation so the looseness scan
  // uses the SAME threshold the recursive sub-list parse uses -- including the
  // task convention (content column is base + 2, the bullet width, NOT the
  // `- [ ] ` checkbox width) and an abutting `{...}` attribute (stripped first).
  const la = extractItemAttr(line)
  const mline = la ? la.stripped : line
  const base = indentColumns(line)
  if (RE_TASK.test(mline)) return base + 2 + (la ? line.length - mline.length : 0)
  const m = RE_ORDERED.exec(mline) ?? RE_UNORDERED.exec(mline)
  if (!m) return -1
  const content = m[m.length - 1]!
  return base + (line.length - leadingWhitespace(line) - content.length)
}

// Ordered-list dialect, fixed by the first item's marker.
type OlKind = 'dec' | 'alo' | 'aup' | 'rlo' | 'rup'

function romanToInt(s: string): number {
  const map: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 }
  const t = s.toLowerCase()
  let total = 0
  for (let k = 0; k < t.length; k++) {
    const cur = map[t[k]!]!
    const nxt = map[t[k + 1]!] ?? 0
    total += cur < nxt ? -cur : cur
  }
  return total
}

// Does `marker` belong to dialect `kind`? Used to continue a list (a
// marker outside the dialect ends it, §11).
function olKindMatches(marker: string, kind: OlKind): boolean {
  switch (kind) {
    case 'dec':
      // `*` not `+`: the bare-dot marker (empty value, carve#315) is decimal
      // too, so it continues an explicit decimal-dot list and vice versa.
      return /^[0-9]*$/.test(marker)
    case 'alo':
      return /^[a-z]$/.test(marker)
    case 'aup':
      return /^[A-Z]$/.test(marker)
    case 'rlo':
      return /^[ivxlcdm]+$/.test(marker)
    case 'rup':
      return /^[IVXLCDM]+$/.test(marker)
  }
}

// Classify the FIRST marker, which fixes the list dialect. A single
// ambiguous roman letter (i/v/x/l/c/d/m) is roman when the next sibling
// marker is roman of the same case, or when it is `i`/`I` (the common
// roman start); any other single letter is alphabetic.
function olKindOf(marker: string, nextMarker: string | null): OlKind {
  // The bare dot has no value to classify: it is decimal by definition.
  if (marker === '') return 'dec'
  if (/^[0-9]+$/.test(marker)) return 'dec'
  const upper = marker === marker.toUpperCase()
  const romanChars = /^[ivxlcdm]+$/i.test(marker)
  if (romanChars && marker.length > 1) return upper ? 'rup' : 'rlo'
  if (romanChars) {
    // Single ambiguous letter (i/v/x/l/c/d/m): tie-break on the next
    // sibling. `c. d.` is alpha (consecutive letters) while `iv. v.` /
    // `i. ii.` is roman (consecutive roman). A lone `i`/`I` defaults to
    // roman (the canonical roman start); other lone letters are alpha.
    if (nextMarker !== null && (nextMarker === nextMarker.toUpperCase()) === upper) {
      if (
        /^[ivxlcdm]+$/i.test(nextMarker) &&
        romanToInt(nextMarker) === romanToInt(marker) + 1
      ) {
        return upper ? 'rup' : 'rlo'
      }
      if (
        /^[a-z]$/i.test(nextMarker) &&
        nextMarker.toLowerCase().charCodeAt(0) === marker.toLowerCase().charCodeAt(0) + 1
      ) {
        return upper ? 'aup' : 'alo'
      }
    }
    if (marker.toLowerCase() === 'i') return upper ? 'rup' : 'rlo'
  }
  return upper ? 'aup' : 'alo'
}

function olStartOf(marker: string, kind: OlKind): number {
  if (kind === 'dec') {
    // The bare dot carries no number, so it starts at 1 and the `<ol>` omits
    // `start`. Setting a start is exactly what the explicit `1.` form is for.
    const n = parseInt(marker, 10)
    return Number.isNaN(n) ? 1 : n
  }
  if (kind === 'rlo' || kind === 'rup') return romanToInt(marker)
  return marker.toLowerCase().charCodeAt(0) - 96 // a=1
}

function olTypeOf(kind: OlKind): '' | 'a' | 'A' | 'i' | 'I' {
  return kind === 'dec'
    ? ''
    : kind === 'alo'
      ? 'a'
      : kind === 'aup'
        ? 'A'
        : kind === 'rlo'
          ? 'i'
          : 'I'
}

// A line continues an ordered list of `kind`/`delim` (same dialect + same
// `.`/`)` delimiter).
function orderedContinues(line: string, kind: OlKind, delim: string): boolean {
  const o = RE_ORDERED.exec(line)
  return o !== null && o[3]! === delim && olKindMatches(o[2]!, kind)
}

/**
 * A non-indented line following a list item is lazy continuation (folds into the
 * item's paragraph) UNLESS it starts a block, in which case the list ends - the
 * djot/CommonMark lazy-continuation rule. Mirrors the block dispatch in
 * `parseBlock`, minus the `%%` inline comment (which is paragraph text, not a
 * block) and the paragraph fallthrough.
 */
/**
 * Does this line OPEN a block (vs being plain prose)? Used by the compact-list
 * rule: a blank line inside a list item loosens the list only when the content
 * after it is a plain paragraph; a blank followed by a block opener keeps the
 * item tight. Lexer-free (no `:::` closer lookahead — for the loose decision a
 * `:::`-shaped opener counts as a block regardless).
 */
/**
 * A ONE-LINE construct that renders nothing: a line comment or a reference /
 * footnote definition (§17 L1's "not a paragraph" set, carve#621).
 *
 * Used for looseness only, and deliberately single-line. A comment BLOCK is
 * invisible too, but `lineOpensBlock` already claims its `%%%` opener, and
 * skipping past that opener would land the scan on the block's BODY - ordinary
 * text - and loosen the item on content the reader never sees.
 *
 * `RE_ABBR_DEF` is not in the set: a definition inside a container is no longer
 * recognized as one, so the line renders as text and is genuinely visible.
 */
function isInvisibleLine(line: string): boolean {
  const l = line.replace(/^[ \t]+/, '')
  // `RE_COMMENT_LINE` matches a `%%%` opener too, so exclude the block form
  // explicitly - skipping it lands the scan on the block's BODY.
  if (RE_COMMENT_BLOCK.test(l)) return false
  if (RE_COMMENT_LINE.test(l)) return true
  if (indentColumns(line, 1) === 0 && (isLinkDefLine(l) || RE_FOOTNOTE_DEF.test(l))) return true

  // A bare attribute line renders nothing either, but unlike the others it is
  // COLUMN-STRICT (§15): it opens only AT its container's content column, and
  // one column further in it is literal paragraph text that really does render
  // `<p>{.c}</p>`. These lines arrive dedented to that column, so the test is
  // column 0 - without it the exemption would swallow a visible paragraph.
  //
  // `extractItemAttr` would not do here: it needs a MARKER before the braces,
  // so it never matches a standalone `{.c}` - a check that could not fire.
  return indentColumns(line, 1) === 0 && isBlockAttributeLine(l)
}

function lineOpensBlock(line: string): boolean {
  return (
    RE_RAW_FENCE.test(line) ||
    RE_FENCE.test(line) ||
    RE_COMMENT_BLOCK.test(line) ||
    // No RE_ABBR_DEF: these lines are item content, never document level.
    //
    // The other two definition kinds are COLUMN-STRICT, like the attribute line
    // below: collected only AT the container's content column, and one column
    // further in they are not definitions at all - they render as ordinary text
    // and open nothing. Testing the shape at any indent made an indented
    // `[^f]: n` "open a block", so the looseness scan stopped short of the real
    // second paragraph and left the item TIGHT where carve-php and carve-rs
    // leave it loose (carve-js#976). `isLinkDefLine` is what actually fired:
    // the anchored footnote pattern rejects the leading space, but a link
    // definition reads `[^f]: n` as label `^f` - which is why the two are
    // ordered as they are a few lines up.
    (indentColumns(line, 1) === 0 && (RE_FOOTNOTE_DEF.test(line) || isLinkDefLine(line))) ||
    RE_HR.test(line) ||
    RE_HEADING.test(line) ||
    RE_DEFLIST_TERM.test(line) ||
    RE_BLOCKQUOTE.test(line) ||
    RE_TASK.test(line) ||
    RE_UNORDERED.test(line) ||
    RE_ORDERED.test(line) ||
    extractItemAttr(line) !== null ||
    isTableRow(line) ||
    (RE_ADMONITION_OPEN.test(line) && !RE_ADMONITION_CLOSE.test(line)) ||
    RE_DIV_OPEN.test(line) ||
    RE_LINE_BLOCK_OPEN.test(line) ||
    RE_HARDBREAKS_OPEN.test(line) ||
    RE_QUOTE_BLOCK_OPEN.test(line)
  )
}

function lazyContinuationEndsList(line: string, lexer: Lexer): boolean {
  // A VERBATIM fence ends the fold only WITH a closer ahead (§10 I4): an
  // unterminated ``` is not a code block, it is an inline verbatim run that
  // belongs to the item's paragraph. Without this the item was closed and the
  // fence became a top-level code block, which the top-level path already got
  // right (corpus 81-paragraph-interruption-18) and carve-rs got right
  // everywhere (carve-js#540).
  //
  // The `:::` arms below stay lexer-free deliberately - I4 does not guard a
  // colon fence (markup-carve/carve#514), and the comment there gives the
  // separate reason.
  if (RE_RAW_FENCE.test(line)) return fenceHasCloser(lexer, RE_RAW_FENCE.exec(line)![1]!)
  if (RE_FENCE.test(line)) return fenceHasCloser(lexer, RE_FENCE.exec(line)![2]!)
  return (
    RE_COMMENT_BLOCK.test(line) ||
    // A flush-left colon-fence shaped line ends list lazy continuation
    // regardless of outer-stream closer lookahead. If the line belongs to the
    // item, it must be indented and parsed by the item sub-lexer; otherwise a
    // later flush-left `:::` can be incorrectly pulled in as the item's closer.
    (RE_ADMONITION_OPEN.test(line) && !RE_ADMONITION_CLOSE.test(line)) ||
    RE_DIV_OPEN.test(line) ||
    RE_LINE_BLOCK_OPEN.test(line) ||
    RE_HARDBREAKS_OPEN.test(line) ||
    RE_QUOTE_BLOCK_OPEN.test(line) ||
    // No RE_ABBR_DEF: a lazy line is item content, so the definition form is
    // not recognized and the line folds into the item as text.
    //
    // The other two are gated on the line being FLUSH, which is what every
    // other predicate here gets for free from its own anchor. RE_LINK_DEF is
    // deliberately whitespace-tolerant - other passes need it to recognize a
    // quoted or nested def - and its leading class is "whitespace except NBSP",
    // so it matches a leading SPACE. Unguarded, that made a definition ONE
    // COLUMN IN end the fold, where a heading, quote, table row, colon fence or
    // bullet in the same position folds as text (PART 1 S4). It also swallowed
    // the footnote form, since `[^f]: x` has the link-def shape too, which is
    // why the flush-anchored RE_FOOTNOTE_DEF above never had to match for the
    // footnote case to break. A definition opens only AT its container's
    // content column - the same strict rule `parseBlockInner` applies
    // (carve-js#597).
    (leadingWhitespace(line) === 0 && (RE_FOOTNOTE_DEF.test(line) || isLinkDefLine(line))) ||
    RE_HR.test(line) ||
    RE_HEADING.test(line) ||
    // A caption line (`^ …`) ends the item's lazy continuation rather than
    // folding in, matching carve-php / carve-rs (a caption is a heading/figure
    // terminator, not plain prose the item absorbs).
    RE_CAPTION.test(line) ||
    // A BLOCK-ATTRIBUTE LINE ENDS THE FOLD (PART 9 §10 I5, markup-carve/carve#1028).
    // I5 makes the invisible constructs interrupters - "a reference definition
    // ..., a comment ..., and a block-attribute line (`{…}` alone on a line,
    // §15)" - and I6 applies the relation to EVERY open paragraph, an item's
    // included. Two arms above already carry the other two invisible kinds; this
    // one was missing, so `- item` / `{.cls}` / `> quote` folded the attribute
    // line INTO the item, where it had no following block to float onto and was
    // dropped as dangling. The author's attribute reached neither the `<li>` nor
    // the quote and rendered nowhere, which is the shape PART 2's LIST-ITEM
    // ATTRIBUTES clause names and REJECTS by engine: "a trailing `{…}` line
    // folded onto a tight item, which carve-php attached to the `<li>` and
    // carve-js dropped".
    //
    // The lexer is positioned on this line, so the multi-line form (§15 A5) is
    // recognized here exactly as `startsInterruptingBlock` recognizes it, rather
    // than by a single-line spelling that would answer differently one column in.
    peekBlockAttributes(lexer) ||
    RE_DEFLIST_TERM.test(line) ||
    RE_BLOCKQUOTE.test(line) ||
    RE_TASK.test(line) ||
    RE_UNORDERED.test(line) ||
    RE_ORDERED.test(line) ||
    extractItemAttr(line) !== null ||
    isTableRow(line)
  )
}

function colonFenceShapeEndsLazyContinuation(line: string): boolean {
  return (
    (RE_ADMONITION_OPEN.test(line) && !RE_ADMONITION_CLOSE.test(line)) ||
    RE_DIV_OPEN.test(line) ||
    RE_LINE_BLOCK_OPEN.test(line) ||
    RE_HARDBREAKS_OPEN.test(line) ||
    RE_QUOTE_BLOCK_OPEN.test(line)
  )
}

function isLiteralColonFenceLine(line: string): boolean {
  line = line.replace(/^[ \t]+/, '')
  return (
    /^:{3,}/.test(line) &&
    !RE_ADMONITION_CLOSE.test(line) &&
    !(RE_ADMONITION_OPEN.test(line) && !RE_ADMONITION_CLOSE.test(line)) &&
    !RE_DIV_OPEN.test(line) &&
    !RE_LINE_BLOCK_OPEN.test(line) &&
    !RE_HARDBREAKS_OPEN.test(line) &&
    !RE_QUOTE_BLOCK_OPEN.test(line)
  )
}

interface ItemLazyState {
  inFence: boolean
  fenceClose: RegExp | null
  inComment: boolean
  commentLen: number
  // `lazyFoldable` as it stood when the comment block opened. A comment renders
  // NOTHING, so closing one may not change whether the item ends in an open
  // paragraph - it has to restore what was there before the fence.
  lazyFoldableBeforeComment: boolean
  /**
   * Did the open comment fence start AT the container's content column?
   *
   * A fence at the column is a BLOCK, so the paragraph it interrupted does not
   * come back when it closes; one collected below the column adds no block, and
   * the paragraph above it is still open when the run ends.
   */
  openedCommentAtColumn: boolean
  // Whether the item's collected content currently ends in an OPEN paragraph
  // that a dedented (below content-column) non-blank line lazily continues
  // (CommonMark family-D rule). True after plain prose, a blockquote line, or
  // plain text inside an open div/admonition; false after a code fence, table,
  // heading, thematic break, a just-opened div, or a blank line.
  lazyFoldable: boolean
  /**
   * Did the line before this one leave a table open?
   *
   * A CONTINUATION ROW IS MORE TABLE, and only where a table is above it
   * (markup-carve/carve#1349). It carries no leading pipe, so `isTableRow` does
   * not see it, and an item whose table ended on one reported an open paragraph
   * its table did not have. With no row above, `- a` / `  + b |` is a paragraph
   * and its `+ b |` is prose, so a dedented line still folds in.
   */
  inTable: boolean
  /**
   * Did the item's last block render nothing, written AT the content column?
   *
   * An invisible line at the column ends the PARAGRAPH, not the container
   * (markup-carve/carve#1364). Those are two answers and this tracker gave one
   * flag for both, so closing the paragraph also ended the item and a
   * below-column line that belongs to it came out at the top level (corpus 197,
   * 277-3, 358). The container still ends at document column 0, which is what
   * the ruling says and what separates 358 from 357-2.
   */
  invisibleAtColumn: boolean
  /** Only comments keep §24 C3's nonzero below-column path open. */
  commentAtColumn: boolean
  /**
   * Is the tracker inside a footnote definition's body?
   *
   * A FOOTNOTE DEFINITION'S BLOCK RUNS TO THE END OF ITS BODY, blank lines and
   * all (markup-carve/carve#1363, PART 1 S4). Its continuation lines are the
   * definition's, not the container's, so none of them reopens a paragraph for a
   * column-0 line to continue. A LINK reference definition has no body and must
   * not open a run - it is the control the ruling names, and the one an
   * over-wide fix breaks.
   */
  inFootnoteBody: boolean
  /**
   * The tracker for the quote this item currently ends on, or null.
   *
   * PART 1 S4 is about the open STACK, so what the ITEM ends on may be several
   * quotes down: `:  > | a |` / `   > + b |` ends on a table, not on a quoted
   * paragraph. Carried across the item's lines for the same reason the quote's
   * own nested tracker is - a quoted table spanning two of them is one table.
   */
  quoteInner: BlockQuoteLazyState | null
  // Whether the item currently has an OPEN definition list (a `:: term` or
  // `:  def` marker was the last structural line, possibly across a separator
  // blank). Used so an UNDER-indented (below content-column) def/term marker
  // line re-aligns to the term instead of folding as lazy prose: rs/php attach
  // an under-indented `:  def` as a `<dd>`, and carve-js must match (decision
  // D, "lenient - still a definition"). An OVER-indented marker still folds
  // (it reaches the item via sliceColumns, not this lazy path).
  inDefList: boolean
  // Whether the item's open paragraph has absorbed a MALFORMED colon fence and
  // is therefore taking the next fence-shaped line as text too (PART 9 §12,
  // "a colon-fence line that fails the opener test leaves the paragraph
  // expecting a closer"). The block layer has implemented that rule at top
  // level for a long time; this tracker did not, so it read the trailing `:::`
  // of `- item` / `  :::note` / `  body` / `  :::` as a div opener and closed
  // the item, where PART 1 S4 folds the following flush-left line into the
  // paragraph that was never interrupted (carve#891).
  absorbingFence: boolean
  // How many colon-fence containers the item's own content currently holds
  // open. A bare `:::` with one open is that container's CLOSER, not an opener
  // and not absorbable text - which is why a malformed fence INSIDE an open
  // container arms nothing: the closer below it still has a container to close.
  divDepth: number
  // The lines so far of a `{…}` block-attribute block that has not closed yet,
  // newline-joined, or null when the tracker is not inside one. §15 A5 lets the
  // block WRAP, so the tracker has to hold it open the way it holds a fence
  // open - otherwise `{.k` / `#x}` reads as two lines of prose and the container
  // keeps a paragraph nothing opened (markup-carve/carve#1281).
  attrRun: string | null
}

/**
 * A BOUNDARY LINE INSIDE AN OPEN FENCE DOES NOT END THE CONTAINER
 * (markup-carve/carve#983, corpus category 279), for the INDENTED body of a
 * list item, whose model is the running tracker rather than a block extent.
 *
 * The three fence kinds - code/raw, colon (`:::`), comment (`%%%`) - all make
 * their body opaque, so a line that would otherwise be read as structure is
 * body text instead. Which lines those are is the container's question; whether
 * a fence is open is NOT, and is answered here.
 *
 * Two of the three were spelled out at the one site that consulted any fence
 * state at all, and the colon depth the tracker already keeps was not, so a
 * `:::` body severed on a marker where a code fence's body did not.
 */
function insideOpenFence(state: ItemLazyState): boolean {
  return state.inFence || state.inComment || state.divDepth > 0
}

/**
 * Does the item currently end on a BLOCK QUOTE WITH AN OPEN PARAGRAPH?
 *
 * A line at the item's content column that does not carry the quote's marker is
 * that paragraph's lazy continuation, and `parseBlockQuote` already reads it
 * that way: "a bare list marker is NOT a paragraph interrupter, so it FOLDS into
 * the quoted paragraph as literal text - but ONLY when an open paragraph
 * precedes it". At the top level `> q` / `- s` is one quoted paragraph in this
 * engine already.
 *
 * The item's own collector asked a different question, and only about the line:
 * it split its stream at the first marker-shaped line, so `- > q` / `  - s`
 * ended the quote and opened a sub-list where every other reader keeps the text
 * (carve-js#1200). That is the same derivation `insideOpenFence` above carries
 * for the three opaque bodies - PART 9 §24 S1 and S2 place a line by the COLUMN
 * it reaches and never read its first character - so the marker test asks what
 * is open rather than what the line looks like.
 *
 * It is the QUOTE'S paragraph, not the item's: `lazyFoldable` is true after a
 * quoted line whether or not that quote still has a paragraph, and `- > # h` /
 * `  - s` really does open a sub-list, because a heading left the quote with no
 * paragraph for the marker to fold into.
 */
function insideOpenQuoteParagraph(state: ItemLazyState): boolean {
  return state.quoteInner !== null && blockQuoteParagraphOpen(state.quoteInner)
}

/**
 * A lookahead over the lines an attached block may hold, already in the form
 * the block will be parsed in.
 *
 * `at(offset)` is relative to the lexer's current position; `base` is the line
 * index that offset 0 sits at, so a refutation from `index` (which is keyed by
 * line index) can be asked about an offset.
 */
interface AttachedScan {
  at: (offset: number) => string | undefined
  index: CloserIndex
  base: number
}

/**
 * The offset of the CLOSER of a code, raw or comment fence opened at `i`, or
 * -1 when that line opens no such fence or the fence never closes.
 *
 * A code/raw fence and a comment fence are OPAQUE: everything between opener
 * and closer is content, so a colon fence written inside one closes nothing
 * and opens nothing (the reason `findColonCloser` skips these spans whole).
 */
function opaqueSpanEnd(scan: AttachedScan, i: number): number {
  const line = scan.at(i)
  if (line === undefined) return -1
  const fence = RE_FENCE.exec(line)
  const rawFence = fence ? null : RE_RAW_FENCE.exec(line)
  const marker = fence ? fence[2]! : rawFence ? rawFence[1]! : null
  if (marker !== null) {
    // Refuted in O(log n) when nothing ahead can close this run, which is what
    // keeps a run of unterminated openers from re-reading the same suffix once
    // per opener.
    if (!codeCloserPossible(scan.index, marker, scan.base + i)) return -1
    const closeRe = fenceCloseRe(marker)
    for (let j = i + 1; ; j++) {
      const candidate = scan.at(j)
      if (candidate === undefined) return -1
      if (closeRe.test(candidate)) return j
    }
  }
  const run = commentFenceRun(line)
  if (run === undefined) return -1
  if (!exactCloserPossible(scan.index.comment, run, scan.base + i)) return -1
  for (let j = i + 1; ; j++) {
    const candidate = scan.at(j)
    if (candidate === undefined) return -1
    // EXACT length, per PART 9 §28: a longer opener nests shorter fences.
    if (commentFenceRun(candidate) === run) return j
  }
}

/** The `:` run length of a line that OPENS a colon-fence block, else null. */
function colonBlockOpenerRun(line: string): number | null {
  const m =
    (RE_ADMONITION_CLOSE.test(line) ? null : RE_ADMONITION_OPEN.exec(line)) ??
    RE_LINE_BLOCK_OPEN.exec(line) ??
    RE_HARDBREAKS_OPEN.exec(line) ??
    RE_QUOTE_BLOCK_OPEN.exec(line) ??
    RE_DIV_OPEN.exec(line)

  return m ? m[1]!.length : null
}

/**
 * The offset of the closer of a colon fence of width `len` opened at `openIdx`,
 * or -1 when it never closes. Colon fences close on an EXACT length match
 * (carve#455), so the widths in flight are a stack rather than a depth count.
 */
function findColonCloser(scan: AttachedScan, openIdx: number, len: number): number {
  // The OUTERMOST width has to reappear for the stack to empty, so nothing
  // ahead carrying it refutes the whole scan before it starts.
  if (!exactCloserPossible(scan.index.colon, len, scan.base + openIdx)) return -1
  const stack = [len]
  for (let j = openIdx + 1; ; j++) {
    const line = scan.at(j)
    if (line === undefined) return -1
    // Skipped from the line AFTER its opener: an opener with no info string is
    // closer-shaped itself and would otherwise end the span where it began.
    const span = opaqueSpanEnd(scan, j)
    if (span !== -1) {
      j = span
      continue
    }
    const close = RE_ADMONITION_CLOSE.exec(line)
    if (close) {
      const closeLen = close[1]!.length
      if (closeLen === stack[stack.length - 1]) {
        stack.pop()
        if (stack.length === 0) return j
      } else {
        stack.push(closeLen)
      }
      continue
    }
    const open = colonBlockOpenerRun(line)
    if (open !== null) stack.push(open)
  }
}

/**
 * The offset of the last line of the fenced block a `+` attaches, or -1 when
 * the attached block does not open with a fence that closes.
 *
 * ONE HELPER, THREE FENCE KINDS. Code/raw, comment and colon all make their
 * body opaque, and which lines could otherwise end the block is the CONTAINER's
 * question, layered on by `collectAttachedBlock` as `isBoundary`.
 */
function fencedBlockEnd(scan: AttachedScan): number {
  const opaque = opaqueSpanEnd(scan, 0)
  if (opaque !== -1) return opaque
  const first = scan.at(0)
  if (first === undefined) return -1
  const run = colonBlockOpenerRun(first)
  if (run !== null) {
    const close = findColonCloser(scan, 0, run)
    if (close !== -1) return close
  }

  return -1
}

/**
 * Collect the ONE flush-left block a `+` continuation marker attaches
 * (PART 9 §17 L3/L4).
 *
 * A BOUNDARY LINE INSIDE AN OPEN FENCE DOES NOT END THE CONTAINER
 * (markup-carve/carve#983, corpus category 279). L3 bounds the attachment "up
 * to the next blank line, sibling marker, or a further `+`", and those bound
 * THE BLOCK: a fenced block ends at its closer, which is what makes it one
 * block, so a boundary line written between an opener and its closer is fence
 * content and ends nothing. Reading the blank as reaching INSIDE the fence
 * makes "fenced code" unattachable the moment its body holds one, which is the
 * kind L3 goes out of its way to name.
 *
 * ONE SPELLING FOR EVERY CONTAINER. This ran as five separate loops - a list
 * item's two `+` paths, a block quote's, a footnote body's and a definition
 * body's two - and none consulted a fence at all, so every container severed,
 * each on its own boundary set. `isBoundary` is the only per-container part;
 * the fence rule is not.
 *
 * An UNTERMINATED fence is left where it was: with no closer there is no fenced
 * block to run through, so the scan falls back to the boundary set. No clause
 * names the unterminated case for an attached block and this does not invent
 * one.
 *
 * `isBoundary` sees the RAW line, because a caller measuring indentation has to
 * see what the author wrote; `transform` produces the line that is collected
 * and that the fence scan reads, which is how the list paths hand over their
 * content-column-dedented form.
 */
/**
 * How many of the `limit` lines at the lexer's position the ONE block a `+`
 * attaches actually occupies (§17 L3).
 *
 * At least one line, always: a probe that consumed nothing would leave the
 * caller's cursor where it was and the container loop would see the same line
 * forever.
 *
 * A LEADING ATTRIBUTE RUN IS PART OF THE BLOCK IT FLOATS ONTO. Only
 * `parseBlocks` owns a pending-attribute slot and this is a `parseBlock` call,
 * so an attribute line left to it reads as a paragraph and the measurement stops
 * in front of the block the attributes were written for.
 */
function attachedBlockExtent(
  lexer: Lexer,
  limit: number,
  transform?: (line: string) => string,
): number {
  if (limit <= 1) return limit
  const lines: string[] = []
  for (let k = 0; k < limit; k++) {
    const line = lexer.peek(k)!
    lines.push(transform ? transform(line) : line)
  }
  const probe = subLexer(lines, lexer.parseOptions, 0)
  probe.nested = true
  probe.suppressPositions = true
  // The depth the block is really parsed at. `MAX_NESTING_DEPTH` turns every
  // line into literal paragraph text once it is reached, so a probe left at 0
  // would measure a construct the real parse never builds. Stated as alignment,
  // not as a fix: no document was found where it changes the answer, because at
  // those depths a `+` has already stopped acting as a continuation marker.
  probe.depth = lexer.depth + 1
  // NO EXTENSION MATCHER RUNS FOR A MEASUREMENT. `matchBlock` and `matchInline`
  // are public callbacks and nothing requires them to be pure: one allocating
  // sequential ids would number its first authored block 2, because the probe
  // called it once for a parse whose result is thrown away. The probe only needs
  // to know where a block ENDS, and an extension block ends where the core
  // parser's fallback for those same lines ends.
  const matchers = activeMatchers
  activeMatchers = []
  try {
    // A LEADING ATTRIBUTE RUN IS PART OF THE BLOCK IT FLOATS ONTO, and so is
    // whatever INVISIBLE construct sits between them. Only `parseBlocks` owns a
    // pending-attribute slot, and §15 A2a keeps that slot across a comment or a
    // reference, footnote or abbreviation definition - so a probe that stopped
    // at the first node would stop in front of the block the attributes were
    // written for and leave it outside the container, attributes dropped.
    for (;;) {
      while (!probe.eof() && tryCollectBlockAttributes(probe) !== null) {
        /* the run floats forward; keep looking for what it floats onto */
      }
      if (probe.eof()) return limit
      const node = parseBlock(probe)
      const invisible =
        node === null || node.type === 'abbreviation_def' || node.type === 'comment'
      if (!invisible || probe.eof()) break
    }
  } finally {
    activeMatchers = matchers
  }

  return Math.min(Math.max(probe.pos, 1), limit)
}

/**
 * §17 L3: does the marker's candidate block begin at DOCUMENT column 0?
 *
 * "Flush-left" is the reach, not a description of the usual case: a line at any
 * other column is not attached at all, and falls through to the ordinary column
 * rules that give it to whichever container its own column names
 * (markup-carve/carve#1436).
 *
 * Asked of the ORIGINAL line, because the view is dedented - see `rootLines`.
 * A quote prefix is stripped first: inside a quote the marker's column 0 is the
 * quote's content column, which is what the executable spec measures there too.
 *
 * Returns TRUE when the answer cannot be recovered, so a synthetic or
 * reassembled line keeps the behavior it had rather than silently losing its
 * attachment.
 */
function attachesAtDocumentColumnZero(lexer: Lexer): boolean {
  const root = lexer.rootLines
  if (!root) return true
  const line = root[lexer.lineNumber(lexer.pos) - 1]
  if (line === undefined) return true
  let rest = line
  for (;;) {
    const m = /^[ \t]*>[ \t]?/.exec(rest)
    if (!m) break
    rest = rest.slice(m[0].length)
  }
  return leadingWhitespace(rest) === 0
}

function collectAttachedBlock(
  lexer: Lexer,
  isBoundary: (line: string) => boolean,
  transform?: (line: string) => string,
): { lines: string[]; lineNumbers: number[]; startLineIndex: number } {
  const fenced = fencedBlockEnd({
    at: (offset) => {
      const line = lexer.peek(offset)
      return line === undefined ? undefined : transform ? transform(line) : line
    },
    index: closerIndex(lexer),
    base: lexer.pos,
  })
  let take = 0
  if (fenced !== -1) {
    take = fenced + 1
  } else {
    while (lexer.peek(take) !== undefined && !isBoundary(lexer.peek(take)!)) take++
    // ...AND ONE BLOCK IS WHERE THAT BLOCK ENDS. §17 L3 says it in capitals: a
    // `+` attaches "the FOLLOWING flush-left block to that container - ONE block
    // of ANY kind". The trailing "up to the next blank line, sibling marker, or
    // a further `+`" is the EXTENT of that one block, not a second thing the
    // attachment is (markup-carve/carve#1290). The boundary scan above finds the
    // outer limit; inside it the marker still takes only the first block, so
    // `- a` / `+` / `para` / `> q` leaves the quote OUTSIDE the item and a
    // second block costs a second marker.
    //
    // Measured by RE-PARSING rather than by a second line scan, so there is one
    // definition of where a block ends: a scan would be a copy of the block
    // grammar that could drift from it silently. A self-delimiting block never
    // reaches here - `fencedBlockEnd` above reads its closer from the lines,
    // which is also what keeps a deeply nested attachment affordable.
    const measured = attachedBlockExtent(lexer, take, transform)
    if (measured < take) take = measured
  }
  const startLineIndex = lexer.pos
  const lines: string[] = []
  const lineNumbers: number[] = []
  for (let k = 0; k < take; k++) {
    const raw = lexer.peek()!
    lines.push(transform ? transform(raw) : raw)
    lineNumbers.push(lexer.lineNumber(lexer.pos))
    lexer.consume()
  }

  return { lines, lineNumbers, startLineIndex }
}

/**
 * Track verbatim/paragraph state across a list item's collected inner lines so a
 * dedented non-blank line only lazily continues an OPEN paragraph (the
 * djot/CommonMark family-D rule, matching carve-php). Each line is passed in its
 * content-column-dedented form so the block-opener regexes key off column 0.
 *
 * Mirrors `trackBlockQuoteLazyState`, but a blockquote line (`>`) keeps the
 * fold open: the trailing quote paragraph absorbs the dedented line in the
 * quote's own lazy continuation. After a code fence or a table (no open
 * trailing paragraph) the dedented line must END the item instead.
 */

/**
 * A `{…}` line that is a block-attribute line rather than paragraph text.
 *
 * Recognition mirrors `tryCollectBlockAttributes` for the SINGLE-LINE form,
 * which is all this caller can see: it is handed one dedented item line at a
 * time, so a block whose `}` arrives on a later line (§15 A5) reads as ordinary
 * text here. That errs toward the old answer (the item stays open), never
 * toward closing an item the author kept open.
 */
function isBlockAttributeLine(content: string): boolean {
  if (!content.startsWith('{') || !content.includes('}')) return false
  return parseBlockAttributeRun(content) !== null
}

/**
 * How much of the line each prefix step reads before it widens.
 *
 * Large enough that an ordinary marker - indent, marker, task box, space run -
 * is decided in one window, small enough that the per-step copy is a constant
 * rather than the tail it replaced.
 */
const PREFIX_WINDOW = 32

/**
 * The one character any of the three invisible blocks can open with.
 *
 * CHEAP FIRST, because this runs on every line an item collects. `isLinkDefLine`
 * splits a trailing attribute block off the line before it tests, which makes it
 * the most expensive predicate in the tracker - putting it on the path of every
 * ordinary prose line cost about 3x on a deeply-indented staircase, and the
 * scaling guard caught it at 2.28x per byte against a 2.0 threshold.
 *
 * A strict superset, so it decides nothing: both definition forms open with `[`
 * after optional indentation and a comment with `%`, and `splitTrailingAttrBlock`
 * only removes a TRAILING block, so it cannot change the leading character.
 */
const RE_INVISIBLE_BLOCK_LEAD = /^[ \t]*[%[]/

/**
 * The line the prefix walk may read, as an END OFFSET.
 *
 * Every regex the walk consults is anchored with `$` and matches `.`, which
 * excludes U+000A - so none of them can match across a newline, and the walk
 * must not window past one either. Taken ONCE, because a per-step `indexOf`
 * would be the same linear read the windowing exists to remove.
 *
 * The newline itself is INSIDE the bound. `- \n` is a marker whose content is
 * the newline (`[^ \t]` admits it, and `$` is then satisfied), so a bound that
 * stopped one character earlier would decline a strip the regex makes.
 */
function prefixWalkBound(content: string): number {
  const nl = content.indexOf('\n')

  return nl === -1 ? content.length : nl + 1
}

/**
 * The length of the block quote marker at `from`, or 0 when there is none.
 *
 * `RE_BLOCKQUOTE` takes `>` plus at most one space, so a two-character window
 * already decides it; the window is only ever short when the line itself is,
 * and `>` alone at the end of the line consumes the whole remainder exactly as
 * `quoted[1] ?? ''` did.
 */
function quotePrefixLength(content: string, from: number, bound: number): number {
  const window = content.slice(from, Math.min(from + PREFIX_WINDOW, bound))
  const quoted = RE_BLOCKQUOTE.exec(window)
  if (!quoted) return 0

  return window.length - (quoted[1]?.length ?? 0)
}

/**
 * The length of the list item marker at `from`, or 0 when there is none.
 *
 * Asked of a WINDOW, and widened until it answers. A marker's own head is
 * short, but its indent, its space run and its abutting attribute block are
 * not bounded, so a fixed window would decline a marker it merely could not
 * see. Doubling costs the prefix twice over at worst, and every widened window
 * is charged to characters the walk then consumes, so the walk stays linear in
 * the line.
 *
 * A truncated window cannot INVENT a marker: each pattern's trailing group is
 * `([^ \t].*)$`, so cutting the tail short only shortens that group, and the
 * marker length is read as what the window does NOT leave to it. It can only
 * hide one, which is what the widening answers.
 */
function markerPrefixLength(content: string, from: number, bound: number): number {
  for (let width = PREFIX_WINDOW; ; width *= 2) {
    const end = Math.min(from + width, bound)
    const window = content.slice(from, end)
    const marked = extractItemAttr(window)?.stripped ?? window
    const item = RE_TASK.exec(marked) ?? RE_ORDERED.exec(marked) ?? RE_UNORDERED.exec(marked)
    // The attribute block is stripped OUT of `marked`, so the marker length is
    // measured against the window rather than against `marked`: the content is
    // a suffix of both, and only the window still holds the braces.
    if (item) return window.length - item[item.length - 1]!.length
    if (end === bound) return 0
  }
}

/**
 * How much of `content` is container prefix - any interleaving of block quote
 * markers and list item markers, in any order and to any depth.
 */
function walkContainerPrefix(content: string): number {
  const bound = prefixWalkBound(content)
  let at = 0
  for (;;) {
    const quote = quotePrefixLength(content, at, bound)
    if (quote > 0) {
      at += quote
      continue
    }
    const marker = markerPrefixLength(content, at, bound)
    if (marker === 0) return at
    at += marker
  }
}

/**
 * The quote a marker line ends on, tracked, or null when it ends on none.
 *
 * The marker line never goes through the running tracker, so a quote opened
 * there arrived at the next line as a FRESH one and forgot the table, fence or
 * div it was holding: `:  > | a |` / `   > + b |` read the continuation row
 * with no row above it (markup-carve/carve#1348, corpus 349-5).
 */
function markerLineQuoteState(content: string): BlockQuoteLazyState | null {
  const quoted = RE_BLOCKQUOTE.exec(content)
  if (!quoted) return null
  const inner: BlockQuoteLazyState = {
    mode: { kind: 'closed' },
    inTable: false,
    colonWidths: [],
    attrRun: null,
  }
  trackBlockQuoteLazyState(
    quoted[1] ?? '',
    inner,
    () => true,
    () => true,
  )

  return inner
}


/**
 * Does the block written ON a list item's MARKER LINE leave an open paragraph
 * behind it?
 *
 * PART 1 S4: NO OPEN PARAGRAPH, NO LAZY LINE. The parameter S4 names is whether
 * a paragraph is open, and a block that leaves none leaves none WHEREVER it was
 * written - so `- # H` puts a heading in the item exactly as `- ` plus an
 * indented `# H` would, and the flush-left line below it is not that item's
 * (markup-carve/carve#1280, corpus category 326).
 *
 * The seeding this answers for asked only "blank, or an empty quote?". Every
 * other paragraph-less shape therefore read as an OPEN paragraph and swallowed
 * the line below it: a heading, a table, a thematic break, a comment, a link
 * reference definition, a footnote definition and an attribute block - seven
 * kinds, none of which holds a paragraph, and every one of which this same
 * engine already ended on in a block quote (`> # H` / `tail`). One rule stated
 * for one container and not the other.
 *
 * The question is asked of a quote RECURSIVELY, so a quote is not automatically
 * an open paragraph either: what decides is the block the quote itself ends on,
 * which is why `- > # H` ends the item and `- > q` does not.
 *
 * ONLY THE MARKER LINE. Once the item has collected lines at its content column
 * the running `trackItemLazyState` answers instead, and S4 leaves that half
 * deliberately open - corpus 75-list-nesting-and-looseness-4 pins the FOLDING
 * answer for a heading reached that way (`- a` / `  - b` / `    # N` / `lazy`
 * keeps the line inside the item). carve-rs gates the same question on the same
 * boundary.
 *
 * Not listed, and deliberately: a code, raw or comment fence, which the two
 * blocks below this seeding already open by hand, and a colon fence, which
 * holds a container the line below folds INTO rather than out of.
 */
/**
 * The block at the BOTTOM of a marker line's stack, as text.
 *
 * Split out of the classifier so the three questions asked of a marker line -
 * does it leave a paragraph, does it end on a table row, and what quote does it
 * end on - are answered from ONE walk. Asking them separately walked the prefix
 * twice per marker line and cost about 40% on a deeply-indented staircase; the
 * scaling guard read it as 2.28x per byte against a 2.0 threshold.
 */
function markerLineBottomBlock(content: string): string {
  // `> > # H` is the quote's question twice over, and `- - # H` is the
  // sub-item's, whose first block is the heading exactly as a bare `- # H`'s
  // is - so the strip runs to the bottom of the stack. It is a WALK BY OFFSET:
  // every regex it consults is anchored with `$`, so re-slicing the remainder
  // per marker cost O(N * line length) on a line of N markers (carve-js#1190).
  const walked = walkContainerPrefix(content)

  return walked === 0 ? content : content.slice(walked)
}

/**
 * Everything a marker line's seeding needs, from one walk.
 *
 * `endsOnTableRow` is FALSE for a quoted line: the table is the quote's, and
 * `quote` carries it there. Claiming it at this level as well would let a
 * continuation row written outside the quote join a table that is not there.
 */
function markerLineState(content: string): {
  leavesParagraphOpen: boolean
  endsOnTableRow: boolean
  bottomIsContinuationMarker: boolean
  quote: BlockQuoteLazyState | null
} {
  const bottom = markerLineBottomBlock(content)
  const quote = markerLineQuoteState(content)

  return {
    leavesParagraphOpen: bottomBlockLeavesParagraphOpen(bottom),
    endsOnTableRow: quote === null && isTableRow(bottom),
    // A bare `+` at the bottom of the marker line is the CONTINUATION MARKER
    // (§17 L3), and what it names is a document-column-0 block. It is not
    // prose, so it opens no paragraph an INDENTED line could fold into - see
    // the fold branch that reads this (markup-carve/carve#1436).
    bottomIsContinuationMarker: quote === null && isContinuationMarker(bottom),
    quote,
  }
}

function bottomBlockLeavesParagraphOpen(rest: string): boolean {
  if (isBlankLine(rest) || trimStructural(rest) === '') return false
  // THE STRICT COLUMN-0 RULE APPLIES TO WHAT IS LEFT (§24 C3). A quote marker
  // takes exactly one following space, so `>  [r]: /u` leaves a line that is
  // INDENTED inside the quote - and an indented definition, comment or table row
  // is paragraph text there, not the construct. Three of the classifiers below
  // tolerate a leading run (`RE_LINK_DEF` and `RE_COMMENT_LINE` match `[ \t]*`
  // first), so without this they answered for a construct the block parser never
  // builds and moved a line out of a container that did hold an open paragraph.
  if (rest.startsWith(' ') || rest.startsWith('\t')) return true
  if (RE_HEADING.test(rest)) return false
  if (RE_HR.test(rest)) return false
  if (isTableRow(rest)) return false
  // Both comment spellings: `%%` renders nothing, and `%%%` opens a fence whose
  // body is taken from the content column and nowhere else, so neither leaves a
  // paragraph for a column-0 line.
  if (RE_COMMENT_LINE.test(rest)) return false
  if (RE_FOOTNOTE_DEF.test(rest) || isLinkDefLine(rest)) return false
  if (isBlockAttributeLine(rest)) return false

  return true
}

/**
 * Does `content` OPEN a block-attribute block that has not closed on its own
 * line?
 *
 * §15 A5 lets the block WRAP, and one block is one block however many lines it
 * takes. `isBlockAttributeLine` above answers only for the single-line form,
 * which is all a tracker handed one line at a time could see - so a body ending
 * `{.k` / `#x}` read as two lines of prose, the author's braces reached the page
 * and the attributes reached nothing (markup-carve/carve#1281, corpus
 * 329-…-container-that-holds-it-6).
 *
 * Flush-left only, like `isBlockAttributeLine` and like every caller's own
 * guard: an indented brace line is lazy paragraph text under the strict column-0
 * rule (§24 C3), not a floater.
 */
function opensWrappedAttributeBlock(content: string): boolean {
  return content.startsWith('{') && !content.includes('}')
}

/**
 * One more line of a wrapped block-attribute run a tracker is standing in.
 *
 * `open` while nothing has carried a `}` yet; `attributes` once one has and the
 * whole run parses; `text` when it does not, or when a blank arrives first - a
 * blank inside an open brace is not a block, exactly as
 * `tryCollectBlockAttributes` reads it. A `text` verdict hands the line back to
 * the caller to classify normally, which is what keeps the run erring toward the
 * old answer rather than toward closing a container the author kept open.
 */
function continueWrappedAttributeBlock(
  collected: string,
  content: string,
): { run: string; verdict: 'open' | 'attributes' | 'text' } {
  if (isBlankLine(content)) return { run: '', verdict: 'text' }
  const run = `${collected}\n${content}`
  if (!content.includes('}')) return { run, verdict: 'open' }

  return { run: '', verdict: parseBlockAttributeRun(run) !== null ? 'attributes' : 'text' }
}

/**
 * Advance a lazy-state tracker's wrapped-attribute run by one line, and say
 * whether that line CLOSED one.
 *
 * ALONGSIDE THE CLASSIFIERS, NEVER INSTEAD OF THEM. A `{` with no `}` after it
 * anywhere is not a block at all - the collector refuses it and the lines are
 * the prose they look like - and a streaming tracker cannot know which it is
 * until a `}` arrives. A run that SUPPRESSED classification while it waited
 * therefore stopped reading the structural lines below it, and `> q` / `> {.k` /
 * `> # H` / `tail` kept the flush-left line inside a quote whose last block is a
 * heading. So the run is a side channel: it only ever OVERRIDES, and only when
 * it closes as real attributes, at which point the container holds no open
 * paragraph (§15 A5, markup-carve/carve#1281).
 *
 * The caller keeps its own state shape, so this reads and writes the one field
 * both have.
 */
function trackWrappedAttributeRun(
  state: { attrRun: string | null },
  content: string,
): boolean {
  if (state.attrRun !== null) {
    const { run, verdict } = continueWrappedAttributeBlock(state.attrRun, content)
    state.attrRun = verdict === 'open' ? run : null

    return verdict === 'attributes'
  }
  if (opensWrappedAttributeBlock(content)) state.attrRun = content

  return false
}

function trackItemLazyState(
  content: string,
  state: ItemLazyState,
  hasFenceCloser: (marker: string) => boolean = () => true,
  /**
   * Does this line sit AT the container's content column, rather than below it?
   *
   * Only the invisible blocks read it. An invisible line AT the column is a
   * BLOCK and ends the paragraph, and what it renders is not a parameter
   * (markup-carve/carve#1364); the same line collected BELOW the column is a
   * lazy continuation and adds no block at all, which is what keeps
   * `- a` / `  %% c` / ` b` folding (corpus 358). Every line the item collects
   * at its own column arrives here as true; the two lazy call sites pass false.
   */
  atContentColumn = true,
): void {
  // Absorption belongs to ONE open paragraph, so it ends wherever that
  // paragraph does. Clearing it here and re-arming it only in the two branches
  // that continue the same paragraph is what keeps a heading, a table or a code
  // fence between the malformed fence and a later bare `:::` from leaving the
  // flag set: at the top level those end the paragraph and the later fence
  // opens a real div, and this tracker has to give the same answer.
  const wasAbsorbing = state.absorbingFence
  state.absorbingFence = false
  // Carried the same way the absorption is, and for the same reason: every
  // other block ends the table, so only the two row branches re-arm it.
  const wasInTable = state.inTable
  state.inTable = false
  // The quote the item ended on is dropped by every line that is not more of
  // it; the quoted branch below re-arms it.
  const wasQuote = state.quoteInner
  state.quoteInner = null
  const wasInvisibleAtColumn = state.invisibleAtColumn
  state.invisibleAtColumn = false
  const wasCommentAtColumn = state.commentAtColumn
  state.commentAtColumn = false
  // A FOOTNOTE DEFINITION'S BODY RUNS ON. A blank between its lines is inside
  // the body rather than after it, so it does not end the run.
  //
  // AT THE BODY COLUMN, which is the parser's own boundary and not merely
  // "indented". `parseFootnoteDef` takes a continuation line only at
  // `FOOTNOTE_BODY_COLUMN`, so a line one column in is the CONTAINER's prose
  // and leaves an open paragraph behind it. Reading any indent as body made
  // `- a` / `  [^f]: t` / ` more` / `tail` end the item where carve-php folds
  // `tail` into it - found by sweeping the columns after `codex review` named
  // the mechanism, and not by the shape it predicted.
  if (
    state.inFootnoteBody &&
    !isBlankLine(content) &&
    indentColumns(content, FOOTNOTE_BODY_COLUMN) < FOOTNOTE_BODY_COLUMN
  ) {
    state.inFootnoteBody = false
  }
  if (state.inFootnoteBody) {
    state.invisibleAtColumn = wasInvisibleAtColumn
    state.commentAtColumn = wasCommentAtColumn
    state.lazyFoldable = false
    state.inDefList = false
    return
  }
  if (state.inComment) {
    // A CLOSER IS NOT A BARE RUN. This said it was - "so this test stays
    // anchored, unlike the opener below, which may carry an info string" - and
    // PART 9 §28 gives the closer the same insignificant tail as the opener:
    // `%%% end` closes one. It also matches on EXACT length, where this read
    // `>=`.
    const run = commentFenceRun(content)
    if (run === state.commentLen) {
      state.inComment = false
      // A CLOSED COMMENT FENCE AT THE COLUMN IS A CLOSED BLOCK, so the paragraph
      // it interrupted is gone and does not come back: `- a` / `  %%% c` /
      // `  %%%` / `tail` leaves the item on a block, and `tail` at column 0
      // reaches no container (markup-carve/carve#1364, corpus 357-3). Restoring
      // the pre-comment state is still right for a fence collected BELOW the
      // column, where the whole run adds no block.
      state.lazyFoldable = state.lazyFoldableBeforeComment && !state.openedCommentAtColumn
      state.invisibleAtColumn = state.openedCommentAtColumn
      state.commentAtColumn = state.openedCommentAtColumn
    } else {
      state.lazyFoldable = false
    }
    state.inDefList = false
    return
  }
  if (state.inFence) {
    if (state.fenceClose!.test(content)) state.inFence = false
    state.lazyFoldable = false
    state.inDefList = false
    return
  }
  // A WRAPPED block-attribute block is held open the way a fence is (§15 A5).
  // It renders nothing and opens nothing at either width, so the container has
  // no paragraph for a column-0 line to fold into while the run is open or once
  // it closes as attributes. A run that turns out NOT to parse hands its last
  // line back to the classifiers below, where its lines are the prose they look
  // like.
  if (trackWrappedAttributeRun(state, content)) {
    state.lazyFoldable = false
    state.inDefList = false
    return
  }
  if (isBlankLine(content)) {
    // A blank is a separator; a `:  def` may follow it (djot allows a blank
    // between a term and its definition), so leave inDefList unchanged.
    state.lazyFoldable = false
    // The paragraph that was absorbing fences ends here, so the next
    // fence-shaped line is an opener again.
    state.absorbingFence = false
    return
  }
  // A definition-list term or definition marker opens (or continues) a def
  // list in this item, and leaves an open paragraph for its body.
  if (RE_DEFLIST_TERM.test(content) || RE_DEFLIST_DEF.test(content)) {
    state.inDefList = true
    state.lazyFoldable = true
    return
  }
  // A code or raw fence opens a verbatim block, which holds no open paragraph -
  // but only when it really opens. Section 10's CLOSER LOOKAHEAD applies here
  // exactly as it does in the quote's tracker: with a paragraph already open
  // and no matching closer ahead, the fence is an inline verbatim run that is
  // PART of that paragraph, so the paragraph stays open. With none open it
  // dispatches unconditionally and an unterminated one runs to the end of the
  // item.
  //
  // The default callback answers "yes" so a caller that cannot look ahead - the
  // synthetic blank at a `+` marker, and the attached block's own lines - keeps
  // the old unconditional behavior.
  const fence = RE_FENCE.exec(content)
  const raw = fence ? null : RE_RAW_FENCE.exec(content)
  const fenceMarker = fence ? fence[2]! : raw ? raw[1]! : null
  if (fenceMarker !== null && (!state.lazyFoldable || hasFenceCloser(fenceMarker))) {
    state.inFence = true
    state.fenceClose = fenceCloseRe(fenceMarker)
    state.lazyFoldable = false
    state.inDefList = false
    return
  }
  if (fenceMarker !== null) {
    // An unterminated fence mid-paragraph: inline verbatim, and the paragraph
    // it sits in stays open. Fall through to the bottom rather than returning,
    // which is where ordinary paragraph text lands.
    state.lazyFoldable = true
    state.inDefList = false
    return
  }
  // An OPENER may carry an info string: `%%% x` is a comment fence, exactly as
  // the block parser reads it via RE_COMMENT_BLOCK_ANY. Requiring a bare run
  // here missed that opener entirely and then matched the CLOSER as an opener,
  // leaving the tracker permanently inside a comment: every later line read as
  // unfoldable, the item ended at the fence, and a following sibling marker
  // started a SECOND list (carve-js#659).
  const commentRun = commentFenceRun(content)
  if (commentRun !== undefined) {
    state.inComment = true
    state.commentLen = commentRun
    state.lazyFoldableBeforeComment = state.lazyFoldable
    state.openedCommentAtColumn = atContentColumn
    state.lazyFoldable = false
    state.inDefList = false
    return
  }
  // A heading is a block and leaves no paragraph open. At the item's content
  // column a following dedented line therefore reaches no container (PART 1
  // S4, carve#1377), just as it does after a table row or thematic break.
  if (RE_HEADING.test(content)) {
    state.lazyFoldable = false
    state.inDefList = false
    return
  }
  if (isTableRow(content) || RE_HR.test(content)) {
    state.inTable = isTableRow(content)
    state.lazyFoldable = false
    state.inDefList = false
    return
  }
  // A TABLE IS A TABLE HOWEVER ITS LAST ROW IS SPELLED. The row test above reads
  // a leading pipe and a continuation row carries none, so an item whose table
  // ended on one kept a dedented line where the standard-row spelling of the
  // same table sent it out (markup-carve/carve#1348).
  if (wasInTable && RE_TABLE_CONT.test(content)) {
    state.inTable = true
    state.lazyFoldable = false
    state.inDefList = false
    return
  }
  // AN INVISIBLE LINE AT THE CONTENT COLUMN IS A BLOCK. A comment and a
  // reference or footnote definition each render nothing, and what a block
  // renders is not a parameter (markup-carve/carve#1364): the paragraph above it
  // is over, so a column-0 line below reaches no container. The quote's tracker
  // has closed on the definitions all along; this one never did.
  //
  // No RE_ABBR_DEF: PART 12 §7 recognizes an abbreviation definition only as a
  // direct child of the document, so inside an item the line IS a paragraph.
  if (
    atContentColumn &&
    RE_INVISIBLE_BLOCK_LEAD.test(content) &&
    (RE_COMMENT_LINE.test(content) || RE_FOOTNOTE_DEF.test(content) || isLinkDefLine(content))
  ) {
    // ONLY THE FOOTNOTE DEFINITION OPENS A RUN. A comment is one line and a
    // link reference definition has no body at all, so the line after either of
    // them is the container's again.
    state.inFootnoteBody = RE_FOOTNOTE_DEF.test(content)
    state.invisibleAtColumn = true
    state.commentAtColumn = RE_COMMENT_LINE.test(content)
    state.lazyFoldable = false
    state.inDefList = false
    return
  }
  // A blockquote line keeps the fold open: the quote's trailing paragraph
  // absorbs the dedented line via the quote's own lazy continuation. An EMPTY
  // quote holds no paragraph, so it does not (PART 1 S4).
  // A QUOTED LINE OPENS OR CONTINUES A QUOTE, and what THAT quote ends on is
  // what the item ends on: `- > q` folds a column-0 line into the quote's
  // paragraph, `- >` holds none and closes the item (carve#561, carve#572), and
  // `:  > | a |` / `   > + b |` ends on a table one level down. A line test
  // could answer the first two; only the quote's own tracker answers the third,
  // because a quoted table spanning two lines is one block.
  const quotedLine = RE_BLOCKQUOTE.exec(content)
  if (quotedLine) {
    const inner: BlockQuoteLazyState = wasQuote ?? {
      mode: { kind: 'closed' },
      inTable: false,
      colonWidths: [],
      attrRun: null,
    }
    trackBlockQuoteLazyState(
      quotedLine[1] ?? '',
      inner,
      () => true,
      () => true,
    )
    state.quoteInner = inner
    state.lazyFoldable = blockQuoteParagraphOpen(inner)
    state.inDefList = false
    return
  }
  // A block-attribute line renders nothing and opens nothing: it collects into
  // `pending` and floats forward to the next block (§15 A1/A2). So there is no
  // open paragraph for a following column-0 line to fold into, and PART 1 S4
  // closes the item and re-classifies the line at the top level - the same
  // answer, for the same reason, as the empty quote above.
  if (isBlockAttributeLine(content)) {
    state.lazyFoldable = false
    state.inDefList = false
    return
  }
  // A div / admonition / line-block OPENER is structural; it opens no paragraph
  // itself, but plain text on a later line inside it does (handled by the
  // fall-through below once the opener line has been seen).
  const bareFence = /^:{3,}[ \t]*$/.test(content)
  // A bare run with a container open is that container's closer.
  if (bareFence && state.divDepth > 0) {
    state.divDepth--
    state.lazyFoldable = false
    state.inDefList = false
    return
  }
  if (
    RE_DIV_OPEN.test(content) ||
    (RE_ADMONITION_OPEN.test(content) && !RE_ADMONITION_CLOSE.test(content)) ||
    RE_LINE_BLOCK_OPEN.test(content) ||
    RE_HARDBREAKS_OPEN.test(content) ||
    RE_QUOTE_BLOCK_OPEN.test(content)
  ) {
    // ...unless the paragraph above it already absorbed a malformed fence AND
    // this line is a BARE run, in which case §12 takes it as text too and the
    // paragraph stays open. Not width-tagged: after a malformed `:::note` a
    // following `::::` is absorbed as readily as a `:::`.
    //
    // ONLY A BARE RUN. A line that opens something of its own - `::: note`,
    // `::: |`, `::: [label]` - interrupts the absorbing paragraph exactly as it
    // does at the top level, which is where this rule is already implemented
    // and where it was measured: `:::note` over `::: note` is a paragraph plus
    // an admonition in all three engines, while `:::note` over `:::` is one
    // paragraph in all three.
    if (wasAbsorbing && bareFence) {
      state.absorbingFence = true
      state.lazyFoldable = true
      return
    }
    state.divDepth++
    // A valid opener ENDS the absorbing paragraph, so the bare fence that
    // closes the block it opens is that block's closer rather than more
    // absorbed text - and a closed block leaves no open paragraph.
    state.lazyFoldable = false
    state.inDefList = false
    return
  }
  // A fence-shaped line that is NOT a valid opener is ordinary paragraph text,
  // and from here the paragraph absorbs the next fence-shaped line as well.
  // `:::note` fails §12's opener test because a type word must be separated
  // from the fence by a space; `::: note` passes it and takes the branch above.
  if (/^:{3,}/.test(content)) {
    // ...but only at the item's own level. Inside an open container the line is
    // ordinary body text and the container's closer below it is still a closer,
    // so arming here would swallow it and hold the paragraph open past the
    // block's end.
    state.absorbingFence = state.divDepth === 0
    state.lazyFoldable = true
    state.inDefList = false
    return
  }
  // A NESTED MARKER LINE IS A MARKER LINE. The sub-item it opens is a container
  // whose first block is whatever the marker holds, so S4's question about it is
  // the one `markerLineState` answers - `- a` / `  - # N` leaves a
  // heading open-paragraph-less at the bottom of the stack, and the flush-left
  // line below reaches no container at all (markup-carve/carve#1280). Asked of
  // the MARKER content only: a heading on a line the sub-item COLLECTS is the
  // other half of S4, which the enumeration below decides and corpus
  // 75-list-nesting-and-looseness-4 pins the folding answer for.
  const nestedMarker = extractItemAttr(content)?.stripped ?? content
  if (RE_TASK.test(nestedMarker) || RE_ORDERED.test(nestedMarker) || RE_UNORDERED.test(nestedMarker)) {
    state.absorbingFence = false
    // The helper unwraps the marker itself, so `- - # H` and `- # H` are one
    // question asked once.
    const nested = markerLineState(content)
    state.lazyFoldable = nested.leavesParagraphOpen
    state.inTable = nested.endsOnTableRow
    state.quoteInner = nested.quote
    state.inDefList = false
    return
  }
  // Everything else (plain prose, div body text) leaves an open paragraph the
  // dedented line can continue. Prose folds into a def body, so an open def list
  // stays open (inDefList unchanged) - and it is the SAME paragraph, so an
  // absorption already under way survives it.
  state.absorbingFence = wasAbsorbing
  state.lazyFoldable = true
}

function parseList(lexer: Lexer): List {
  const first = lexer.peek()!
  const baseIndent = indentColumns(first)
  // Classify on the marker after stripping any abutting `{...}` attribute block.
  const firstAttr = extractItemAttr(first)
  const firstStripped = firstAttr ? firstAttr.stripped : first
  const isTask = RE_TASK.test(firstStripped)
  const isOrdered = !isTask && RE_ORDERED.test(firstStripped)
  // A change of unordered marker character (`-` vs `*` vs `+`), or of
  // ordered dialect/delimiter (decimal/alpha/roman, `.` vs `)`), starts a
  // new list (grammar PART 9 §11). The first item fixes the ordered
  // dialect; the second item's marker (if a sibling) tie-breaks an
  // ambiguous single roman letter.
  const firstMarkerChar = isOrdered ? '' : unorderedMarkerChar(firstStripped)
  const firstOrdered = isOrdered ? RE_ORDERED.exec(firstStripped)! : null
  const orderedDelim = firstOrdered ? firstOrdered[3]! : ''
  let orderedKind: OlKind = 'dec'
  let orderedStart = 1
  if (firstOrdered) {
    // Tie-break the dialect on the next sibling, looking past blank lines
    // and the first item's own continuation/nested lines (indented deeper
    // than the marker) — `x.` / blank or indented body / `xi.` is still one
    // roman list.
    let k = 1
    for (; lexer.peek(k) !== undefined; k++) {
      const ln = lexer.peek(k)!
      if (!isBlankLine(ln) && indentColumns(ln, baseIndent + 1) <= baseIndent) break
    }
    const nextLine = lexer.peek(k)
    const nextStripped =
      nextLine !== undefined
        ? (extractItemAttr(nextLine)?.stripped ?? nextLine)
        : undefined
    const nm =
      nextStripped !== undefined && indentColumns(nextLine!, baseIndent + 1) === baseIndent
        ? RE_ORDERED.exec(nextStripped)
        : null
    orderedKind = olKindOf(firstOrdered[2]!, nm ? nm[2]! : null)
    orderedStart = olStartOf(firstOrdered[2]!, orderedKind)
  }
  const items: ListItem[] = []
  let loose = false
  // §11 N1 hard boundary: a run of three or more blank lines before a
  // compatible sibling marker ends this list rather than loosening it. Set
  // where the loose decision is made, acted on after the item is pushed.
  let hardBoundary = false

  /**
   * The boundary set for a `+`-attached block in a list item: a blank, a
   * dedent below the marker column, and at the marker column a sibling marker,
   * ANY list marker (§11) or a further `+`. Both `+` paths - the first-block
   * `- +` and the mid-item one - carry the SAME set, so it is written once;
   * whether a line in it ends the block is `insideOpenFence`'s answer, layered
   * on by `collectAttachedBlock`.
   */
  const isItemAttachBoundary = (a: string): boolean => {
    if (isBlankLine(a)) return true
    const ind = indentColumns(a, baseIndent + 1)
    if (ind < baseIndent) return true
    if (ind !== baseIndent) return false
    const am = matchListMarker(a, isTask, isOrdered)
    const sibling =
      am &&
      (isOrdered
        ? orderedContinues(a, orderedKind, orderedDelim)
        : unorderedMarkerChar(a) === firstMarkerChar)
    const anyMarker =
      RE_ORDERED.test(a) || RE_UNORDERED.test(a) || RE_TASK.test(a) || extractItemAttr(a) !== null
    return Boolean(sibling) || anyMarker || isContinuationMarker(a)
  }

  while (!lexer.eof()) {
    const itemStartLineIndex = lexer.pos
    const line = lexer.peek()!
    if (isBlankLine(line)) {
      // Blank lines between siblings are handled by the per-item collector
      // below; a stray leading blank just ends the list.
      break
    }
    if (indentColumns(line, baseIndent + 1) !== baseIndent) break
    // Strip an abutting `{...}` attribute block off the marker so the bare
    // marker regexes match; remember its attributes to attach to the <li>.
    const la = extractItemAttr(line)
    const mline = la ? la.stripped : line
    const m = matchListMarker(mline, isTask, isOrdered)
    if (!m) break
    // §11: a sibling with a different marker character (unordered) or a
    // different delimiter (ordered) is a new list.
    if (!isOrdered && unorderedMarkerChar(mline) !== firstMarkerChar) break
    if (isOrdered && !orderedContinues(mline, orderedKind, orderedDelim)) break

    let content: string
    let checked: boolean | undefined
    if (isTask) {
      checked = m[2]!.toLowerCase() === 'x'
      content = m[3]!
    } else if (isOrdered) {
      content = m[4]!
    } else {
      content = m[2]!
    }
    const itemAttrs = la ? la.attrs : undefined

    // item (continuation paragraphs or nested lists). Visual content column:
    // baseIndent (tab-aware columns) plus the BARE marker width. An abutting
    // `{...}` block is item metadata and contributes zero, so changing a class
    // or Unicode value cannot restructure the body (carve#1701, carve#1698). The leading
    // whitespace may be a tab, so it is measured in columns (baseIndent) rather
    // than characters. For a TASK item the
    // checkbox is content, not marker, so the content column is the bullet
    // width (`- `/`* ` = 2) -- not the full
    // `- [x] ` width (matching the spec's task attribute/continuation
    // convention `- [x] x` / `  {.c}`).
    const contentCol = isTask
      ? baseIndent + 2
      : baseIndent + (mline.length - leadingWhitespace(mline) - content.length)
    lexer.consume()

    // First-block item (Carve): `- +` opens an item whose body is the
    // flush-left block that follows, with no indentation. A lone `+` as the
    // sole item content is the continuation marker, not literal text
    // (`- + text` keeps `+ text` as literal content). Lets an item start
    // directly with a table, code block, quote or div at column 0.
    if (isContinuationMarker(content)) {
      // AND ONLY A FLUSH-LEFT ONE (§17 L3, markup-carve/carve#1436). A candidate
      // at any other column is not attached: it falls through to the ordinary
      // column rules, exactly as if this marker line had been a comment. Under a
      // NESTED marker that is the whole difference - `* * +` used to swallow a
      // line written at the OUTER item's content column, so outer content could
      // not be written after a nested marker at all.
      const attachesHere = attachesAtDocumentColumnZero(lexer)
      // The attached block is a block: a boundary line inside a fence it opened
      // is that fence's body, not a boundary (see the indented loop's note on
      // carve#975 and corpus category 279). Without this the opener came out an
      // EMPTY code block and the closer an inline code span, which is the same
      // damage category 278 pins one level in.
      const {
        lines: attached,
        lineNumbers: attachedLineNumbers,
        startLineIndex: attachedStartLineIndex,
      } =
        attachesHere ?
          collectAttachedBlock(lexer, isItemAttachBoundary, (a) => sliceColumns(a, baseIndent))
        : { lines: [], lineNumbers: [], startLineIndex: lexer.pos }
      // A SECOND ATTACHED BLOCK TAKES A SECOND MARKER, and the first-block form
      // is no exception: `- +` / `para` / `+` / `> q` holds both, exactly as
      // `- a` / `+` / `para` / `+` / `> q` does. This branch published the item
      // as soon as it had ONE block, so the second marker was left at the top
      // level and rendered as a paragraph of its own - `<p>+</p>` on the page,
      // with the block it was written for outside the item (§17 L3, corpus
      // 327-…-that-block-s-extent-7).
      //
      // The blank between two attached blocks is a SEPARATOR, not a loosener:
      // the author wrote no blank line, so the item stays tight, which is the
      // same carve-out `plusSeparators` makes in the indented body.
      while (!lexer.eof() && isContinuationMarker(lexer.peek()!)) {
        const plusLineIndex = lexer.pos
        lexer.consume()
        if (!attachesAtDocumentColumnZero(lexer)) break
        const more = collectAttachedBlock(lexer, isItemAttachBoundary, (a) =>
          sliceColumns(a, baseIndent),
        )
        if (more.lines.length === 0) break
        attached.push('')
        attachedLineNumbers.push(lexer.lineNumber(plusLineIndex))
        attached.push(...more.lines)
        attachedLineNumbers.push(...more.lineNumbers)
      }
      const sub = nestedSubLexer(lexer, attached, attachedStartLineIndex, attachedLineNumbers)
      const fbChildren = parseBlocks(sub, 0)
      const fbItem: ListItem = { type: 'list_item', children: fbChildren }
      attachBlockPos(lexer, fbItem, itemStartLineIndex, lexer.pos)
      if (checked !== undefined) fbItem.checked = checked
      if (itemAttrs) fbItem.attrs = itemAttrs
      items.push(fbItem)
      continue
    }

    const nested: string[] = []
    const nestedLineNumbers: number[] = []
    // Lines admitted by reaching this item's content column. A below-column
    // lazy line can retain a positive residual indent for recursive safety,
    // but that must never be mistaken for #1705 over-indentation.
    const authoredBaseEligible = new Set<number>()
    let hasOverindentedBlockCandidate = false
    // Index in `nested` where an indented ORDERED sub-list begins. Ordered
    // markers do not interrupt a paragraph (§10), so if the sub-list is joined
    // with the lead text it folds into the lead paragraph instead of nesting
    // (`1. a` / `   1. b` -> `<li>a\n1. b</li>`). Splitting it into its own block
    // stream lets it nest. Unordered/task sub-lists interrupt and already nest
    // via the join, and lazy continuation / block-attribute lines must stay on
    // the join, so only an indented ordered marker triggers the split.
    let firstBlockIdx = -1
    let bodyHasContentColumnLine = false
    let pendingBlanks = 0
    let pendingBlankLineNumbers: number[] = []
    // Indices in `nested` that hold a `+`-injected blank separator. These keep
    // the attached block parsing standalone but never loosen the list (Bug B).
    const plusSeparators = new Set<number>()
    // Track whether the item's collected content currently ends in an open
    // paragraph (family-D lazy continuation). The lead text opens one.
    // ONE WALK for the three questions the lead line answers.
    const leadState = markerLineState(content)
    const lazyState: ItemLazyState = {
      inFence: false,
      fenceClose: null,
      inComment: false,
      commentLen: 0,
      lazyFoldableBeforeComment: false,
      openedCommentAtColumn: false,
      invisibleAtColumn: false,
      commentAtColumn: false,
      inFootnoteBody: false,
      absorbingFence: false,
      divDepth: 0,
      // The lead text opens a paragraph unless it is one of the shapes that
      // open nothing - PART 1 S4's one question, asked of the block the marker
      // line holds. See `markerLineState`.
      lazyFoldable: leadState.leavesParagraphOpen,
      inTable: leadState.endsOnTableRow,
      quoteInner: leadState.quote,
      inDefList: RE_DEFLIST_TERM.test(content) || RE_DEFLIST_DEF.test(content),
      attrRun: null,
    }
    // A FENCE OPENED ON THE MARKER LINE IS AN OPEN FENCE (markup-carve/carve#950).
    // The lead line never went through `trackItemLazyState`, so `- ``` ` left
    // the tracker believing the item held an open paragraph, and every line
    // below the content column folded into the code text - body and closer
    // both. Nothing precedes the lead, so no closer lookahead applies: the
    // fence opens unconditionally, exactly as it does at the top of a quote.
    const itemFenceMemo: QuotedFenceCloserMemo = new Map()
    const leadFence = RE_FENCE.exec(content) ?? RE_RAW_FENCE.exec(content)
    if (leadFence) {
      lazyState.inFence = true
      lazyState.fenceClose = fenceCloseRe(RE_FENCE.test(content) ? leadFence[2]! : leadFence[1]!)
      lazyState.lazyFoldable = false
    }
    // A COMMENT FENCE OPENED ON THE MARKER LINE IS AN OPEN COMMENT, for the
    // reason carve#950 gives for the code fence one line up: the lead line
    // never goes through `trackItemLazyState`, so `- %%%` left the tracker
    // believing the item held an open paragraph and nothing below the marker
    // line was comment body to it. PART 9 §28 makes that body VERBATIM, so the
    // tracker has to know the comment is open before it reads the next line.
    const leadComment = leadFence ? undefined : commentFenceRun(content)
    if (leadComment !== undefined) {
      lazyState.inComment = true
      lazyState.commentLen = leadComment
      lazyState.lazyFoldableBeforeComment = lazyState.lazyFoldable
      lazyState.lazyFoldable = false
    }
    // The lead line may itself be the malformed fence (`- :::note`), and then
    // the paragraph it opens is already absorbing: the `:::` below it is text,
    // not a closer for a block nothing opened (PART 9 §12, carve#891).
    lazyState.absorbingFence =
      /^:{3,}/.test(content) &&
      !RE_DIV_OPEN.test(content) &&
      !RE_ADMONITION_OPEN.test(content) &&
      !RE_LINE_BLOCK_OPEN.test(content) &&
      !RE_HARDBREAKS_OPEN.test(content) &&
      !RE_QUOTE_BLOCK_OPEN.test(content)
    while (!lexer.eof()) {
      const l = lexer.peek()!
      if (isBlankLine(l)) {
        pendingBlanks++
        pendingBlankLineNumbers.push(lexer.lineNumber(lexer.pos))
        lexer.consume()
        continue
      }
      // List-continuation marker (Carve): a lone `+` at the marker column
      // attaches the FOLLOWING flush-left block to this item without indenting
      // it. A bare `+` is never a bullet (a bullet needs `+ ` + content). It
      // injects a blank separator so the block parses on its own; the
      // compact-list rule above then keeps the item tight.
      if (indentColumns(l, baseIndent + 1) === baseIndent && isContinuationMarker(l)) {
        const plusLineNumber = lexer.lineNumber(lexer.pos)
        lexer.consume()
        pendingBlanks = 0
        pendingBlankLineNumbers = []
        // Mark this blank as a `+`-injected separator: it lets the attached
        // block parse on its own but must NOT loosen the list (Bug B). A real
        // internal blank before a plain paragraph still loosens; a `+` one
        // never does, matching carve-php.
        // ONLY A FLUSH-LEFT BLOCK (§17 L3, markup-carve/carve#1436) - see the
        // first-block form above. Nothing is attached from another column, and
        // the marker line itself is still consumed, so the candidate falls
        // through to the ordinary rules on the next turn of this loop.
        if (!attachesAtDocumentColumnZero(lexer)) continue
        plusSeparators.add(nested.length)
        nested.push('')
        nestedLineNumbers.push(plusLineNumber)
        trackItemLazyState('', lazyState)
        // A boundary line inside a fence THIS attached block opened is that
        // fence's body, exactly as it is in the indented body (carve#975 for
        // the marker, corpus category 279 for the blank, the dedent and the
        // three fence kinds together). The old loop consulted the tracker for
        // two of the kinds and for no boundary but the marker, so a blank
        // severed a code fence from its opener and a colon fence severed on
        // every boundary there is.
        const { lines: attachedLines, lineNumbers: attachedLineNumbers } = collectAttachedBlock(
          lexer,
          isItemAttachBoundary,
          (a) => sliceColumns(a, baseIndent),
        )
        for (let k = 0; k < attachedLines.length; k++) {
          nested.push(attachedLines[k]!)
          nestedLineNumbers.push(attachedLineNumbers[k]!)
          // The attached block's lines are the item's, so the item's own
          // tracker sees them: what they leave open decides how a later
          // dedented line folds.
          trackItemLazyState(attachedLines[k]!, lazyState)
        }
        continue
      }
      // Content-column model (carve#295): a continuation belongs to the item
      // only if it reaches the item's content column - the SAME rule the
      // no-blank case uses; the blank line only decides tight vs loose. There is
      // no `baseIndent + 2` relaxation and no below-column block-opener nesting.
      // A block opener is recognized only AT the content column (the item body's
      // column 0), exactly as at the top level; a line that reaches the content
      // column but carries residual indent is lazy paragraph text, and a line
      // below the content column ends the item body and parses at document level
      // (falling through to the lazy-fold / detach branch below). Intentional
      // divergence from djot, which attaches at any indent past the marker.
      const lw = indentColumns(l, contentCol)
      if (lw >= contentCol) {
        bodyHasContentColumnLine = true
        for (let k = 0; k < pendingBlanks; k++) {
          nested.push('')
          nestedLineNumbers.push(pendingBlankLineNumbers[k]!)
          trackItemLazyState('', lazyState)
        }
        pendingBlanks = 0
        pendingBlankLineNumbers = []
        // A sub-list marker (ordered, unordered, or task) at or past the content
        // column starts the item's block stream.
        //
        // INSIDE AN OPEN FENCE THE LINE IS CODE TEXT AND NOTHING ELSE
        // (markup-carve/carve#975, category 278). Section 24's S1 and S2 place
        // a line by the COLUMN it reaches; neither reads its first character,
        // so `- x` at the content column is the same continuation that plain
        // `x` is - which corpus 276-...-3 already pins, and which differs from
        // 278's first row by two characters. This test ran unconditionally, so
        // the marker split the fence body away from its opener: the opener was
        // left an EMPTY code block, the marker line became a nested list, and
        // the closer came out as an inline code span.
        //
        // `lazyState` here describes the lines ALREADY collected, because
        // `trackItemLazyState` runs at the bottom of this branch - so it
        // answers exactly "was a fence open when this line began". An
        // unterminated fence is inline verbatim rather than a block (the
        // closer-lookahead rule), and `inFence` is only set for one that
        // really opens, so a marker under an unterminated opener still nests.
        //
        // A COMMENT FENCE'S BODY IS VERBATIM TOO (PART 9 §28, carve-js#878),
        // and §24's S1/S2 read a line's COLUMN there as well - they never read
        // its first character - so the derivation is the one carve#975 pinned
        // for the code fence, one construct over. Without `inComment` the same
        // split happened: the opener was left alone in the lead stream, the
        // marker line opened a nested list in the block stream, and the body
        // that §28 makes invisible rendered as a list on the page.
        //
        // A COLON FENCE'S BODY IS OPAQUE ON THE SAME READING (corpus category
        // 279). Two of the three kinds were spelled out here and the third was
        // not, so `- x` / `  :::` / `  a` / `  - m` / `  b` / `  :::` split the
        // div in two around a nested list where §24's S1/S2 place `- m` in its
        // body. `insideOpenFence` answers for all three at once.
        const isMarker =
          !insideOpenFence(lazyState) &&
          !insideOpenQuoteParagraph(lazyState) &&
          (RE_ORDERED.test(l) ||
            RE_UNORDERED.test(l) ||
            RE_TASK.test(l) ||
            // An abutting-attr bullet (`-{.x} item`) is a marker too. It no
            // longer reaches here via §10 interruption (bullets do not
            // interrupt), so the sub-list nesting path must recognize it
            // directly to keep nesting.
            extractItemAttr(l) !== null)
        if (firstBlockIdx === -1 && isMarker) {
          firstBlockIdx = nested.length
        }
        // RESIDUAL-AWARE FOR EVERY LINE KIND. The residual columns of a
        // straddling tab are indentation whatever follows them, so dropping
        // them makes the same column mean two things depending on how it was
        // written (PART 9 §24 C1).
        //
        // This used to apply only to markers, on the premise that "Carve has no
        // indent-sensitive block where a leftover column would change meaning".
        // The space spellings disprove it, and all three engines agree on them:
        // under `1. a` a `> quote` at the content column (three spaces) nests,
        // one column past (four spaces) is text. A tab reaches column 4, so it
        // is the four-space case - but consuming the tab whole delivered the
        // opener flush at column 0 and it nested, which no space spelling of
        // that column does (carve-js#767, carve-php#890 one layer down).
        const dedented = sliceColumns(l, contentCol, true)
        authoredBaseEligible.add(nested.length)
        if (dedented[0] === ' ' || dedented[0] === '\t') hasOverindentedBlockCandidate = true
        nested.push(dedented)
        nestedLineNumbers.push(lexer.lineNumber(lexer.pos))
        const fenceLineIndex = lexer.pos
        trackItemLazyState(dedented, lazyState, (marker) =>
          itemFenceHasCloser(lexer, marker, fenceLineIndex, contentCol, itemFenceMemo),
        )
        lexer.consume()
      } else if (
        pendingBlanks === 0 &&
        // A dedented (below content-column) plain line only lazily continues an
        // OPEN paragraph (family-D rule). After a code fence or table -- which
        // leave no open paragraph -- the line ends the item and becomes a
        // top-level block instead. A blockquote/div trailing paragraph keeps the
        // fold open (lazyFoldable stays true). The indented-marker special case
        // below still folds regardless, matching the symmetric §10 behavior.
        // An UNTERMINATED fence (inFence still open) is NOT a code block -- it is
        // an inline-verbatim run that is part of the paragraph, so a dedented
        // line folds into it (matching the §10 closer-lookahead rule).
        // `inComment` counts like `inFence`: an UNCLOSED comment fence opens no
        // block (§28) and is still a comment, so a below-column line after it is
        // part of the paragraph the fence never interrupted. Without this, giving
        // the opener its info string (see trackItemLazyState) latched the tracker
        // inside a comment that never closes, and the item ended there.
        //
        // "The paragraph the fence never interrupted" is the whole of that
        // reason, so it needs a paragraph to have been open when the fence
        // arrived - which `lazyFoldableBeforeComment` is exactly the record of.
        // A comment fence written ON THE MARKER LINE interrupts nothing: it IS
        // the item's first block, and it takes its body from the content column
        // and nowhere else, so a column-0 line below it reaches no container
        // (§24 C3) and ends the item, the same answer `- %% c` gives one
        // spelling over (PART 1 S4, markup-carve/carve#1280).
        // A BARE CONTINUATION MARKER FOLDS ONLY COLUMN 0 (§17 L3,
        // markup-carve/carve#1436). While the item has collected nothing, its
        // lead is an empty first-block item waiting for a flush-left block: a
        // column-0 line is the block the marker names and belongs here, and an
        // INDENTED line is not attached at all - it falls through to the
        // ordinary column rules. `* * +` / ` x` folded a column-1 line into the
        // outer item, which is below that item's content column and reaches no
        // container.
        !(leadState.bottomIsContinuationMarker && nested.length === 0 && leadingWhitespace(l) > 0) &&
        (((lazyState.lazyFoldable ||
          (lazyState.inComment && lazyState.lazyFoldableBeforeComment) ||
          // AN INVISIBLE BLOCK AT THE COLUMN ENDED THE PARAGRAPH, NOT THE ITEM
          // (markup-carve/carve#1364). The item goes on collecting, so a line
          // still indented belongs to it and starts a paragraph of its own
          // there (corpus 197, 277-3, 358). The container ends at document
          // column 0, which is the line this test excludes and which is all
          // that separates 358 from 357-2.
          (lazyState.commentAtColumn && indentColumns(l, contentCol) > 0)) &&
          !lazyContinuationEndsList(l, lexer)) ||
          // A list marker indented past the base column but BELOW the content
          // column folds into the lead text rather than ending the list. Under
          // symmetric §10 no list marker interrupts a paragraph, so on the
          // recursive reparse it stays folded: `1. a`/`  1. b`, `- a`/` - b`,
          // and the abutting-attr form `- a`/` -{.x} b` all fold. (At or past
          // the content column the marker nests; at the base column it can start
          // a sibling list, §11 -- so only a below-content indented one folds.)
          (indentColumns(l, baseIndent + 1) > baseIndent &&
            (RE_TASK.test(l) ||
              RE_UNORDERED.test(l) ||
              RE_ORDERED.test(l) ||
              extractItemAttr(l) !== null)))
      ) {
        // Lazy continuation: a line with no blank before it that starts no block
        // (or is the indented ordered marker above) folds into the item's lead
        // paragraph (djot rule). A block-starting line or a blank ends the list.
        //
        // Exception: an UNDER-indented (below content-column) line inside an
        // OPEN definition list has its leading whitespace stripped before it
        // folds. A def/term marker re-aligns to column 0 and attaches as a
        // `<dd>`/`<dt>` (decision D); a plain continuation folds into the open
        // term/definition with its leading whitespace removed, exactly as a
        // lazy paragraph continuation does. rs/php strip here, so carve-js
        // must match, otherwise a below-column term-fold like `:: term`/` x`
        // would keep the stray space (`<dt>term\n x</dt>`). An OVER-indented
        // line never reaches here (it goes through sliceColumns and folds with
        // its residual indent preserved), so only the genuinely-under-indented
        // case is stripped.
        let lazyLine = l
        if (lexer.literalLazyLinkDefLines.has(lexer.lineNumber(lexer.pos))) {
          lazyLine = l.replace(/^[ \t]+/, '')
        } else if (lazyState.inDefList && indentColumns(l, contentCol) < contentCol) {
          lazyLine = l.replace(/^[ \t]+/, '')
        } else if (indentColumns(l, contentCol) < contentCol && lineOpensBlock(l.replace(/^[ \t]+/, ''))) {
          // A block-SHAPED line below the content column opens nothing (§24 C3:
          // below it a marker folds as lazy item text and no other opener nests
          // either), and it is folding here for that reason. It must not carry
          // enough indentation to reach the SUB-list's content column on the
          // recursive reparse, though, or it opens a list one level down -
          // which is what `-   x` / `    - a` / `  - b` did, nesting `b` under
          // `a` where the executable spec folds it (carve#603). One column
          // reaches no content column at all, so the fold holds at every depth.
          lazyLine = ' ' + l.replace(/^[ \t]+/, '')
        }
        nested.push(lazyLine)
        nestedLineNumbers.push(lexer.lineNumber(lexer.pos))
        // BELOW THE CONTENT COLUMN, so an invisible line here adds no block: it
        // is the lazy continuation of the paragraph above it, which stays open
        // behind it (corpus 183, 197, 358).
        trackItemLazyState(lazyLine, lazyState, () => true, false)
        lexer.consume()
      } else {
        break
      }
    }

    // A block opener may be authored past the canonical item-body column.  The
    // collector above deliberately keeps the whole physical run; rebase each
    // recognized block group now, before tightness and block parsing inspect
    // it.  This is #1705's authored `block_base`: only structural indentation
    // is removed, while indentation beyond the opener's base remains payload.
    const leadIsMarker =
      RE_UNORDERED.test(content) ||
      RE_ORDERED.test(content) ||
      RE_TASK.test(content) ||
      extractItemAttr(content) !== null
    if (hasOverindentedBlockCandidate)
      rebaseOverindentedBlocks(
        nested,
        authoredBaseEligible,
        leadIsMarker ? markerContentColumn(content) : -1,
      )

    // THE BLANK IS STILL REMEMBERED (§17 L1, carve#621). An invisible line does
    // not loosen the item on its own - it is not a second paragraph - but it
    // does not FILL the gap either. So when the item's tail after its last
    // blank is nothing but invisible lines, the item is still "followed by a
    // blank line before the next marker" and L1's other clause applies. Without
    // this, attaching the comment consumed the signal and `- a` / blank /
    // `  %% n` / `- b` came out tight, where the same document without the
    // comment is loose.
    let blankBeforeInvisible = false
    for (let k = nested.length - 1; k >= 0; k--) {
      const ln = nested[k]!
      if (isBlankLine(ln)) {
        // A `+`-injected separator is not a blank line the author wrote, and
        // never loosens - the same exemption the second-paragraph scan below
        // makes for it. Without this the item went loose through the back door:
        // `- a` / `+` / `%% note` / `- b` came out loose where the identical
        // document without the comment is tight.
        blankBeforeInvisible = k < nested.length - 1 && !plusSeparators.has(k)
        break
      }
      if (!isInvisibleLine(ln)) break
    }

    // A blank line inside an OPEN verbatim fence is that fence's content, not
    // spacing between blocks. Blanks are buffered in `pendingBlanks` and
    // flushed only when a later line reaches the content column, so a fence
    // running to the end of the item never received them.
    //
    // Only while a fence or comment is open: with nothing open the trailing
    // blanks really are spacing, and flushing them would change list tightness
    // and the item's end position (markup-carve/carve-js#988).
    if (pendingBlanks > 0 && (lazyState.inFence || lazyState.inComment)) {
      for (let k = 0; k < pendingBlanks; k++) {
        nested.push('')
        nestedLineNumbers.push(pendingBlankLineNumbers[k]!)
      }
      // `pendingBlanks` is NOT cleared. The loose-list test below reads it to
      // decide whether a blank separated this item from its sibling, and a
      // blank is both at once: the fence's content AND the separator that
      // loosens the list. Clearing it made `- a\n  %%% x\n b\n\n- c\n` tight.
    }

    // Blank line(s) before the next sibling marker make the list loose.
    // The next marker must be a real sibling of THIS list: same kind and
    // (for unordered) same marker character. A blank line before a
    // different marker (`- a\n\n+ b`) separates two distinct lists
    // (§11), so it must not loosen this one.
    if ((pendingBlanks > 0 || blankBeforeInvisible) && !lexer.eof()) {
      const nextLine = lexer.peek()!
      const nextStripped = extractItemAttr(nextLine)?.stripped ?? nextLine
      if (
        indentColumns(nextLine, baseIndent + 1) === baseIndent &&
        matchListMarker(nextStripped, isTask, isOrdered) &&
        (isOrdered
          ? orderedContinues(nextStripped, orderedKind, orderedDelim)
          : unorderedMarkerChar(nextStripped) === firstMarkerChar)
      ) {
        // A run of THREE OR MORE blank lines is a hard boundary (§11 N1): the
        // sibling marker after it opens a new list instead of joining this
        // one. One or two blank lines remain the ordinary loose separator
        // (§17 L1). `blankBeforeInvisible` is deliberately not counted here -
        // a run broken by a comment is not a run of blank lines.
        if (pendingBlanks >= 3) hardBoundary = true
        else loose = true
      }
    }

    // Compact list blocks (Carve): an internal blank line loosens the item only
    // when the content after it is a plain paragraph (a real second paragraph).
    // A blank followed by a block opener (sub-list, quote, fence, div, heading,
    // table) keeps the item tight, so an item can carry a sub-block without the
    // list going loose. Only the tight/loose RENDERING changes; block structure
    // is unchanged. (Canonical djot renders these loose; Carve deviates here.)
    // A blank line INSIDE a fenced block is that block's content, not an
    // interior block separator, so it must not loosen the item (carve#326 case
    // C; matches carve-rs / carve-php). Precompute which lines fall inside a
    // CLOSED fence in a single pass, then skip those blanks in the scan below.
    // Only a fence with a matching closer forms a block; an UNCLOSED opener is
    // inline verbatim inside a paragraph, so a following blank still loosens
    // (matches carve-rs). The opener may be the item's lead (a marker-line
    // fence, `- ``` `, which is not in `nested`), so the pass prepends `content`
    // and a `nested[k]` corresponds to `fenceLines[k + 1]`. Marking closed
    // ranges is O(n) total (ranges never overlap), keeping the scan linear.
    //
    // ALL THREE FENCE KINDS. This knew only the code fence, which is the same
    // one-kind-of-three defect corpus category 279 pins for the collectors -
    // and it surfaced the moment they were fixed: the blank inside a
    // `+`-attached `::: note` or `%%%` body reaches `nested` now and loosened
    // the item, where the identical code fence kept it tight.
    //
    // STILL ONE STATEFUL PASS, not one scan per line. Asking
    // `fencedBlockEnd` at every index reads the same suffix again for every
    // unterminated opener, which is quadratic: an item of N comment openers of
    // strictly increasing width (none of which can close) went from 137ms to
    // 15s at N=4000, a parser DoS on a 4000-line document. The stack below is
    // `findColonCloser`'s nesting model run once, left to right, which is what
    // keeps the whole pass linear (ranges never overlap).
    const fenceLines = [content, ...nested]
    const inFence: boolean[] = new Array(fenceLines.length).fill(false)
    // AN OPENER WITH NO CLOSER AHEAD OPENS NOTHING, so it must not latch this
    // pass either. Without the check an unterminated `%%%` swallowed every
    // later line and a genuinely CLOSED code fence below it went unmarked, so a
    // blank inside that code loosened the item - the divergence from what the
    // block parser does with the same lines. Raised by codex review.
    const closers = buildCloserIndex(fenceLines)
    // THE ITEM'S LEAD CONTAINER HIDES NOTHING (markup-carve/carve#1602). A
    // `:::` container that IS the item's first block is the item's own body:
    // the blank line between two of its blocks is the only blank line the item
    // has, and §17 L1 reads it. That is already what happens when the closer is
    // MISSING - an unterminated opener latches nothing below, so the blank is
    // seen and the list is loose - and writing the closer is a spelling change,
    // so it must not move the tightness. Marking the range made
    //
    //     - ::: d
    //       b
    //
    //       tail
    //
    // loose and the same document with `  :::` written TIGHT, which is
    // `parse(fmt(x)) != parse(x)` - PART 11 §1 - on the one corpus document
    // where the writer supplies a missing closer, corpus
    // `362-an-unterminated-container-does-not-extend-the-item-past-a-blank-line-3`.
    // The maintainer ruled the two converge on the reading the SOURCE already
    // gets, which is loose.
    //
    // A container the item ATTACHES below a lead block keeps its interior: a
    // blank between two of ITS blocks is the container's, not the item's, and
    // corpus `279-a-boundary-line-inside-an-open-fence-does-not-end-the-
    // container-10` pins that reading. So the lead test is what separates them,
    // not the presence of a closer.
    //
    // STILL ONE MARKED RANGE PER OUTERMOST OPAQUE FENCE, so the pass stays
    // linear. `openOpaque` counts the opaque fences currently open, and only
    // the transition through zero writes a range: nesting a hundred containers
    // inside an item marks the outermost span once rather than once per level,
    // which is the same bound the openIdx it replaces had.
    const firstContentIdx = fenceLines.findIndex((l) => l.trim() !== '')
    const open: Array<{
      kind: 'code' | 'comment' | 'colon'
      close: RegExp | null
      len: number
      opaque: boolean
    }> = []
    let openOpaque = 0
    let opaqueIdx = -1
    const enter = (entry: { opaque: boolean }, k: number): void => {
      if (!entry.opaque) return
      if (openOpaque === 0) opaqueIdx = k
      openOpaque++
    }
    const leave = (entry: { opaque: boolean }, k: number): void => {
      if (!entry.opaque) return
      openOpaque--
      if (openOpaque > 0) return
      for (let i = opaqueIdx; i <= k; i++) inFence[i] = true
      opaqueIdx = -1
    }
    for (let k = 0; k < fenceLines.length; k++) {
      const line = fenceLines[k]!
      const inner = open[open.length - 1]
      if (inner !== undefined && inner.kind !== 'colon') {
        const closed =
          inner.kind === 'code' ? inner.close!.test(line) : commentFenceRun(line) === inner.len
        if (!closed) continue
        open.pop()
        leave(inner, k)
        continue
      }
      if (inner !== undefined) {
        // Inside a colon fence a bare run of the INNERMOST width closes it and
        // any other run opens one (carve#455's exact-length rule).
        const close = RE_ADMONITION_CLOSE.exec(line)
        if (close) {
          const len = close[1]!.length
          if (len === inner.len) {
            open.pop()
            leave(inner, k)
          } else {
            const nested = { kind: 'colon' as const, close: null, len, opaque: true }
            open.push(nested)
            enter(nested, k)
          }
          continue
        }
      }
      const fence = RE_FENCE.exec(line)
      const rawFence = fence ? null : RE_RAW_FENCE.exec(line)
      const marker = fence ? fence[2]! : rawFence ? rawFence[1]! : null
      let opened: { kind: 'code' | 'comment' | 'colon'; close: RegExp | null; len: number } | null =
        null
      if (marker !== null) {
        if (codeCloserPossible(closers, marker, k))
          opened = { kind: 'code', close: fenceCloseRe(marker), len: marker.length }
      } else {
        const run = commentFenceRun(line)
        if (run !== undefined) {
          if (exactCloserPossible(closers.comment, run, k))
            opened = { kind: 'comment', close: null, len: run }
        } else {
          // AN UNTERMINATED CONTAINER RUNS TO THE END OF THE ITEM, so its
          // interior is its own whether or not the closer is written
          // (markup-carve/carve-js#1376). The closer gate stays for the two
          // VERBATIM kinds, where an opener with none is inline verbatim inside
          // a paragraph and opens no block at all; a `:::` with none still
          // opens a container - corpus family 362 pins that - so gating it here
          // made the blank line inside it visible to the scan and the item
          // read LOOSE where the identical document with `:::` written read
          // TIGHT. That is PART 11 §1 in both its forms, the HTML one included:
          // the lead paragraph rendered `<p>x</p>` on one side and `x` on the
          // other.
          //
          // The maintainer ruled TIGHT, converging on the reading the engine
          // already gives the closed spelling - #1602's principle, from the
          // other side - which is also carve-php's answer in both attached
          // configurations and keeps corpus
          // `279-a-boundary-line-inside-an-open-fence-does-not-end-the-container-10`.
          const colon = colonBlockOpenerRun(line)
          if (colon !== null) opened = { kind: 'colon', close: null, len: colon }
        }
      }
      if (opened === null) continue
      const entry = {
        ...opened,
        opaque: !(opened.kind === 'colon' && k === firstContentIdx),
      }
      open.push(entry)
      enter(entry, k)
    }
    // WHAT IS STILL OPEN AT THE END REACHED THE END, and its range is marked
    // from where it opened to the item's last line. Only the loop's transition
    // through zero wrote a range, so an unterminated container left the stack
    // non-empty and marked nothing - which is the same blindness the closer gate
    // above used to produce, one step later.
    if (openOpaque > 0 && opaqueIdx >= 0) {
      for (let i = opaqueIdx; i < fenceLines.length; i++) inFence[i] = true
    }
    // A FOOTNOTE DEFINITION'S BLOCK RUNS TO THE END OF ITS BODY, blank lines and
    // all (markup-carve/carve#1363, PART 1 S4). A blank between two lines of the
    // definition is inside its block, not an interior separator of the item, so
    // it must not loosen the item any more than a blank inside a fence does.
    //
    // ONLY THE FOOTNOTE FORM. A link reference definition has no body at all, so
    // it opens no run and the blank after it still loosens - `- a` /
    // `  [r]: /u` / blank / `    more` IS a second paragraph (corpus 359-2). That
    // is the control an over-wide fix breaks, and it is the whole difference
    // between the two definition kinds here.
    const inFootnoteRun: boolean[] = new Array(nested.length).fill(false)
    for (let k = 0; k < nested.length; k++) {
      const line = nested[k]!
      if (indentColumns(line, 1) !== 0 || !RE_FOOTNOTE_DEF.test(line)) continue
      // The run reaches the LAST indented line under the definition; the blanks
      // after that one are the item's again, so a trailing blank still loosens.
      let last = k
      for (let j = k + 1; j < nested.length; j++) {
        const next = nested[j]!
        if (next === '') continue
        // The same `FOOTNOTE_BODY_COLUMN` boundary the tracker uses, so the two
        // agree about where the definition's block ends.
        if (indentColumns(next, FOOTNOTE_BODY_COLUMN) < FOOTNOTE_BODY_COLUMN) break
        last = j
      }
      for (let j = k + 1; j <= last; j++) inFootnoteRun[j] = true
      k = last
    }
    for (let k = 0; k < nested.length; k++) {
      if (inFence[k + 1]!) continue
      if (inFootnoteRun[k]!) continue
      if (nested[k] !== '') continue
      // A `+`-injected separator never loosens, even when the block it attaches
      // is a plain paragraph -- it keeps the item tight like a `+`-attached
      // quote/code/table (Bug B, corpus 83-list-continuation-marker family).
      if (plusSeparators.has(k)) continue
      let j = k + 1
      // Skip blanks AND invisible lines: §17 L1 loosens on a second PARAGRAPH,
      // and a comment or a definition renders nothing, so it is neither the
      // paragraph that loosens nor a wall that hides one behind it. Stopping at
      // the invisible line instead of looking past it kept `%% n` / `text`
      // tight, which is the opposite error - the item does hold a second
      // paragraph, it just has a comment in front of it (carve#621).
      while (j < nested.length) {
        if (nested[j] === '') {
          j++
          continue
        }
        const comment = commentFenceRun(nested[j]!)
        if (comment !== undefined) {
          let close = j + 1
          while (close < nested.length && commentFenceRun(nested[close]!) !== comment) close++
          // A closed comment fence is one invisible block. Its verbatim
          // payload is not a paragraph behind an invisible opener.
          if (close < nested.length) {
            j = close + 1
            continue
          }
        }
        if (isInvisibleLine(nested[j]!)) {
          j++
          continue
        }
        break
      }
      if (j >= nested.length) continue
      // A blank followed by content the item's SUB-LIST consumes does not
      // loosen THIS item: that content belongs to the sub-list, whose looseness
      // is decided by its own recursive parse. Counting it here wrongly
      // propagates a child's looseness up to the parent (carve#322). The
      // threshold is the sub-list's content column: a line at or past it is the
      // sub-list's, a line BELOW it (an above-content-column line, §24 C3, or a
      // dedented column-0 paragraph) is the item's OWN block and still loosens.
      // Matches carve-php / carve-rs, and the sibling-blank invariant where the
      // outer item stays tight.
      if (firstBlockIdx !== -1) {
        const subCol = markerContentColumn(nested[firstBlockIdx]!)
        if (subCol >= 0 && indentColumns(nested[j]!, subCol) >= subCol) continue
      }
      // `j` can no longer be an invisible line (skipped above), so this is the
      // plain "is the next visible thing a paragraph" test it always was.
      //
      // STILL `lineOpensBlock`, not §24 C3's wider family. The rebase above has
      // already rewritten an over-indented opener into its exact-column
      // spelling, so asking the ordinary question here is what makes the two
      // spellings agree. Asking `lineOpensItemBlock` instead widened the
      // EXACT-column case too, and a lone block image - a paragraph under §17
      // L2 - stopped loosening its item (corpus 411, 162).
      if (!lineOpensBlock(nested[j]!)) {
        loose = true
        break
      }
    }

    // When the item's content BEGINS, on the marker line, with another list
    // marker (`- - A`, `* - A`, `1. - A`, ...), the lead is itself a sub-list,
    // not a paragraph. Carve then parses the lead together with every following
    // dedented line as ONE block stream so the marker-line sub-list behaves
    // exactly like a sub-list opened on a *following* line: following
    // same-indent markers MERGE into it as siblings, and post-blank indented
    // blocks are ABSORBED into its items. This MATCHES reference djot.js
    // (@djot/djot 0.3.2) and CommonMark, which both treat a marker-line
    // sub-list as a normal nested list. It corrects Carve's prior line-scoping
    // (which split the sub-list from following items and leaked later indented
    // blocks to the parent row) -- a bug inherited from djot-php, whose
    // marker-line handling deviates from reference djot (see
    // php-collective/djot-php). The single combined stream reuses the normal
    // nested-list/absorption logic -- no separate path. The lead/block split
    // below stays for the indented-ordered sub-list case (an ordered marker
    // that does NOT interrupt the lead paragraph), where the lead really is a
    // paragraph.
    // When the lead is a colon-fence opener (`::: word` admonition or a bare
    // `:::` div) whose matching closer line sits among the collected nested
    // lines, the body in between -- including a nested LIST -- belongs to the
    // container. The `firstBlockIdx` split (which exists to let an indented
    // ordered sub-list nest instead of folding) would otherwise sever the
    // opener from its body, leaving `::: word` literal and the closer as
    // trailing text. Keep the whole stream together so the admonition/div
    // opener captures its nested-list body and finds its closer (matching
    // carve-rs / the grammar `admonition = open, {block}, close`). The closer
    // must be one of the collected (item-content-column) lines: a closer at
    // column 0 dedents out of the item and is not in `nested`, so this guard
    // does not fire and the opener correctly stays literal.
    const leadOpensColonFence =
      (RE_ADMONITION_OPEN.test(content) && !RE_ADMONITION_CLOSE.test(content)) ||
      RE_DIV_OPEN.test(content)
    // Parse the lead text together with its continuation/nested lines as one
    // block sequence (lazy continuation merges into the lead paragraph). An
    // indented ordered sub-list, however, is parsed as its own block stream so
    // it nests instead of folding into the lead paragraph.
    const literalBelowColumnColonFence =
      leadOpensColonFence && nested.length > 0 && !bodyHasContentColumnLine
    const itemLead = literalBelowColumnColonFence ? ` ${content}` : content
    const keepStreamWhole =
      firstBlockIdx === -1 || leadIsMarker || (leadOpensColonFence && !literalBelowColumnColonFence)
    const leadLines = keepStreamWhole ? nested : nested.slice(0, firstBlockIdx)
    const blockLines = keepStreamWhole ? [] : nested.slice(firstBlockIdx)
    const mkSub = (
      lines: readonly string[],
      startLineIndex: number,
      sourceLineMap?: number[],
    ): Lexer => {
      const sub = nestedSubLexer(lexer, lines, startLineIndex, sourceLineMap)
      // THIS BODY'S COLUMN 0 IS THE ITEM'S CONTENT COLUMN, so a marker reaching
      // it opens a sublist rather than folding into an open paragraph (§24 C3,
      // markup-carve/carve#1517). Set here rather than in `nestedSubLexer`
      // because it must NOT travel: a quote, a div or a definition body inside
      // the item gets its own lexer without it, and a marker there folds as §10
      // I2 says.
      sub.markerOpensSublist = true
      return sub
    }
    // AN ATTRIBUTE BLOCK MUST SURVIVE THE SPLIT (markup-carve/carve#1238,
    // carve-js#1100). The two `parseBlocks` calls below are one stream to the
    // author: the item's lead, then the sub-list the `firstBlockIdx` split hands
    // to its own lexer so the list parser owns its looseness bookkeeping. Each
    // call kept its own pending-attribute slot, so a `{...}` line written
    // immediately before the sub-list ended the FIRST stream with a dangling run
    // and was dropped, while the sub-list opened the second one with an empty
    // slot:
    //
    //     - a
    //
    //       {.x}
    //       - b
    //
    // A paragraph, quote or fence in that position is not a marker, so the
    // collector never split there and those cases always attached -- which is
    // why the nested list was the ONE block type in an item that lost its
    // attributes, blank line or no blank line. `carry` reunites the halves.
    //
    // Deliberately NOT a "was the whole chunk an attribute block" test on the
    // lines: `parseBlocks` is what decides whether a `{...}` line IS an
    // attribute run, and only it knows the answers that matter here -- the
    // strict column-0 rule (a brace one column in is paragraph text, so
    // `- a` / blank / `   {.c}` keeps its literal paragraph), an open fence
    // (whose body is verbatim), and §15 A2a's float past an invisible
    // construct. Reading the lines a second time here would be a second
    // spelling of that rule, free to drift from the first.
    const carry: PendingAttrCarry = { attrs: null }
    const children = parseBlocks(
      mkSub([itemLead, ...leadLines], itemStartLineIndex, [
        lexer.lineNumber(itemStartLineIndex),
        ...nestedLineNumbers.slice(0, leadLines.length),
      ]),
      0,
      blockLines.length > 0 ? carry : undefined,
    )
    if (blockLines.length > 0) {
      children.push(
        ...parseBlocks(
          mkSub(
            blockLines,
            itemStartLineIndex + 1 + firstBlockIdx,
            nestedLineNumbers.slice(firstBlockIdx),
          ),
          0,
          carry,
        ),
      )
    }

    const item: ListItem = { type: 'list_item', children }
    let itemEnd = lexer.pos
    while (itemEnd > itemStartLineIndex + 1 && isBlankLine(lexer.lines[itemEnd - 1]!)) itemEnd--
    // The end-at-the-last-placed-child fixup that used to sit here moved into
    // `attachBlockPos`, which now applies it to every closerless container
    // rather than to items alone (markup-carve/carve#1522).
    attachBlockPos(lexer, item, itemStartLineIndex, itemEnd)
    if (checked !== undefined) item.checked = checked
    if (itemAttrs) item.attrs = itemAttrs
    items.push(item)
    if (hardBoundary) break
  }

  const list: List = { type: 'list', ordered: isOrdered, tight: !loose, items }
  if (isOrdered) {
    if (orderedStart !== 1) list.start = orderedStart
    const t = olTypeOf(orderedKind)
    if (t) list.olType = t
    if (orderedDelim === '.' || orderedDelim === ')') list.delim = orderedDelim
    // The bare dot is a spelling, not a dialect: `. a` and `1. a` are the same
    // list, so the tree has to carry which one opened it or the writer must
    // normalize one away (PART 11 §6).
    if (firstOrdered && firstOrdered[2] === '') list.bareMarker = true
  } else if (firstMarkerChar === '-' || firstMarkerChar === '*') {
    list.bulletChar = firstMarkerChar
  }
  return list
}

/**
 * Parse a table cell's leading markers from its raw between-pipe text.
 *
 * Disambiguation follows the spec's writing convention: markers are
 * written *tight* against the pipe (`|=`, `|=>`, `|>`, `|<`, `|~`) with
 * no separating space, so they are only recognized at index 0 of the
 * raw cell text. A normal cell always has a space after the pipe
 * (`| Alice`, `| <https://x>`, `| >10`), so content that merely begins
 * with `<`/`>`/`~`/`=` is preserved verbatim.
 *
 * A cell whose trimmed content is exactly `^` or `<` (always written
 * spaced, e.g. `| ^ |`, `| < |`) is a rowspan/colspan marker. The tight
 * prefix is an optional `=` (header) followed by an optional alignment
 * marker (`>` right, `<` left, `~` center).
 */
/**
 * The characters a table cell reads as an ALIGNMENT MARKER, glued to `|` or `|=`.
 *
 * Exported so the Carve writer can read the set off the parser instead of
 * carrying a second copy of it. The writer must not emit a header marker
 * immediately followed by one of these, because the next parse eats it as
 * alignment and keeps the rest of the cell as text (markup-carve/carve-js#903).
 * A guard built from a hand-listed set would be a second spelling of this rule,
 * and this repository has repeatedly found one rule spelled N times where N was
 * larger than anyone claimed.
 */
export const TABLE_ALIGNMENT_MARKERS: ReadonlyMap<string, 'left' | 'right' | 'center'> = new Map([
  ['>', 'right'],
  ['<', 'left'],
  ['~', 'center'],
])

/**
 * Read a table cell's attribute block at `from`, if there is one there.
 *
 * Uses the quote-aware inline-attribute matcher so a quoted `}` inside a value
 * (`{key="{y}"}`) is handled rather than truncated at the first brace. The WHOLE
 * payload must then be valid attribute syntax (same as inline and block
 * attribute blocks); a partially-invalid payload like `{.x 1bad}` is not an
 * attribute block, so the `{` stays ordinary content.
 *
 * Exported so the linter asks this question the same way the parser answers it.
 * A rule spelled twice drifts, and the rule this one serves - the block binds
 * after the markers - already had four spellings across the engines to unify.
 */
export function readCellAttributeBlock(
  src: string,
  from = 0,
): { attrs: Attrs; length: number } | undefined {
  if (src[from] !== '{') return undefined
  const m = RE_INLINE_ATTR.exec(src.slice(from))
  if (!m || !isValidInlineAttrPayload(m[1]!)) return undefined
  const attrs = parseAttrs(m[1]!)
  if (isEmptyAttrs(attrs)) return undefined

  return { attrs, length: m[0].length }
}

function parseCellMarkers(src: string): {
  header: boolean
  span?: 'rowspan' | 'colspan'
  align?: 'left' | 'right' | 'center'
  valign?: 'top' | 'middle' | 'bottom'
  attrs?: Attrs
  content: string
} {
  // A lone `<` is a colspan marker even when it is glued to the pipes (`|<|`).
  // It may fail to merge later (for example in column 0), but it must still
  // render as an empty structural marker cell rather than an empty left-aligned
  // cell. Non-lone prefixes such as `|< text|` remain per-cell alignment.
  if (trimCellPadding(src) === '<') return { header: false, span: 'colspan', content: '' }

  // Tight prefix only: the marker must sit at index 0 of the raw text.
  let i = 0
  let header = false
  if (src[i] === '=') {
    header = true
    i++
  }
  // A one- or two-axis run is consumed as a unit. A duplicate axis other than
  // `~~` invalidates the whole run, so `|=<< Note|` keeps both `<` bytes as
  // visible content instead of silently consuming a valid-looking prefix.
  const markerStart = i
  let align: 'left' | 'right' | 'center' | undefined
  let valign: 'top' | 'middle' | 'bottom' | undefined
  let inheritedHorizontal = false
  let invalidAxis = src[i] === '^' || src[i] === 'v' ||
    (src[i] === '~' && (src[i + 1] === '<' || src[i + 1] === '>'))
  if (src[i] === '?' && src[i + 1] !== undefined && '^~v'.includes(src[i + 1]!)) {
    inheritedHorizontal = true
    valign = src[i + 1] === '^' ? 'top' : src[i + 1] === '~' ? 'middle' : 'bottom'
    i += 2
  }
  while (!inheritedHorizontal && src[i] !== undefined && '<>~^v?'.includes(src[i]!)) {
    const marker = src[i]!
    if (marker === '?') {
      invalidAxis = true
      break
    } else if (marker === '<' || marker === '>' || marker === '~') {
      if (align === undefined) {
        align = marker === '<' ? 'left' : marker === '>' ? 'right' : 'center'
      } else if (marker === '~' && valign === undefined) {
        valign = 'middle'
      } else {
        invalidAxis = true
        break
      }
    } else {
      if (valign !== undefined) { invalidAxis = true; break }
      valign = marker === '^' ? 'top' : 'bottom'
    }
    i++
  }
  const validRun = i > markerStart &&
    !invalidAxis &&
    (align !== undefined || inheritedHorizontal) &&
    (src[i] === ' ' || src[i] === '{' ||
      (!inheritedHorizontal && src[i] !== undefined && '<>~^v?'.includes(src[i]!)))
  if (!validRun) {
    i = markerStart
    align = undefined
    valign = undefined
    inheritedHorizontal = false
  }

  // A `{...}` attribute block supplies the cell's attributes. It binds LAST -
  // after the kind marker and after the alignment marker, in every cell - and
  // is GLUED to whatever precedes it: to the marker run where the cell has one
  // (`|=<{.x} …`), to the opening `|` where it has none (`|{.x} …`). The rest,
  // after optional whitespace, is the cell content. A SPACE before the brace
  // (`| {.x}`) is ordinary content, not attributes. A cell that carries an
  // attribute block is never a bare span marker, so its content is literal
  // even if it is just `<`/`^`. An invalid payload leaves the `{` as content.
  //
  // The order is what makes an attributed HEADER cell expressible at all. With
  // the block bound ahead of the `=`, the only available shape is `|{#x}=R|`,
  // and that is ambiguous by construction: an attributed header cell, or a data
  // cell whose content starts with `=`. This grammar reads it the second way,
  // so the shape the writer produced for an attributed header cell came back as
  // `<td id="x">=R</td>` and the round-trip invariant failed on it. Once `=`
  // has committed the cell to header, everything after it is unambiguous
  // (spec §5 T10, corpus 319).
  const block = readCellAttributeBlock(src, i)
  let attrs = block?.attrs
  if (block) i += block.length

  // Spec §5 T11: THE MARKER RUN ENDS AT A SPACE. The kind marker, the alignment
  // run and the attribute block are ONE run, and a cell carrying any of them
  // must follow it with one literal space. Without that space there is no run
  // and every character of it is content, so `|=hot= |` is the highlight its
  // author wrote rather than a header cell holding `hot=`. The closing pipe is
  // not a terminator (`|= |` is the empty header cell) and neither is a tab,
  // which PART 7 gives no padding role inline. The run is ATOMIC: a rejected
  // alignment run takes the `=` with it, which is why the reset below clears
  // `header` as well.
  if (i > 0 && src[i] !== ' ') {
    i = 0
    header = false
    align = undefined
    valign = undefined
    inheritedHorizontal = false
    attrs = undefined
  }

  if (i > 0) {
    // A tight prefix was consumed; the rest is content.
    const content = trimCellPadding(src.slice(i))
    if ((align !== undefined || valign !== undefined) && attrs !== undefined) return { header, ...(align ? { align } : {}), ...(valign ? { valign } : {}), attrs, content }
    if (align !== undefined || valign !== undefined) return { header, ...(align ? { align } : {}), ...(valign ? { valign } : {}), content }
    if (attrs !== undefined) return { header, attrs, content }
    return { header, content }
  }

  // No tight prefix: a lone `^`/`<` (always spaced) is a span marker;
  // otherwise the whole trimmed text is content.
  const trimmed = trimCellPadding(src)
  if (trimmed === '^') return { header: false, span: 'rowspan', content: '' }
  return { header: false, content: trimmed }
}

/**
 * Would a cell holding exactly this payload be read as a SPAN MARKER?
 *
 * Exported so the Carve writer can read the rule off the parser instead of
 * carrying a second copy of it, the same way `TABLE_ALIGNMENT_MARKERS` is.
 * Naming `^` and `<` in the writer would be an enumeration that goes stale the
 * next time a cell-level marker is added, and the alignment sigil's history is
 * what that costs: each writer answered that class with its own slightly
 * different set of characters.
 *
 * PADDING IS NOT AN ESCAPE WHERE THE PRODUCTION ADMITS PADDING (PART 11
 * section 6f). Section 6e's one space in front of a cell's content puts it out
 * of reach of the three slots that are read GLUED to the opening pipe, and that
 * argument holds only where the construct forbids the padding. The span cell is
 * written WITH the padding inside it -
 *
 *     rowspan_marker = {space}, '^', {space} ;
 *     colspan_marker = {space}, '<', {space} ;
 *
 * so a cell whose whole payload is `^` or `<` re-reads as a span however it is
 * padded, and section 2 is what applies: omitting the escape changes the
 * re-parse.
 *
 * The predicate is over the PAYLOAD, so it answers the question the writer can
 * ask before it has decided which prefix the cell takes. Both of the parser's
 * span decisions above are reached with `i === 0`, on the padding-trimmed
 * source, so a payload is a marker exactly when its trimmed form is one: a
 * leading `^` sets `invalidAxis`, and a lone `<` is caught ahead of the run
 * scan outright.
 */
export function cellPayloadIsSpanMarker(payload: string): boolean {
  const trimmed = trimCellPadding(payload)
  return trimmed === '^' || trimmed === '<'
}

interface RawCell {
  header: boolean
  span?: 'rowspan' | 'colspan'
  align?: 'left' | 'right' | 'center'
  valign?: 'top' | 'middle' | 'bottom'
  attrs?: Attrs
  raw: string
  /**
   * The backtick run this cell's collected source ends INSIDE, 0 when it ends
   * outside one. Carried forward per continuation row rather than recomputed
   * from `raw`, which would be quadratic in the number of rows.
   */
  openRun: number
  /**
   * Where this cell sits in the document, when that is answerable.
   *
   * Cleared once a `+` continuation row merges into the cell: its content then
   * comes from two non-adjacent regions, so no single span covers it and PART 12
   * section 4 forbids inventing one.
   */
  pos?: Position
  /**
   * Where each FRAGMENT of `raw` came from, one range per source region, set
   * only for a fragment VERIFIED to appear verbatim at that point in its line -
   * a fragment whose source cannot be confirmed contributes no range, so the
   * nodes over it go unplaced rather than landing on a wrong offset.
   *
   * A cell with no `+` continuation has exactly one range covering all of `raw`,
   * which maps the same way a single base offset did. A CONTINUED cell has one
   * per row, with the joining space between them mapping to nothing: the
   * fragments each sit verbatim in the document even though their concatenation
   * does not, so the inlines inside one fragment are placeable and only the ones
   * reaching across a row boundary are not (markup-carve/carve-js#1153).
   */
  anchors?: AnchorRange[]
}

const isGfmDelimiterCell = (c: RawCell): boolean =>
  !c.span && !c.attrs && /^:?-+:?$/.test(trimCellPadding(c.raw))

const isGfmDelimiterRow = (row: RawCell[]): boolean =>
  row.length > 0 && row.every(isGfmDelimiterCell)

// A row attribute block is a valid `{...}` attribute block GLUED to the row's
// closing `|` and running to end of line -- the row-level twin of a cell's
// opening-pipe attribute block. It sets the `<tr>` attributes. The whole
// payload must be valid attribute syntax (same gate as cell / inline / block
// attributes); otherwise the `{` is ordinary content and there is no row attr.
export function rowAttrsFromLine(line: string): { attrs?: Attrs; body: string } {
  const stripped = line.replace(/[ \t]+$/, '')
  const lastPipe = stripped.lastIndexOf('|')
  if (lastPipe < 0 || stripped[lastPipe + 1] !== '{') return { body: line }
  const after = stripped.slice(lastPipe + 1)
  const m = RE_INLINE_ATTR.exec(after)
  if (m && m[0].length === after.length && isValidInlineAttrPayload(m[1]!)) {
    const attrs = parseAttrs(m[1]!)
    if (!isEmptyAttrs(attrs)) return { attrs, body: stripped.slice(0, lastPipe + 1) }
  }
  return { body: line }
}

/**
 * The length of the backtick run a cell's source ends INSIDE, or 0 when it ends
 * outside one, resumed from the state `from` the cell was already in.
 *
 * The state a `+` continuation row's matching column starts in: a run the base
 * row left open is still open when the continuation is cut, which is what keeps
 * that continuation's own pipes content (PART 9 §22,
 * markup-carve/carve#1293).
 *
 * RESUMED, never recomputed. A cell accumulates a fragment per continuation row,
 * so re-reading the whole accumulated text before every row is quadratic in the
 * number of rows - about a second on sixteen thousand short continuations,
 * against forty milliseconds. Each cell carries its own state forward instead,
 * and only the new fragment is read.
 *
 * ESCAPE-AWARE OUTSIDE A RUN, because this measures the state the INLINE parser
 * will be in for this text. Outside a run an escaped backtick opens nothing, and
 * a scan that counted it opened a run the inline pass does not have - which made
 * the continuation's real opener look like a closer and split a cell the run
 * owns, dropping the segment behind it. INSIDE a run the body is verbatim and
 * resolves no escapes, so the backslash is content and the backtick after it
 * still closes.
 */
function openVerbatimRun(text: string, from = 0): number {
  let openRun = from
  for (let i = 0; i < text.length; i++) {
    if (openRun === 0 && text[i] === '\\') {
      // OUTSIDE a run only. An escape consumes the next character, so an
      // escaped backtick opens nothing. INSIDE one the body is verbatim and
      // resolves no escapes, so the backslash is content and the backtick
      // after it still closes - which is what the inline parser does with it.
      i++
      continue
    }
    if (text[i] !== '`') continue
    let run = 1
    while (text[i + run] === '`') run++
    if (openRun === 0) openRun = run
    else if (run === openRun) openRun = 0
    i += run - 1
  }

  return openRun
}

function parseTable(lexer: Lexer): Table | Figure {
  // Collect raw cell source first; a `+` continuation row appends its
  // non-empty fragments to the previous row's *source* so an inline
  // construct spanning the line boundary is one logical cell. Inline
  // parsing happens once, after merging.
  const rawRows: RawCell[][] = []
  const rowAttrsList: (Attrs | undefined)[] = []
  /** Where a row BEGINS, by row index - its own line, not its first cell's. */
  const rowStarts: Array<{ line: number; column: number; offset: number } | undefined> = []
  /** Where a row ENDS once `+` continuations have extended it, by row index. */
  const rowEnds: Array<{ line: number; column: number; offset: number } | undefined> = []
  let lastRaw: RawCell[] | null = null
  while (
    !lexer.eof() &&
    (isTableRow(lexer.peek()!) || RE_TABLE_CONT.test(lexer.peek()!))
  ) {
    const line = lexer.peek()!
    const lineIndex = lexer.pos
    if (RE_TABLE_CONT.test(line)) {
      if (!lastRaw) break // a continuation with no row to extend
      if (
        rawRows.length === 2 &&
        rawRows[1] === lastRaw &&
        isGfmDelimiterRow(lastRaw) &&
        !isGfmDelimiterRow(rawRows[0]!)
      )
        break
      lexer.consume()
      // A row that continues still occupies a CONTIGUOUS run of lines, and no
      // sibling row overlaps it - so unlike its cells, the row can be placed.
      // Recording where it now ends is what makes that possible.
      rowEnds[rawRows.length - 1] = {
        line: lexer.lineNumber(lineIndex),
        column: lexer.lineStartColumn(lineIndex) + line.length,
        offset: lexer.lineOffset(lineIndex) + line.length,
      }
      const contOffset = lexer.lineOffset(lineIndex)
      const contLine = lexer.lineNumber(lineIndex)
      const contColumn = lexer.lineStartColumn(lineIndex)
      const contCanPosition = lexer.hasDocumentOffsets
      splitTableRowSpans(line, lastRaw.map((c) => c.openRun)).forEach(({ text: src, start }, idx) => {
        const frag = trimCellPadding(src)
        const target = lastRaw![idx]
        // A fragment on a span (`^`/`<`) column is skipped: the spec's
        // "Combined: Rowspan + Multi-line" example always places the `+`
        // rows *before* the `^` row, so they extend the real origin cell
        // (verified). A `+` after the span row is not a spec'd ordering.
        if (!frag || !target || target.span) return
        const fragStart = target.raw ? target.raw.length + 1 : 0
        target.raw = target.raw ? `${target.raw} ${frag}` : frag
        // Only the NEW fragment is read; the joining space is not a run
        // character, so resuming from the cell's own state is exact.
        target.openRun = openVerbatimRun(frag, target.openRun)
        // The CELL keeps no span. Its content sits in two column ranges on
        // non-adjacent lines, and one range covering both would swallow the
        // neighbouring column's content on the lines between - so cell 1 would
        // CONTAIN cell 0, and an offset would map to two sibling cells at once.
        // A construct that is not one contiguous range cannot honestly be one.
        delete target.pos
        // The INLINE content does not go with it. Each fragment still sits
        // verbatim on its own line, so it gets its own range and the inlines
        // inside it keep real spans; only a node reaching across the row
        // boundary - and the joining space that stands in for it - has no span
        // to state (markup-carve/carve-js#1153).
        //
        // The same verbatim check as the base row, and DOMINATED the same way:
        // `splitTableRowSpans` builds each piece as a contiguous slice of the
        // line and `trimCellPadding` removes only spaces from its ends, so the
        // compare held on all 1131 corpus documents and on 200k random table
        // shapes. It is kept because its failure mode is the useful one - a
        // fragment that is not a slice of its line contributes no range, and the
        // nodes over it go unplaced rather than landing on a wrong offset, which
        // is what the base row's check was added for when `\|` was still
        // resolved here and left the text shorter than its source (#462).
        const within = contCanPosition ? src.indexOf(frag) : -1
        if (within >= 0 && line.slice(start + within, start + within + frag.length) === frag) {
          const range: AnchorRange = {
            from: fragStart,
            to: fragStart + frag.length,
            offset: contOffset + start + within,
            line: contLine,
            column: contColumn + start + within,
          }
          if (target.anchors) target.anchors.push(range)
          else target.anchors = [range]
        }
        // NO CLAMP ON THE RANGE BEFORE when this fragment is unplaceable. A
        // range's `to` is the length `raw` had when it was appended, and the
        // next fragment starts one past that, so the joining space is already
        // the only offset between them and an unplaced fragment simply leaves a
        // wider gap. `to` is inclusive so an exclusive span end may land on it;
        // the space itself belongs to no range, which is what makes a node
        // reaching across the boundary unplaceable.
      })
      continue
    }
    lexer.consume()
    const { attrs: rowAttrs, body: rowBody } = rowAttrsFromLine(line)
    // Positions are only emitted when this lexer can express a document offset.
    // Verifying the content against the local line is not enough: inside an
    // unmapped container the check passes while the offset means something else.
    const canPosition = lexer.hasDocumentOffsets
    const lineOffset = lexer.lineOffset(lineIndex)
    const lineNo = lexer.lineNumber(lineIndex)
    const lineCol = lexer.lineStartColumn(lineIndex)
    const raw: RawCell[] = splitTableRowSpans(rowBody).map(({ text: src, start }) => {
      const { header, span, align, valign, attrs, content } = parseCellMarkers(src)
      const c: RawCell = { header, raw: content, openRun: openVerbatimRun(content) }
      if (span) c.span = span
      if (align) c.align = align
      if (valign) c.valign = valign
      if (attrs) c.attrs = attrs
      if (canPosition) {
        c.pos = {
          startLine: lineNo,
          endLine: lineNo,
          startColumn: lineCol + start,
          endColumn: lineCol + start + src.length,
          startOffset: lineOffset + start,
          endOffset: lineOffset + start + src.length,
        }
      }
      // Anchor the cell's inline content, but only after checking the content is
      // where we think it is. `\|` unescapes to one character, so a cell holding
      // an escaped pipe is not a verbatim slice and gets no anchor.
      const within = content === '' || !canPosition ? -1 : src.indexOf(content)
      if (within >= 0 && rowBody.slice(start + within, start + within + content.length) === content) {
        c.anchors = [
          {
            from: 0,
            to: content.length,
            offset: lineOffset + start + within,
            line: lineNo,
            column: lineCol + start + within,
          },
        ]
      }
      return c
    })
    rawRows.push(raw)
    rowAttrsList.push(rowAttrs)
    // The row's own extent, independent of whether its cells keep theirs. A row
    // whose every cell continues has no cell span to start from, and it still
    // occupies these lines.
    rowStarts[rawRows.length - 1] = canPosition
      ? { line: lineNo, column: lineCol, offset: lineOffset }
      : undefined
    rowEnds[rawRows.length - 1] = canPosition
      ? {
          line: lineNo,
          column: lineCol + line.length,
          offset: lineOffset + line.length,
        }
      : undefined
    lastRaw = raw
  }
  // GFM-style header separator: when the SECOND row is a delimiter row -- every
  // cell a run of dashes with optional alignment colons (`---`, `:--`, `--:`,
  // `:-:`) -- the first row becomes the header (rendered in <thead>) and the
  // colons set per-column alignment for the whole column. The delimiter row is
  // dropped. This is in addition to Carve's tight per-cell markers `|=`/`|<`; a
  // delimiter row anywhere else is an ordinary data row.
  // A cell carrying author attributes (`|{.x} ---`) is content, not a plain
  // structural delimiter, so it never makes its row a GFM header separator.
  if (
    rawRows.length >= 2 &&
    isGfmDelimiterRow(rawRows[1]!) &&
    !isGfmDelimiterRow(rawRows[0]!)
  ) {
    const aligns = rawRows[1]!.map((c) => {
      // DOMINATED, and narrowed anyway. `isGfmDelimiterCell` above already
      // required `/^:?-+:?$/` of the SAME space-trimmed string, so a cell whose
      // padding is not a space has already stopped the row from being a
      // delimiter row and never reaches here - reverting this one site to the
      // wider trim renders all 1366 corpus documents byte-identically, plus
      // seven targeted delimiter-row probes. It is narrowed regardless, because
      // one rule spelled two ways is how this class of defect starts: the
      // domination is a property of the code above, not of the rule.
      const t = trimCellPadding(c.raw)
      const left = t.startsWith(':')
      const right = t.endsWith(':')
      return left && right ? 'center' : right ? 'right' : left ? 'left' : undefined
    })
    rawRows.splice(1, 1)
    rowAttrsList.splice(1, 1)
    rowStarts.splice(1, 1)
    rowEnds.splice(1, 1)
    for (const c of rawRows[0]!) c.header = true
    // Column alignment lands on the HEADER cells only, matching what the native
    // `|=<` markers produce. Propagating it onto body cells too made the same
    // logical table parse to two different trees depending on which separator
    // syntax was used, and the writer then serialized the propagated values as
    // per-cell markers the author never wrote (carve#352, corpus 09-tables-3).
    //
    // Nothing is lost: the HTML renderer already inherits column alignment for a
    // body cell whose own align is unset, which is how the native path has always
    // rendered aligned body cells. A genuine per-cell override still sets
    // `c.align` itself and is untouched here.
    rawRows[0]!.forEach((c, i) => {
      const a = aligns[i]
      if (a && !c.align) c.align = a
    })
  }
  const rows: TableRow[] = rawRows.map((rc, idx) => {
    const row: TableRow = {
      type: 'table_row',
      cells: rc.map((c) => {
        const cell: TableCell = {
          type: 'table_cell',
          header: c.header,
          children: c.span
            ? []
            : c.anchors?.length
              ? parseInline(
                  c.raw,
                  lexer.abbrDefs,
                  lexer.linkDefs,
                  inlineSource({
                    baseOffset: c.anchors[0]!.offset,
                    startLine: c.anchors[0]!.line,
                    startColumn: c.anchors[0]!.column,
                    anchoredRanges: c.anchors,
                  }),
                )
              : stripPositions(parseInline(c.raw, lexer.abbrDefs, lexer.linkDefs)),
        }
        if (c.span) cell.span = c.span
        if (c.align) cell.align = c.align
        if (c.valign) cell.valign = c.valign
        if (c.attrs) cell.attrs = c.attrs
        if (c.pos) cell.pos = c.pos
        return cell
      }),
    }
    // A row owns its complete source line, including its pipe delimiters.
    //
    // A `+` continuation breaks that, because the extended cell loses its own
    // span - its content sits in two column ranges on non-adjacent lines. The
    // ROW is still one contiguous range that no sibling row overlaps, so it is
    // placed from where it starts to where the continuation leaves it. Only
    // when every cell continued does the start come from the row's own line
    // rather than a cell, since there is no cell span left to take it from.
    const spans = rc.map((c) => c.pos)
    const end = rowEnds[idx]
    if (end) {
      const first = rowStarts[idx] ?? spans.find(Boolean)
      const startLine = 'startLine' in (first ?? {}) ? (first as Position).startLine : undefined
      const rowStart = first
        ? 'line' in first
          ? { line: first.line, column: first.column, offset: first.offset }
          : {
              line: startLine!,
              column: (first as Position).startColumn!,
              offset: (first as Position).startOffset!,
            }
        : undefined
      if (rowStart) {
        row.pos = {
          startLine: rowStart.line,
          endLine: end.line,
          startColumn: rowStart.column,
          endColumn: end.column,
          startOffset: rowStart.offset,
          endOffset: end.offset,
        }
      }
    } else {
      const first = spans[0]
      const last = spans[spans.length - 1]
      if (
        first &&
        last &&
        spans.every(Boolean) &&
        first.startColumn !== undefined &&
        last.endColumn !== undefined &&
        first.startOffset !== undefined &&
        last.endOffset !== undefined
      ) {
        row.pos = {
          startLine: first.startLine,
          endLine: last.endLine,
          startColumn: first.startColumn,
          endColumn: last.endColumn,
          startOffset: first.startOffset,
          endOffset: last.endOffset,
        }
      }
    }
    const ra = rowAttrsList[idx]
    if (ra) row.attrs = ra
    return row
  })
  const table: Table = { type: 'table', rows }
  // Optional caption ^ ...
  let lookahead = 0
  while (!lexer.eof() && isBlankLine(lexer.peek(lookahead))) lookahead++
  const next = lexer.peek(lookahead)
  if (next) {
    const cap = RE_CAPTION.exec(next)
    // §4: a caption attaches only when it immediately follows the block
    // or is separated by at most ONE blank line.
    if (cap && lookahead <= 1) {
      for (let i = 0; i <= lookahead; i++) lexer.consume()
      table.caption = parseCaptionInline(lexer, cap[1]!)
    }
  }
  return table
}

/**
 * Split a table row into cells, reporting where each one STARTS in the line.
 *
 * The start index is what lets a cell carry a real span (PART 12 section 4)
 * instead of none. The cell TEXT is still built character by character, because
 * `\|` is two source characters for one content character - so the text is not
 * always a verbatim slice even though its start always is.
 */
export function splitTableRowSpans(
  line: string,
  carried?: readonly number[],
): Array<{ text: string; start: number }> {
  const cells: Array<{ text: string; start: number }> = []
  let buf = ''
  // The length of the backtick run that opened the verbatim span this scan is
  // inside, or 0 when it is outside one. A BOOLEAN was not enough: a verbatim
  // run opens on a run of N backticks and closes only on a run of EXACTLY N
  // (`verbatimSpanEnd`, PART 9 §22), so toggling once per backtick read the
  // second backtick of ` ``x ` as a CLOSER and left the scan outside a run that
  // is still open - the interior `|` then split the row where the inline pass
  // reads content. One production, two spellings, and only the one-backtick
  // shape agreed (markup-carve/carve#1293, corpus category 328).
  // THE CONTINUATION IS CUT WHILE THE RUN IS STILL OPEN. A `+` continuation
  // extends the CELL, so the block an unclosed run reaches the end of is that
  // whole cell, continuation included - the run spans the row boundary and
  // closes on the continuation row. Cutting the continuation with a FRESH
  // scanner cuts inside the run and leaves a segment with no column to join,
  // and a dropped segment is content loss rather than a second answer
  // (markup-carve/carve#1293, corpus category 333).
  //
  // Per COLUMN, never per line. The open run belongs to ONE column and a
  // continuation joins per column, so the columns before it are still cut at
  // their own pipes; carrying the run across the whole continuation line
  // instead swallows those separators and pushes the text into the wrong cell,
  // which leaves the run's own cell holding an empty `<code></code>` - the
  // artifact that ruling rejects, produced from the other direction.
  let cellIndex = 0
  let openRun = carried?.[0] ?? 0
  let i = 0
  // Skip the leading row marker: `|` (standard) or `+` (continuation)
  if (line[0] === '|' || line[0] === '+') i = 1
  let cellStart = i
  // The row's CLOSING `|` is a delimiter, and cells are cut out of the row at
  // BLOCK level - before any inline parsing. So it comes off here, ahead of the
  // scan, instead of being left for the loop to meet: an UNTERMINATED run
  // reaches the end of the line, and `inCode` would then hand the closing pipe
  // to the run as content while the row still ended at it. That made the
  // character vanish into a `<code>` and still terminate the row, which is the
  // tell (markup-carve/carve#1284, ruled: the row is a table and the run stops
  // at the pipe).
  //
  // On a row whose runs all close, nothing moves: the loop met this same pipe
  // outside a run and split there anyway, and the empty tail it left behind was
  // dropped by the padding test below.
  const bodyEnd = line.replace(/[ \t]+$/, '').length
  const scanEnd = bodyEnd > i && line[bodyEnd - 1] === '|' ? bodyEnd - 1 : line.length
  for (; i < scanEnd; i++) {
    const ch = line[i]!
    if (ch === '`') {
      // The MAXIMAL run, as the opener is: a run cannot cross `scanEnd`, whose
      // character is the row's closing `|`.
      let run = 1
      while (line[i + run] === '`') run++
      if (openRun === 0) openRun = run
      else if (run === openRun) openRun = 0
      // A run of any other length inside an open one is content, and so is the
      // opener and the closer themselves.
      buf += line.slice(i, i + run)
      i += run - 1
      continue
    }
    if (ch === '\\' && line[i + 1] === '|') {
      // Keep the escape. It stops the pipe SPLITTING the row - that is this
      // loop's job - but resolving it here too made a cell the one place in the
      // engine where an escape does not become an `escaped_text` node, and left
      // the cell's text shorter than its source so no position could be
      // anchored to it (#462).
      buf += '\\|'
      i++
      continue
    }
    if (ch === '|' && openRun === 0) {
      cells.push({ text: buf, start: cellStart })
      buf = ''
      cellStart = i + 1
      cellIndex++
      openRun = carried?.[cellIndex] ?? 0
      continue
    }
    buf += ch
  }
  // The last cell. When the closing `|` was removed above, this cell is real
  // however empty it looks - `|||` is two empty cells. Otherwise there was no
  // closing pipe to end it, so a padding-only tail is line padding, not a cell.
  if (scanEnd < line.length || trimStructural(buf) !== '')
    cells.push({ text: buf, start: cellStart })
  return cells
}

function splitTableRow(line: string): string[] {
  return splitTableRowSpans(line).map((cell) => cell.text)
}

/**
 * From a fence opener (` ``` ` / `~~~` / raw) at peek(0), is there a matching
 * closing fence ahead? Used by startsInterruptingBlock so an UNTERMINATED
 * fence does NOT interrupt a paragraph (§10 CLOSER LOOKAHEAD): a stray ``` in
 * prose stays paragraph text instead of swallowing the rest of the block. The
 * negative cache (noFenceCloserFrom) keeps "many unclosed fences" input linear.
 */
function fenceHasCloser(lexer: Lexer, marker: string): boolean {
  const char = marker[0]!
  const start = lexer.pos + 1
  if (fenceCloserMemoRefutes(lexer.fenceCloserMemo, char, marker.length, start)) return false
  const closeRe = fenceCloseRe(marker)
  let maxRun = 0
  for (let i = start; i < lexer.lines.length; i++) {
    const l = lexer.lines[i]!
    if (closeRe.test(l)) return true
    const closer = RE_FENCE_CLOSER.exec(l)
    if (closer && closer[1]![0] === char) maxRun = Math.max(maxRun, closer[1]!.length)
  }
  // No closer for this marker ahead. Record how long the longest same-character
  // run from here was, so a later opener (pos only advances, so it scans a
  // suffix whose runs can only be shorter) is O(1) whenever it is longer.
  lexer.fenceCloserMemo.set(char, { from: start, maxRun })
  return false
}

/**
 * Does the line at peek(0) begin a block that INTERRUPTS an open paragraph
 * (grammar PART 9 §10, Markdown-like)? Mirrors parseBlock's detection battery
 * with the §10 carve-outs: a bare image does NOT interrupt; an ordered marker
 * interrupts only as `1.`/`1)`; a fence/`:::` interrupts only with a closer
 * ahead; a `|` line interrupts only when it is a valid table row.
 *
 * `content` overrides WHICH TEXT is classified while keeping the lexer for the
 * lookaheads that need it (a fence's closer, `atDocumentLevel`). One caller
 * needs it: a container's BELOW band, where the line's remaining indentation is
 * a sub-column residue rather than part of what the line says
 * (markup-carve/carve#932). Every `^`-anchored pattern here fails on an indented
 * line, so passing the raw line there answers a different question - "does this
 * line open a block AT ITS INDENT" - and that question is the top level's to
 * answer, after the container has closed.
 */
function startsInterruptingBlock(
  lexer: Lexer,
  content?: string,
  // THE §24 C3 SUBLIST ARM IS THE CALLER'S TO WAIVE, and exactly one caller
  // does. A block quote's lazy-continuation loop asks this about the QUOTE's
  // open paragraph, and carve-js#1200 ruled that paragraph claims the line
  // first: `- > q` / `  - s` is one quoted paragraph, not a quote plus a
  // sub-list, and carve-rs and the executable spec agree. §24 C3 is about a
  // child of the ITEM, so it does not decide a line the quote is still holding.
  //
  // Waiving it does NOT hand the quote every marker. The loop's own
  // `blockQuoteParagraphOpen` guard runs right after this test, so a quote that
  // ended on a heading, a table or a blank line still breaks there - and the
  // marker then reaches the item body, where §24 C3 opens the sublist. That is
  // the near miss carve-js#1200 names, and it stays intact.
  sublistArm = true,
): boolean {
  const ln = content ?? lexer.peek()
  if (ln === undefined) return false
  // Dispatch on the first non-whitespace character, so a line costs one or two
  // regex tests instead of the whole battery — this is the per-line cost on
  // dense interrupt text. Each regex keeps its own anchor, so leading-whitespace
  // handling is unchanged: a `^`-anchored pattern (heading, quote, table, `:::`,
  // raw fence, defs, comments) still fails on an indented line, and the
  // `^\s*`-anchored ones (fence, list, link-def) still match it. The boolean
  // result is identical to testing every pattern in order.
  let i = 0
  while (i < ln.length && (ln.charCodeAt(i) === 32 || ln.charCodeAt(i) === 9)) i++
  switch (ln[i]) {
    case '#':
      return RE_HEADING.test(ln)
    case '>':
      return RE_BLOCKQUOTE.test(ln)
    case '|':
      // A valid `|…|` row (a stray leading `|` in prose is not a row).
      return isTableRow(ln)
    case '`':
    case '~':
      // Raw passthrough / fenced code: interrupt only with a matching closer.
      if (RE_RAW_FENCE.test(ln)) return fenceHasCloser(lexer, RE_RAW_FENCE.exec(ln)![1]!)
      if (RE_FENCE.test(ln)) return fenceHasCloser(lexer, RE_FENCE.exec(ln)![2]!)
      return false
    case '-':
      // A thematic break, or - in a list item's own body - a bullet or task at
      // the body's column 0, which §24 C3 opens a sublist with. Everywhere else
      // a bullet/task does NOT interrupt a paragraph (symmetric with ordered
      // markers; a list needs a blank line, §10 I2).
      return RE_HR.test(ln) || opensSublistHere(lexer, ln, i, sublistArm)
    case '+':
      // `+` is the list-continuation marker, never an interrupter.
      return false
    case '*':
      // abbreviation definition (invisible, and only at document level - PART
      // 12 §7), a thematic break, or a `*` bullet at a list item body's column 0
      // (§24 C3). Everywhere else a bullet/task does NOT interrupt
      // (symmetric, §10 I2).
      return (
        (lexer.atDocumentLevel && RE_ABBR_DEF.test(ln)) ||
        RE_HR.test(ln) ||
        opensSublistHere(lexer, ln, i, sublistArm)
      )
    case '_':
      return RE_HR.test(ln)
    case ':':
      // Colon-fence containers open immediately and auto-close at EOF.
      if (
        (RE_ADMONITION_OPEN.test(ln) && !RE_ADMONITION_CLOSE.test(ln)) ||
        RE_DIV_OPEN.test(ln) ||
        RE_LINE_BLOCK_OPEN.test(ln) ||
        RE_HARDBREAKS_OPEN.test(ln) ||
        RE_QUOTE_BLOCK_OPEN.test(ln)
      )
        return true
      // A definition-list term (`::`) is a first-class block opener (carve#295):
      // it interrupts an open paragraph like a heading or quote, so `text` /
      // `:: term` opens a def-list, and at a list item's content column a def-list
      // nests. `RE_DEFLIST_TERM` is `^`-anchored, so an indented `:: term` (below
      // the content column) still fails here and folds as lazy text, matching
      // how heading/quote behave at the same position.
      return RE_DEFLIST_TERM.test(ln)
    case '[':
      // link or footnote reference definition (invisible)
      //
      // Flush only, for the reason the `::` arm above spells out: a definition
      // opens at its container's CONTENT COLUMN (column 0 in every lexer, since
      // nested content is dedented into a sub-lexer), so an indented one is
      // below every content column and folds as lazy text - exactly as an
      // indented heading, quote, table row or `:: term` already does. The
      // anchor does that work for every other pattern here; RE_LINK_DEF is
      // whitespace-tolerant on purpose (other passes need it to see a quoted or
      // nested def) and so needs the test written out (carve-js#597).
      return i === 0 && (isLinkDefLine(ln) || RE_FOOTNOTE_DEF.test(ln))
    case '%':
      // line or block comment (invisible)
      return RE_COMMENT_LINE.test(ln) || RE_COMMENT_BLOCK.test(ln)
    case '{':
      // A standalone block-attribute line (invisible): it floats forward to
      // the next block (or is dropped when none follows, §15), so it must
      // interrupt the paragraph rather than fold in as literal text.
      //
      // The override is threaded through: this is the one arm that re-reads the
      // line from the lexer instead of testing `ln`, so without it a below-column
      // `{.x}` stayed lazy text while every other opener kind left the container
      // (raised by codex review on markup-carve/carve-js#864).
      return peekBlockAttributes(lexer, content === undefined ? undefined : ln)
    default:
      // An ordered-list marker does NOT interrupt a paragraph (it needs a blank
      // line, matching Djot): allowing it would require the CommonMark `1.`-only
      // heuristic to keep `2.`, `1985.`, `a.`, `i.` as prose, which Carve avoids.
      // A bare image is inline, not a block, so it does not interrupt either.
      //
      // Inside a list item's own body it does, at that body's column 0, and it
      // is the SAME sentence the bullet arms above take: §24 C3 opens a sublist
      // with any marker reaching the content column, "SYMMETRIC" in its own
      // words, so bullet, task and ordered behave alike here exactly as they do
      // when they fold everywhere else.
      return opensSublistHere(lexer, ln, i, sublistArm)
  }
}

/**
 * Does `ln` open a SUBLIST where the lexer is reading - a list item's own body,
 * at that body's column 0?
 *
 * PART 9 §24 C3, which §10 I2 defers to by name. The content column IS the item
 * body's column 0, and a marker reaching it opens a sublist "whether or not a
 * blank line precedes the child" - which is the one place a marker interrupts an
 * open paragraph, and a divergence from djot the clause calls intentional.
 *
 * COLUMN 0 EXACTLY, which is what `i` carries. A marker one column in has not
 * reached the content column, and §24 C3 is explicit that BELOW it "a list
 * marker folds as lazy item text (markers never interrupt, §10 I2)". The item
 * collector already delivers such a line with its residual indent intact, so
 * testing the dispatch index is what keeps the two bands apart -
 * `RE_UNORDERED` and friends are whitespace-tolerant and would answer yes for
 * both.
 *
 * THE ABUTTING-ATTRIBUTE FORM IS A MARKER TOO (`-{.x} item`), recognized here
 * the way the collector's own nesting path recognizes it, so the two spellings
 * of one marker do not answer differently.
 */
function opensSublistHere(lexer: Lexer, ln: string, i: number, enabled: boolean): boolean {
  if (!enabled || !lexer.markerOpensSublist || i !== 0) return false
  return (
    RE_TASK.test(ln) || RE_UNORDERED.test(ln) || RE_ORDERED.test(ln) || extractItemAttr(ln) !== null
  )
}

// Whether the peeked line ENDS an open heading or blockquote (and starts a
// sibling block). A list marker (bullet, task, ordered, or abutting-attr) ends
// them and starts a sibling list -- unlike paragraph interruption, where a list
// marker FOLDS in (symmetric §10): a list folds into a PARAGRAPH but ends a
// heading/quote, matching djot. Every paragraph-interrupter ends them too.
// Consume a caption's continuation lines. A caption is multi-line inline
// content, so it folds following lines exactly like a PARAGRAPH (§10), NOT like
// a heading: a list marker FOLDS in (djot — a list needs a blank line to
// interrupt), while a heading / blockquote / table / fenced code / `:::` div /
// thematic break / `%%%` comment interrupts and ends the caption. A blank line
// or a further `^ ` caption line also ends it. Continuation lines join with
// `\n`. The lexer is positioned on the line AFTER the caption's first line;
// `firstLine` is that first line's already-extracted text (`cap[1]`).
/**
 * Parse a caption's inline content, anchored to the source.
 *
 * The caption's text IS a suffix of its line (`^ text` keeps everything after
 * the marker), and its continuation lines are appended verbatim - so unlike a
 * line block's expanded whitespace or a table's reassembled cells, an exact
 * mapping exists and there is nothing to invent. Captions were nonetheless run
 * through `stripPositions`, which is why 41 of this engine's 61 unplaced corpus
 * nodes were inside a `caption`.
 *
 * The suffix test is kept as a guard rather than assumed: if the line the lexer
 * is sitting on does not end with the caption text, the mapping is not exact
 * and the positions are dropped, as before.
 */
function parseCaptionInline(lexer: Lexer, firstLine: string): InlineNode[] {
  const capIndex = lexer.pos - 1
  const capLine = lexer.lines[capIndex]
  const anchors: Array<{ offset: number; column: number; line: number }> = []
  const anchorable =
    lexer.hasDocumentOffsets && capLine !== undefined && capLine.endsWith(firstLine)
  if (anchorable) {
    const within = capLine.length - firstLine.length
    anchors.push({
      offset: lexer.lineOffset(capIndex) + within,
      column: lexer.lineStartColumn(capIndex) + within,
      line: lexer.lineNumber(capIndex),
    })
  }
  const text = readCaptionText(lexer, firstLine, anchorable ? anchors : undefined)
  if (!anchorable) {
    return stripPositions(
      parseInline(text, lexer.abbrDefs, lexer.linkDefs, undefined, true),
    )
  }
  return parseInline(
    text,
    lexer.abbrDefs,
    lexer.linkDefs,
    inlineSource({
      anchored: true,
      baseOffset: anchors[0]!.offset,
      startLine: lexer.lineNumber(capIndex),
      startColumn: anchors[0]!.column,
      lineAnchors: anchors,
    }),
    true,
  )
}

function readCaptionText(
  lexer: Lexer,
  firstLine: string,
  anchors?: Array<{ offset: number; column: number; line: number }>,
): string {
  let text = firstLine
  while (!lexer.eof()) {
    const next = lexer.peek()!
    if (isBlankLine(next) || RE_CAPTION.test(next)) break
    if (startsInterruptingBlock(lexer)) break
    text += '\n' + next
    // A continuation line is appended whole, so its origin is its own start.
    anchors?.push({
      offset: lexer.lineOffset(lexer.pos),
      column: lexer.lineStartColumn(lexer.pos),
      line: lexer.lineNumber(lexer.pos),
    })
    lexer.consume()
  }
  // NO TRAILING WHITESPACE (PART 2; carve#926). Every line, not only the last:
  // the run before a SOFT BREAK is dropped too, so `abc<SP>` + newline + `def`
  // and `abc` + newline + `def` are the same document.
  return dropTrailingWhitespace(text)
}

function endsHeadingOrQuote(lexer: Lexer): boolean {
  const ln = lexer.peek()
  if (
    ln !== undefined &&
    (RE_UNORDERED.test(ln) ||
      RE_TASK.test(ln) ||
      RE_ORDERED.test(ln) ||
      extractItemAttr(ln) !== null)
  ) {
    return true
  }
  return startsInterruptingBlock(lexer)
}

/**
 * `flattened` marks the MAX_NESTING_DEPTH degradation path (§25): past the cap
 * every opener "becomes literal paragraph text", so NOTHING interrupts here and
 * consecutive flattened openers plus any text after them form ONE paragraph,
 * ending at the first blank line. Grouping them one-per-opener was an artifact
 * of where the degrade path handed back to the block parser, not a rule -
 * "degrades to literal text" is the whole rule, and literal text groups the way
 * the same characters typed by an author would. (carve#547, carve#494)
 */
function parseParagraph(lexer: Lexer, flattened = false): Paragraph {
  const lines: string[] = []
  const startLineIndex = lexer.pos
  while (!lexer.eof()) {
    const ln = lexer.peek()!
    if (isBlankLine(ln)) break
    // Paragraph interruption (grammar PART 9 §10): a VISIBLE block (heading,
    // list, quote, table, fence, thematic break, admonition/div) interrupts
    // an open paragraph with no blank line before it, at the top level AND
    // nested — the Markdown-like rule. Invisible constructs (reference
    // definitions, comments) interrupt too. A bare image does not interrupt,
    // an ordered marker interrupts only as `1.`/`1)`, and a fence/`:::` only
    // when it has a matching closer ahead. See startsInterruptingBlock.
    //
    // Only a paragraph that already holds a line can be interrupted: the FIRST
    // line is always consumed. In normal dispatch the first line reaching
    // parseParagraph is never a block opener (parseBlockInner would have
    // claimed it), so this does not change interruption. It DOES guarantee
    // progress on the MAX_NESTING_DEPTH degradation path, where a marker line
    // (e.g. a `>` past the depth cap) is routed here to become literal text —
    // without this guard startsInterruptingBlock would break before consuming,
    // looping forever on the same line.
    if (
      !flattened &&
      lines.length > 0 &&
      !lexer.literalLazyLinkDefLines.has(lexer.lineNumber(lexer.pos)) &&
      startsInterruptingBlock(lexer) &&
      !(RE_ADMONITION_CLOSE.test(ln) && lines.some((line) => isLiteralColonFenceLine(line)))
    )
      break
    lexer.consume()
    lines.push(ln)
  }
  // Every paragraph line has its leading whitespace stripped (djot /
  // CommonMark): `a\n   b` renders as `a\nb`, and a leading-indented first
  // line (` c`, or a fresh paragraph after a list closes) renders as `c` —
  // Carve has no indented code blocks, so indentation never survives into a
  // paragraph. The first line's stripped width is folded into the inline
  // base position so source offsets/columns stay accurate.
  const firstLead = lines[0]!.match(/^[ \t]+/)?.[0].length ?? 0
  // Strip the trailing whitespace at the very END of the paragraph (the final
  // line's trailing spaces/tabs, with nothing after them). CommonMark / djot /
  // carve-php all drop a paragraph's final spaces before inline parsing, so
  // `abc ` is `<p>abc</p>` and a bare `# ` (not a heading) is `<p>#</p>`.
  //
  // EVERY LINE, not only the last (PART 2 NO TRAILING WHITESPACE; carve#926).
  // This was anchored with a bare `$` and no `m` flag, so it reached the very
  // end of the joined text and nothing else - interior trailing whitespace
  // before a SOFT BREAK survived, deliberately, because PART 12 SS7 said it
  // must. That clause asserted the opposite of this one, twice, and has been
  // corrected. A backslash hard break is still never affected: the backslash is
  // the last character on its line, so the run before it is not trailing.
  const text = dropTrailingWhitespace(lines.map((ln) => ln.replace(/^[ \t]+/, '')).join('\n'))
  // Each line contributes its OWN leading whitespace on top of whatever prefix
  // the container stripped, so a continuation line needs its own origin rather
  // than a single base offset plus a local one (#444).
  const anchors =
    lines.length > 1
      ? lines.map((ln, i) => {
          const lead = ln.match(/^[ \t]+/)?.[0].length ?? 0
          return {
            offset: lexer.lineOffset(startLineIndex + i) + lead,
            column: lexer.lineStartColumn(startLineIndex + i) + lead,
            line: lexer.lineNumber(startLineIndex + i),
          }
        })
      : undefined
  return {
    type: 'paragraph',
    children: parseInline(text, lexer.abbrDefs, lexer.linkDefs, {
      anchored: lexer.hasDocumentOffsets,
      baseOffset: lexer.lineOffset(startLineIndex) + firstLead,
      startLine: lexer.lineNumber(startLineIndex),
      startColumn: lexer.lineStartColumn(startLineIndex) + firstLead,
      ...(anchors ? { lineAnchors: anchors } : {}),
    }),
  }
}

function leadingWhitespace(line: string): number {
  let n = 0
  while (n < line.length && (line[n] === ' ' || line[n] === '\t')) n++
  return n
}

/**
 * Apply an over-indented list block opener's authored column as a temporary
 * local block base (PART 9 §24 C3, carve#1705).
 *
 * The item collector has already removed `content_column`, so a positive
 * leading indent here is exactly the authored over-indent.  Single-line block
 * openers are rebased independently.  Containers and definitions carry the
 * same base through their body/closer; treating every line independently would
 * let an accidentally dedented fence close or would corrupt opaque payload.
 *
 * This is one forward pass.  A line is stripped at most once and container
 * scans advance the outer cursor, keeping flat and deeply nested input linear.
 *
 * Every line this pass moves ends up spelled exactly as the same block would be
 * spelled AT the content column, which is what keeps an over-indented opener
 * and its exact-column twin parsing identically from here on.  Nothing
 * downstream needs to know a rebase happened.
 */
function rebaseOverindentedBlocks(
  lines: string[],
  eligible?: ReadonlySet<number>,
  leadNestedColumn = -1,
  includeSublists = false,
  definitionEntriesCarryTheirBase = false,
): void {
  const firstVisible = lines.find((line) => !isBlankLine(line))
  const firstMarkerColumn = firstVisible === undefined ? -1 : markerContentColumn(firstVisible)
  if (firstMarkerColumn >= 0) {
    const hasParentOwnedCandidate = lines.some((line, index) => {
      if (isBlankLine(line) || (eligible && !eligible.has(index))) return false
      const column = indentColumns(line, firstMarkerColumn)
      if (column === 0 || column >= firstMarkerColumn) return false
      const opener = sliceColumns(line, column, true)
      return markerContentColumn(opener) < 0 && lineOpensItemBlock(opener)
    })
    if (!hasParentOwnedCandidate) return
  }
  // A sub-list may open on the item's marker line, which is not part of
  // `lines`. Seed its ownership column so a following line at that child's
  // content column is left for the child's collector (for example
  // `- > - - x` / `  >     # h`).
  //
  // ONE column, not a stack. A line at or past the open child's content column
  // is handed to that child whatever it is, so a deeper marker inside the child
  // could only ever be popped again before it decided anything - the deeper
  // entries were unreachable. Keeping one column is also what makes the scan
  // linear: `cap` below bounds every measurement by the child's column instead
  // of by the line's own indentation, so a ladder does not re-read the same
  // leading run once per level (carve#752's counted bound).
  let ownedColumn = leadNestedColumn
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (isBlankLine(line)) continue
    if (eligible && !eligible.has(i)) continue
    const cap = ownedColumn >= 0 ? ownedColumn + 1 : Infinity
    const base = indentColumns(line, cap)
    // A deeper item owns this line. Its own collector will see the line after
    // the intervening marker/content columns have been removed and will apply
    // the authored-base rule in that coordinate system.
    if (ownedColumn >= 0 && base >= ownedColumn) continue
    ownedColumn = -1
    const markerColumn = markerContentColumn(line)
    if (markerColumn >= 0) {
      ownedColumn = markerColumn
      continue
    }
    if (base === 0) {
      // Opaque groups already at the container's minimum column still own
      // their payload. Without advancing past them, a payload line that looks
      // like a block opener is reconsidered as an authored base of its own.
      // `~~~~ / one-space ``` / ~~~~` then loses that content space and the
      // writer is not a fixed point.
      const code = RE_FENCE.exec(line) ?? RE_RAW_FENCE.exec(line)
      const comment = code ? undefined : commentFenceRun(line)
      if (code || comment !== undefined) {
        let end = i
        if (code) {
          const marker = RE_FENCE.test(line) ? code[2]! : code[1]!
          const close = fenceCloseRe(marker)
          for (let j = i + 1; j < lines.length; j++) {
            end = j
            if (close.test(lines[j]!)) break
          }
        } else {
          for (let j = i + 1; j < lines.length; j++) {
            end = j
            if (commentFenceRun(lines[j]!) === comment) break
          }
        }
        i = end
      }
      continue
    }
    const opener = sliceColumns(line, base, true)
    if (!lineOpensItemBlock(opener)) continue
    // THE MOVE IS WITHHELD, THE WALK IS NOT. A line directly under a
    // description line at this container's minimum column is that
    // description's payload rather than a block of this container
    // (`isDescriptionPayloadLine`), so it must reach the definition list with
    // the indentation its author gave it - moved flush, it would arrive at
    // column 0, where the body ends instead. The run is still walked below so
    // `i` advances over everything the payload owns, which is what keeps a
    // closer of its own from being reconsidered as a second authored base.
    const descriptionPayload = isDescriptionPayloadLine(lines[i - 1] ?? '', line)
    // Sublists already use the containment rule in the item collector. Their
    // residual indentation expresses another nesting level, not an authored
    // base to erase here.
    if (!includeSublists && (
      RE_ORDERED.test(opener) ||
      RE_UNORDERED.test(opener) ||
      RE_TASK.test(opener) ||
      extractItemAttr(opener) !== null
    ))
      continue

    let end = i
    const code = RE_FENCE.exec(opener) ?? RE_RAW_FENCE.exec(opener)
    const comment = code ? undefined : commentFenceRun(opener)
    const colon = code || comment !== undefined ? null : colonBlockOpenerRun(opener)

    if (code) {
      const marker = RE_FENCE.test(opener) ? code[2]! : code[1]!
      const close = fenceCloseRe(marker)
      for (let j = i + 1; j < lines.length; j++) {
        const candidate = lines[j]!
        if (!isBlankLine(candidate) && indentColumns(candidate, base) < base) break
        end = j
        if (!isBlankLine(candidate) && close.test(sliceColumns(candidate, base, true))) break
      }
    } else if (comment !== undefined) {
      for (let j = i + 1; j < lines.length; j++) {
        const candidate = lines[j]!
        if (!isBlankLine(candidate) && indentColumns(candidate, base) < base) break
        end = j
        if (
          !isBlankLine(candidate) &&
          commentFenceRun(sliceColumns(candidate, base, true)) === comment
        )
          break
      }
    } else if (colon !== null) {
      const stack = [colon]
      for (let j = i + 1; j < lines.length; j++) {
        const candidate = lines[j]!
        if (!isBlankLine(candidate) && indentColumns(candidate, base) < base) break
        end = j
        if (isBlankLine(candidate)) continue
        const local = sliceColumns(candidate, base, true)
        const run = RE_ADMONITION_CLOSE.exec(local)
        if (!run) continue
        const width = run[1]!.length
        if (stack[stack.length - 1] === width) {
          stack.pop()
          if (stack.length === 0) break
        } else {
          stack.push(width)
        }
      }
    } else if (
      !definitionEntriesCarryTheirBase &&
      (RE_DEFLIST_TERM.test(opener) || RE_DEFLIST_DEF.test(opener))
    ) {
      // A LIST ITEM'S DEFINITION ENTRY ENDS AT ITS SEPARATING BLANK, WHATEVER
      // COLUMN IT WAS AUTHORED AT (carve-js#1514).
      //
      // carve#1752 asks a payload to keep its offset from its opener, and in a
      // list item both spellings have the same offset - so both say the same
      // thing, and the spec repo's own corpus test pins a definition list under
      // `over-column list block groups match their exact-column spelling`.
      //
      // A footnote body and a definition description are the exception, not
      // this: carve#1763 pins the two spellings there as two documents, so they
      // pass `definitionEntriesCarryTheirBase` and take the arm below.
      for (let j = i + 1; j < lines.length; j++) {
        const candidate = lines[j]!
        if (isBlankLine(candidate) || indentColumns(candidate, base) < base) break
        end = j
      }
    } else if (
      RE_BLOCKQUOTE.test(opener) ||
      RE_DEFLIST_TERM.test(opener) ||
      RE_DEFLIST_DEF.test(opener) ||
      RE_FOOTNOTE_DEF.test(opener) ||
      RE_LINK_DEF.test(opener)
    ) {
      // These families own continuation/body lines.  A blank remains part of
      // the run only when another line at the authored base follows it.
      for (let j = i + 1; j < lines.length; j++) {
        const candidate = lines[j]!
        if (isBlankLine(candidate)) {
          let k = j + 1
          while (k < lines.length && isBlankLine(lines[k]!)) k++
          if (k >= lines.length || indentColumns(lines[k]!, base) < base) break
          end = j
          continue
        }
        if (indentColumns(candidate, base) < base) break
        end = j
      }
    }

    // A caption is a structural continuation of the captionable block above
    // it and shares that block's authored base. Leaving the caption behind at
    // the residual indentation turns it into escaped prose.
    const caption = lines[end + 1]
    if (
      caption !== undefined &&
      !isBlankLine(caption) &&
      indentColumns(caption, base) >= base &&
      RE_CAPTION.test(sliceColumns(caption, base, true))
    ) {
      end++
    }

    if (!descriptionPayload) {
      for (let j = i; j <= end; j++) {
        if (!isBlankLine(lines[j]!)) {
          lines[j] = sliceColumns(lines[j]!, base, true)
        }
      }
    }
    i = end
  }
}

/**
 * Would a container body's rebase pass MOVE any line of `rendered`?
 *
 * The writer asks this, and it asks the rebase itself rather than a copy of its
 * rule. A definition description's payload sits at its separator's column, in
 * from its `::`, which is ABOVE the body minimum of a footnote body, a list
 * item or a
 * definition description - so at that minimum the container's rebase claims the
 * payload as a block of its own and the description loses it (carve-js#1509).
 * One column further in, the `::` line's own column becomes the entry's base and
 * the rebase hands the whole run back at the same relative columns.
 *
 * Any predicate written out again HERE would be a second spelling of the same
 * rule and would drift from the first one; running the pass over a copy cannot.
 */
export function aBodyRebaseWouldMoveALine(rendered: string): boolean {
  const lines = rendered.split('\n')
  const rebased = lines.slice()
  rebaseOverindentedBlocks(rebased, undefined, -1, true, true)

  return rebased.some((line, index) => line !== lines[index])
}

/**
 * The opener families an OVER-COLUMN line may spell (PART 9 §24 C3,
 * carve#1705).
 *
 * Wider than `lineOpensBlock` by the two shapes that still deserve to be moved
 * back to the item's base even though they are not block OPENERS there: a block
 * attribute line and a bare block image.  Both are PARAGRAPHS at the canonical
 * content column (PART 9 §17 L2) and stay paragraphs after the move - the point
 * of rebasing them is that `{.c}` reaches the heading below it, and that the
 * image is inside the item rather than an indented run beside it.
 *
 * ONLY the rebase asks this. Anything that classifies a line the collector
 * already placed at the content column asks `lineOpensBlock`, so an
 * over-indented spelling and its exact-column twin answer alike.
 */
function lineOpensItemBlock(line: string): boolean {
  return lineOpensBlock(line) || isBlockAttributeLine(line) || isBlockImageLine(line)
}

/**
 * A BLOCK OPENER DIRECTLY UNDER A DESCRIPTION LINE IS THE DESCRIPTION'S CONTENT
 * AT ANY INDENT ABOVE ZERO (markup-carve/carve#1769, corpus
 * `422-a-recognized-opener-in-a-body-needs-no-blank-line-above-it` -7, -8 and
 * -9; markup-carve/carve-js#1518).
 *
 * The authored-base clause says where an opener MAY sit, not what has to sit
 * above it, and a description line is the place that turns out to reach BELOW
 * its own content column as well as past it: nothing stands between the `:  `
 * marker and the line under it, so that line is the description's first payload
 * rather than a continuation of anything, and the separator's width does not
 * get to decide whether the author reached it.
 *
 * ABOVE ZERO is the whole of the condition. At column 0 the payload is flush
 * with the entry itself and belongs to the surviving context, which is what
 * keeps `:: term` / `:  definition` / `> quote` ending the body under
 * `BELOW THE BODY'S COLUMN THE BODY ENDS` (markup-carve/carve#932).
 *
 * ONE PREDICATE, TWO COLLECTORS. The body collector asks it to decide
 * MEMBERSHIP - whether the line joins the description at all - and the rebase
 * pass asks it to decide PLACEMENT - whether a container above may claim the
 * same line as a block of its own before the description is ever parsed. Those
 * are two questions, and a rule written out at both would drift; `description`
 * is the raw line above, so both ask it in the coordinate system they hold.
 */
function isDescriptionPayloadLine(description: string, payload: string | undefined): boolean {
  if (payload === undefined || isBlankLine(payload)) return false
  if (!RE_DEFLIST_DEF.test(description)) return false
  if (indentColumns(payload, 1) === 0) return false
  return lineOpensItemBlock(payload.replace(/^[ \t]+/, ''))
}

// Visual column of the leading whitespace, expanding tabs to the next
// CommonMark tab stop (a multiple of 4). This is the column model used for list
// nesting comparisons: a space advances one column, a tab advances to the next
// tab stop. For space-only indentation it equals leadingWhitespace().
//
// `cap` bounds the walk. The result is `min(realColumns, cap)`, so a caller
// that only compares the answer against a threshold can stop the scan there
// instead of walking an indentation run whose length it does not care about.
// Every nesting level re-measures the same run, so an unbounded walk costs
// `O(depth)` per line per level - the larger half of markup-carve/carve#752's
// cubic term. Pick `cap` by the comparison:
//
//   `>= t` / `< t`         -> cap = t
//   `=== t` / `<= t` / `> t` -> cap = t + 1
//
// Both are exact: `min(real, cap)` and `real` compare identically against any
// threshold strictly below `cap`, and a tab that overshoots `cap` only
// saturates a value the comparison had already decided. Leave `cap` off where
// the NUMBER itself is used rather than compared.
function indentColumns(line: string, cap = Infinity): number {
  let col = 0
  let i = 0
  while (i < line.length && col < cap) {
    const c = line[i]
    if (c === ' ') col++
    else if (c === '\t') col += 4 - (col % 4)
    else break
    i++
  }
  if (layoutWork.on) layoutWork.gate += i
  return col > cap ? cap : col
}

// Dedent counterpart of indentColumns(): drop leading whitespace up to `cols`
// columns. By default a tab straddling the boundary is consumed whole, so a
// block opener (quote, heading) dedents flush to column 0 and parses -- Carve
// has no indent-sensitive block where a leftover column would change meaning.
// With keepResidual (used only for sub-list marker lines), the unconsumed
// columns of a straddling tab are re-emitted as spaces so tab+space-aligned
// sibling markers keep the same visual column and the recursive parse re-derives
// the child base from it. For space-only indentation this equals line.slice(cols).
function sliceColumns(line: string, cols: number, keepResidual = false): string {
  let col = 0
  let i = 0
  while (i < line.length && col < cols) {
    if (line[i] === ' ') {
      col++
      i++
    } else if (line[i] === '\t') {
      col += 4 - (col % 4)
      i++
    } else {
      break
    }
  }
  // When dedenting a sub-list block stream, a tab straddling the boundary leaves
  // residual columns; reinsert them as spaces so tab+space-aligned sibling
  // markers stay at the same visual column and the recursive parse re-derives
  // correctly. Lead content uses whole-tab consumption (keepResidual=false) so a
  // block opener reaches column 0. (Space-only indentation has no residual.)
  if (layoutWork.on) layoutWork.strip += i
  if (keepResidual && col > cols) return ' '.repeat(col - cols) + line.slice(i)
  return line.slice(i)
}

// ============================================================================
// Inline parsing
// ============================================================================

// Footnote reference `[^label]`. A label is a physical-line identifier: it
// contains neither `]` nor a source newline. Letting this cross a soft break
// creates an id no definition marker (which is necessarily one line) can bind.
const RE_FOOTNOTE_REF = /^\[\^([^\]\r\n]+)\]/
// extension_name = identifier = (letter|'_'){letter|digit|'_'|'-'}
// (grammar.ebnf:968-969,1122) -- a lone `_` is a valid extension name.
const RE_EXTENSION = /^:([a-zA-Z_][\w-]*)\[([^\]]*)\](?:\{((?:[^}"'\n]|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')+)\})?/
// Raw inline passthrough tag, follows a verbatim span: `` `…`{=html} ``.
const RE_RAW_INLINE = /^\{=([a-zA-Z][\w-]*)\}/
// Symbol shortcode `:name:` (after extension, which needs `[`).
// The first name char is a letter, digit, `+` or `-` (so `:+1:` / `:-1:`
// parse), but never `_` — `:_x_:` would steal from underline. Scanning the
// symbol at the opening `:` also gives it precedence over smart typography,
// so `:+-:` is the symbol `+-`, not a `±` between colons (grammar PART 9 §7).
const RE_SYMBOL = /^:([a-zA-Z0-9+-][\w+-]*):/

/**
 * Does a SYMBOL SHORTCODE open at this offset?
 *
 * Exported so the Carve writer can read the rule off the parser instead of
 * carrying a second copy of it. PART 11 section 2 escapes a character only
 * where omitting it would change the re-parse, so the writer has to ask the
 * exact question the parse asks - and this repository has repeatedly found one
 * rule spelled N times where N was larger than anyone claimed.
 *
 * A symbol opens on a `:` NOT preceded by `_` or an alphanumeric and followed
 * by a name that CLOSES on another `:`. Requiring the closer is what leaves
 * `a : b : c` alone, and the preceding-character guard is what leaves a URL's
 * `http://x` alone.
 */
export function symbolOpensAt(text: string, offset: number): boolean {
  if (text[offset] !== ':') return false
  if (offset > 0 && /[A-Za-z0-9_]/.test(text[offset - 1]!)) return false
  return RE_SYMBOL.test(text.slice(offset))
}
// Autolink (grammar.ebnf:775,776,791,792,1139). Two alternatives:
//   url_autolink   = scheme ':' {url_char}+   -- url_char excludes `<`/`>` plus
//                    `"` `\` `` ` `` `{` `}` `|` `^`, so a body holding any of
//                    those makes the construct invalid (whole-literal).
//   email_autolink = {email_char}+ '@' {email_char}+ '.' {letter}+ -- the
//                    `.TLD` is MANDATORY and email_char excludes `:`/`@`, so
//                    `<a@b>` (no TLD) and `<x@y:z>` are not autolinks.
//
// WHAT ENDS THE BODY IS THE White_Space PROPERTY, not `\s` -- the same test and
// the same reason as `RE_DESTINATION_WHITESPACE` above. JavaScript's `\s` is
// White_Space PLUS U+FEFF MINUS U+0085, so `<https://a/b<NEL>c>` linked here
// with an invisible U+0085 inside the href, where carve-rs leaves the line
// literal (carve-js#810). U+0085 is out under BOTH readings of `url_char` --
// it is whitespace under the lenient one and outside the enumerated ASCII set
// under the strict one -- so the row is fixable without waiting on
// markup-carve/carve#860.
//
// U+FEFF, U+200B and U+180E now go out TOGETHER, through General_Category Cf,
// which is what markup-carve/carve#844 ruled and markup-carve/carve#860
// measured. They were always the same question; only U+FEFF was answered.
const RE_AUTOLINK = new RegExp(
  '^<([a-zA-Z][a-zA-Z0-9+.\\-]*:[^>' +
    AUTOLINK_BODY_EXCLUDED +
    '<"\\\\`{}|^]+|[A-Za-z0-9._+\\-]+@[A-Za-z0-9._+\\-]+\\.[A-Za-z]+)>',
  'u',
)
// `crossref_id` is one of the eleven productions that read the `whitespace`
// TERMINAL (PART 7), so the id ends at PART 7's four characters -- unlike the
// autolink body directly above, whose end is the White_Space PROPERTY because
// `unicode_url_char` says so. Two neighbouring productions, two classes, and
// the difference is written in the grammar rather than inherited from the host.
const RE_CROSSREF = /^<\/#([^> \t\n\r]+)>/
const RE_INLINE_ATTR = /^\{((?:[^}"'\n]|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')+)\}/

// Inline node types a trailing `{...}` must NOT attach to: their renderers emit
// no attributes, so an attached block would be silently dropped. `text` is
// literal by the §14 rule; `soft_break`/`hard_break` are whitespace; `mention`
// and `tag` are inert stable spans that do not take attributes. After any of
// these the `{...}` stays literal text (matches carve-rs / carve-php).
// `heading_ref` belongs here for the same reason as the rest: a cross-reference
// renders either as its literal source (unresolved) or as a link whose href is
// structural, and neither emits the attached attributes - so `</#h>{i}` dropped
// the `{i}` entirely. carve-rs and carve-php keep it literal in both cases
// (carve-js#537).
const ATTR_INERT_PREV = new Set([
  'text',
  'soft_break',
  'hard_break',
  'mention',
  'tag',
  'heading_ref',
  // Smart typography is a source-to-glyph substitution, not one of PART 9's
  // inline attribute carriers. Attaching a block here consumes source that no
  // renderer has an element on which to emit.
  'smart_punctuation',
])

// Tail patterns parsed after a `[…]` (or `![…]`) whose close bracket was
// found by balance (buildBracketMap), so the inner text may hold nested
// brackets the [^\]]* regexes can't span. Link/image titles accept double OR
// single quotes (grammar link_title; an enhancement over djot, which has no
// single-quote titles); the two title groups are separate so the other quote
// may appear inside (`"it's"`, `'say "hi"'`). The {attrs} body allows `}`
// inside a quoted value and an escaped quote inside that value, so the close
// `}` is the first one outside quotes (djot "don't mind braces in quotes").
// RE_SPAN_TAIL's body is `*` so an empty `{}` matches; isValidAttrPayload then
// decides span (valid block, possibly empty) vs literal (invalid content).
// Destination is non-empty (grammar `link_destination = {...}+`), so `[a]()`
// is NOT a link -- it stays literal (matches carve-php / carve-rs).
//
// THE SLOT BEFORE THE TITLE IS ONE LITERAL SPACE. `link_title` is spelled
// `space, ('"', ... )` in grammar.ebnf and `image_title = link_title` inherits
// it, and PART 7 puts it after the first non-whitespace character of the line,
// where a tab is not syntax at all.
//
// It was `\s+`, which in JavaScript is Unicode White_Space PLUS U+FEFF MINUS
// U+0085 - so EIGHTEEN characters opened a title slot here, measured: the tab,
// LF, VT, FF, CR, NBSP, the ogham space, six of the U+2000 block, U+2028,
// U+2029, U+202F, U+205F, U+3000 and the byte order mark (carve-js#809).
// carve-rs is the reference and leaves every one of them literal.
//
// The failure is not "a link without a title" - the whole bracket run stays
// literal text and the character survives in the output, because the tail
// pattern matches nothing and no link is built at all.
//
// The `+` is gone too, per the markup-carve/carve#912 ruling: the production
// means exactly ONE space, and accepting a run was the engine being lax rather
// than the grammar being loose. `[t](/u<SP><SP>"T")` is therefore literal text.
//
// ONE producer serves the link tail and the image tail, which is why narrowing
// it here fixes both. The block-level `RE_BARE_IMAGE` is the SECOND spelling of
// the same slot and moves with it.
const RE_LINK_REST = /^(?: "((?:[^"\\]|\\.)*)"| '((?:[^'\\]|\\.)*)')?\)(?:\{((?:[^}"'\n]|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')+)\})?/

/**
 * Read a destination out of a link or image tail, starting at the `(`.
 *
 * A parenthesis inside a destination is balanced against the one that closes
 * the tail, so `[a](x(y)z)` is a whole link rather than a truncated one. This
 * is what djot and CommonMark both do, and URLs that carry parentheses -
 * Wikipedia and MDN produce them constantly - are the reason they do.
 *
 * The scan ends at whitespace, which begins a title, or at a `)` with no
 * opener left to match. A destination that needs either of those characters
 * literally escapes it; `\(`, `\)` and `\\` are the only escapes here, so a
 * backslash in front of anything else stays a literal backslash and URLs full
 * of them are unaffected.
 *
 * Returns the raw destination and where the scan stopped, or null when the
 * tail does not open with `(`.
 */
function scanDestination(tail: string): { dest: string; end: number } | null {
  if (tail[0] !== '(') return null
  let dest = ''
  let depth = 0
  let i = 1
  for (; i < tail.length; i++) {
    const c = tail[i]!
    if (c === '\\' && (tail[i + 1] === '(' || tail[i + 1] === ')' || tail[i + 1] === '\\')) {
      dest += tail[i + 1]
      i++
      continue
    }
    if (c === '(') depth++
    else if (c === ')') {
      if (depth === 0) break
      depth--
    } else if (RE_DESTINATION_WHITESPACE.test(c)) break
    dest += c
  }
  return { dest, end: i }
}

/**
 * The whole tail of a link or image: `(destination)`, optionally with a title
 * and an attribute block. Returns the shape the regex it replaced returned --
 * full match, destination, the two title spellings, attribute payload -- so
 * the call sites read the same either way.
 */
function execLinkTail(tail: string): [string, string, string | undefined, string | undefined, string | undefined] | null {
  const scanned = scanDestination(tail)
  if (scanned === null || scanned.dest === '') return null
  const rest = RE_LINK_REST.exec(tail.slice(scanned.end))
  if (rest === null) return null
  return [tail.slice(0, scanned.end + rest[0].length), scanned.dest, rest[1], rest[2], rest[3]]
}
const RE_REF_TAIL = /^\[([^\]]*)\](?:\{((?:[^}"'\n]|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')+)\})?/
const RE_SPAN_TAIL = /^\{((?:[^}"'\n]|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')*)\}/

/**
 * Map each `[` in `s` to the index of its balancing `]` (innermost pairing,
 * allowing nested `[...]`; a backslash-escaped bracket is skipped, not
 * counted), computed in a single O(n) stack pass. The link/image/span
 * branches look the close `]` up in O(1) rather than re-scanning to end of
 * input for every `[`, which would be O(n^2) on adversarial input like
 * `[[[[...` (with or without a trailing `]`). Unbalanced `[` are absent from
 * the map.
 */
// The closed-verbatim-span single-space strip: one leading and one trailing
// space are removed when the content BOTH begins and ends with a space — but
// NOT when it consists entirely of spaces. The all-space guard matches the
// executable spec's `codeText()` and the CommonMark rule it derives from
// ("...but does not consist entirely of space characters"). Without the guard
// `` `  ` `` stripped to the empty string, and an empty verbatim span has no
// representable Carve source (a bare `` `` `` reparses as a two-backtick
// opener), so `carve fmt` could not round-trip it. Shared by the code-span,
// math and inline-literal scanners so the three cannot drift apart.
function stripVerbatimPadding(content: string): string {
  // ALL-SPACE IS MEASURED IN CARVE'S WHITESPACE, not the host language's
  // (carve#977, PART 7). A native `.trim()` called ` <VT> ` all-space, so the
  // padding stayed on and `` ` <VT> ` `` rendered `<code> <VT> </code>` where
  // `` ` x ` `` renders `<code>x</code>` - a vertical tab deciding, in the one
  // test that separates padding from content, that a space is not padding.
  if (trimStructural(content) === '') return content
  return content.replace(/^ ([\s\S]*) $/, '$1')
}

// Resolve the verbatim (code) span opening at `i` (a backtick). The opener is
// the MAXIMAL run of backticks (`openLen`); it closes on a run of EXACTLY that
// length. An opener with no equal-length closer is opaque to the end of the
// string. `end` is the index just past the closing run, or text.length when
// unclosed; `closed` flags which. Shared by scanInline's tokenizer,
// findEmphasisClose, and buildBracketMap so all three agree on what a span hides.
function verbatimSpanEnd(text: string, i: number): { end: number; closed: boolean; openLen: number } {
  let openLen = 1
  while (text[i + openLen] === '`') openLen++
  let k = i + openLen
  while (k < text.length) {
    if (text[k] === '`') {
      let m = 1
      while (text[k + m] === '`') m++
      if (m === openLen) return { end: k + openLen, closed: true, openLen }
      k += m
    } else {
      k++
    }
  }
  return { end: text.length, closed: false, openLen }
}

/**
 * Does a RAW bracketed run re-read as itself when written between `[` and `]`?
 *
 * The writer needs this because a raw run - an image's alt text - resolves no
 * escapes: whatever sits between the brackets IS the value, backslashes and
 * all. So the writer cannot neutralize a `]` by escaping it; it can only ask
 * whether the reader's own scan of the run would close where the writer puts
 * the `]`, and emit the run verbatim when it does.
 *
 * It is the READER's scan, not a second spelling of it: the same
 * `buildBracketMap` that the inline pass consults, run over the run wrapped in
 * the brackets it will be written between. Balanced, escape-aware and
 * literal-span-aware therefore hold here by construction rather than by a
 * comment promising they do - which is the failure markup-carve/carve#1206
 * found four times upstream, where one production was written flat in four
 * places and all four agreed with each other and with nothing else.
 */
export function rawBracketRunCloses(text: string): boolean {
  return buildBracketMap(`[${text}]`)[0] === text.length + 1
}

function buildBracketMap(s: string): Record<number, number> {
  const map: Record<number, number> = {}
  const stack: number[] = []
  for (let j = 0; j < s.length; j++) {
    const ch = s[j]
    if (ch === '\\') {
      j++
      continue
    }
    // A `[` or `]` inside a verbatim span is literal text, not a bracket — skip
    // the whole span (to its end when unclosed) so it never enters the map.
    if (ch === '`') {
      j = verbatimSpanEnd(s, j).end - 1
      continue
    }
    // A delimited comment is opaque to inline structure: brackets in its
    // discarded content cannot close a link label around it. An unclosed `{%`
    // is literal, so only skip when the first `%}` really exists.
    if (ch === '{' && s[j + 1] === '%') {
      const close = s.indexOf('%}', j + 2)
      if (close !== -1) {
        j = close + 1
        continue
      }
    }
    // Likewise an editorial comment: its content is LITERAL (PART 9
    // editorial_comment), so a `]` inside is text and no escape can spell it
    // otherwise. Without this, `[{#a]b#}](u)` ended the label at the comment's
    // `]` and the link never formed, with no way for the author to fix it
    // (carve#403). An unclosed `{#` is not a comment, so it is left alone.
    if (ch === '{' && s[j + 1] === '#') {
      const close = s.indexOf('#}', j + 2)
      if (close !== -1) {
        j = close + 1
        continue
      }
    }
    if (ch === '[') {
      stack.push(j)
    } else if (ch === ']') {
      const open = stack.pop()
      if (open !== undefined) map[open] = j
    }
  }
  return map
}

// Suffix-existence tables used to skip the inline tail regexes when their
// mandatory close delimiter is absent from the rest of the input. Each tail
// pattern (the link tail, RE_SPAN_TAIL, the critic and forced-emphasis
// patterns) requires a specific literal (`)`, `}`, `+}`, `-}`) inside its
// match; if no such literal occurs at or after the position where the regex
// would be anchored, the regex CANNOT match, so running it is pure wasted work.
// Without this guard those patterns backtrack to end-of-input at O(n) distinct
// positions — quadratic on adversarial runs like `![x](`×n, `[x](`×n or
// `{+`×n. `suf[k] === 1` iff the delimiter occurs at some index >= k; built in
// one backward O(n) pass, so each guard is O(1). Skipping only ever elides a
// call that would have failed, keeping output byte-identical.
function suffixHasChar(s: string, ch: string): Uint8Array {
  const n = s.length
  const suf = new Uint8Array(n + 1)
  let seen = 0
  for (let k = n - 1; k >= 0; k--) {
    if (s[k] === ch) seen = 1
    suf[k] = seen
  }
  return suf
}

function suffixHasPair(s: string, a: string, b: string): Uint8Array {
  const n = s.length
  const suf = new Uint8Array(n + 1)
  let seen = 0
  for (let k = n - 1; k >= 0; k--) {
    if (s[k] === a && s[k + 1] === b) seen = 1
    suf[k] = seen
  }
  return suf
}

// A `[text]{…}` span only forms when the `{…}` content is a valid attribute
// payload (see isValidAttrPayload). RE_SPAN_TAIL scans `[^}"'\n]*` forward to
// the first unquoted `}`; on a run like `[x]{[x]{…}` — or `[x]{a[x]{…}`,
// `[x]{.a [x]{…}` — where one far `}` exists but the content can NEVER validate,
// that scan runs to the far `}` at every `[`, so N brackets do O(n) work each:
// O(n^2). This walks the SAME attribute-token grammar and bails at the first
// character that cannot continue a valid token, rejecting a doomed payload in
// O(1) per opener instead of O(n). It is a pure SKIP filter: it returns true
// ONLY when the payload is provably invalid (so the elided RE_SPAN_TAIL would
// have failed too); on reaching a `}` (a candidate close) or any construct whose
// validity is subtle — a quote, an escape, a `key=<value>`, a newline, or rare
// whitespace — it returns false and the unchanged RE_SPAN_TAIL + isValidAttrPayload
// path runs, so every accepted span (and its output) is byte-identical. Because
// a nested `{`/`[` (or any other invalid boundary char) ends the walk, each
// character is visited by O(1) walks, keeping the total O(n). `brace` is the
// index of the opening `{`.
// Whitespace RE_SPAN_TAIL content may contain: PART 7's four characters except
// `\n` (which its class `[^}"'\n]` excludes). Matches isValidAttrPayload's
// separator run on those chars, and it has to: this is the FAST PATH for the
// same production, so a wider class here declares a payload valid that the
// regex then rejects. It was `[^\S\n]`, and the two disagreed on a vertical
// tab, a form feed, NBSP and every Unicode space.
const WS_NO_NL = /[ \t\r]/
function isIdentStart(c: string): boolean {
  return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_'
}
function isCssIdentStart(c: string): boolean {
  return isIdentStart(c) || (c >= '0' && c <= '9')
}
function isIdentPart(c: string): boolean {
  return isIdentStart(c) || (c >= '0' && c <= '9') || c === '-'
}
/** ASCII letter or digit, the only characters a BCP 47 subtag may hold. */
function isAsciiAlphanumeric(c: string): boolean {
  return /^[A-Za-z0-9]$/.test(c)
}

function spanAttrProvablyInvalid(text: string, brace: number): boolean {
  const n = text.length
  let i = brace + 1
  while (i < n) {
    const c = text[i]!
    // A candidate close at a token boundary: let the real regex decide/parse.
    if (c === '}') return false
    // A newline is the ONLY whitespace RE_SPAN_TAIL's content class excludes
    // (`[^}"'\n]`), so it ends the content run — defer (the regex stops here, no
    // far scan). Every OTHER `\s` (space, tab, NBSP, other Unicode spaces) is a
    // valid token separator for isValidAttrPayload's `\s+`, so skip it.
    if (c === '\n') return false
    if (WS_NO_NL.test(c)) {
      i++
      continue
    }
    // Quotes and escapes are subtle — defer to RE_SPAN_TAIL rather than skip.
    if (c === '"' || c === "'" || c === '\\') return false
    if (c === '#' || c === '.') {
      // `#id` / `.class`: an explicit CSS identifier (letter, digit or `_`,
      // then `[\w-]`) MUST
      // follow, else the token — and the whole payload — is invalid (§14).
      const d = text[i + 1]
      if (d === undefined || !isCssIdentStart(d)) return true
      i += 2
      while (i < n && isIdentPart(text[i]!)) i++
      continue
    }
    if (c === ':') {
      // `{:TAG}` (and the empty `{:}`) is the language attribute, sugar for
      // `lang=TAG`. It is the THIRD place the attribute grammar is spelled -
      // `parseAttrs`'s `re` and `isValidAttrPayload`'s strip are the other two -
      // and the three move together or this fast path rejects a payload the
      // regexes accept, which is silent: the span simply never forms.
      i++
      while (i < n && (isAsciiAlphanumeric(text[i]!) || text[i] === '-')) i++
      continue
    }
    if (isIdentStart(c)) {
      // A bareword: a boolean attribute, or the name of a `key=value`.
      i++
      while (i < n && isIdentPart(text[i]!)) i++
      if (text[i] === '=') {
        const v = text[i + 1]
        // `key=` with an EMPTY value (EOF, `}`, or any whitespace follows) leaves
        // a dangling `=` and is invalid — a bare value is `\S+` (>=1 non-space)
        // and a quoted value starts with `"`/`'`. Otherwise (quoted or bare value)
        // defer to the regex (a valid bare value is consumed whole -> linear).
        if (v === undefined || v === '}' || isCarveWhitespace(v)) {
          return true
        }
        return false
      }
      continue
    }
    // Any other character cannot begin a valid attribute token at a boundary
    // (`[`, `{`, `(`, a digit, `-`, `+`, `=`, `,`, …): the payload is invalid.
    return true
  }
  // Ran off the end without a closing `}`: RE_SPAN_TAIL would fail too.
  return true
}
// Content runs to the delimiter-specific closer (`+}` / `-}`), so a nested
// span of a DIFFERENT type whose `}` would otherwise abort an `[^}]*` class is
// kept inside and recursed into: `{+a {-b-} c+}` -> ins(a, del(b), c). Matches
// carve-php / carve-rs.
// AN EMPTY BRACE PAIR IS NOT A CONSTRUCT (markup-carve/carve#1447): the content
// slots are `+`, not `*`, so an opener meeting its own closer opened nothing and
// its characters are text. `{++}` was an `<ins>` inserting nothing and `{##}` a
// comment saying nothing; the empty `<del>` spelled `{--}`, which is now the
// braced en dash below. `RE_FORCED_EMPHASIS` already required content.
//
// `RE_CRITIC_SUB` is deliberately left alone. Its halves are independent and a
// half-empty substitution is an ordinary edit - `{~a~>~}` deletes, `{~~>b~}`
// inserts - so the same requirement per half would refuse real documents.
const RE_CRITIC_INS = /^\{\+((?:[^+]|\+(?!\}))+)\+\}/
const RE_CRITIC_DEL = /^\{-((?:[^-]|-(?!\}))+)-\}/
const RE_CRITIC_SUB = /^\{~([^}]*)~>([^}]*)~\}/
const RE_CRITIC_CMT = /^\{#([^}]+)#\}/
// A BRACED HYPHEN PAIR IS AN EN DASH (markup-carve/carve#1447). The bare run
// carries a flanking guard, so `x --verbose y` stays literal and an author who
// MEANT a dash in that position had no way to say so. This is that way, and it
// cost nothing: the string it took was an empty `<del>`.
const RE_BRACED_EN_DASH = /^\{--\}/
// Forced intraword emphasis (§22): a brace pair around a bare delimiter forces
// a span with no word-boundary condition. Group 1 is the delimiter; the
// backreference closes it before `}`, non-greedy so the nearest `delim}` wins.
// Matched AFTER RE_CRITIC_SUB, so `{~…~>…~}` is substitution and a bare
// `{~…~}` (no `~>`) is forced strikethrough. The `=` form requires a trailing
// `=` before `}`, so the raw-inline `{=format}` attribute (no trailing `=`,
// e.g. `{=html}`) does not match here.
// The content is `+?`, so an EMPTY pair never matched here - but it also never
// STOPPED here: the lazy run grew past its own closer and took the next
// construct with it, so `{//} x {/y/}` came back as one `<em>` holding
// `/} x {/y`. The lookahead refuses the empty pair at its own closer instead,
// which is what an empty brace pair being text has to mean
// (markup-carve/carve#1447).
const RE_FORCED_EMPHASIS = /^\{([/*_^,~=])(?!\1\})([\s\S]+?)\1\}/
const FORCED_TYPE: Record<string, Emphasis['type']> = {
  '/': 'emphasis',
  '*': 'strong',
  _: 'underline',
  '^': 'superscript',
  ',': 'subscript',
  '~': 'strike',
  '=': 'highlight',
}
// Names can include version-style dots between alnum runs (e.g. `#release-1.0`)
// but a trailing period is treated as sentence punctuation, not part of the name.
// Mention / tag name = name_word ('.' name_word)*, name_word = (letter | digit
// | '_' | '-')+ (grammar PART 9 §7). Interior dots only (a trailing dot stays
// punctuation — the non-greedy dotted-segment match leaves it); each segment
// allows digits, `_` and `-` in any position. Matches carve-php / carve-rs.
const RE_MENTION = /^@([a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*)/
const RE_TAG = /^#([a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*)/

// Fixed multi-character smart-typography tokens, LONGEST FIRST, and the order
// is the rule rather than a tidiness: `<-->` beats `<->` and `<--`, `-->` beats
// the hyphen-run branch below, `<==` beats `<=`, `(tm)` beats `(c)`.
//
// The doubled run is the canonical arrow in both families (markup-carve/carve#1442).
// `<--` `-->` `<-->` and `<==` `==>` `<=>` are canonical; `<-` `->` `<->` still
// match and are DEPRECATED rather than removed, so a document written before
// the rule goes on working.
//
// `=>` IS GONE, and that one is a behavior change rather than a deprecation.
// It is ubiquitous in prose about code - `key => value`, `x => x + 1`,
// `Some(x) => x` - and every one of those silently became ⇒, in the rendered
// output only. `<=` keeps ≤ for the mirror-image reason: in technical prose it
// is far more often a comparison than a leftward implication, which is what
// forces the left double arrow to grow a character in the first place.
const SMART_TOKENS: Array<[string, string, string]> = [
  ['<-->', '↔', 'left_right_arrow'],
  ['<->', '↔', 'left_right_arrow'],
  ['-->', '→', 'rightwards_arrow'],
  ['<--', '←', 'leftwards_arrow'],
  ['<=>', '⇔', 'left_right_double_arrow'],
  ['==>', '⇒', 'rightwards_double_arrow'],
  ['<==', '⇐', 'leftwards_double_arrow'],
  ['(tm)', '™', 'trademark'],
  ['...', '…', 'ellipsis'],
  ['->', '→', 'rightwards_arrow'],
  ['<-', '←', 'leftwards_arrow'],
  ['<=', '≤', 'less_than_or_equal'],
  ['>=', '≥', 'greater_than_or_equal'],
  ['!=', '≠', 'not_equal'],
  ['+-', '±', 'plus_minus'],
  ['(c)', '©', 'copyright'],
  ['(r)', '®', 'registered'],
]

/**
 * Allocate a run of `n` hyphens (n >= 2) into em/en dashes, matching
 * djot + carve-php: all em when divisible by 3, all en when divisible by
 * 2, otherwise max em-dashes with the remainder as en-dashes (a
 * remainder of 1 trades one em for two en). 2->–, 3->—, 4->––, 5->—–.
 */
function allocateDashes(n: number): string {
  if (n % 3 === 0) return '—'.repeat(n / 3)
  if (n % 2 === 0) return '–'.repeat(n / 2)
  let em = Math.floor(n / 3)
  let en: number
  if (n % 3 === 1) {
    em -= 1
    en = 2
  } else {
    en = 1
  }
  return '—'.repeat(em) + '–'.repeat(en)
}
const isAlnum = (ch: string) => /[A-Za-z0-9]/.test(ch)
/*
 * The space class the hyphen-run flanking test reads (PART 9 §8, carve#1443).
 *
 * PART 7's four whitespace characters plus the NO-BREAK SPACE - NOT `\s`. A
 * VERTICAL TAB and a FORM FEED are CONTENT in Carve, so `---<VT>` has to answer
 * the way `---!` answers, and `\s` takes both. The nbsp is in for the reason it
 * is in quote flanking below: the question asked is "does a space stand here",
 * and a nbsp is a space to the reader - in either of its spellings, so the
 * internal U+E000 placeholder for an escaped `\ ` counts too.
 */
const isFlankSpace = (ch: string) => /[ \t\n\r\u00a0\ue000]/.test(ch)
// Adjudicated smart-quote opening context (matches carve-rs on these inputs):
// a straight quote curls OPENING when preceded by start-of-content, Unicode
// whitespace (incl. NBSP, handled below via the U+E000 placeholder), or one of
// the operator/opening-punctuation chars `( [ { = : - /`. Sentence punctuation
// (`. , ; ! ?`), letters, digits and closing brackets stay CLOSING. The en/em
// dash also opens (a quote right after a `--` dash run opens), as does a quote
// directly after an opening curly quote (nested-quote context).
const isQuoteOpenContext = (prev: string) =>
  prev === '' ||
  // `=` opens a quote so an attribute-like `key="value"` / `="x"` gets an
  // opening curly quote; `:` opens too (`:"q"` -> `:“q”`), matching carve-rs.
  // PART 7's four characters PLUS the NO-BREAK SPACE, not `\s`.
  //
  // The four are the whitespace clause. The NBSP is a deliberate addition and
  // not an inherited one: this test picks a GLYPH for a character that is
  // already content, so what it asks is "does a space stand here", and a
  // no-break space is a space to the reader. The branch below already says so
  // for the ESCAPED spelling (`\ `, carried as U+E000), and a rule that
  // answered the two spellings of one character differently would be the drift
  // PART 7 exists to stop.
  //
  // What comes OUT is the rest of the host's `\s`: a VERTICAL TAB, a FORM FEED
  // and U+FEFF are not spaces under any reading, and a quote after one now
  // closes exactly as a quote after a letter does. `a<VT>"x"` and `a<SOH>"x"`
  // used to curl differently, from one class.
  /[ \t\n\r\u00a0([{\-–—/=:]/.test(prev) ||
  prev === '“' ||
  prev === '‘' ||
  // U+E000 is the internal non-breaking-space placeholder (escaped `\ ` /
  // line-block indent); a nbsp is whitespace, so a quote after it opens.
  prev === ''

/**
 * Recognize one smart-typography construct at `text[i]`.
 * `prev` is the character immediately before (for contextual quotes).
 * Returns the replacement and consumed length, or null.
 */
/**
 * The previously emitted character, for the quote open/close decision.
 *
 * It used to be the tail of the text buffer, but a smart-typography node
 * flushes that buffer, so the glyph it produced would otherwise be invisible
 * here. An opening curly quote is one of the few characters that puts the NEXT
 * quote in opening context, so losing it flips `""` from opening to closing.
 * Anything else with prior output is word-adjacent, i.e. closing context.
 */
function lastEmittedGlyph(out: InlineNode[]): string {
  const previous = out[out.length - 1]
  if (previous && previous.type === 'smart_punctuation') {
    const glyph = previous.glyph ?? SMART_PUNCTUATION_GLYPHS[previous.kind]
    if (glyph) return glyph
  }
  // An escaped character is its own node but still the character before the
  // quote, and quote flanking reads that character: `\{"quoted"` opens on the
  // brace exactly as an unescaped `{` would (corpus 163).
  if (previous && previous.type === 'escaped_text') return previous.value
  return 'x'
}

let activeQuoteCharacters: readonly [string, string, string, string] = ['“', '”', '‘', '’']

function smartToken(
  text: string,
  i: number,
  prev: string,
): { out: string; len: number; kind: string } | null {
  for (const [tok, out, kind] of SMART_TOKENS) {
    if (text.startsWith(tok, i)) return { out, len: tok.length, kind }
  }
  // A run of 2+ hyphens collapses to em/en dashes (djot allocation). A
  // lone `-` stays literal.
  if (text[i] === '-' && text[i + 1] === '-') {
    let n = 0
    while (text[i + n] === '-') n++
    // PART 9 §8 (carve#1443): a run PRECEDED by whitespace (or the start of the
    // content) and FOLLOWED by a non-whitespace character is a long CLI flag,
    // not a dash, and stays literal. `git log --oneline` rendered `git log
    // –oneline` before this - silently, and in the output only.
    //
    // The run start is scanned back to, not assumed to be `i`: a literal run is
    // emitted one hyphen at a time, so the next character re-enters here with
    // hyphens already behind it. Reading only forward would convert the tail of
    // `---foo` into an en dash.
    let start = i
    while (start > 0 && text[start - 1] === '-') start--
    const before = start > 0 ? text[start - 1]! : ''
    const after = text[i + n] ?? ''
    //
    // The whole run is consumed as literal text rather than declined, so the
    // arrow token cannot pick up what the dash rule put down: declining left
    // `-->` as a stray `-` plus a live `->`, and the flag rendered `-→`.
    if ((before === '' || isFlankSpace(before)) && after !== '' && !isFlankSpace(after)) {
      return { out: text.slice(i, i + n), len: n, kind: 'literal_hyphen_run' }
    }
    return { out: allocateDashes(n), len: n, kind: 'dash_run' }
  }
  const c = text[i]!
  if (c === '"') {
    const open = isQuoteOpenContext(prev)
    return { out: open ? activeQuoteCharacters[0] : activeQuoteCharacters[1], len: 1, kind: open ? 'left_double_quote' : 'right_double_quote' }
  }
  if (c === "'") {
    // Contextual single quote (matches djot): an apostrophe / closing
    // quote `’` when the previous char is alphanumeric (`it's`,
    // `John's`) OR the next char is a digit (decade elision `'70s`, and
    // `'24'` -> `’24’` as djot does); an opening quote `‘` in an open
    // context (`'word'`, `rock 'n' roll`); otherwise `’`.
    const next = text[i + 1] ?? ''
    const open = isQuoteOpenContext(prev)
    const apostrophe = /[0-9]/.test(next) || (!open && isAlnum(next))
    return {
      out: apostrophe ? '’' : open ? activeQuoteCharacters[2] : activeQuoteCharacters[3],
      len: 1,
      kind: open && !apostrophe ? 'left_single_quote' : 'right_single_quote',
    }
  }
  return null
}

/**
 * The inline nodes of a REFERENCE LABEL, for PART 9R R1's heading-index lookup.
 *
 * R1 keys the heading index by each heading's RENDERED PLAIN TEXT, and says the
 * LABEL enters that same comparison as its rendered plain text - its inline
 * markup stripped exactly as the heading's was. So the label has to be PARSED
 * to be compared: a fixed-character-list strip gets `*bold* heading` right and
 * `` `code()` heading `` wrong, which is why the corpus pins both.
 *
 * Neither the abbreviation table nor `linkDefs` is applied. The label is being
 * read for its plain text, not published: a nested reference inside it must not
 * resolve, and an abbreviation renders as its own text under `inlineText`
 * anyway.
 */
export function parseRefLabelInlines(label: string): InlineNode[] {
  return scanInline(label, inlineSource(), false)
}

function parseInline(
  text: string,
  abbrDefs: Map<string, string>,
  linkDefs: Map<string, LinkDef> = new Map(),
  source: InlineSource = inlineSource(),
  captionContext = false,
): InlineNode[] {
  const nodes = applyAbbreviations(scanInline(text, source, false, captionContext), abbrDefs)
  return applyLinkDefs(nodes, linkDefs)
}

interface InlineSource {
  baseOffset: number
  startLine: number
  startColumn: number
  /**
   * Document offset and column of each LINE START inside the inline text.
   *
   * The scanner walks the container's STRIPPED text, so after the first newline
   * a linear `baseOffset + localOffset` drifts by whatever prefix the container
   * removed from each following line (`> `, the list content indent). Anchors
   * give each line its own origin, which is the only way a continuation line
   * lands on the right source (#444).
   *
   * Absent for text that was reconstructed rather than stripped - a line block's
   * expanded whitespace, a table's reassembled cells - where no exact mapping
   * exists and inventing one is what PART 12 section 4 forbids.
   *
   * EACH ANCHOR CARRIES ITS SOURCE LINE NUMBER, not only its offset and column.
   * Counting newlines in the stripped text names the right line only while the
   * text has one newline per source line, and a container that REMOVES a line -
   * a `+` continuation marker, whose own line the block layer consumes - breaks
   * that. The offsets stayed right and the line number ran one short per removed
   * line, so a node reported a line whose start its own offset was nowhere near
   * (markup-carve/carve-js#1305).
   */
  lineAnchors?: Array<{ offset: number; column: number; line: number }>
  /**
   * How many lines into `lineAnchors` this text starts.
   *
   * A nested scan (an emphasis body, a link label) re-bases its text on its own
   * offset 0, and the anchors belong to the WHOLE stanza. Carrying a delta
   * rather than re-basing the array is what keeps this linear, exactly as
   * `rangeShift` does for `anchoredRanges`.
   */
  anchorShift?: number
  /**
   * False when this text cannot be located in the document at all, so no `pos`
   * is emitted for anything scanned from it.
   *
   * A nested sub-lexer whose lines could not be mapped back (a blockquote with a
   * `+` continuation marker, a definition list that re-indents its body) has
   * offsets that are only meaningful inside its own text. Emitting those as
   * document positions is the invented value PART 12 section 4 forbids, and it
   * is what produced spans like "> quot" for the text "quoted".
   */
  anchored?: boolean
  /**
   * The local ranges of this text that DO map to the document, for text
   * assembled from more than one source region.
   *
   * `lineAnchors` handles text whose regions are separated by the newlines the
   * scanner can see. A table cell extended by a `+` continuation row has no such
   * marker: its fragments are joined with a SPACE that stands in for the row
   * boundary, so a single base offset drifts by four characters or more from the
   * join onward, and nothing in the text says where that happens.
   *
   * Each fragment that was VERIFIED to appear verbatim on its own source line
   * contributes one range. Everything else - the joining space, a fragment whose
   * source could not be verified - is outside every range and has no document
   * offset, so a node that starts or ends there, or that straddles two ranges,
   * is published with no `pos` at all (PART 12 section 4). A node that sits
   * inside ONE range is a run of source it owns end to end, and section 4's
   * escape does not reach it (markup-carve/carve-js#1153).
   *
   * Sorted by `from`, non-overlapping, and `to` is INCLUSIVE so a span's
   * exclusive end may land on a range's last boundary.
   */
  anchoredRanges?: readonly AnchorRange[]
  /**
   * How far into `anchoredRanges`' own coordinates this text starts.
   *
   * A nested scan (a link label, an emphasis body) re-bases its text on its own
   * offset 0, and the ranges belong to the WHOLE cell. Carrying a delta rather
   * than re-basing the array is what keeps this linear: a cell accumulates one
   * range per continuation row and a nested scan per inline construct, so
   * copying the array on every `shiftSource` is quadratic in a tall cell that
   * also carries markup - measured at 3.0x per byte over a 4x input before this
   * was a delta.
   */
  rangeShift?: number
}

/**
 * One local range of an inline text that maps exactly to a document region.
 *
 * Local offset `o` with `from <= o <= to` sits at document offset
 * `offset + (o - from)`, on `line`, at column `column + (o - from)`. A range
 * never spans a newline, which is what lets `line` be a single number.
 */
interface AnchorRange {
  from: number
  to: number
  offset: number
  line: number
  column: number
}

function inlineSource(overrides: Partial<InlineSource> = {}): InlineSource {
  const source: InlineSource = {
    baseOffset: overrides.baseOffset ?? 0,
    startLine: overrides.startLine ?? 1,
    startColumn: overrides.startColumn ?? 1,
  }
  if (overrides.lineAnchors) source.lineAnchors = overrides.lineAnchors
  if (overrides.anchorShift) source.anchorShift = overrides.anchorShift
  if (overrides.anchoredRanges) source.anchoredRanges = overrides.anchoredRanges
  if (overrides.rangeShift) source.rangeShift = overrides.rangeShift
  if (overrides.anchored === false) source.anchored = false
  return source
}

/**
 * The range holding `offset`, or undefined when no range does.
 *
 * BINARY SEARCH, not a scan. A cell accumulates one range per continuation row
 * and the scanner asks per token, so a linear lookup is quadratic in a tall
 * multi-line cell - the same shape `openVerbatimRun` is resumed rather than
 * recomputed to avoid.
 */
function anchorRangeAt(ranges: readonly AnchorRange[], offset: number): AnchorRange | undefined {
  let lo = 0
  let hi = ranges.length - 1
  let found: AnchorRange | undefined
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const r = ranges[mid]!
    if (r.from <= offset) {
      found = r
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return found && offset <= found.to ? found : undefined
}


// Inline recursion depth, bounding the same nesting the block side caps with
// MAX_NESTING_DEPTH. scanInline recurses one frame per nested link / span /
// emphasis / critic level; without a cap a deeply nested run (e.g.
// `[[[[…x]]]]`) overflows the call stack and throws RangeError. JS is
// single-threaded, so a module-level counter with try/finally is sufficient
// (and far less invasive than threading a depth arg through every recursive
// call site). Over the cap the run stays literal text instead of recursing.
let inlineDepth = 0

function scanInline(
  text: string,
  source: InlineSource = inlineSource(),
  inFootnote = false,
  captionContext = false,
): InlineNode[] {
  if (inlineDepth >= MAX_NESTING_DEPTH) {
    return [withPos({ type: 'text', value: text } as Text, source, text, 0, text.length)]
  }
  inlineDepth++
  try {
    return scanInlineInner(text, source, inFootnote, captionContext)
  } finally {
    inlineDepth--
  }
}

function scanInlineInner(
  text: string,
  source: InlineSource,
  inFootnote: boolean,
  captionContext: boolean,
): InlineNode[] {
  const out: InlineNode[] = []
  let i = 0
  let buf = ''
  let bufStart = 0
  // Caption number placeholder: only the first bare `#` in a caption becomes one.
  let captionNumberEmitted = false
  // Last char appended to buf. Tracked explicitly because reading
  // `buf[buf.length - 1]` each char indexes a growing ConsString, which V8 must
  // flatten/traverse -- O(n^2) over a quote-dense run (and a catastrophic cliff
  // once the rope gets deep). A scalar keeps the smart-quote context check O(1).
  let bufLast = ''
  const emphasisNoClose = new Map<string, number>()

  // Precompute each `[`'s balancing `]` once (O(n)) so the link/image/span
  // branches resolve the close bracket in O(1); see buildBracketMap.
  const bracketClose = text.includes('[') ? buildBracketMap(text) : {}

  // Suffix tables so a tail regex is only run when its mandatory close
  // delimiter still lies ahead; otherwise the regex would backtrack to EOF and
  // fail. See suffixHasChar/suffixHasPair. Built only when the delimiter is
  // present at all, mirroring the bracketClose guard above.
  const rparenSuf = text.includes(')') ? suffixHasChar(text, ')') : null
  const rbraceSuf = text.includes('}') ? suffixHasChar(text, '}') : null
  const insSuf = text.includes('+}') ? suffixHasPair(text, '+', '}') : null
  const delSuf = text.includes('-}') ? suffixHasPair(text, '-', '}') : null

  const flush = () => {
    if (buf) {
      const node = { type: 'text', value: buf } as Text
      out.push(withPos(node, source, text, bufStart, i))
      buf = ''
      bufLast = ''
    }
  }

  const append = (value: string) => {
    if (!buf) bufStart = i
    buf += value
    if (value) bufLast = value[value.length - 1]!
  }

  while (i < text.length) {
    const c = text[i]!

    // Core inline constructs all begin with punctuation. When no extension
    // matcher can claim an arbitrary offset, append ordinary ASCII prose as a
    // run instead of asking smart typography, emphasis and every other inline
    // recognizer about each letter and space individually.
    const code = text.charCodeAt(i)
    if (
      activeMatchers.length === 0 &&
      ((code >= 48 && code <= 57) ||
        (code >= 65 && code <= 90) ||
        (code >= 97 && code <= 122) ||
        code === 32 ||
        code === 9)
    ) {
      const start = i
      do {
        i++
        if (i >= text.length) break
        const next = text.charCodeAt(i)
        if (
          !(
            (next >= 48 && next <= 57) ||
            (next >= 65 && next <= 90) ||
            (next >= 97 && next <= 122) ||
            next === 32 ||
            next === 9
          )
        ) {
          break
        }
      } while (true)
      const value = text.slice(start, i)
      if (!buf) bufStart = start
      buf += value
      bufLast = value[value.length - 1]!
      continue
    }
    const rest = text.slice(i)

    // Hard line break: a backslash at end of line (before a newline).
    if (c === '\\' && text[i + 1] === '\n') {
      flush()
      out.push(withPos({ type: 'hard_break' }, source, text, i, i + 2))
      i += 2
      continue
    }
    // A backslash at the very end of the content (no following character) is
    // still a hard break, mirroring the `\`-before-newline rule at end of
    // input (`para\` at EOF -> `<br>`), matching djot and carve's cheatsheet.
    if (c === '\\' && i + 1 >= text.length) {
      flush()
      out.push(withPos({ type: 'hard_break' }, source, text, i, i + 1))
      i++
      continue
    }
    // Non-breaking space: a backslash followed by a space (djot). Emit the
    // internal placeholder (U+E000) rather than a literal U+00A0 so it is
    // converted per renderer (HTML &nbsp;, Markdown U+00A0, plain/ANSI a
    // space) and never confused with an author's literal non-breaking space.
    if (c === '\\' && text[i + 1] === ' ') {
        append('\ue000')
        i += 2
        continue
    }

    // Escape: a backslash before any ASCII punctuation yields that literal
    // character (djot / grammar `ascii_punctuation` — the full set, including
    // `& : ; ?`).
    if (c === '\\' && i + 1 < text.length) {
      const nxt = text[i + 1]!
      if (/[\\`*_{}\[\]()#+\-.!~^/<>@%|=,"'$&:;?]/.test(nxt)) {
        // The escape is its own node: the backslash carries intent the literal
        // character does not. `\-\-` was written precisely so a downstream
        // processor would not read an en dash, and flattening it into text lost
        // that (carve#350).
        const escStart = i
        flush()
        out.push(
          withPos({ type: 'escaped_text', value: nxt } as EscapedText, source, text, escStart, i + 2),
        )
        i += 2
        continue
      }
    }

    // Smart typography (grammar.ebnf §"Smart Typography", PART 9 §8).
    // Runs after the escape check, so `\->` etc. are already absorbed
    // into buf as literals and never reach here. Inside code is handled
    // by the opaque code branch below (continues before this on a
    // backtick). Multi-char tokens are matched longest-first.
    {
      // Quote context: the char in buf, else (buf flushed by a prior
      // inline node like code/emphasis/link) treat it as word-adjacent
      // so a closing quote stays closing; only true start is "".
      const prevForQuote = buf.length
        ? bufLast
        : out.length
          ? lastEmittedGlyph(out)
          : ''
      const st = smartToken(text, i, prevForQuote)
      if (st && st.kind === 'literal_hyphen_run') {
        // A flag-shaped hyphen run (carve#1443) is ordinary text: it joins the
        // buffer rather than becoming a node, so it renders and round-trips as
        // the hyphens the author wrote.
        buf += st.out
        bufLast = st.out[st.out.length - 1]!
        i += st.len
        continue
      }
      if (st) {
        flush()
        // A dash run resolves to one or more glyphs; each consumes a fixed
        // number of source hyphens (3 for em, 2 for en), so the run partitions
        // into one node per glyph carrying the hyphens it came from.
        if (st.kind === 'dash_run') {
          let consumed = 0
          for (const glyph of st.out) {
            const width = glyph === '—' ? 3 : 2
            out.push(
              withPos(
                {
                  type: 'smart_punctuation',
                  kind: glyph === '—' ? 'em_dash' : 'en_dash',
                  value: text.slice(i + consumed, i + consumed + width),
                } as SmartPunctuation,
                source,
                text,
                i + consumed,
                i + consumed + width,
              ),
            )
            consumed += width
          }
        } else {
          const node = {
            type: 'smart_punctuation',
            kind: st.kind,
            value: text.slice(i, i + st.len),
          } as SmartPunctuation
          // Quote glyphs are locale-dependent and decided here, so record the
          // resolved character; other kinds resolve through the glyph table.
          if (st.kind.endsWith('_quote')) node.glyph = st.out
          out.push(withPos(node, source, text, i, i + st.len))
        }
        i += st.len
        continue
      }
    }

    // Trailing (inline) line comment: `%%` preceded by whitespace or at the
    // start of the run consumes to the next newline (or end of input). The
    // preceding whitespace is absorbed so the visible text keeps no trailing
    // space; the terminating newline stays and becomes a soft break. `%%`
    // inside a code span never reaches here (code is consumed opaquely), and
    // `\%%` is already handled by the escape branch. (§4.13, grammar
    // inline_comment.)
    // A NEWLINE counts as the whitespace before it: `%%` at the start of a
    // later line is a comment exactly as it is on the first. A paragraph never
    // showed the difference - a comment-only line is handled at the block layer
    // there - but inside a line block the whole stanza is inline content, so
    // the verse kept `%% c` as text where the other engines drop it, and this
    // one dropped it on the first line and not the second (carve#574).
    if (c === '%' && text[i + 1] === '%' && (i === 0 || /[ \t\n]/.test(text[i - 1]!))) {
      // Absorb the whitespace run immediately before `%%` so the visible text
      // keeps no trailing space. Flush the trimmed buffer with a source span
      // that ends where that whitespace begins, and start the comment node
      // there too, keeping inline source spans contiguous.
      const trimmed = buf.replace(/[ \t]+$/, '')
      const commentStart = i - (buf.length - trimmed.length)
      if (trimmed) {
        const node = { type: 'text', value: trimmed } as Text
        out.push(withPos(node, source, text, bufStart, commentStart))
      }
      buf = ''
      const nl = text.indexOf('\n', i)
      const end = nl === -1 ? text.length : nl
      const content = text.slice(i + 2, end).replace(/^[ \t]/, '')
      out.push(
        withPos({ type: 'comment', block: false, content } as Comment, source, text, i, end),
      )
      i = end
      continue
    }

    // Explicitly delimited inline comment (PART 9 §21a). The first `%}` wins;
    // an opener in the content is ordinary text, and an opener with no closer
    // stays literal. Unlike `%%`, surrounding whitespace is ordinary visible
    // text and scanning resumes after the closer.
    if (c === '{' && text[i + 1] === '%') {
      const close = text.indexOf('%}', i + 2)
      if (close !== -1) {
        flush()
        const content = text.slice(i + 2, close).replace(/^ /, '').replace(/ $/, '')
        out.push(
          withPos(
            { type: 'comment', block: false, delimited: true, content } as Comment,
            source,
            text,
            i,
            close + 2,
          ),
        )
        i = close + 2
        continue
      }
    }

    // Inline verbatim (code span). The opening run is the MAXIMAL run of
    // backticks; it closes only on a run of EXACTLY the same length (a shorter
    // OR longer run is content). An opener with no equal-length closer still
    // opens a verbatim span that runs to the END of the block — matches djot
    // upstream + carve-php (grammar code_span, "UNCLOSED RUN"). Uses the shared
    // verbatimSpanEnd helper so the tokenizer, findEmphasisClose, and
    // buildBracketMap stay in lockstep on span boundaries.
    if (c === '`') {
      const { end, closed, openLen } = verbatimSpanEnd(text, i)
      flush()
      if (!closed) {
        // Unclosed: verbatim to end of block, with the block's trailing
        // whitespace stripped (no surrounding single-space strip — that applies
        // only to a closed span).
        // PART 7's four characters (the run may cross a line, so `\n` and `\r`
        // are in). `\s` ate a trailing vertical tab out of the span's content.
        const value = text.slice(i + openLen).replace(/[ \t\n\r]+$/, '')
        out.push(withPos({ type: 'code', value }, source, text, i, text.length))
        i = text.length
        continue
      }
      const inner = stripVerbatimPadding(text.slice(i + openLen, end - openLen))
      // A verbatim span tagged `{=format}` is raw inline passthrough.
      const raw = RE_RAW_INLINE.exec(text.slice(end))
      if (raw) {
        const len = end - i + raw[0].length
        out.push(withPos({ type: 'raw_inline', format: raw[1]!, content: inner } as RawInline, source, text, i, i + len))
        i += len
        continue
      }
      out.push(withPos({ type: 'code', value: inner }, source, text, i, end))
      i = end
      continue
    }

    // Math (djot form): inline $`x`, display $$`x`. A bare `$` not
    // followed by a backtick run (e.g. currency `$5`) stays literal.
    if (c === '$') {
      const display = text[i + 1] === '$'
      const dollarLen = display ? 2 : 1
      const tick = i + dollarLen
      if (text[tick] === '`') {
        const { end, closed, openLen } = verbatimSpanEnd(text, tick)
        const innerEnd = end - openLen
        const hasContent = closed
          ? innerEnd > tick + openLen && text[innerEnd - 1] !== '`'
          : text.length > tick + openLen
        if (hasContent && (!closed || text[end] !== '`')) {
          flush()
          const content = closed
            ? stripVerbatimPadding(text.slice(tick + openLen, innerEnd))
            : text.slice(tick + openLen).replace(/[ \t\n\r]+$/, '')
          const len = end - i
          out.push(withPos({ type: 'math', display, content } as Math, source, text, i, i + len))
          i += len
          continue
        }
      }
    }

    // Inline literal (§27): a `!` prefix on a verbatim code span, mirroring
    // the `$`-math prefix above. The span content is captured verbatim, later
    // HTML-escaped and emitted by every renderer with the `<code>` wrapper
    // dropped; a trailing `{…}` attaches below as an ordinary inline attribute
    // block (no special first-token sigil). Like code and math, an unclosed
    // span reaches the end of the containing block.
    if (c === '!' && text[i + 1] === '`') {
      const { end, closed, openLen } = verbatimSpanEnd(text, i + 1)
      flush()
      const content = closed
        ? stripVerbatimPadding(text.slice(i + 1 + openLen, end - openLen))
        : text.slice(i + 1 + openLen).replace(/[ \t\n\r]+$/, '')
      out.push(withPos({ type: 'literal_inline', content } as LiteralInline, source, text, i, end))
      i = end
      continue
    }

    // Image ![alt](src) — the alt text allows nested balanced [...], so the
    // close `]` is found by balance, not a [^\]]* regex that would mis-split
    // a nested bracket (e.g. `![a [b] c](/u)`). Alt is raw text, not inline.
    if (c === '!' && text[i + 1] === '[') {
      const closeAbs = bracketClose[i + 1]
      const close = closeAbs === undefined ? -1 : closeAbs - i
      if (close > 1) {
        const alt = rest.slice(2, close)
        const tail = rest.slice(close + 1)
        // A link/image tail needs a literal `)`; skip when none lies ahead.
        const ml = rparenSuf && rparenSuf[i + close + 1] ? execLinkTail(tail) : null
        if (ml) {
          flush()
          const img: Image = { type: 'image', src: ml[1]!, alt }
          const title = ml[2] ?? ml[3]
          if (title !== undefined) img.title = unescapeAttrValue(title)
          let len = close + 1 + ml[0].length
          if (ml[4]) {
            // An invalid payload (`{2=v}`) is literal (§14), and an
            // empty-attr `{…}` is literal too -- neither is consumed.
            if (!isValidInlineAttrPayload(ml[4])) {
              len -= ml[4].length + 2
            } else {
              const a = parseAttrs(ml[4])
              if (isEmptyAttrs(a)) len -= ml[4].length + 2
              else img.attrs = a
            }
          }
          out.push(withPos(img, source, text, i, i + len))
          i += len
          continue
        }
        // Reference image `![alt][ref]{attrs}`; collapsed `![alt][]` reuses the
        // alt as the label. The image form of a reference link — same explicit
        // `[label]: url` resolution (applyLinkDefs), src instead of href. Alt
        // must be non-empty (as for a reference link's text).
        const mref = RE_REF_TAIL.exec(tail)
        // Full `![alt][ref]` allows an empty alt (`![][ref]`, label = ref);
        // collapsed `![alt][]` needs a non-empty alt to use as the label.
        if (mref && (mref[1]! !== '' || alt !== '')) {
          flush()
          let len = close + 1 + mref[0].length
          let attrs: Attrs | undefined
          if (mref[2]) {
            if (!isValidInlineAttrPayload(mref[2])) {
              len -= mref[2].length + 2
            } else {
              const a = parseAttrs(mref[2])
              if (isEmptyAttrs(a)) len -= mref[2].length + 2
              else attrs = a
            }
          }
          const img: Image = {
            type: 'image',
            src: '',
            alt,
            ref: mref[1]! !== '' ? mref[1]! : alt,
            rawRef: rawSourceSlice(source, text, i, i + len) ?? rest.slice(0, len),
          }
          if (attrs) img.attrs = attrs
          out.push(withPos(img, source, text, i, i + len))
          i += len
          continue
        }
      }
    }

    // Inline footnote `^[content]` (pandoc-style; design §2-§5). The caret must
    // immediately precede `[` and must not be inside footnote content (no notes
    // inside notes, §3.1). A `^` anywhere else is literal text (there is no bare
    // superscript), so `^^[x]` is a literal `^` followed by a note. The matching
    // `]` is the balanced close from bracketClose (escape/code-span aware).
    // Empty or whitespace-only content is literal. Content is inline-only,
    // parsed with footnote recognition disabled.
    if (!inFootnote && c === '^' && text[i + 1] === '[') {
      const close = bracketClose[i + 1]
      if (close !== undefined && trimStructural(text.slice(i + 2, close)) !== '') {
        flush()
        const inner = text.slice(i + 2, close)
        const children = scanInline(inner, shiftSource(source, text, i + 2), true)
        out.push(withPos({ type: 'inline_footnote', inline: children } as InlineFootnote, source, text, i, close + 1))
        i = close + 1
        continue
      }
    }

    // Link / reference link / footnote / span. The bracket text may contain
    // nested balanced [...] (djot: `[a [b] c](/u)`, `[[x](y)](z)`), so the
    // matching close `]` is found by balance — not a [^\]]* regex that would
    // mis-split at the first inner `]`. The (url) / [ref] / {attrs} tail is
    // then parsed by the same sub-patterns the old fast-path regexes used.
    if (c === '[') {
      const closeAbs = bracketClose[i]
      const close = closeAbs === undefined ? -1 : closeAbs - i
      if (close > 0) {
        const innerText = rest.slice(1, close)
        const tail = rest.slice(close + 1)
        // Footnote reference [^label] -- before reference links so adjacent
        // refs like `[^a][^a]` are two notes, not one unresolved `[text][ref]`.
        // Inside footnote content a `[^x]` is literal, not a reference
        // (no notes inside notes, design §3.1).
        const mfn = inFootnote ? null : RE_FOOTNOTE_REF.exec(rest)
        if (mfn) {
          flush()
          out.push(withPos({ type: 'footnote_ref', id: mfn[1]! } as FootnoteRef, source, text, i, i + mfn[0].length))
          i += mfn[0].length
          continue
        }
        // Inline link [text](url "title"){attrs}
        const ml = rparenSuf && rparenSuf[i + close + 1] ? execLinkTail(tail) : null
        if (ml) {
          flush()
          const link: Link = {
            type: 'link',
            href: ml[1]!,
            children: scanInline(innerText, shiftSource(source, text, i + 1), inFootnote),
          }
          const title = ml[2] ?? ml[3]
          if (title !== undefined) link.title = unescapeAttrValue(title)
          let len = close + 1 + ml[0].length
          if (ml[4]) {
            // An invalid payload (`{2=v}`) is literal (§14), and an
            // empty-attr `{…}` is literal too -- neither is consumed.
            if (!isValidInlineAttrPayload(ml[4])) {
              len -= ml[4].length + 2
            } else {
              const a = parseAttrs(ml[4])
              if (isEmptyAttrs(a)) len -= ml[4].length + 2
              else link.attrs = a
            }
          }
          out.push(withPos(link, source, text, i, i + len))
          i += len
          continue
        }
        // Reference link [text][ref]{attrs}; collapsed [text][] reuses the text
        // as the label.
        //
        // RECOGNITION IS NOT RESOLUTION, and the emptiness question belongs to
        // the second. This used to demand a non-empty TEXT, which is a rule
        // nothing states: an empty link text is allowed and produces an empty
        // anchor (PART 9 §4) - as the inline form `[](u)` already did right
        // here. The guard ran before the node existed, so `[][d]` was not an
        // unresolved reference, it was never a reference at all, and no amount
        // of definition made it one (markup-carve/carve-js#1119).
        //
        // A label that names nothing still parses and then fails to resolve,
        // exactly as `[][nope]` does, and the unresolved path finalizes it back
        // to its own source. So `[][]` - collapsed, hence an empty label - is a
        // link node carrying `ref: ''` that resolves to nothing and renders as
        // literal `[][]`. That is what carve-rs and carve-php both build for
        // it; refusing it here instead made the two engines' ASTs differ on a
        // document whose HTML matched, and left `[][]{.c}` an inline span in
        // this engine alone.
        //
        // A LABEL CANNOT OPEN WITH `@`, which the old text guard was
        // shielding by accident at the empty-text spelling. The grammar spells
        // the first character apart for exactly this reason:
        //
        //   reference_label = (character - ']' - '@'), {character - ']'} ;
        //
        // `@` opens a citation key, so `[][@a]` is a literal `[]` followed by
        // the citation `[@a]`. Widening the branch without this would swallow
        // it: with the citations extension enabled the citation loses its
        // number and its bibliography entry, and the reader gets `[][@a]` as
        // text. The subtraction is on the FIRST character only, so `[][a@b]`
        // is an ordinary label, and the empty label has no first character to
        // test - `[][]` is `collapsed_reference_link`, a production of its own.
        //
        // THE TEST IS SCOPED TO THE SPELLING THIS CHANGE OPENS, deliberately.
        // `[t][@a]` violates the same production and is taken as a reference
        // here, in carve-rs and in carve-php alike; correcting that is a
        // cross-engine ruling and not this fix's to make, so the non-empty-text
        // path keeps the behavior all three engines share.
        const mref = RE_REF_TAIL.exec(tail)
        if (mref && (innerText !== '' || !mref[1]!.startsWith('@'))) {
          flush()
          let len = close + 1 + mref[0].length
          let attrs: Attrs | undefined
          if (mref[2]) {
            // An invalid payload (`{2=v}`) is literal (§14), and an
            // empty-attr `{…}` is literal too -- neither is consumed.
            if (!isValidInlineAttrPayload(mref[2])) {
              len -= mref[2].length + 2
            } else {
              const a = parseAttrs(mref[2])
              if (isEmptyAttrs(a)) len -= mref[2].length + 2
              else attrs = a
            }
          }
          const refLink: Link = {
            type: 'link',
            href: '',
            children: scanInline(innerText, shiftSource(source, text, i + 1), inFootnote),
            ref: mref[1]! !== '' ? mref[1]! : innerText,
            // rawRef includes any consumed trailing {attrs} so the literal
            // fallback for an unresolved ref preserves the full source, and it
            // is read from the DOCUMENT where the scanner's own text is not
            // that source (carve-js#1183).
            rawRef: rawSourceSlice(source, text, i, i + len) ?? rest.slice(0, len),
          }
          if (attrs) refLink.attrs = attrs
          out.push(withPos(refLink, source, text, i, i + len))
          i += len
          continue
        }
      }
      // Footnote reference [^label] -- before span, so `[^x]{.c}` stays a
      // footnote ref (the `{.c}` then attaches via the inline-attr pass)
      // rather than becoming a <span> of `^x`. Footnote labels hold no
      // nested brackets, so its own regex stays authoritative.
      const mfn = inFootnote ? null : RE_FOOTNOTE_REF.exec(rest)
      if (mfn) {
        flush()
        out.push(withPos({ type: 'footnote_ref', id: mfn[1]! } as FootnoteRef, source, text, i, i + mfn[0].length))
        i += mfn[0].length
        continue
      }
      // Inline span `[text]{attrs}` (PART 9 §14). After links so `[t](u)` /
      // `[t][r]` win; the `{` must directly abut `]`. A bracket followed by a
      // VALID attribute block forms a span -- including an empty one (`[x]{}`,
      // `[x]{ }` -> empty <span>, matching djot). An INVALID block (`{???}`,
      // `{=y=}`) is not an attribute block, so it stays literal.
      if (close > 0) {
        const innerText = rest.slice(1, close)
        // A span tail needs a literal `}` ahead; and its `{…}` content must be
        // able to form a valid attribute payload. Skip RE_SPAN_TAIL (which would
        // otherwise scan to a far `}` at every `[` -> O(n^2) on `[x]{[x]{…}`)
        // when no `}` lies ahead or the payload is provably invalid.
        const ms =
          rbraceSuf && rbraceSuf[i + close + 1] && !spanAttrProvablyInvalid(text, i + close + 1)
            ? RE_SPAN_TAIL.exec(rest.slice(close + 1))
            : null
        if (ms && isValidInlineAttrPayload(ms[1]!)) {
          flush()
          out.push(
            withPos(
              {
                type: 'span',
                children: scanInline(innerText, shiftSource(source, text, i + 1), inFootnote),
                attrs: parseAttrs(ms[1]!),
              } as Span,
              source,
              text,
              i,
              i + close + 1 + ms[0].length,
            ),
          )
          i += close + 1 + ms[0].length
          continue
        }
      }
    }

    // Inline extension :type[content]{attrs}
    if (c === ':') {
      const m = RE_EXTENSION.exec(rest)
      if (m) {
        flush()
        const ext: Extension = {
          type: 'inline_extension',
          name: m[1]!,
          content: scanInline(m[2]!, shiftSource(source, text, i + m[0].indexOf('[') + 1), inFootnote),
        }
        // THE ONLY INLINE ATTRIBUTE SURFACE WITH NO VALIDITY GATE, until now: a
        // trailing block here went straight to `parseAttrs`, so `{#1a}` became
        // `a=""` where §14 makes it literal on every sibling surface, a tab
        // separated two attributes after markup-carve/carve#906 narrowed the
        // rest, and a quoted value carried a line break past
        // markup-carve/carve#888. An invalid payload is not consumed - the
        // extension parses without attributes and the braces stay literal
        // text, exactly as the link and image tails already do.
        let consumed = m[0].length
        if (m[3] !== undefined) {
          if (isValidInlineAttrPayload(m[3])) ext.attrs = parseAttrs(m[3])
          else consumed -= m[3].length + 2
        }
        out.push(withPos(ext, source, text, i, i + consumed))
        i += consumed
        continue
      }
      // Symbol shortcode `:name:` (after extension, which needs `[`).
      const sym = symbolOpensAt(text, i) ? RE_SYMBOL.exec(rest) : null
      if (sym) {
        flush()
        out.push(withPos({ type: 'symbol', name: sym[1]! } as SymbolInline, source, text, i, i + sym[0].length))
        i += sym[0].length
        continue
      }
    }

    // Autolink <url>
    if (c === '<') {
      const cr = RE_CROSSREF.exec(rest)
      if (cr) {
        flush()
        const cref: CrossRef = { type: 'heading_ref', target: cr[1]! }
        out.push(withPos(cref, source, text, i, i + cr[0].length))
        i += cr[0].length
        continue
      }
      const m = RE_AUTOLINK.exec(rest)
      if (m) {
        flush()
        const href = m[1]!
        const auto: AutoLink = {
          type: 'autolink',
          href: href.includes('@') && !href.includes(':') ? `mailto:${href}` : href,
          // Display is the raw `<...>` content: a URI autolink keeps its scheme
          // (`<mailto:a@b>` -> `mailto:a@b`), an email autolink shows the address.
          text: href,
        }
        let consumed = m[0].length
        // Optional trailing {attrs} (djot): `<url>{.c}`. An explicit
        // `href` in the block is ignored -- the structural href wins
        // (djot + carve-php), so it never produces a duplicate attribute.
        // An invalid payload (`{2=v}`) is literal (§14), not an
        // attribute block -- leave it for normal text processing.
        const am = /^\{([^}\n]+)\}/.exec(text.slice(i + consumed))
        if (am && isValidInlineAttrPayload(am[1]!)) {
          const attrs = parseAttrs(am[1]!)
          if (!isEmptyAttrs(attrs)) {
            // A real attribute block: consume it (so it is not
            // re-processed). Drop a structural `href` so it never
            // duplicates the autolink's own href (djot + carve-php).
            if (attrs.keyValues?.href !== undefined) {
              delete attrs.keyValues.href
              if (attrs.order) attrs.order = attrs.order.filter((s) => s !== 'href')
            }
            if (!isEmptyAttrs(attrs)) auto.attrs = attrs
            consumed += am[0].length
          }
        }
        out.push(withPos(auto, source, text, i, i + consumed))
        i += consumed
        continue
      }
    }

    // CriticMarkup family
    if (c === '{') {
      // Each `{…}` tail regex requires its own literal close (`}`, `+}`, `-}`);
      // skip it when that delimiter is absent from the rest of the input, which
      // would otherwise force a backtrack to EOF at every `{` (quadratic on
      // runs like `{+`×n or `{~`×n). O(1) suffix lookups; output-identical.
      const hasBrace = !!(rbraceSuf && rbraceSuf[i])
      const sub = hasBrace ? RE_CRITIC_SUB.exec(rest) : null
      if (sub) {
        flush()
        out.push(
          withPos(
            { type: 'substitution', oldText: sub[1]!, newText: sub[2]! } as CriticSubstitute,
            source,
            text,
            i,
            i + sub[0].length,
          ),
        )
        i += sub[0].length
        continue
      }
      const ins = insSuf && insSuf[i] ? RE_CRITIC_INS.exec(rest) : null
      if (ins) {
        flush()
        out.push(withPos({ type: 'insert', children: scanInline(ins[1]!, shiftSource(source, text, i + 2), inFootnote) } as CriticInsert, source, text, i, i + ins[0].length))
        i += ins[0].length
        continue
      }
      const del = delSuf && delSuf[i] ? RE_CRITIC_DEL.exec(rest) : null
      if (del) {
        flush()
        out.push(withPos({ type: 'delete', children: scanInline(del[1]!, shiftSource(source, text, i + 2), inFootnote) } as CriticDelete, source, text, i, i + del[0].length))
        i += del[0].length
        continue
      }
      if (hasBrace && RE_BRACED_EN_DASH.test(rest)) {
        // The SAME node the bare run produces, carrying the authored spelling
        // in `value` - so the AST says "an en dash was written here" rather
        // than holding a glyph in a text run, and `fmt` writes `{--}` back
        // instead of the literal character. PART 12's vocabulary already has
        // the kind; the braced form is a second spelling of it, not a second
        // construct.
        flush()
        out.push(
          withPos(
            { type: 'smart_punctuation', kind: 'en_dash', value: '{--}' } as SmartPunctuation,
            source,
            text,
            i,
            i + 4,
          ),
        )
        i += 4
        continue
      }
      const cmt = hasBrace ? RE_CRITIC_CMT.exec(rest) : null
      if (cmt) {
        flush()
        out.push(withPos({ type: 'critic_comment', text: cmt[1]! } as CriticComment, source, text, i, i + cmt[0].length))
        i += cmt[0].length
        continue
      }
      // Forced intraword emphasis `{X…X}` (§22) — emits the same node as the
      // bare delimiter, but with no word-boundary condition.
      const forced = hasBrace ? RE_FORCED_EMPHASIS.exec(rest) : null
      if (forced) {
        flush()
        out.push(withPos({ type: FORCED_TYPE[forced[1]!]!, children: scanInline(forced[2]!, shiftSource(source, text, i + 2), inFootnote) } as Emphasis, source, text, i, i + forced[0].length))
        i += forced[0].length
        continue
      }
      // Inline attribute block — attaches to preceding node. It must be GLUED:
      // a non-empty `buf` means unflushed text (e.g. a space) sits between the
      // preceding node and the `{`, so the block is NOT attached -- it stays
      // literal text (`<url> {.x}` keeps `{.x}`). Matches carve-php / carve-rs.
      const attr = !buf && hasBrace ? RE_INLINE_ATTR.exec(rest) : null
      // A digit-leading key or otherwise invalid payload (`{2=v}`) makes the
      // whole block literal (§14), same strict rule as block/span attrs — so
      // `` `code`{#1a} `` keeps the braces rather than parsing a bogus attr.
      if (attr && out.length && isValidInlineAttrPayload(attr[1]!)) {
        const prev = out[out.length - 1]!
        const parsed = parseAttrs(attr[1]!)
        // A `{...}` that yields no real attribute is literal text (PART 9
        // §15), not an empty attribute block to attach. Without this guard a
        // payload like `{=hl=}`, `{ }`, or `{???}` after a non-text node is
        // silently consumed and dropped.
        // The block also stays literal after an inert node whose renderer emits
        // NO attributes -- a soft/hard break, a mention, or a tag -- otherwise
        // the attrs attach and are silently discarded at render (mentions/tags
        // are stable inert spans that do not take attributes). Matches
        // carve-rs / carve-php, which keep the `{...}` literal in these cases.
        if (!ATTR_INERT_PREV.has(prev.type) && !isEmptyAttrs(parsed)) {
          ;(prev as { attrs?: Attrs }).attrs = mergeAttrs(
            (prev as { attrs?: Attrs }).attrs,
            parsed,
          )
          // A TRAILING ATTRIBUTE BLOCK IS THE NODE'S OWN MARKUP (PART 12 §4,
          // carve#521), so the span covers it: `*x*{#i}` gives the `strong`
          // offsets 0..7, not 0..3. The braces are where the node's `attrs`
          // came from, and a span stopping at `*x*` says the node ends before
          // the markup that gave it half its content -- the same reading that
          // already puts a break's backslash inside the break.
          extendPosTo(prev, source, text, i + attr[0].length)
          i += attr[0].length
          continue
        }
      }
    }

    // Mention
    if (c === '@' && (i === 0 || !/[A-Za-z0-9_]/.test(text[i - 1]!))) {
      const m = RE_MENTION.exec(rest)
      if (m) {
        flush()
        out.push(withPos({ type: 'mention', user: m[1]! } as Mention, source, text, i, i + m[0].length))
        i += m[0].length
        continue
      }
    }
    // Tag
    if (c === '#' && (i === 0 || !/[A-Za-z0-9_]/.test(text[i - 1]!))) {
      const m = RE_TAG.exec(rest)
      if (m) {
        flush()
        out.push(withPos({ type: 'tag', name: m[1]! } as Tag, source, text, i, i + m[0].length))
        i += m[0].length
        continue
      }
      // Bare `#` (not a tag) in a caption = number placeholder, first only.
      // `\#` never reaches here (the escape branch consumes it as literal).
      if (captionContext && !captionNumberEmitted) {
        flush()
        out.push(withPos({ type: 'caption_number' } as CaptionNumber, source, text, i, i + 1))
        captionNumberEmitted = true
        i += 1
        continue
      }
    }

    // Emphasis-family delimiters
    const em = matchEmphasis(text, i, source, inFootnote, emphasisNoClose)
    if (em) {
      flush()
      out.push(withPos(em.node, source, text, i, em.end))
      i = em.end
      continue
    }

    // Soft break (single newline inside paragraph)
    if (c === '\n') {
      flush()
      out.push(withPos({ type: 'soft_break' }, source, text, i, i + 1))
      i++
      continue
    }

    // Extension inline matchers run only here, where every core construct has
    // declined position i: extensions add syntax, they never hijack core.
    if (activeMatchers.length) {
      const xm = tryInlineMatchers(text, i)
      if (xm) {
        flush()
        out.push(withPos(xm.node, source, text, i, xm.end))
        i = xm.end
        continue
      }
    }

    append(c)
    i++
  }
  flush()
  return out
}

interface EmphasisMatch {
  node: Emphasis
  end: number
}

function matchEmphasis(
  text: string,
  i: number,
  source: InlineSource,
  inFootnote = false,
  noClose: Map<string, number> = new Map(),
): EmphasisMatch | null {
  const c = text[i]!

  // Bold-italic /*...*/  (priority over /emphasis/ and *bold*)
  if (c === '/' && text[i + 1] === '*') {
    const start = i + 2
    // A bold-italic span requires a non-whitespace char right after `/*`
    // (grammar boldItalic `~spaceOrEnd`). Empty (`/**/`) or space-initial
    // (`/* x*/`) content is not bold-italic and falls through to `/` emphasis,
    // matching carve-php parseBoldItalic.
    // `isCarveWhitespace`, not `\s`: PART 7 makes a vertical tab CONTENT, so
    // `/*<VT>a*/` is bold-italic exactly as `/*<SOH>a*/` already was.
    if (start < text.length && !isCarveWhitespace(text[start])) {
      let searchPos = start
      for (;;) {
        const close = findClose(text, searchPos, '*/')
        if (close === -1) break
        const inner = text.slice(start, close)
        // The content must not end in whitespace (nor be empty). A trailing
        // space closer like `/*x */` is not bold-italic; skip this `*/` and
        // look for a later one before giving up (parity with carve-php).
        if (inner === '' || isCarveWhitespace(inner[inner.length - 1])) {
          searchPos = close + 1
          continue
        }
        const children = scanInline(inner, shiftSource(source, text, start), inFootnote)
        return {
          // `boldItalic` records that the author used the combined form. The
          // nested spelling `*/x/*` yields the same tree, so the writer needs the
          // mark to reproduce what was written (PART 11 §6).
          node: {
            type: 'strong',
            boldItalic: true,
            // The inner emphasis is synthesized from the single `/*…*/` token
            // rather than scanned as its own delimiter pair, so nothing else
            // assigns it a span. PART 12 §4 requires one on every node but the
            // document root, and a consumer cannot tell a synthesized node from
            // a parsed one. It spans the CONTENT; the outer strong spans the
            // delimiters too.
            children: [withPos({ type: 'emphasis', children }, source, text, start, close)],
          },
          end: close + 2,
        }
      }
    }
  }
  // Single-char delimiters. Highlight `=` is single-char like the rest; a
  // doubled `==` is therefore literal by same-delimiter adjacency (handled
  // below), exactly like `**x**`. There is NO bare `^`/`,` delimiter:
  // superscript and subscript exist only in the braced forms `{^x^}`/`{,x,}`
  // (grammar PART 9 §9 rationale note) -- a bare caret or comma is literal.
  const pairs: Array<[string, Emphasis['type']]> = [
    ['/', 'emphasis'],
    ['*', 'strong'],
    ['_', 'underline'],
    ['~', 'strike'],
    ['=', 'highlight'],
  ]
  for (const [delim, type] of pairs) {
    if (c === delim) {
      const after = text[i + 1]
      const before = text[i - 1]
      // Opener must be followed by a non-space character.
      if (!after || after === ' ' || after === '\n') continue
      // No same-type nesting (spec §4.2): a bare delimiter adjacent to the
      // same delimiter (before OR after) does not open, so a doubled
      // delimiter is literal text. `**x**`, `~~x~~`, `==x==` stay literal,
      // uniformly with `//x//` and `__x__`. Applies to all five.
      if (after === delim || before === delim) continue
      // Word-boundary opener (spec §9): every bare delimiter can't open after
      // an alphanumeric or `_`, keeping paths/identifiers/numbers literal
      // (a/b/c, foo*bar*baz, snake_case, x = 5, key=value, 1,2,3). Use the
      // forced `{X…X}` family for deliberate intraword emphasis.
      if (before && /[A-Za-z0-9_]/.test(before)) continue
      // A HIGHLIGHT DOES NOT OPEN BEFORE `>` (markup-carve/carve#1442). `=>`
      // stopped being an arrow, which exposed its `=` to this machinery for the
      // first time: `d => e; x != y` opened here and closed on the `=` of `!=`,
      // rendering `<mark>&gt; e; x !</mark>` out of two things that are not
      // emphasis at all. The spec's Ohm grammar carries the same guard, and it
      // costs nothing real - a highlight whose content starts with `>` is a
      // shape nobody writes, while `=>` in prose about code is everywhere.
      if (delim === '=' && after === '>') continue
      // Italic/underline additionally can't open after `/` (path protection,
      // e.g. snake_/case/).
      if ((delim === '/' || delim === '_') && before === '/') continue
      // Find closer that's not preceded by space
      const close = cachedFindEmphasisClose(text, i + 1, delim, noClose)
      if (close !== -1) {
        const inner = text.slice(i + 1, close)
        return {
          node: { type, children: scanInline(inner, shiftSource(source, text, i + 1), inFootnote) },
          end: close + 1,
        }
      }
    }
  }
  return null
}

function findClose(text: string, from: number, marker: string): number {
  // Search forward for marker, simple substring match
  return text.indexOf(marker, from)
}

function cachedFindEmphasisClose(
  text: string,
  from: number,
  delim: string,
  noClose: Map<string, number>,
): number {
  const firstNoClose = noClose.get(delim)
  if (firstNoClose !== undefined && from >= firstNoClose) return -1
  const close = findEmphasisClose(text, from, delim)
  if (close === -1) noClose.set(delim, Math.min(firstNoClose ?? from, from))
  return close
}

function withPos<T extends InlineNode>(
  node: T,
  source: InlineSource,
  text: string,
  start: number,
  end: number,
): T {
  if (source.anchored === false) return node
  const pos = sourcePos(source, text, start, end)
  if (pos) node.pos = pos
  return node
}

/**
 * Move a node's span end out to `end`, keeping its start where it was.
 *
 * Used when markup that belongs to an already-emitted node is read after it -
 * a trailing attribute block. A node parsed with `anchored: false` carries no
 * `pos` at all, and there is nothing to extend.
 */
function extendPosTo(node: InlineNode, source: InlineSource, text: string, end: number): void {
  const pos = (node as { pos?: Position }).pos
  if (!pos) return
  const point = pointAt(source, text, end)
  // The markup read after the node is outside every anchored range, so the
  // extended span would end somewhere the text does not map. A span that cannot
  // state its own end is not a span; the node keeps none.
  if (!point) {
    delete (node as { pos?: Position }).pos
    return
  }
  pos.endLine = point.line
  pos.endColumn = point.column
  pos.endOffset = point.offset
}

function sourcePos(
  source: InlineSource,
  text: string,
  start: number,
  end: number,
): Position | undefined {
  const startPoint = pointAt(source, text, start)
  const endPoint = pointAt(source, text, end)
  if (!startPoint || !endPoint) return undefined
  // BOTH ENDS IN THE SAME RANGE. Two ends that each map is not enough when the
  // text is assembled: a node reaching from one fragment into the next covers
  // source it does not own - the row boundary between them - and one span for
  // two non-adjacent regions is the invented value PART 12 section 4 forbids.
  if (source.anchoredRanges && startPoint.range !== endPoint.range) return undefined
  return {
    startLine: startPoint.line,
    endLine: endPoint.line,
    startColumn: startPoint.column,
    endColumn: endPoint.column,
    startOffset: startPoint.offset,
    endOffset: endPoint.offset,
  }
}

/**
 * The AUTHORED SOURCE of `text[start..end)`, for a field that promises verbatim.
 *
 * `rawRef` is documented as the authored source verbatim, and the writer emits
 * it unchanged for an unresolved reference. Captured from the scanner's own
 * text it is not verbatim in a line block: the block layer empties every
 * comment-only line before the stanza is scanned as one inline run, so
 * `[a` / `%% secret` / `c][missing]` captured `[a\n\nc][missing]` and `carve
 * fmt` wrote the line back as a bare `%%`, losing the author's text from a
 * document that renders the same either way (carve-js#1183).
 *
 * IT VERIFIES ITSELF RATHER THAN TRUSTING THE SPAN, because the document is not
 * always the right answer. Container prefixes are stripped from this text on
 * purpose - a `> ` or a list item's indent is not part of the reference the
 * author wrote - so a blockquote's document slice would put those markers back
 * INTO `rawRef` and the writer would emit them inside the label.
 *
 * So the candidate is accepted only when every line of it either matches the
 * scanner's line exactly or stands against an EMPTY one. That is precisely the
 * emptied-comment-line shape and nothing else: a differing line that still
 * holds text is a prefix this text was right to drop, and a blank line inside a
 * paragraph or a stanza ends the block rather than appearing in one. A
 * reconstructed text (a line block with expanded tabs, a table cell assembled
 * from continuation rows) fails the same test and keeps the scanned spelling.
 *
 * Undefined means "no better answer than the local text", never an empty one.
 */
function rawSourceSlice(
  source: InlineSource,
  text: string,
  start: number,
  end: number,
): string | undefined {
  // ONLY ANCHORED TEXT CAN BE ASKED. Without `lineAnchors` a span is a single
  // base offset plus a local one, which is the document only when the two never
  // diverge - and a bare `inlineSource()` scanning a detached label has no
  // document behind it at all.
  if (!source.lineAnchors || activeDocument === null) return undefined
  const pos = sourcePos(source, text, start, end)
  if (pos?.startOffset === undefined || pos.endOffset === undefined) return undefined
  const candidate = normalizeNewlines(activeDocument.slice(pos.startOffset, pos.endOffset))
  const local = text.slice(start, end)
  if (candidate === local) return undefined
  const candidateLines = candidate.split('\n')
  const localLines = local.split('\n')
  if (candidateLines.length !== localLines.length) return undefined
  for (const [i, localLine] of localLines.entries()) {
    if (localLine !== '' && localLine !== candidateLines[i]) return undefined
  }

  return candidate
}

function shiftSource(source: InlineSource, text: string, by: number): InlineSource {
  const point = pointAt(source, text, by)
  const shifted: InlineSource = {
    // THE ANCHORED BASE, NOT THE LINEAR ONE. `baseOffset + by` walks the LOCAL
    // text, which is the document only while the two have the same length. A
    // line block's joined text is shorter than its source by every comment line
    // the block layer emptied, so past the first such line the linear sum lands
    // mid-comment: `*a` / `%% secret` / `c*` measured `c` at the second `%`
    // (carve-js#1182). `pointAt` already resolved the anchored answer.
    baseOffset: point?.offset ?? source.baseOffset + by,
    startLine: point?.line ?? source.startLine,
    startColumn: point?.column ?? source.startColumn,
  }
  if (source.anchoredRanges) {
    shifted.anchoredRanges = source.anchoredRanges
    shifted.rangeShift = (source.rangeShift ?? 0) + by
  }
  if (source.lineAnchors) {
    // CARRIED INWARD, which is the whole defect: the anchors reached the
    // stanza's top-level nodes and stopped at the first inline container, so a
    // node nested under one was measured from the joined text. Shared, with the
    // starting LINE carried as a delta - the array belongs to the whole stanza,
    // and copying a suffix per nested construct is quadratic in a tall stanza
    // that also carries markup.
    shifted.lineAnchors = source.lineAnchors
    shifted.anchorShift = (source.anchorShift ?? 0) + newlinesUpTo(text, by)
  }
  return shifted
}

/** How many newlines of `text` sit strictly before `offset`. */
function newlinesUpTo(text: string, offset: number): number {
  const indices = newlineIndices(text)
  let lo = 0
  let hi = indices.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (indices[mid]! < offset) lo = mid + 1
    else hi = mid
  }
  return lo
}

// Per-document cache of newline offsets for each inline text. pointAt() used to
// rescan `text` from 0 to `offset` on every token, which is O(offset) per call
// and O(n^2) across a token-dense or many-line paragraph. Caching the sorted
// newline indices once per distinct text and binary-searching makes each lookup
// O(log n). Cleared at the start of every parse() so it never outlives a
// document.
const newlineIndexCache = new Map<string, number[]>()

function newlineIndices(text: string): number[] {
  let indices = newlineIndexCache.get(text)
  if (indices === undefined) {
    indices = []
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '\n') indices.push(i)
    }
    newlineIndexCache.set(text, indices)
  }
  return indices
}

/**
 * Map a local offset in the inline text to its document line, column and
 * offset.
 *
 * With `lineAnchors` each line carries its own origin, so a continuation line is
 * measured from where that line actually starts in the document rather than by
 * adding a single base offset to a local one.
 *
 * With `anchoredRanges` the text was assembled from regions the scanner cannot
 * see the boundaries of, and an offset OUTSIDE every range has no document
 * position at all - undefined, rather than a number computed from the wrong
 * origin. The range is reported alongside so a caller can require both ends of a
 * span to come from the same one.
 */
function pointAt(
  source: InlineSource,
  text: string,
  offset: number,
): { line: number; column: number; offset: number; range?: AnchorRange } | undefined {
  if (source.anchoredRanges) {
    const cellOffset = offset + (source.rangeShift ?? 0)
    const range = anchorRangeAt(source.anchoredRanges, cellOffset)
    if (!range) return undefined
    const within = cellOffset - range.from
    return {
      line: range.line,
      column: range.column + within,
      offset: range.offset + within,
      range,
    }
  }
  const indices = newlineIndices(text)
  const newlinesBefore = newlinesUpTo(text, offset)
  // A FALLBACK ONLY. `startLine + newlinesBefore` assumes the stripped text has
  // one newline per source line, which an anchored text need not: see
  // `lineAnchors`. Where anchors exist the anchor's own line wins below.
  const line = source.startLine + newlinesBefore
  // Offset of this line's start within the LOCAL text.
  const lineStart = newlinesBefore === 0 ? 0 : indices[newlinesBefore - 1]! + 1
  const withinLine = offset - lineStart

  // A NESTED SCAN STARTS PART WAY INTO THE ANCHORED TEXT, so its first line is
  // whichever line of the outer text it began on. `anchorShift` carries that
  // index rather than a re-based copy of the array, for the reason `rangeShift`
  // carries one: an inline construct per line would otherwise copy the whole
  // anchor list per construct.
  const anchor = source.lineAnchors?.[newlinesBefore + (source.anchorShift ?? 0)]
  if (anchor) {
    // THE FIRST LINE MAY BEGIN MID-LINE and the rest never do. A shifted text
    // starts wherever its opener left off, so its origin is the source's own
    // base, which `shiftSource` already resolved through this function; only a
    // line reached by crossing a newline starts where the anchor says. For an
    // unshifted source the two agree by construction, since its first anchor IS
    // its base.
    if (newlinesBefore === 0) {
      return { line, column: source.startColumn + offset, offset: source.baseOffset + offset }
    }
    return {
      line: anchor.line,
      column: anchor.column + withinLine,
      offset: anchor.offset + withinLine,
    }
  }

  // Column resets to 1 right after the most recent newline; with none, it
  // continues from the source's starting column.
  const column =
    newlinesBefore === 0
      ? source.startColumn + offset
      : offset - indices[newlinesBefore - 1]!
  return { line, column, offset: source.baseOffset + offset }
}

function findEmphasisClose(text: string, from: number, delim: string): number {
  let depth = 0
  for (let j = from; j < text.length; j++) {
    const ch = text[j]!
    // Skip escapes
    if (ch === '\\' && j + 1 < text.length) {
      j++
      continue
    }
    // Skip verbatim (code) spans. An unclosed run is opaque to the end of the
    // block, so no emphasis closer can follow it — the opener cannot close.
    if (ch === '`') {
      const span = verbatimSpanEnd(text, j)
      if (!span.closed) return -1
      j = span.end - 1
      continue
    }
    // Comment contents are transparent to the surrounding emphasis structure.
    // Only a closed form is a comment; an unterminated opener remains literal.
    if (ch === '{' && text[j + 1] === '%') {
      const close = text.indexOf('%}', j + 2)
      if (close !== -1) {
        j = close + 1
        continue
      }
    }
    if (ch === delim) {
      // Closer must not be preceded by whitespace
      const prev = text[j - 1]
      if (prev === ' ' || prev === '\n' || prev === undefined) continue
      const next = text[j + 1]
      // Word-boundary closer (spec §9): no bare delimiter closes when followed
      // by an alphanumeric. Applies to every delimiter, not just / and _.
      if (next && /[A-Za-z0-9]/.test(next)) continue
      if (depth === 0) return j
      depth--
    }
  }
  return -1
}

/**
 * A span covering `value.slice(start, end)` of a text node whose own span is
 * `parent`.
 *
 * Abbreviation expansion splits a text node AFTER parsing, so the fragments it
 * produces have no span of their own - and PART 12 section 4 requires one on
 * every node except the document root.
 *
 * The arithmetic is sound rather than approximate: a text node's value maps 1:1
 * onto its source span, because escapes, smart punctuation and soft breaks are
 * each their own node, so no source character inside a text run stands for a
 * different number of characters. A text node never contains a newline either,
 * so a fragment stays on the parent's line and the column math stays flat.
 *
 * Returns undefined when the parent carries no span, rather than inventing one:
 * section 4 forbids emitting `pos` with invented values.
 */
function fragmentPos(
  parent: Position | undefined,
  start: number,
  end: number,
): Position | undefined {
  if (!parent) return undefined
  const pos: Position = { startLine: parent.startLine, endLine: parent.startLine }
  if (parent.startColumn !== undefined) {
    pos.startColumn = parent.startColumn + start
    pos.endColumn = parent.startColumn + end
  }
  if (parent.startOffset !== undefined) {
    pos.startOffset = parent.startOffset + start
    pos.endOffset = parent.startOffset + end
  }
  return pos
}


function applyAbbreviations(
  nodes: InlineNode[],
  defs: Map<string, string>,
): InlineNode[] {
  if (defs.size === 0) return nodes
  const out: InlineNode[] = []
  const abbrRe = new RegExp(`\\b(${[...defs.keys()].join('|')})\\b`, 'g')
  for (const node of nodes) {
    if (node.type !== 'text') {
      // Recurse where applicable
      const anyChildren = (node as unknown as { children?: InlineNode[] }).children
      if (Array.isArray(anyChildren)) {
        ;(node as unknown as { children: InlineNode[] }).children = applyAbbreviations(
          anyChildren,
          defs,
        )
      }
      // Inline-footnote content lives in `.inline` (design §3); recurse there too.
      const anyInline = (node as unknown as { inline?: InlineNode[] }).inline
      if (Array.isArray(anyInline)) {
        ;(node as unknown as { inline: InlineNode[] }).inline = applyAbbreviations(
          anyInline,
          defs,
        )
      }
      // An inline_extension keeps its inlines under `content`, not `children`,
      // so the generic recursion above never reached them and `:kbd[HTML]`
      // silently dropped an expansion that `*HTML*` and `[HTML](/u)` got.
      // PART 9R R3 matches a term in RENDERED TEXT at word boundaries and says
      // nothing about the container it sits in (carve#1151).
      const anyContent = (node as unknown as { content?: InlineNode[] }).content
      if (Array.isArray(anyContent)) {
        ;(node as unknown as { content: InlineNode[] }).content = applyAbbreviations(
          anyContent,
          defs,
        )
      }
      out.push(node)
      continue
    }
    const value = node.value
    let last = 0
    abbrRe.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = abbrRe.exec(value))) {
      if (m.index > last) {
        const frag = { type: 'text', value: value.slice(last, m.index) } as Text
        const fragSpan = fragmentPos(node.pos, last, m.index)
        if (fragSpan) frag.pos = fragSpan
        out.push(frag)
      }
      const abbr = m[1]!
      out.push({
        type: 'abbreviation',
        abbr,
        expansion: defs.get(abbr)!,
        pos: fragmentPos(node.pos, m.index, m.index + abbr.length),
      } as Abbreviation)
      last = m.index + abbr.length
    }
    if (last < value.length) {
      out.push({
        type: 'text',
        value: value.slice(last),
        pos: fragmentPos(node.pos, last, value.length),
      } as Text)
    } else if (last === 0) {
      out.push(node)
    }
  }
  return out
}

/**
 * Resolve reference-link placeholders against the collected definitions.
 * A resolved ref becomes a normal Link; an unresolved one falls back to
 * its literal `[text][ref]` text (Djot behavior). Order-independent: the
 * definition may appear anywhere in the document (grammar §6).
 */
function applyLinkDefs(
  nodes: InlineNode[],
  defs: Map<string, LinkDef>,
): InlineNode[] {
  const out: InlineNode[] = []
  for (const node of nodes) {
    const anyChildren = (node as unknown as { children?: InlineNode[] }).children
    if (Array.isArray(anyChildren)) {
      ;(node as unknown as { children: InlineNode[] }).children = applyLinkDefs(
        anyChildren,
        defs,
      )
    }
    // Inline-footnote content lives in `.inline` (design §3); recurse there too.
    const anyInline = (node as unknown as { inline?: InlineNode[] }).inline
    if (Array.isArray(anyInline)) {
      ;(node as unknown as { inline: InlineNode[] }).inline = applyLinkDefs(
        anyInline,
        defs,
      )
    }
    if (node.type === 'link' && node.ref !== undefined) {
      // Normalization does not make a multiline label syntactically valid.
      // The inline scanner may retain such a bracket run as a placeholder so
      // it can degrade byte-for-byte, but it must never enter the symbol table.
      const def = /[\r\n]/.test(node.ref) ? undefined : defs.get(normalizeRefLabel(node.ref))
      if (def) {
        node.href = def.href
        if (def.title !== undefined) node.title = def.title
        // PART 9R R1: the definition's attributes transfer to the link, and
        // the link's own override per key. "Per key" is §15 A3's merge - the
        // one stacked attribute lists already use - so a repeated id or key
        // takes the LAST value (the link's) and classes ACCUMULATE across the
        // two. Definition first, link second (carve#604).
        if (def.attrs) node.attrs = mergeAttrs(def.attrs, node.attrs ?? {})
      }
        // PART 12 §3a, A RESOLVED REFERENCE KEEPS ITS DESTINATION: `ref` and
        // `rawRef` stay BESIDE `href`, exactly as §5 has footnote numbering
        // added alongside rather than in place of the reference. Deleting them
        // made `[a][]` and `[a](#a)` the same tree, which is the distinction
        // the clause exists to protect - and the clause names all three
        // engines as missing this half (carve#596).

      // If unresolved, KEEP the placeholder so a post-parse pass
      // (resolveImplicitHeadingRefs in heading-ids.ts) can match it
      // against the document's parsed headings, or finalize it to
      // literal text. Falling back here would lose the link node
      // before that pass ever sees it.
      out.push(node)
      continue
    }
    if (node.type === 'image' && node.ref !== undefined) {
      const def = /[\r\n]/.test(node.ref) ? undefined : defs.get(normalizeRefLabel(node.ref))
      if (def) {
        node.src = def.href
        if (def.title !== undefined) node.title = def.title
        // AN IMAGE REFERENCE RESOLVES THE SAME ENTRY - NORMATIVE. It looks the
        // label up in the same table and takes the same three fields, so a
        // definition's attributes reach the image exactly as they reach a link:
        // `[ex]: /i.png {.wide}` gives `class="wide"`. This took `href` and
        // `title` and stopped, which is not a rule, it is where the
        // implementation stopped (carve#697).
        //
        // Same §15 A3 merge as the link branch above - definition first, use
        // site second, so a repeated key takes the LAST value and classes
        // ACCUMULATE in source order.
        if (def.attrs) node.attrs = mergeAttrs(def.attrs, node.attrs ?? {})
      }
        // PART 12 §3a, A RESOLVED REFERENCE KEEPS ITS DESTINATION: `ref` and
        // `rawRef` stay BESIDE `href`, exactly as §5 has footnote numbering
        // added alongside rather than in place of the reference. Deleting them
        // made `[a][]` and `[a](#a)` the same tree, which is the distinction
        // the clause exists to protect - and the clause names all three
        // engines as missing this half (carve#596).

      // Unresolved image refs do NOT match heading text; the resolve pass
      // finalizes any survivor to literal source (rawRef).
      out.push(node)
      continue
    }
    out.push(node)
  }
  return out
}

// ============================================================================
// Attribute block parsing — {#id .class key=value key="value with spaces"}
// ============================================================================

/**
 * True when `inner` (the text between an attribute block's braces) is
 * ENTIRELY valid attribute syntax: a sequence of `#id`, `.class`, or
 * `key=value` tokens separated by whitespace/newlines, with nothing
 * left over. Used to decide whether a standalone `{...}` line is a
 * block-attribute line or literal text (PART 9 §15).
 */
function isValidAttrPayload(inner: string): boolean {
  // A QUOTED VALUE STOPS AT THE NEWLINE, in BOTH of its alternatives
  // (markup-carve/carve#888). The value ends at the closing quote on the same
  // line; a line break inside the quotes is not content, it ends the
  // production, and the whole attribute block is unrecognized.
  //
  // The rule is on the PAYLOAD rather than on the matchers because the matchers
  // are eight regex literals that share one subpattern, and it applies to BOTH
  // surfaces:
  //
  //  - an INLINE attribute block cannot span lines at all
  //    (markup-carve/carve#897), and since markup-carve/carve#906 its padding
  //    takes `space` and its separator `space+`, neither of which admits a
  //    break. The quoted value was the last way through.
  //  - `block_attributes` reads the SAME `quoted_value`, so a break inside a
  //    quoted value ends that block too. A block attribute may still span
  //    lines: `continuation` is where a newline is admitted, and it sits
  //    BETWEEN two tokens, never inside one.
  //
  // Testing the QUOTED RUNS rather than the payload is what keeps those apart -
  // `\s+` below is the separator and still carries the newline a continuation
  // needs. This engine kept the break in the value and rendered it into the
  // attribute; carve-php and carve-rs collapsed it to a space, which no
  // production in either normative file describes.
  if (quotedRunSpansLines(inner)) return false
  // The quoted value alternatives are escape-aware (and single-quoted as
  // well as double-quoted) so the same payloads parseAttrs accepts validate
  // as block attributes — otherwise `"a\"b"` strips only to `"a\"` and the
  // rest leaks, falsely rejecting the block.
  // Explicit ids and classes additionally admit an ASCII digit first. Keys and
  // booleans keep the narrower identifier grammar, so `2=v` stays literal.
  // The bareword (boolean-attribute) alternative comes after key=value so a
  // `key=value` is consumed whole, and before the separator run. It makes
  // `{disabled}` and `{.c disabled}` valid blocks (boolean attrs) rather than
  // literal text.
  //
  // THE SEPARATOR AND THE UNQUOTED VALUE ARE PART 7's FOUR CHARACTERS, not
  // `\s+` / `\S+`. An unquoted value runs to the next `whitespace`, so
  // `{k=v<VT>w}` is ONE attribute whose value holds a vertical tab; under `\s`
  // it split into `k="v"` and a boolean `w`, while `{k=v<SOH>w}` - the same
  // shape with a different control character - stayed one attribute. Three
  // producers spell this run (here, `parseAttrs`'s `re` below, and WS_NO_NL's
  // fast path); they move together or the fast path accepts what the regex
  // rejects.
  // A SEPARATOR IS REQUIRED BETWEEN TWO ATTRIBUTES. `attribute_list` is
  // `attribute, {space+, attribute}` (PART 7), so `{.a.b}` and `{#i.c}` are not
  // attribute blocks and stay literal. This engine used to strip items and
  // whitespace in any order and accept whatever emptied, which admitted every
  // adjacent pair; the executable spec has always refused them, and nothing in
  // the corpus pinned the question either way.
  return ATTR_PAYLOAD.test(inner)
}

/**
 * `^ ws* item (ws+ item)* ws*$`, spelled once. Anchored rather than stripped,
 * because stripping cannot express "these two may not touch".
 *
 * The BAREWORD alternative is the one name here that may not begin with `_`
 * (markup-carve/carve#1450). This is the SECOND spelling of that rule - the
 * first is `parseAttrs`'s `re` - and they have to move together, or the payload
 * validates as an attribute block that then parses to nothing.
 */
const ATTR_ITEM_SRC =
  '(?:#[a-zA-Z0-9_][\\w-]*)|(?:\\.[a-zA-Z0-9_][\\w-]*)|(?:[a-zA-Z_][\\w-]*=(?:"(?:[^"\\\\]|\\\\.)*"|\'(?:[^\'\\\\]|\\\\.)*\'|[^ \\t\\n\\r]+))|(?::(?:[A-Za-z0-9]{1,8}(?:-[A-Za-z0-9]{1,8})*)?)|(?:[a-zA-Z][\\w-]*)'
const ATTR_PAYLOAD = new RegExp(
  `^[ \\t\\n\\r]*(?:(?:${ATTR_ITEM_SRC})(?:[ \\t\\n\\r]+(?:${ATTR_ITEM_SRC}))*[ \\t\\n\\r]*)?$`,
)

/**
 * The same question for an INLINE attribute block, which additionally requires
 * every whitespace slot of its interior to be a SPACE (markup-carve/carve#906,
 * markup-carve/carve-js#836).
 *
 * Five slots narrow, and they are five separate positions rather than one
 * separator rule - the run after `{`, the run between two attributes, the run
 * before `}`, the boundary after an UNQUOTED value, and the blessed empty
 * block `{ }`. All five sit AFTER the first non-whitespace character of their
 * line, which is where PART 7 already says a tab is not syntax. A tab at any
 * of them makes the block unrecognized and its braces show.
 *
 * The BLOCK-ATTRIBUTE LINE does NOT narrow, and that distinction is the ruling
 * rather than an omission: it is the one attribute block with a `continuation`,
 * so the whitespace after its newline IS a leading indentation run, where a tab
 * belongs. `isValidAttrPayload` above is therefore left alone and this wrapper
 * is used everywhere except that one call site.
 *
 * Inside a QUOTED value a tab is CONTENT and does not narrow anything, so the
 * quoted runs come out before the test. Testing the raw payload would reject
 * `{k="a<TAB>b"}`, which is a valid block whose value contains a tab.
 */
function isValidInlineAttrPayload(inner: string): boolean {
  return isValidAttrPayload(inner) && !inlineAttrPayloadHasTab(inner)
}

/**
 * Whether an attribute payload puts a TAB where the inline block's grammar
 * spells `space`. Split out from the predicate above because the DEFINITION's
 * trailing attribute block reaches this rule through
 * `splitTrailingAttrBlock` instead, and has no validity gate of its own to
 * hang it on.
 *
 * The quoted runs come out first: inside a quoted value a tab is CONTENT.
 * Leading/trailing braces do not matter here, so a caller may pass the payload
 * with or without them.
 */
function inlineAttrPayloadHasTab(inner: string): boolean {
  return inner.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '').includes('\t')
}

/** Whether any quoted run in an attribute payload carries a line break. */
function quotedRunSpansLines(inner: string): boolean {
  // `\\.` cannot consume a newline (no `s` flag), so a run that reaches the
  // next line does it through the unescaped-character class and is matched
  // here whole.
  for (const m of inner.matchAll(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g)) {
    if (m[0]!.includes('\n')) return true
  }

  return false
}

/** True when an attribute block parsed to no id, classes, or key=values. */
function isEmptyAttrs(attrs: Attrs): boolean {
  return (
    attrs.id === undefined &&
    (attrs.classes === undefined || attrs.classes.length === 0) &&
    (attrs.keyValues === undefined || Object.keys(attrs.keyValues).length === 0)
  )
}

// Backslash before ASCII punctuation yields that character; any other
// backslash is kept literal. Mirrors the inline text-escape rule and the
// carve-php AttributeParser, applied to quoted attribute values.
function unescapeAttrValue(v: string): string {
  return v.replace(/\\(.)/g, (whole, c: string) =>
    /[\\`*_{}\[\]()#+\-.!~^/<>@%|=,"'$&:;?]/.test(c) ? c : whole,
  )
}

export function parseAttrs(src: string): Attrs {
  const attrs: Attrs = {}
  const order: string[] = []
  const note = (slot: string) => {
    if (!order.includes(slot)) order.push(slot)
  }
  // A key/value's value is double-quoted, single-quoted, or a bare run
  // (grammar `quoted_value = '"' … '"' | "'" … "'"`). Both quote forms
  // strip their delimiters, so `k='{y}'` yields the literal `{y}`. A
  // backslash escapes ASCII punctuation inside a quoted value, so
  // `k="a\"b"` yields the literal `a"b`.
  // Explicit ids/classes admit an ASCII digit first. Keys and booleans do not.
  // The bareword alternative (m[7]) is LAST so `key=value` matches as a
  // key/value, not as a bareword `key` with a leftover `=value`. A bareword is
  // a value-less (boolean) attribute -> rendered `name=""` (djot-php form).
  // IT MAY NOT START WITH `_`, unlike every other name here
  // (markup-carve/carve#1450): `{_x_}` is also a forced underline, and alone on
  // a line the attribute reading won and rendered NOTHING, since there was no
  // block beneath it to attach to. HTML has no underscore-first boolean
  // attribute to lose, and `{#_id}`, `{._c}` and `{_k=1}` are untouched -
  // none of them ends `_}`, so none of them collides.
  const re = /(?:#([a-zA-Z0-9_][\w-]*))|(?:\.([a-zA-Z0-9_][\w-]*))|(?:([a-zA-Z_][\w-]*)=(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|([^ \t\n\r]+)))|(?:(?<=^|[ \t\n\r]):((?:[A-Za-z0-9]{1,8}(?:-[A-Za-z0-9]{1,8})*)?)(?=[ \t\n\r]|$))|(?:([a-zA-Z][\w-]*))/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) {
    if (m[1]) {
      attrs.id = m[1]
      note('#id')
    } else if (m[2]) {
      attrs.classes = [...(attrs.classes ?? []), m[2]]
      note('.class')
    } else if (m[3]) {
      const val =
        m[4] !== undefined ? unescapeAttrValue(m[4])
        : m[5] !== undefined ? unescapeAttrValue(m[5])
        : (m[6] ?? '')
      if (m[3] === 'id') {
        // `id=j` is the SAME attribute as `#j`: it sets the id slot, last-wins
        // (§15), instead of emitting a second `id="…"` (invalid HTML). Matches
        // carve-php; `{#i id=j}` -> `id="j"`.
        attrs.id = val
        note('#id')
      } else {
        attrs.keyValues = { ...(attrs.keyValues ?? {}), [m[3]]: val }
        note(m[3])
      }
    } else if (m[7] !== undefined) {
      // `{:TAG}` is exact sugar for `lang=TAG`, and `{:}` for `lang=""` - an
      // explicit "the language here is unknown", which stops inheritance from a
      // surrounding language in a way that omitting the attribute does not.
      // It desugars during attribute parsing, so there is no new AST node, no
      // new field, and a consumer that has never heard of the shorthand sees an
      // ordinary `lang` key/value.
      attrs.keyValues = { ...(attrs.keyValues ?? {}), lang: m[7] }
      note('lang')
    } else if (m[8]) {
      if (m[8] === 'id') {
        // A bare boolean `id` also feeds the id slot (value ''), last-wins and
        // single -- `{id id=j}` -> `id="j"`, `{id}` -> `id=""` -- so `id` never
        // enters keyValues and no duplicate `id` attribute can be produced.
        attrs.id = ''
        note('#id')
      } else {
        // Boolean attribute: a bare word with no value.
        attrs.keyValues = { ...(attrs.keyValues ?? {}), [m[8]]: '' }
        note(m[8])
      }
    }
  }
  if (order.length) attrs.order = order
  return attrs
}

export function mergeAttrs(a: Attrs | undefined, b: Attrs): Attrs {
  if (!a) return b
  const out: Attrs = { ...a }
  // `!== undefined`, not truthiness: an explicit `id=""` in a later block wins
  // over an earlier `#old` (last-wins §15), e.g. `[x]{#old}{id=""}` -> `id=""`.
  if (b.id !== undefined) out.id = b.id
  if (b.classes) out.classes = [...(out.classes ?? []), ...b.classes]
  if (b.keyValues) out.keyValues = { ...(out.keyValues ?? {}), ...b.keyValues }
  // Merge source order: keep `a`'s order, append `b`'s new slots (a slot
  // already present keeps its earlier position; values are last-wins via
  // the merges above). §15 + source-order rendering.
  const order = [...attrOrder(a)]
  for (const slot of attrOrder(b)) if (!order.includes(slot)) order.push(slot)
  if (order.length) out.order = order
  return out
}

/** The attribute slots of `a` in order (its `order`, or a derived default). */
function attrOrder(a: Attrs): string[] {
  if (a.order) return a.order
  const o: string[] = []
  if (a.classes?.length) o.push('.class')
  if (a.id !== undefined) o.push('#id')
  if (a.keyValues) for (const k of Object.keys(a.keyValues)) o.push(k)
  return o
}
