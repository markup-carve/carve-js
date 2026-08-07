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

export interface ParseOptions {
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
  kind: 'div' | 'admonition' | 'line block' | 'hard-break block'
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

// Content must carry at least one non-ASCII-whitespace character, mirroring
// RE_CAPTION: `# ` / `#   ` (marker + whitespace only) and `#\t…` are NOT
// headings, exactly like the caption rule. Leading spaces are folded into the
// ` +` delimiter, so the content group starts at the first non-space; a NBSP
// (U+00A0) counts as content, as everywhere else in the parser.
const RE_HEADING =
  /^(#{1,6}) +((?=[ \t\f]*[^ \t\n\r\f]).+?)(?:\s+\{((?:[^}"'\n]|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')+)\})?\s*$/
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
// THE TAB ROW IS DELIBERATELY UNCHANGED. Whether this run is `whitespace` or
// the narrower `space` is the same question PART 7 answers for NAMED slots
// ("a tab is syntax ONLY in a line's LEADING INDENTATION RUN") and that carve
// #886 / #894 / #905 have been settling one construct at a time -- but no
// clause names this run, so there is nothing to apply it to yet. carve-rs
// accepts a tab after `:::` and after `+` and rejects one after ` ``` `;
// carve-php accepts it in all three. Narrowing the class to `whitespace` fixes
// every row all three tickets name without deciding that one.
const TRAILING_WS = '[ \\t]*$'

/**
 * The closer for a fence opened with `marker`: the same character, at least as
 * long, and nothing after it but the trailing run above.
 *
 * ONE producer on purpose. This regex was built at eight call sites and spelled
 * out at four more, and a narrowing pass that reaches twelve of thirteen leaves
 * exactly the drift carve-js#805 reports.
 */
function fenceCloseRe(marker: string): RegExp {
  return new RegExp(`^${marker[0]}{${marker.length},}${TRAILING_WS}`)
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
// either, and carries `TRAILING_WS` above: it was left at `\s` when the slots
// were narrowed, so ```` ```<BOM> ```` opened a fence in this engine while
// carve-rs and carve-php both read the line as prose. Opener and closer are
// one run seen from two ends (carve-js#805).
// Groups: 3 lang, 4|6 header (quoted, incl. quotes), 5|7|8 label (incl. brackets).
const RE_FENCE = new RegExp(
  '^()(`{3,}|~{3,}) ?(?:([a-zA-Z0-9_+#/.-]+)(?: +("[^"]*"))?(?: +(\\[[^\\]]*\\]))?' +
    '|("[^"]*")(?: +(\\[[^\\]]*\\]))?|(\\[[^\\]]*\\]))?' +
    TRAILING_WS,
)
// Bullets are `-` and `*` only. Unlike Markdown/djot, `+` is not a Carve bullet
// -- it is reserved as the list-continuation marker (PART 9 §17), so a lone `+`
// is unambiguous and a `+ x` line is ordinary paragraph text. A marker is a list
// item only with non-empty content: a content-less marker (`-`, `- `, `-   ` --
// bare or trailing whitespace only) is NOT a list, it is paragraph text.
// The leading indentation is matched ATOMICALLY, via the `(?=(...))\1` idiom.
// A plain `([^\S\u00a0]*)` is greedy and BACKTRACKS: on a line the pattern does
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
// U+FEFF IS NOT INDENTATION. These classes are `\s` minus NBSP, and
// JavaScript's `\s` uniquely contains U+FEFF - Rust's `char::is_whitespace`
// and PCRE's `\s` do not - so a mark before a marker was skipped here as
// indentation while carve-php and carve-rs kept the line literal (#790).
//
// PART 9 states that zero-width characters are NOT whitespace and ARE ordinary
// characters, and the corpus pins the one exception: a mark at the START of a
// document is not content. Everywhere else it is, and content before a marker
// means the marker opens nothing. This engine also rendered the same mark into
// a paragraph's text, so it was content in one position and absent in another.
//
// Scoped to marker RECOGNITION on purpose. `RE_BLANK_LINE` below decides what a
// BLANK LINE is, which moves document structure rather than what a line opens;
// it is narrower still, because the grammar names that class outright.
const RE_UNORDERED = /^(?=([^\S\u00a0\ufeff]*))\1[-*] +([\S\u00a0].*)$/
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
  /^(?=([^\S\u00a0\ufeff]*))\1([0-9]+|[ivxlcdm]+|[IVXLCDM]+|[a-z]|[A-Z]|(?=\.))([.)]) +([\S\u00a0].*)$/
// Task states (matches djot-php): `x`/`X` are checked; ` `, `-`, `_`,
// `>`, `?` are all accepted and render as an unchecked checkbox.
const RE_TASK = /^(?=([^\S\u00a0\ufeff]*))\1[-*] +\[([ xX\-_>?])\] +([\S\u00a0].*)$/
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
  /^([^\S\u00a0\ufeff]*)((?:[-*])|(?:[0-9]+|[ivxlcdm]+|[IVXLCDM]+|[a-z]|[A-Z]|(?=\.))[.)])\{((?:[^}"'\n]|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')*)\}( +[\S\u00a0].*)$/
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

const TRIM_STRUCTURAL_RE = /^[^\S\u00a0]+|[^\S\u00a0]+$/g

function trimStructural(text: string): string {
  // Fast path: a line with no literal U+00A0 trims identically to native
  // String.trim() (which would also strip U+00A0, but there is none here), so
  // the hot per-line blank/HR checks stay at native speed; only a line that
  // actually carries a non-breaking space pays for the regex.
  if (!text.includes(' ')) return text.trim()
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
const RE_ADMONITION_OPEN = /^(:{3,}) +([a-zA-Z_][\w-]*)(?: +("[^"]*"))?(?: +(\[[^\]]*\]))?[ \t]*$/
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
const RE_DEFLIST_TERM = /^::(?!:) [ \t]*(?=\S)(.+)$/
// A CONTENT-LESS marker line: `::` or `:` followed by whitespace and nothing
// else. It is not a marker - both patterns above require content - so it stays
// paragraph text, and it CLOSES any open term or definition rather than folding
// into it (carve-js#731; carve-rs and carve-php both close).
//
// At least one space is required, so a bare `::` is untouched: all three engines
// already agree on that line and it is a different shape.
const RE_DEFLIST_MARKER_EMPTY = /^::?(?!:)[ \t]+$/

const RE_DEFLIST_DEF = /^: {2,}(.+)$/
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
const RE_ABBR_DEF = /^\*\[([A-Za-z0-9]+)\]: +([^]+)$/u
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
 */
function splitTrailingAttrBlock(line: string): [string, string | null] {
  const end = line.replace(/\s+$/, '')
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
      if (inlineAttrPayloadHasTab(end.slice(open))) return [line, null]

      return [end.slice(0, open - 1), end.slice(open)]
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
  /^[^\S\u00a0\ufeff]*\[(?!@)([^\]]+)\]: \p{White_Space}*(\P{White_Space}+)(?: (?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'))?[ \t]*$/u

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
const RE_CAPTION = /^\^ +(.*[^ \t\n\r\f].*)$/
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
 */
function dropTrailingWhitespace(text: string): string {
  return text.replace(/[ \t]+(?=\n|$)/g, (run, offset: number, whole: string) => {
    // AN ESCAPED SPACE IS CONTENT, NOT TRAILING WHITESPACE. `\ ` is this
    // language's non-breaking-space escape, so the space it names is a
    // character the author wrote and the run STOPS at it.
    //
    // Missing this does not lose a character, it changes the block: dropping
    // the space leaves a bare backslash at the end of the line, and a bare
    // backslash at the end of a line is a HARD BREAK. So `a\ ` + newline + `b`
    // rendered a line break where the author wrote a no-break space. Raised by
    // codex review on the change that widened this rule to every line, and it
    // was already true at the block-FINAL position that rule reached before.
    //
    // Only the FIRST character of the run can be the escaped one; everything
    // after it is ordinary trailing whitespace and still goes.
    let slashes = 0
    for (let i = offset - 1; i >= 0 && whole[i] === '\\'; i--) slashes++

    return slashes % 2 === 1 && run.startsWith(' ') ? ' ' : ''
  })
}
const RE_TABLE_ROW = /^\|/
// A complete standard table row opens AND closes with `|` (grammar
// standard_row). A stray leading `|` with no closing `|` (`| a`) is ordinary
// paragraph text, not a table -- so a table opener / interrupter must have the
// trailing pipe, not just a leading one. A row may carry an attribute block
// GLUED to its closing pipe (`| a |{.x}` -> <tr class="x">); rowAttrsFromLine
// validates and strips it, so the gate allows an optional trailing `{...}`.
const isTableRow = (line: string): boolean => {
  if (!RE_TABLE_ROW.test(line)) return false
  if (!/\|[ \t]*$/.test(line) && rowAttrsFromLine(line).attrs === undefined) return false
  const cells = splitTableRow(rowAttrsFromLine(line).body)
  // A row needs a non-empty cell OR at least two cells: `|||` (two empty cells)
  // is a valid all-empty body row, but `||` (a single empty cell) is not a
  // table. Matches carve-php / carve-rs.
  return cells.some((cell) => cell.length > 0) || cells.length >= 2
}
// A `+`-prefixed continuation row (multi-line cell). Like the grammar's
// continuation_row it ends with `|`; that trailing pipe distinguishes
// it from a `+ ` list item (which never ends with `|`). Only consumed
// inside parseTable, after a standard `|` row has opened the table.
const RE_TABLE_CONT = /^\+.*\|\s*$/
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
const RE_BARE_IMAGE = /^!\[([^\]]*)\]\(([^)\s]+)(?: "([^"]*)"| '([^']*)')?\)(?:\{((?:[^}"'\n]|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')+)\})?\s*$/
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
const RE_RAW_FENCE = new RegExp('^(`{3,}|~{3,}) ?=([a-zA-Z][\\w-]*)' + TRAILING_WS)
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
const RE_FENCE_CLOSER = new RegExp('^(`{3,}|~{3,})' + TRAILING_WS)
// The same line seen by the definition prepass, which has already re-based it to
// the fence's content column and so matches the run alone.
const RE_FENCE_CLOSER_PREPASS = new RegExp('^([`~]{3,})' + TRAILING_WS)

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

  // Negative cache for fenceHasCloser (paragraph-interruption closer
  // lookahead): the smallest line index from which NO bare fence-closer
  // line exists onward. Once proven, every later fence opener (pos only
  // advances) short-circuits, keeping "many unclosed fences" input linear.
  noFenceCloserFrom = Infinity

  // width -> LAST line index carrying a comment fence of that width, built once
  // by commentBlockHasCloser. A closer must match the opener width exactly, so
  // "is there a closer after i" is exactly "last index for this width > i".
  // Replaces a per-opener scan to end of input, which was superlinear when many
  // openers carry distinct widths.
  commentFenceLastIndex: Map<number, number> | undefined = undefined

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
      this.lines = source.replace(/\r\n?/g, '\n').split('\n')
    } else {
      this.lines = source.slice()
    }
    // Drop trailing empty line introduced by terminal newline
    if (this.lines.length && this.lines[this.lines.length - 1] === '') {
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

function normalizedSourceLines(source: string): string[] {
  if (layoutWork.on) layoutWork.seam += source.length
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
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
  const mapLength = lines.length > 0 && lines[lines.length - 1] === '' ? lines.length - 1 : lines.length
  const sub = subLexer(
    lines,
    parent.parseOptions,
    parent.lineNumberOffset + startLineIndex,
    sourceLineMap ?? Array.from({ length: mapLength }, (_l, i) => parent.lineNumber(startLineIndex + i)),
    parent.unclosedContainerKeys,
  )
  sub.abbrDefs = parent.abbrDefs
  sub.linkDefs = parent.linkDefs
  sub.footnoteDefs = parent.footnoteDefs
  sub.footnoteDefPos = parent.footnoteDefPos
  sub.nested = true
  sub.depth = parent.depth + 1
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
  const parentIndicesOf = new Map<number, number[]>()
  if (sub.sourceLineMap) {
    for (let i = 0; i < parent.lines.length; i++) {
      const number = parent.lineNumber(i)
      const bucket = parentIndicesOf.get(number)
      if (bucket) bucket.push(i)
      else parentIndicesOf.set(number, [i])
    }
  }

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

/** A dedented line's content, with any synthesized leading spaces removed. */
function withoutSyntheticIndent(line: string): string {
  return line.replace(/^[^\S\u00a0]+/, '')
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

export function parse(source: string, opts: ParseOptions = {}): Document {
  newlineIndexCache.clear()
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
  // First pass: collect abbreviation and reference-link definitions so
  // they can be resolved regardless of document order (grammar §6).
  collectLinkDefs(lexer)

  const prevMatchers = activeMatchers
  const prevCtx = activeMatcherCtx
  activeMatchers = (opts.extensions ?? []).filter((e) => e.matchInline || e.matchBlock)
  activeMatcherCtx = activeMatchers.length ? makeMatcherCtx(lexer, opts) : null
  try {
    const children = parseBlocks(lexer, 0)
    appendLinkReferenceDefinitions(children, lexer, source)
    const doc: Document = { type: 'document', children }
    // Record the source byte length so renderers can size the
    // abbreviation-expansion budget (DoS guard); see render-html/markdown/ansi.
    doc.srcByteLength = utf8ByteLength(source)
    if (lexer.frontmatter) doc.frontmatter = lexer.frontmatter
    if (lexer.footnoteDefs.size) doc.footnoteDefs = Object.fromEntries(lexer.footnoteDefs)
    if (lexer.footnoteDefPos.size) doc.footnoteDefPos = Object.fromEntries(lexer.footnoteDefPos)
    toCodepointPositions(doc, source)
    return doc
  } finally {
    activeMatchers = prevMatchers
    activeMatcherCtx = prevCtx
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
  for (const [label, def] of lexer.linkDefs) {
    // A definition with no recorded line came from somewhere other than the
    // source scan (a sub-lexer copy for extension content), so there is no line
    // to reproduce and nothing to hoist.
    if (def.line === undefined) continue
    const node: LinkReferenceDefinition = {
      type: 'link_reference_definition',
      label,
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
export function normalizeRefLabel(label: string): string {
  return label.trim().replace(/\s+/g, ' ')
}

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
const RE_DESCRIPTION_PREFIX = /^[^\S\u00a0\ufeff]*:[^\S\u00a0]+/
const RE_AFTER_TERM = /^[^\S\u00a0\ufeff]*(?:::(?!:)|:)[^\S\u00a0]/

function stripContainerPrefixesKeepIndent(raw: string, afterTerm = false): string {
  let line = raw
  let prev: string
  do {
    prev = line
    line = line
      .replace(/^[^\S\u00a0\ufeff]*>(?: |$)/, '') // blockquote (NBSP and U+FEFF are content)
      .replace(/^[^\S\u00a0\ufeff]*(?:[-*]|\d+[.)])[^\S\u00a0]+(?:\[[ xX\-_>?]\][^\S\u00a0]+)?/, '') // list/task (NBSP and U+FEFF are content)
    if (afterTerm) line = line.replace(RE_DESCRIPTION_PREFIX, '')
  } while (line !== prev)
  return line
}

function stripContainerPrefixes(raw: string, afterTerm = false): string {
  // Residual indentation, keeping a content NBSP - and a content U+FEFF, for
  // the same reason. This is the view the definition collector matches
  // against, so a mark eaten here resolved a reference on a line the renderer
  // prints verbatim: the definition line rendered literally AND registered
  // (#790).
  return stripContainerPrefixesKeepIndent(raw, afterTerm).replace(/^[^\S\u00a0\ufeff]+/, '')
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
 * Deliberate limitation: this flat pre-pass is the price of
 * order-independent resolution (§6) without a second structural parse.
 * A definition jammed into a hard-wrapped paragraph with no surrounding
 * blank line (e.g. `Intro\n- [r]: /u`) is still collected here even
 * though parseParagraph keeps that line as prose. Reference definitions
 * are conventionally blank-line-separated; the jammed-in form is
 * pathological and intentionally not special-cased.
 */
// The list marker the definition pre-pass tracks content columns with. Applied
// REPEATEDLY along a line, so `- - a` contributes both of its columns.
const RE_PREPASS_MARKER =
  /^([ \t]*)(?:[-*]|(?:[0-9]+|[ivxlcdm]+|[IVXLCDM]+|[a-z]|[A-Z])[.)])(?:\{[^}]*\})? +/

function collectLinkDefs(lexer: Lexer) {
  let fence: { ch: string; len: number; contentCol: number; quoted: boolean } | null = null
  // A LINE BLOCK is verse: a definition written inside one is text the author
  // laid out, not a definition (PART 9 §23). Tracked like a code fence, and
  // closed on its own width so a wider `:::: |` is not closed by a narrower run.
  let verse: number | null = null
  // A comment's body is OPAQUE. This pass did not know it, so a `[r]: /u`
  // written inside `%%%` registered and a reference elsewhere resolved against
  // text the author commented out - invisible in the output AND active in the
  // link table (carve-js#634). The footnote path already treats a comment as
  // opaque; this one did not.
  let commentFence: number | null = null
  // Div nesting depth, for the abbreviation branch below. A div is the one
  // container that adds NO per-line prefix, so `raw` alone cannot tell a
  // document-level definition from one written inside `:::`. Colon fences close
  // on an exact length match (carve#455), which is what the stack records.
  const divs: number[] = []
  // Track the enclosing list item's content column so a fenced-code delimiter
  // is tested at its container's content column (PART 2), not blindly at
  // column 0. Without this the prepass cannot tell a real fence nested at a
  // list item's content column from a merely indented run, and a definition
  // written inside such a fence is spuriously collected. Same content-column
  // stack the Markdown migrator uses. (Blockquote prefixes are handled by
  // stripContainerPrefixes; a list nested inside a blockquote is not tracked
  // here — a rarer residual case.)
  const listCols: number[] = []
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
    if (!fence) {
      // maintain the content-column stack (same rule as the migrator): a
      // marker opens an item at its marker width; a blank is transparent; a
      // dedented line leaves an item when a blank precedes it or it starts a
      // block; code content (inside a fence) never changes it.
      // bullets are `-`/`*` (not `+`, the continuation marker); ordered markers
      // cover every dialect the parser accepts (decimal, roman, single-letter);
      // an optional abutting `{…}` attribute block is part of the marker width
      const marker = unquoted.match(RE_PREPASS_MARKER)
      const indent = unquoted.length - unquoted.replace(/^[ \t]+/, '').length
      // Test the RAW line for a block starter: a blockquote `>` is stripped by
      // stripContainerPrefixes, so check `raw` (trimmed) for it, else a quote
      // interrupting a list item would not pop the stack.
      const rawTrimmed = raw.trim()
      const startsBlock =
        /^#{1,6}([ \t]|$)/.test(rawTrimmed) ||
        RE_BLOCKQUOTE.test(rawTrimmed) ||
        /^(`{3,}|~{3,})/.test(rawTrimmed) ||
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
          m2 = rest.match(RE_PREPASS_MARKER)
        }
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
    }
    // strip the enclosing content column so a fence delimiter at that column
    // is recognized (kept-indent view keeps residual indent after markers)
    const contentCol = listCols.length ? listCols[listCols.length - 1]! : 0
    // A fence is quoted if a blockquote prefix leads the line, possibly behind a
    // single list marker (`- > ```), so its closer is blockquote-stripped. Deeper
    // list/quote mixing is a documented residual.
    const afterMarker = raw.replace(
      /^([ \t]*)(?:[-*]|(?:[0-9]+|[ivxlcdm]+|[IVXLCDM]+|[a-z]|[A-Z])[.)])(?:\{[^}]*\})? +(?:\[[ xX\-_>?]\] +)?/,
      '',
    )
    const rawIsQuoted = /^(?:[^\S ]*>(?: |$))+/.test(raw) || /^(?:[^\S ]*>(?: |$))+/.test(afterMarker)
    // A comment fence's closer is a leading `%` run of the SAME length;
    // trailing text is allowed, so `%%% end` closes a `%%%` fence.
    if (commentFence !== null) {
      const close = RE_COMMENT_BLOCK_ANY.exec(line)
      if (close && close[1]!.length === commentFence) commentFence = null
      continue
    }
    {
      const open = RE_COMMENT_BLOCK_ANY.exec(line)
      // Only a fence that CLOSES opens the opaque region. An unterminated
      // `%%%` degrades to a single-line comment, and treating it as open would
      // suppress every definition in the rest of the document.
      if (open && commentBlockHasCloser(lexer, open[1]!.length)) {
        commentFence = open[1]!.length
        continue
      }
    }
    if (verse !== null) {
      const close = line.trim().match(/^(:{3,})$/)
      if (close && close[1]!.length >= verse) verse = null
      continue
    }
    const verseOpen = line.trim().match(/^(:{3,})[ \t]*\|$/)
    if (verseOpen) {
      verse = verseOpen[1]!.length
      continue
    }
    // Track `:::` nesting so the abbreviation branch can require document
    // level. Only the depth matters here, not what kind of div it is.
    const colon = line.trim().match(/^(:{3,})[ \t]*(.*)$/)
    if (colon) {
      const width = colon[1]!.length
      if (colon[2] === '' && divs.length && divs[divs.length - 1] === width) divs.pop()
      else divs.push(width)
    }
    if (fence) {
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
      if (close && close[1]![0] === fence.ch && close[1]!.length >= fence.len)
        fence = null
      continue // definitions inside fenced code are literal samples
    }
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
      !listCols.includes(quoteIndent)
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
    const openerCol = inFootnoteBody && contentCol === 0 ? keptIndent : contentCol
    const deIndented = keptIndent >= openerCol ? kept.slice(openerCol) : kept
    const open = RE_FENCE.exec(deIndented)
    if (open) {
      fence = { ch: open[2]![0]!, len: open[2]!.length, contentCol: openerCol, quoted: rawIsQuoted }
      continue
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
      lexer.abbrDefs.set(abbr[1]!, abbr[2]!)
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
    // Inside a footnote body the column is KNOWN - it is two, §16's own
    // (carve#717) - so the body no longer needs the blanket exemption it used to
    // carry below. With the exemption a definition anywhere in a note body was
    // collected, including at columns where the body renders the line as text:
    // the reader saw `[r]: /u` as prose while a reference to it silently
    // resolved (the `VA` rows of carve#669 and carve#701, at indents 1 and 3).
    const openColumn = inFootnoteBody ? FOOTNOTE_BODY_COLUMN : contentCol
    const atAnOpenContentColumn = plusColumn !== null
      ? rawIndent === plusColumn
      : listCols.length
        ? listCols.includes(rawIndent)
        : rawIndent === openColumn
    // Compared against the QUOTE-STRIPPED view, not the raw line. `kept` has
    // both the quote prefix and any list marker removed, so `kept === raw` was
    // really asking "does this line carry a marker of its own?" - the exemption
    // that keeps `- [ref]: /url`, where the definition IS the item's content and
    // sits at its column by construction. A quote prefix made the two differ for
    // the same reason a marker does, so every quoted line skipped the guard and
    // a definition PAST the column collected inside a quote while the identical
    // shape outside one stayed literal (carve-js#648). Content columns are
    // measured inside the quote (carve#658), so the quote must not change the
    // answer.
    const notAtContentColumn = kept === unquoted && !atAnOpenContentColumn
    // The trailing attribute block comes off BEFORE the regex runs: the
    // pattern's `.*$` tail would otherwise swallow it (carve#604).
    const [defLine, defAttrText] = splitTrailingAttrBlock(line)
    const m = topLevelIndentedDef || notAtContentColumn ? null : RE_LINK_DEF.exec(defLine)
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
      // EXACT, not folded. §6 and PART 9R R1 both say matching is
      // "case-sensitive, no whitespace folding", and this engine folded the
      // definition key and the lookup symmetrically - so `[t][ b  c]` resolved
      // against `[b c]: /u`, where the executable spec and carve-rs both leave it
      // literal (carve-js#673). The label goes in as written.
      //
      // `normalizeRefLabel` stays for the IMPLICIT heading-reference path, which
      // is deliberately fuzzier: heading-ids.ts and lint.ts both wrap it in
      // `.toLowerCase()`, and all four implementations fold whitespace AND case
      // when matching `[Some Heading][]` against a heading's text.
      def.line = idx
      lexer.linkDefs.set(m[1]!, def)
      continue
    }
  }
}

function parseBlocks(lexer: Lexer, baseIndent: number): BlockNode[] {
  const out: BlockNode[] = []
  // Leading block-attribute lines (grammar PART 9 §15) accumulate here
  // and attach to the next block. They float across blank lines; a
  // dangling run with no following block is dropped.
  let pending: Attrs | null = null
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
  // A dangling pending run (no following block) is dropped.
  return out
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
function peekBlockAttributes(lexer: Lexer): boolean {
  // Strict column-0 rule: a block-attribute line opens ONLY at its container's
  // content column (column 0 in every parseBlocks context, since nested content
  // is dedented into a sub-lexer). A `{...}` indented ABOVE that column does not
  // attach -- it is literal paragraph text. So require the `{` flush, not `\s*{`.
  if (!/^\{/.test(lexer.peek()!)) return false
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
    while (i < src.length && /\s/.test(src[i]!)) i++
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
    return { type: 'comment', block: false, content: l.replace(/^[ \t]*%%/, '').replace(/^\s/, '') }
  }
  if (RE_LINE_BLOCK_OPEN.test(line)) return parseLineBlock(lexer)
  if (RE_HARDBREAKS_OPEN.test(line)) return parseHardBreaksBlock(lexer)
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
  if (leadingWhitespace(line) === 0 && isLinkDefLine(line)) {
    lexer.consume()
    return null
  }
  if (RE_HR.test(line)) {
    lexer.consume()
    return { type: 'thematic_break' } as ThematicBreak
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
  return { type: 'raw_block', format, content: lines.join('\n') }
}

/**
 * From a `%%%` opener at peek(0), is there a matching closer ahead? A comment
 * closer matches on EXACT delimiter length (longer fences nest), so ANY later
 * line whose delimiter run has that length is a valid closer. Used to reject an
 * unclosed `%%%` as a block opener (PART 9 §28): without this an unclosed opener
 * swallows the rest of the document, silently dropping every following block.
 *
 * Answered from a width -> LAST line index map, built once per lexer in a single
 * pass. A per-opener scan to end of input is superlinear on a document full of
 * fence openers with DISTINCT widths (each one scans the whole document and no
 * width repeats): ~1.9 MiB of such input took 8.5s before this, growing ~7x per
 * 4x of input. Since any same-width line ahead IS a closer, comparing against
 * the last index of that width is exact, not an approximation.
 */
function commentBlockHasCloser(lexer: Lexer, fence: number): boolean {
  let lastByWidth = lexer.commentFenceLastIndex
  if (lastByWidth === undefined) {
    lastByWidth = new Map<number, number>()
    for (let i = 0; i < lexer.lines.length; i++) {
      const c = RE_COMMENT_BLOCK_ANY.exec(lexer.lines[i]!)
      if (c) lastByWidth.set(c[1]!.length, i)
    }
    lexer.commentFenceLastIndex = lastByWidth
  }
  const last = lastByWidth.get(fence)
  return last !== undefined && last > lexer.pos
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

/** Per-quote negative cache for `quotedFenceHasCloser`, keyed by fence character. */
type QuotedFenceCloserMemo = Map<string, number>

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
function quotedFenceHasCloser(
  lexer: Lexer,
  marker: string,
  fromIndex: number,
  memo: QuotedFenceCloserMemo,
): boolean {
  const char = marker[0]!
  const start = fromIndex + 1
  if (start >= (memo.get(char) ?? Infinity)) return false
  const closeRe = fenceCloseRe(marker)
  let sawSameChar = false
  for (let i = start; i < lexer.lines.length; i++) {
    const quoted = RE_BLOCKQUOTE.exec(lexer.lines[i]!)
    if (!quoted) break
    const content = quoted[1] ?? ''
    if (closeRe.test(content)) return true
    const closer = RE_FENCE_CLOSER.exec(content)
    if (closer && closer[1]![0] === char) sawSameChar = true
  }
  if (!sawSameChar) memo.set(char, start)

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
  const openerTail = m[2]!.trim()
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
  const label = m[1]!.trim()
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
    // footnote definition.
    if (/^\+[ \t]*$/.test(ln)) {
      const plusLineNumber = lexer.lineNumber(lexer.pos)
      lexer.consume()
      pendingBlanks = 0
      pendingBlankLineNumbers = []
      const attached: string[] = []
      const attachedLineNumbers: number[] = []
      while (!lexer.eof()) {
        const a = lexer.peek()!
        if (isBlankLine(a) || /^\+[ \t]*$/.test(a) || RE_FOOTNOTE_DEF.test(a)) break
        attachedLineNumbers.push(lexer.lineNumber(lexer.pos))
        lexer.consume()
        attached.push(a)
      }
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
      for (let k = 0; k < pendingBlanks; k++) {
        bodyLines.push('')
        bodyLineNumbers.push(pendingBlankLineNumbers[k]!)
      }
      pendingBlanks = 0
      pendingBlankLineNumbers = []
      bodyLines.push(sliceColumns(ln, FOOTNOTE_BODY_COLUMN))
      bodyLineNumbers.push(lexer.lineNumber(lexer.pos))
      lexer.consume()
    } else {
      break
    }
  }
  if (!lexer.footnoteDefs.has(label)) {
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
      const lastIndex = Math.max(defLineIndex, lexer.pos - 1)
      const lastLine = lexer.lines[lastIndex] ?? ''
      lexer.footnoteDefPos.set(label, {
        startLine: lexer.lineNumber(defLineIndex),
        endLine: lexer.lineNumber(lastIndex),
        startColumn: lexer.lineStartColumn(defLineIndex),
        endColumn: lexer.lineStartColumn(lastIndex) + lastLine.length,
        startOffset: lexer.lineOffset(defLineIndex),
        endOffset: lexer.lineOffset(lastIndex) + lastLine.length,
      })
    }
  }
  return null
}

function parseAdmonition(lexer: Lexer): Admonition {
  const openLineIndex = lexer.pos
  const open = lexer.consume()
  const m = RE_ADMONITION_OPEN.exec(open)!
  const fence = m[1]!.length
  const kind = m[2]!
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
  const children = parseBlocks(subLexer, 0)
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
    RE_HARDBREAKS_OPEN.exec(line)
  return m ? m[1]!.length : null
}

function colonFenceKind(line: string): UnclosedContainer['kind'] {
  if (RE_LINE_BLOCK_OPEN.test(line)) return 'line block'
  if (RE_HARDBREAKS_OPEN.test(line)) return 'hard-break block'
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
     * The expansion kept the line's LENGTH, so document offsets still line up.
     *
     * Each preserved space becomes exactly one U+E000 sentinel, so a line with
     * an indent or a medial gap is not a verbatim slice but every character
     * still sits at its own offset - the whitespace is consumed as layout and
     * never reaches a text node's value. A TAB expands to up to four sentinels,
     * which shifts everything after it, so those stay unanchored.
     */
    aligned: boolean
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
    const expanded = expandLineBlockWhitespace(ln)
    stanza.push({ text: expanded, lineIndex, aligned: expanded.length === ln.length })
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
    let breakIndex = 0
    const inline = parseInline(
      lines.map((l) => l.text).join('\n'),
      lexer.abbrDefs,
      lexer.linkDefs,
      anchorable
        ? inlineSource({
            baseOffset: lexer.lineOffset(lines[0]!.lineIndex),
            startLine: lexer.lineNumber(lines[0]!.lineIndex),
            startColumn: lexer.lineStartColumn(lines[0]!.lineIndex),
            lineAnchors: lines.map((l) => ({
              offset: lexer.lineOffset(l.lineIndex),
              column: lexer.lineStartColumn(l.lineIndex),
            })),
          })
        : inlineSource({ anchored: false }),
    ).map((node) => {
      if (node.type !== 'soft_break') return node
      // Keep the break's span: it is the same source, just a different meaning
      // inside a line block. Building a fresh object dropped it.
      const hardBreak = { type: 'hard_break' } as InlineNode
      // The stanza's text is `lines` joined by '\n' and holds no other newline,
      // so the k-th break IS the newline ending lines[k] - which line geometry
      // knows even when a tab left the INLINE offsets unanchored. Without this
      // the break inherited the unanchored parse and came out unplaced (#549).
      const line = lines[breakIndex++]
      if (node.pos) {
        hardBreak.pos = node.pos
      } else if (lexer.hasDocumentOffsets && line) {
        const end = lexer.lineOffset(line.lineIndex) + (lexer.lines[line.lineIndex]?.length ?? 0)
        const column = lexer.lineStartColumn(line.lineIndex) + (lexer.lines[line.lineIndex]?.length ?? 0)
        hardBreak.pos = {
          startLine: lexer.lineNumber(line.lineIndex),
          endLine: lexer.lineNumber(line.lineIndex),
          startColumn: column,
          endColumn: column + 1,
          startOffset: end,
          endOffset: end + 1,
        }
      }
      return hardBreak
    })

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

  // NO TRAILING WHITESPACE (PART 2; carve#926), and it reaches this line last.
  // The MEDIAL GAPS rule above has already converted a trailing run of TWO OR
  // MORE columns into NBSP CONTENT, which this must not touch - the sentinel is
  // not a space any more. What is left is a ONE-COLUMN trailing run, still an
  // ordinary collapsible space, and that is the run the rule drops. So
  // `abc<SP><SP>` keeps two non-breaking spaces and `def<SP>` keeps none.
  return out.replace(/ +$/, '')
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
// `:  definition` lines; a definition continues on lines indented to COLUMN 3
// or beyond. A `:: term` after a definition starts a new entry; a single
// blank line between entries is allowed, anything else ends the list.
function parseDefinitionList(lexer: Lexer): DefinitionList {
  const items: DefinitionItem[] = []
  const parseDefBody = (first: string, firstLineIndex: number): BlockNode[] => {
    const bodyLines: string[] = []
    const bodyLineNumbers: number[] = []
    // First-block form (`:  +`, mirroring the list `- +`): when the sole
    // content is a lone `+`, the definition body is the FOLLOWING flush-left
    // block, with no indentation. `:  \+` keeps a literal `+` instead.
    if (/^\+[ \t]*$/.test(first)) {
      while (!lexer.eof()) {
        const a = lexer.peek()!
        if (
          isBlankLine(a) ||
          /^\+[ \t]*$/.test(a) ||
          RE_DEFLIST_TERM.test(a) ||
          RE_DEFLIST_DEF.test(a)
        )
          break
        const lineIndex = lexer.pos
        lexer.consume()
        bodyLines.push(a)
        bodyLineNumbers.push(lexer.lineNumber(lineIndex))
      }
    } else {
      bodyLines.push(first)
      bodyLineNumbers.push(lexer.lineNumber(firstLineIndex))
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
        const attached: string[] = []
        const attachedLineNumbers: number[] = []
        while (!lexer.eof()) {
          const a = lexer.peek()!
          if (
            isBlankLine(a) ||
            /^\+[ \t]*$/.test(a) ||
            RE_DEFLIST_TERM.test(a) ||
            RE_DEFLIST_DEF.test(a)
          )
            break
          const lineIndex = lexer.pos
          lexer.consume()
          attached.push(a)
          attachedLineNumbers.push(lexer.lineNumber(lineIndex))
        }
        if (attached.length > 0) {
          bodyLines.push('')
          bodyLineNumbers.push(lexer.lineNumber(plusLineIndex))
          for (const a of attached) bodyLines.push(a)
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
      if (!isBlankLine(ln) && indentColumns(ln, 3) >= 3) {
        // A CONTINUATION INDENTED PAST THE BODY'S COLUMN IS LAZY TEXT
        // (markup-carve/carve#918). `definition_indent` REACHES the body's
        // column and does not measure how far past it a line went, because
        // there is nothing past that column for indentation to mean. So a line
        // indented further continues the body's OPEN PARAGRAPH, and a paragraph
        // continuation carries inline content.
        //
        // This stripped the WHOLE leading run, which delivered a line at column
        // 4 flush at column 0 - byte-identical to one written at column 3 - so
        // the two columns could not give different answers and a stray
        // four-space indent silently opened a block quote. Slicing exactly the
        // body's three columns and KEEPING the residual is what separates them,
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
        bodyLines.push(sliceColumns(ln, 3, true))
        bodyLineNumbers.push(lexer.lineNumber(lineIndex))
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
        if (after !== undefined && !isBlankLine(after) && indentColumns(after, 3) >= 3) {
          for (let k = 0; k < look; k++) {
            const lineIndex = lexer.pos
            bodyLines.push('')
            bodyLineNumbers.push(lexer.lineNumber(lineIndex))
            lexer.consume()
          }
          continue
        }
        break
      }
      // A new term/definition marker ends this definition (the outer loop
      // picks it up).
      if (RE_DEFLIST_TERM.test(ln) || RE_DEFLIST_DEF.test(ln) || RE_DEFLIST_MARKER_EMPTY.test(ln)) break
      // Lazy continuation: a flush-left line (no blank before it) that does not
      // start an interrupting block folds into the open paragraph; a block
      // opener ends the definition.
      if (!startsInterruptingBlock(lexer)) {
        const lineIndex = lexer.pos
        bodyLines.push(ln)
        bodyLineNumbers.push(lexer.lineNumber(lineIndex))
        lexer.consume()
        continue
      }
      break
    }
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
      // Trailing whitespace on the last line is not content, and every other
      // block drops it - a paragraph, a heading, a quoted paragraph. The term
      // kept it, so `:: t ` published `<dt>t </dt>` where carve-rs and
      // carve-php publish `<dt>t</dt>` (carve#510, found by the fuzzer).
      // Trimming the END only: interior runs are the author's, and the start is
      // where the term's own offsets are anchored.
      // NO TRAILING WHITESPACE (PART 2; carve#926). This was `[^\S\n]+$` - the
      // whole Unicode class minus the newline - so a term dropped a trailing
      // NBSP, byte-order mark, ideographic space, vertical tab and every
      // Unicode space, all of which are CONTENT and survive at every other
      // content line in this file. It also reached only the LAST line, where a
      // term folds a following plain line into itself just as a paragraph does.
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
              },
              ...Array.from({ length: continuationLines }, (_unused, i) => ({
                offset: lexer.lineOffset(termLineIndex + 1 + i),
                column: lexer.lineStartColumn(termLineIndex + 1 + i),
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
      definitions.push(parseDefBody(d[1]!, defLineIndex))
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
    items.push({ terms, definitions, definitionLines, definitionSpans })
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
  return { type: 'abbreviation_def', abbr: m[1]!, expansion: m[2]! }
}

interface BlockQuoteLazyState {
  inFence: boolean
  fenceClose: RegExp | null
  inComment: boolean
  commentLen: number
  /**
   * Widths of the colon fences open in this quote, innermost last, so a bare
   * `:::` run reads as the innermost container's closer only on an EXACT width
   * match — `collectColonFenceBody`'s rule. A plain counter closed a `::::`
   * container on a `:::` run, which that container reads as a nested opener,
   * and the quote then ended on a line the top level folds in.
   */
  colonWidths: number[]
  /**
   * Whether the open paragraph has absorbed a MALFORMED colon fence, so a
   * following bare run is absorbed as text too (§12).
   */
  absorbingFence: boolean
  paragraphOpen: boolean
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
function trackBlockQuoteLazyState(
  content: string,
  state: BlockQuoteLazyState,
  hasCommentCloser: (fence: number) => boolean,
  hasFenceCloser: (marker: string) => boolean,
): void {
  // Absorption belongs to ONE open paragraph, so it ends wherever that
  // paragraph does: cleared here and re-armed only in the two branches that
  // continue the same paragraph, exactly as `trackItemLazyState` does it.
  const wasAbsorbing = state.absorbingFence
  state.absorbingFence = false
  if (state.inComment) {
    // EXACT length, per PART 9 §28: "The CLOSER matches on EXACT delimiter
    // length (§2), so a longer opener nests shorter fences and a too-short line
    // is content, not a closer." This read `>=`, which is the CODE fence's rule
    // (`fenceCloseRe`) and not this one - so a `%%%%` line inside a `%%%`
    // comment closed it here and was body text to the parser.
    const run = commentFenceRun(content)
    if (run === state.commentLen) state.inComment = false
    state.paragraphOpen = false
    return
  }
  if (state.inFence) {
    if (state.fenceClose!.test(content)) state.inFence = false
    state.paragraphOpen = false
    return
  }
  if (isBlankLine(content)) {
    state.paragraphOpen = false
    return
  }
  // A heading, table row, or thematic break is an UNCONDITIONAL paragraph
  // interrupter (no matching-closer dependency), so it leaves no open trailing
  // paragraph even directly after quoted prose. A following lazy list marker
  // then ENDS the quote (it has no paragraph to fold into) -- exactly as
  // `# h\n- item` is a heading plus a sibling list at the top level, and as
  // `> a\n> # h\n- item` is a quote (para + heading) plus a sibling list.
  // Mirrors trackItemLazyState.
  if (RE_HEADING.test(content) || isTableRow(content) || RE_HR.test(content)) {
    state.paragraphOpen = false
    return
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
    state.paragraphOpen = false
    return
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
    state.paragraphOpen = false
    return
  }
  if (
    RE_DIV_OPEN.test(content) ||
    (RE_ADMONITION_OPEN.test(content) && !RE_ADMONITION_CLOSE.test(content)) ||
    RE_LINE_BLOCK_OPEN.test(content) ||
    RE_HARDBREAKS_OPEN.test(content)
  ) {
    // ...unless the paragraph above already absorbed a MALFORMED fence and this
    // line is a bare run, in which case §12 takes it as text too and the
    // paragraph stays open. Corpus 260 pins that shape inside a quote.
    //
    // Reaching here with a bare run already proves it is NOT the innermost
    // container's closer - that branch returned above - so absorption applies
    // inside a container as readily as at the quote's own level.
    if (wasAbsorbing && bareFence) {
      state.absorbingFence = true
      state.paragraphOpen = true
      return
    }
    // A colon-fence OPENER is structural and needs no closer ahead ("colon-fence
    // containers open immediately and auto-close at EOF"), so it interrupts an
    // open quoted paragraph and leaves an EMPTY container holding none either.
    state.colonWidths.push(colonFenceOpenerLen(content) ?? 3)
    state.paragraphOpen = false
    return
  }
  // A fence-shaped line that is NOT a valid opener is ordinary paragraph text
  // (`:::note` fails §12's opener test - a type word needs a space), and from
  // here the paragraph absorbs the next bare fence-shaped line as well.
  if (/^:{3,}/.test(content)) {
    state.absorbingFence = true
    state.paragraphOpen = true
    return
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
  if (fenceMarker !== null && (!state.paragraphOpen || hasFenceCloser(fenceMarker))) {
    state.inFence = true
    state.fenceClose = fenceCloseRe(fenceMarker)
    state.paragraphOpen = false
    return
  }
  // AN UNTERMINATED OPENER DOES NOT OPEN A BLOCK (PART 9 section 28). Every
  // opener was treated as opening here, so `> %%%` with no closer put the
  // tracker inside a comment, `paragraphOpen` went false, and a lazy line
  // that should have continued the quote's paragraph ended the quote
  // instead. The block parser has always looked ahead; this is the same
  // lookahead over the quote's own lines.
  //
  // With no closer the line FALLS THROUGH to the bottom of this function
  // rather than returning, so it lands on `paragraphOpen = true` - which is
  // where a `%%` line comment already landed, and a degraded opener IS a
  // comment line.
  const commentRun = commentFenceRun(content)
  if (commentRun !== undefined && hasCommentCloser(commentRun)) {
    state.inComment = true
    state.commentLen = commentRun
    state.paragraphOpen = false
    return
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
  state.absorbingFence = wasAbsorbing
  state.paragraphOpen = true
}

function parseBlockQuote(lexer: Lexer): BlockQuote | Figure {
  const firstLineIndex = lexer.pos
  const inner: string[] = []
  const innerLineNumbers: number[] = []
  const state: BlockQuoteLazyState = {
    inFence: false,
    fenceClose: null,
    inComment: false,
    commentLen: 0,
    colonWidths: [],
    absorbingFence: false,
    paragraphOpen: false,
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
      const attached: string[] = []
      const attachedLineNumbers: number[] = []
      while (!lexer.eof()) {
        const next = lexer.peek()!
        if (isBlankLine(next) || RE_BLOCKQUOTE.test(next) || /^\+[ \t]*$/.test(next)) {
          break
        }
        attachedLineNumbers.push(lexer.lineNumber(lexer.pos))
        lexer.consume()
        attached.push(next)
      }
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
        state.paragraphOpen = false
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
      startsInterruptingBlock(lexer)
    ) {
      break
    }
    // A non-`>` line inside an open fence/comment, or after a block that left no
    // open paragraph (heading/table/fence/thematic/div), terminates the quote
    // instead of being swallowed. This is also what ends the quote on a lazy
    // list marker when no open paragraph precedes it.
    if (!state.paragraphOpen) break
    const lineIndex = lexer.pos
    lexer.consume()
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
      // The block loop spans the FIGURE, so the quote it wraps would otherwise
      // have no position of its own (PART 12 section 4). It ends where the
      // caption begins.
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
  // invalid one (`{#1a}`) is literal (§14), so the line is NOT a bare block
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
  if (RE_COMMENT_LINE.test(l) || isLinkDefLine(l) || RE_FOOTNOTE_DEF.test(l)) return true

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
    RE_FOOTNOTE_DEF.test(line) ||
    isLinkDefLine(line) ||
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
    RE_HARDBREAKS_OPEN.test(line)
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
    RE_DEFLIST_TERM.test(line) ||
    RE_BLOCKQUOTE.test(line) ||
    RE_TASK.test(line) ||
    RE_UNORDERED.test(line) ||
    RE_ORDERED.test(line) ||
    extractItemAttr(line) !== null ||
    isTableRow(line) ||
    isBlockImageLine(line)
  )
}

function colonFenceShapeEndsLazyContinuation(line: string): boolean {
  return (
    (RE_ADMONITION_OPEN.test(line) && !RE_ADMONITION_CLOSE.test(line)) ||
    RE_DIV_OPEN.test(line) ||
    RE_LINE_BLOCK_OPEN.test(line) ||
    RE_HARDBREAKS_OPEN.test(line)
  )
}

function isLiteralColonFenceLine(line: string): boolean {
  return (
    /^:{3,}/.test(line) &&
    !RE_ADMONITION_CLOSE.test(line) &&
    !(RE_ADMONITION_OPEN.test(line) && !RE_ADMONITION_CLOSE.test(line)) &&
    !RE_DIV_OPEN.test(line) &&
    !RE_LINE_BLOCK_OPEN.test(line) &&
    !RE_HARDBREAKS_OPEN.test(line)
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
  // Whether the item's collected content currently ends in an OPEN paragraph
  // that a dedented (below content-column) non-blank line lazily continues
  // (CommonMark family-D rule). True after plain prose, a blockquote line, or
  // plain text inside an open div/admonition; false after a code fence, table,
  // heading, thematic break, a just-opened div, or a blank line.
  lazyFoldable: boolean
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
 * A quote marker with NOTHING after it opens a quote holding no paragraph.
 *
 * PART 1 S4: NO OPEN PARAGRAPH, NO LAZY LINE. `- >` + a column-0 line closes
 * the item; `- > q` + the same line folds, because there the quote holds one.
 * Treating every quote line as paragraph-opening kept the line inside the item
 * - the answer S4 names as wrong (carve#561, carve#572).
 */
function isEmptyQuoteLine(content: string): boolean {
  let rest = content
  let sawQuote = false
  // `> > q` holds a paragraph; `> >` does not.
  for (let m = RE_BLOCKQUOTE.exec(rest); m; m = RE_BLOCKQUOTE.exec(rest)) {
    sawQuote = true
    rest = m[1] ?? ''
  }
  return sawQuote && rest.trim() === ''
}

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

function trackItemLazyState(content: string, state: ItemLazyState): void {
  // Absorption belongs to ONE open paragraph, so it ends wherever that
  // paragraph does. Clearing it here and re-arming it only in the two branches
  // that continue the same paragraph is what keeps a heading, a table or a code
  // fence between the malformed fence and a later bare `:::` from leaving the
  // flag set: at the top level those end the paragraph and the later fence
  // opens a real div, and this tracker has to give the same answer.
  const wasAbsorbing = state.absorbingFence
  state.absorbingFence = false
  if (state.inComment) {
    // A CLOSER IS NOT A BARE RUN. This said it was - "so this test stays
    // anchored, unlike the opener below, which may carry an info string" - and
    // PART 9 §28 gives the closer the same insignificant tail as the opener:
    // `%%% end` closes one. It also matches on EXACT length, where this read
    // `>=`.
    const run = commentFenceRun(content)
    if (run === state.commentLen) {
      state.inComment = false
      state.lazyFoldable = state.lazyFoldableBeforeComment
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
  // A code fence or raw fence opens a verbatim block with no open paragraph.
  const fence = RE_FENCE.exec(content)
  if (fence) {
    const marker = fence[2]!
    state.inFence = true
    state.fenceClose = fenceCloseRe(marker)
    state.lazyFoldable = false
    state.inDefList = false
    return
  }
  const raw = RE_RAW_FENCE.exec(content)
  if (raw) {
    const marker = raw[1]!
    state.inFence = true
    state.fenceClose = fenceCloseRe(marker)
    state.lazyFoldable = false
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
    state.lazyFoldable = false
    state.inDefList = false
    return
  }
  // A heading keeps the item open for a dedented plain line, but no longer
  // ABSORBS it: headings end at their newline (SINGLE-LINE HEADINGS), so the
  // line is taken into the item and becomes a paragraph of its own there
  // (corpus 73-list-nesting-and-looseness-4). A table row or thematic break
  // leaves no open trailing content at all, so a dedented line ends the item.
  if (RE_HEADING.test(content)) {
    state.lazyFoldable = true
    state.inDefList = false
    return
  }
  if (isTableRow(content) || RE_HR.test(content)) {
    state.lazyFoldable = false
    state.inDefList = false
    return
  }
  // A blockquote line keeps the fold open: the quote's trailing paragraph
  // absorbs the dedented line via the quote's own lazy continuation. An EMPTY
  // quote holds no paragraph, so it does not (PART 1 S4).
  if (RE_BLOCKQUOTE.test(content)) {
    state.lazyFoldable = !isEmptyQuoteLine(content)
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
    RE_HARDBREAKS_OPEN.test(content)
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
  // Everything else (plain prose, list-marker content, div body text) leaves an
  // open paragraph the dedented line can continue. Prose folds into a def body,
  // so an open def list stays open (inDefList unchanged) - and it is the SAME
  // paragraph, so an absorption already under way survives it.
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
    // baseIndent (tab-aware columns) plus the marker width in characters. The
    // marker (`- `, `1. `) and any abutting `{...}` attr block contain no tabs,
    // so their column width equals their character count; the leading
    // whitespace may be a tab, so it is measured in columns (baseIndent) rather
    // than characters. The marker/attr width is taken from the ORIGINAL line so
    // an abutting `{...}` block widens it correctly. For a TASK item the
    // checkbox is content, not marker, so the content column is the bullet
    // width (`- `/`* ` = 2) plus any abutting attr width -- not the full
    // `- [x] ` width (matching the spec's task attribute/continuation
    // convention `- [x] x` / `  {.c}`).
    const contentCol = isTask
      ? baseIndent + 2 + (la ? line.length - mline.length : 0)
      : baseIndent + (line.length - leadingWhitespace(line) - content.length)
    lexer.consume()

    // First-block item (Carve): `- +` opens an item whose body is the
    // flush-left block that follows, with no indentation. A lone `+` as the
    // sole item content is the continuation marker, not literal text
    // (`- + text` keeps `+ text` as literal content). Lets an item start
    // directly with a table, code block, quote or div at column 0.
    if (isContinuationMarker(content)) {
      const attached: string[] = []
      const attachedLineNumbers: number[] = []
      let attachedStartLineIndex = lexer.pos
      while (!lexer.eof()) {
        const a = lexer.peek()!
        if (isBlankLine(a)) break
        const ind = indentColumns(a, baseIndent + 1)
        if (ind < baseIndent) break
        if (ind === baseIndent) {
          const am = matchListMarker(a, isTask, isOrdered)
          const sibling =
            am &&
            (isOrdered
              ? orderedContinues(a, orderedKind, orderedDelim)
              : unorderedMarkerChar(a) === firstMarkerChar)
          // A base-column line that is ANY list marker (a different
          // kind/dialect, e.g. an ordered `1.` after this unordered first-block
          // item, or an abutting-attribute bullet `-{.x}`) starts a SIBLING
          // list (§11), not item content -- stop attaching so it parses as a
          // separate top-level list (Bug C, first-block `- +` path).
          const anyMarker =
            RE_ORDERED.test(a) ||
            RE_UNORDERED.test(a) ||
            RE_TASK.test(a) ||
            extractItemAttr(a) !== null
          if (sibling || anyMarker || isContinuationMarker(a)) break
        }
        if (attached.length === 0) attachedStartLineIndex = lexer.pos
        attached.push(sliceColumns(a, baseIndent))
        attachedLineNumbers.push(lexer.lineNumber(lexer.pos))
        lexer.consume()
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
    const lazyState: ItemLazyState = {
      inFence: false,
      fenceClose: null,
      inComment: false,
      commentLen: 0,
      lazyFoldableBeforeComment: false,
      absorbingFence: false,
      divDepth: 0,
      // The lead text opens a paragraph unless it is one of the shapes that
      // open nothing: a blank, an empty quote, or a block-attribute line (which
      // renders nothing and floats forward). `trackItemLazyState` applies the
      // same three to every later line; this is the lead-line copy of it.
      lazyFoldable:
        !isBlankLine(content) && !isEmptyQuoteLine(content) && !isBlockAttributeLine(content),
      inDefList: RE_DEFLIST_TERM.test(content) || RE_DEFLIST_DEF.test(content),
    }
    // The lead line may itself be the malformed fence (`- :::note`), and then
    // the paragraph it opens is already absorbing: the `:::` below it is text,
    // not a closer for a block nothing opened (PART 9 §12, carve#891).
    lazyState.absorbingFence =
      /^:{3,}/.test(content) &&
      !RE_DIV_OPEN.test(content) &&
      !RE_ADMONITION_OPEN.test(content) &&
      !RE_LINE_BLOCK_OPEN.test(content) &&
      !RE_HARDBREAKS_OPEN.test(content)
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
        plusSeparators.add(nested.length)
        nested.push('')
        nestedLineNumbers.push(plusLineNumber)
        trackItemLazyState('', lazyState)
        while (!lexer.eof()) {
          const a = lexer.peek()!
          if (isBlankLine(a)) break
          const ind = indentColumns(a, baseIndent + 1)
          if (ind < baseIndent) break
          if (ind === baseIndent) {
            const am = matchListMarker(a, isTask, isOrdered)
            const sibling =
              am &&
              (isOrdered
                ? orderedContinues(a, orderedKind, orderedDelim)
                : unorderedMarkerChar(a) === firstMarkerChar)
            // A base-column line that is ANY list marker (even a different
            // kind/dialect, e.g. an ordered `1.` after this unordered item, or
            // an abutting-attribute bullet `-{.x}`) starts a SIBLING list
            // (§11), not item content -- stop attaching so it parses as a
            // separate top-level list (Bug C).
            const anyMarker =
              RE_ORDERED.test(a) ||
              RE_UNORDERED.test(a) ||
              RE_TASK.test(a) ||
              extractItemAttr(a) !== null
            if (sibling || anyMarker || isContinuationMarker(a)) break
          }
          const attached = sliceColumns(a, baseIndent)
          nested.push(attached)
          nestedLineNumbers.push(lexer.lineNumber(lexer.pos))
          trackItemLazyState(attached, lazyState)
          lexer.consume()
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
        const isMarker =
          RE_ORDERED.test(l) ||
          RE_UNORDERED.test(l) ||
          RE_TASK.test(l) ||
          // An abutting-attr bullet (`-{.x} item`) is a marker too. It no longer
          // reaches here via §10 interruption (bullets do not interrupt), so the
          // sub-list nesting path must recognize it directly to keep nesting.
          extractItemAttr(l) !== null
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
        nested.push(dedented)
        nestedLineNumbers.push(lexer.lineNumber(lexer.pos))
        trackItemLazyState(dedented, lazyState)
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
        (((lazyState.lazyFoldable || lazyState.inFence || lazyState.inComment) &&
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
        if (lazyState.inDefList && indentColumns(l, contentCol) < contentCol) {
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
        trackItemLazyState(lazyLine, lazyState)
        lexer.consume()
      } else {
        break
      }
    }

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
        loose = true
      }
    }

    // Compact list blocks (Carve): an internal blank line loosens the item only
    // when the content after it is a plain paragraph (a real second paragraph).
    // A blank followed by a block opener (sub-list, quote, fence, div, heading,
    // table) keeps the item tight, so an item can carry a sub-block without the
    // list going loose. Only the tight/loose RENDERING changes; block structure
    // is unchanged. (Canonical djot renders these loose; Carve deviates here.)
    // A blank line INSIDE a fenced code block is verbatim content, not an
    // interior block separator, so it must not loosen the item (carve#326 case
    // C; matches carve-rs / carve-php). Precompute which lines fall inside a
    // CLOSED fence in a single pass, then skip those blanks in the scan below.
    // Only a fence with a matching closer forms a code block; an UNCLOSED opener
    // is inline verbatim inside a paragraph, so a following blank still loosens
    // (matches carve-rs). The opener may be the item's lead (a marker-line
    // fence, `- ``` `, which is not in `nested`), so the pass prepends `content`
    // and a `nested[k]` corresponds to `fenceLines[k + 1]`. Marking closed
    // ranges is O(n) total (ranges never overlap), keeping the scan linear.
    const fenceLines = [content, ...nested]
    const inFence: boolean[] = new Array(fenceLines.length).fill(false)
    let fenceOpenIdx = -1
    let fenceOpenCh = ''
    let fenceOpenLen = 0
    for (let k = 0; k < fenceLines.length; k++) {
      if (fenceOpenIdx >= 0) {
        const cl = RE_FENCE_CLOSER.exec(fenceLines[k]!)
        if (cl && cl[1]![0] === fenceOpenCh && cl[1]!.length >= fenceOpenLen) {
          for (let i = fenceOpenIdx; i <= k; i++) inFence[i] = true
          fenceOpenIdx = -1
        }
      } else {
        const fo = RE_FENCE.exec(fenceLines[k]!)
        if (fo) {
          fenceOpenIdx = k
          fenceOpenCh = fo[2]![0]!
          fenceOpenLen = fo[2]!.length
        }
      }
    }
    for (let k = 0; k < nested.length; k++) {
      if (inFence[k + 1]!) continue
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
      while (j < nested.length && (nested[j] === '' || isInvisibleLine(nested[j]!))) j++
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
    const leadIsMarker =
      RE_UNORDERED.test(content) ||
      RE_ORDERED.test(content) ||
      RE_TASK.test(content) ||
      // An abutting-attribute bullet/ordered marker (`-{.x} A`, `1.{.x} A`) is a
      // list marker too, exactly as the sub-list nesting path above recognizes
      // it -- keep this detection in step so the attributed marker-line case
      // merges/absorbs like the plain one.
      extractItemAttr(content) !== null

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
      return nestedSubLexer(lexer, lines, startLineIndex, sourceLineMap)
    }
    const children = parseBlocks(
      mkSub([itemLead, ...leadLines], itemStartLineIndex, [
        lexer.lineNumber(itemStartLineIndex),
        ...nestedLineNumbers.slice(0, leadLines.length),
      ]),
      0,
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
        ),
      )
    }

    const item: ListItem = { type: 'list_item', children }
    attachBlockPos(lexer, item, itemStartLineIndex, lexer.pos)
    if (checked !== undefined) item.checked = checked
    if (itemAttrs) item.attrs = itemAttrs
    items.push(item)
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
function parseCellMarkers(src: string): {
  header: boolean
  span?: 'rowspan' | 'colspan'
  align?: 'left' | 'right' | 'center'
  attrs?: Attrs
  content: string
} {
  // A `{...}` attribute block GLUED to the opening pipe (index 0, no space)
  // supplies the cell's attributes; the rest, after optional whitespace, is the
  // cell content. A SPACE before the brace (`| {.x}`) is ordinary content, not
  // attributes. A cell that carries an attribute block is never a bare span
  // marker, so its content is literal even if it is just `<`/`^`. An invalid
  // attribute payload leaves the `{` as ordinary content.
  if (src[0] === '{') {
    // Reuse the quote-aware inline-attribute matcher so a quoted `}` inside a
    // value (`{key="{y}"}`) is handled, not truncated at the first brace. The
    // WHOLE payload must then be valid attribute syntax (same as inline / block
    // attribute blocks); a partially-invalid payload like `{.x 1bad}` is not an
    // attribute block, so the `{` stays ordinary content.
    const m = RE_INLINE_ATTR.exec(src)
    if (m && isValidInlineAttrPayload(m[1]!)) {
      const attrs = parseAttrs(m[1]!)
      if (!isEmptyAttrs(attrs)) {
        return { header: false, attrs, content: trimCellPadding(src.slice(m[0].length)) }
      }
    }
  }

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
  // A `<`/`>`/`~` immediately after `|` or `|=` IS an alignment marker
  // (spec: docs/case-study/syntax.md, "Disambiguation"). Exactly one is
  // recognized; a *repeated* character is the start of content, so for
  // `|=<<` the first `<` aligns and the second `<` is content.
  let align: 'left' | 'right' | 'center' | undefined
  const a = src[i]
  if (a === '>') {
    align = 'right'
    i++
  } else if (a === '<') {
    align = 'left'
    i++
  } else if (a === '~') {
    align = 'center'
    i++
  }

  if (i > 0) {
    // A tight marker prefix was consumed; the rest is content.
    const content = trimCellPadding(src.slice(i))
    return align ? { header, align, content } : { header, content }
  }

  // No tight prefix: a lone `^`/`<` (always spaced) is a span marker;
  // otherwise the whole trimmed text is content.
  const trimmed = trimCellPadding(src)
  if (trimmed === '^') return { header: false, span: 'rowspan', content: '' }
  return { header: false, content: trimmed }
}

interface RawCell {
  header: boolean
  span?: 'rowspan' | 'colspan'
  align?: 'left' | 'right' | 'center'
  attrs?: Attrs
  raw: string
  /**
   * Where this cell sits in the document, when that is answerable.
   *
   * Cleared once a `+` continuation row merges into the cell: its content then
   * comes from two non-adjacent regions, so no single span covers it and PART 12
   * section 4 forbids inventing one.
   */
  pos?: Position
  /**
   * Anchor for the cell's INLINE content, set only when `raw` was VERIFIED to
   * appear verbatim at that point in the row line.
   *
   * Not every cell qualifies: `\|` is two source characters for one content
   * character, so a cell containing an escaped pipe drifts after it. Rather than
   * detect that syntactically, the anchor is kept only when the document text at
   * the computed offset equals the content - a check that cannot pass for a case
   * this does not handle.
   */
  inlineAnchor?: InlineSource
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
function rowAttrsFromLine(line: string): { attrs?: Attrs; body: string } {
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
      splitTableRowSpans(line).forEach(({ text: src }, idx) => {
        const frag = trimCellPadding(src)
        const target = lastRaw![idx]
        // A fragment on a span (`^`/`<`) column is skipped: the spec's
        // "Combined: Rowspan + Multi-line" example always places the `+`
        // rows *before* the `^` row, so they extend the real origin cell
        // (verified). A `+` after the span row is not a spec'd ordering.
        if (!frag || !target || target.span) return
        target.raw = target.raw ? `${target.raw} ${frag}` : frag
        // The CELL keeps no span. Its content sits in two column ranges on
        // non-adjacent lines, and one range covering both would swallow the
        // neighbouring column's content on the lines between - so cell 1 would
        // CONTAIN cell 0, and an offset would map to two sibling cells at once.
        // A construct that is not one contiguous range cannot honestly be one.
        //
        // Its inline content goes with it: joined from lines that are not
        // adjacent, so no single anchor locates it and a span covering it could
        // not select its own text.
        delete target.pos
        delete target.inlineAnchor
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
      const { header, span, align, attrs, content } = parseCellMarkers(src)
      const c: RawCell = { header, raw: content }
      if (span) c.span = span
      if (align) c.align = align
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
        c.inlineAnchor = inlineSource({
          baseOffset: lineOffset + start + within,
          startLine: lineNo,
          startColumn: lineCol + start + within,
        })
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
            : c.inlineAnchor
              ? parseInline(c.raw, lexer.abbrDefs, lexer.linkDefs, c.inlineAnchor)
              : stripPositions(parseInline(c.raw, lexer.abbrDefs, lexer.linkDefs)),
        }
        if (c.span) cell.span = c.span
        if (c.align) cell.align = c.align
        if (c.attrs) cell.attrs = c.attrs
        if (c.pos) cell.pos = c.pos
        return cell
      }),
    }
    // A row spans its cells: from the first cell's start to the last cell's end.
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
      const first = spans.find(Boolean) ?? rowStarts[idx]
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
function splitTableRowSpans(line: string): Array<{ text: string; start: number }> {
  const cells: Array<{ text: string; start: number }> = []
  let buf = ''
  let inCode = false
  let i = 0
  // Skip the leading row marker: `|` (standard) or `+` (continuation)
  if (line[0] === '|' || line[0] === '+') i = 1
  let cellStart = i
  for (; i < line.length; i++) {
    const ch = line[i]!
    if (ch === '`') inCode = !inCode
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
    if (ch === '|' && !inCode) {
      cells.push({ text: buf, start: cellStart })
      buf = ''
      cellStart = i + 1
      continue
    }
    buf += ch
  }
  // Trailing content after last pipe
  if (trimStructural(buf) !== '') cells.push({ text: buf, start: cellStart })
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
  const start = lexer.pos + 1
  if (start >= lexer.noFenceCloserFrom) return false // memo: no closer ahead
  const closeRe = fenceCloseRe(marker)
  let sawAnyCloser = false
  for (let i = start; i < lexer.lines.length; i++) {
    const l = lexer.lines[i]!
    if (closeRe.test(l)) return true
    if (RE_FENCE_CLOSER.test(l)) sawAnyCloser = true
  }
  // No closer for this marker ahead. If there is NO bare fence-closer line at
  // all from here on, cache it (pos only advances) so later openers are O(1).
  if (!sawAnyCloser) lexer.noFenceCloserFrom = start
  return false
}

/**
 * Does the line at peek(0) begin a block that INTERRUPTS an open paragraph
 * (grammar PART 9 §10, Markdown-like)? Mirrors parseBlock's detection battery
 * with the §10 carve-outs: a bare image does NOT interrupt; an ordered marker
 * interrupts only as `1.`/`1)`; a fence/`:::` interrupts only with a closer
 * ahead; a `|` line interrupts only when it is a valid table row.
 */
function startsInterruptingBlock(lexer: Lexer): boolean {
  const ln = lexer.peek()
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
      // thematic break only. A bullet/task does NOT interrupt a paragraph
      // (symmetric with ordered markers; a list needs a blank line, §10).
      return RE_HR.test(ln)
    case '+':
      // `+` is the list-continuation marker, never an interrupter.
      return false
    case '*':
      // abbreviation definition (invisible, and only at document level - PART
      // 12 §7) or thematic break. A bullet/task does NOT interrupt
      // (symmetric, §10).
      return (lexer.atDocumentLevel && RE_ABBR_DEF.test(ln)) || RE_HR.test(ln)
    case '_':
      return RE_HR.test(ln)
    case ':':
      // Colon-fence containers open immediately and auto-close at EOF.
      if (
        (RE_ADMONITION_OPEN.test(ln) && !RE_ADMONITION_CLOSE.test(ln)) ||
        RE_DIV_OPEN.test(ln) ||
        RE_LINE_BLOCK_OPEN.test(ln) ||
        RE_HARDBREAKS_OPEN.test(ln)
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
      return peekBlockAttributes(lexer)
    default:
      // An ordered-list marker does NOT interrupt a paragraph (it needs a blank
      // line, matching Djot): allowing it would require the CommonMark `1.`-only
      // heuristic to keep `2.`, `1985.`, `a.`, `i.` as prose, which Carve avoids.
      // A bare image is inline, not a block, so it does not interrupt either.
      return false
  }
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
  const anchors: Array<{ offset: number; column: number }> = []
  const anchorable =
    lexer.hasDocumentOffsets && capLine !== undefined && capLine.endsWith(firstLine)
  if (anchorable) {
    const within = capLine.length - firstLine.length
    anchors.push({
      offset: lexer.lineOffset(capIndex) + within,
      column: lexer.lineStartColumn(capIndex) + within,
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
  anchors?: Array<{ offset: number; column: number }>,
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

// Footnote reference `[^label]` (no `]` in the label).
const RE_FOOTNOTE_REF = /^\[\^([^\]]+)\]/
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
const RE_CROSSREF = /^<\/#([^>\s]+)>/
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
const ATTR_INERT_PREV = new Set(['text', 'soft_break', 'hard_break', 'mention', 'tag', 'heading_ref'])

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
  if (content.trim() === '') return content
  return content.replace(/^ (.*) $/, '$1')
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
// Whitespace RE_SPAN_TAIL content may contain: any `\s` except `\n` (which its
// class `[^}"'\n]` excludes). Matches isValidAttrPayload's `\s+` on those chars.
const WS_NO_NL = /[^\S\n]/
function isIdentStart(c: string): boolean {
  return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_'
}
function isIdentPart(c: string): boolean {
  return isIdentStart(c) || (c >= '0' && c <= '9') || c === '-'
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
      // `#id` / `.class`: an identifier (letter or `_`, then `[\w-]`) MUST
      // follow, else the token — and the whole payload — is invalid (§14).
      const d = text[i + 1]
      if (d === undefined || !isIdentStart(d)) return true
      i += 2
      while (i < n && isIdentPart(text[i]!)) i++
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
        if (v === undefined || v === '}' || /\s/.test(v)) {
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
const RE_CRITIC_INS = /^\{\+((?:[^+]|\+(?!\}))*)\+\}/
const RE_CRITIC_DEL = /^\{-((?:[^-]|-(?!\}))*)-\}/
const RE_CRITIC_SUB = /^\{~([^}]*)~>([^}]*)~\}/
const RE_CRITIC_CMT = /^\{#([^}]*)#\}/
// Forced intraword emphasis (§22): a brace pair around a bare delimiter forces
// a span with no word-boundary condition. Group 1 is the delimiter; the
// backreference closes it before `}`, non-greedy so the nearest `delim}` wins.
// Matched AFTER RE_CRITIC_SUB, so `{~…~>…~}` is substitution and a bare
// `{~…~}` (no `~>`) is forced strikethrough. The `=` form requires a trailing
// `=` before `}`, so the raw-inline `{=format}` attribute (no trailing `=`,
// e.g. `{=html}`) does not match here.
const RE_FORCED_EMPHASIS = /^\{([/*_^,~=])([\s\S]+?)\1\}/
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

// Fixed multi-character smart-typography tokens, longest first so
// `<->` beats `<-`, `---` beats `--`, `(tm)` beats `(c)`.
const SMART_TOKENS: Array<[string, string, string]> = [
  ['<->', '↔', 'left_right_arrow'],
  ['(tm)', '™', 'trademark'],
  ['...', '…', 'ellipsis'],
  ['->', '→', 'rightwards_arrow'],
  ['<-', '←', 'leftwards_arrow'],
  ['=>', '⇒', 'rightwards_double_arrow'],
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
  /[\s([{\-–—/=:]/.test(prev) ||
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
    return { out: allocateDashes(n), len: n, kind: 'dash_run' }
  }
  const c = text[i]!
  if (c === '"') {
    const open = isQuoteOpenContext(prev)
    return { out: open ? '“' : '”', len: 1, kind: open ? 'left_double_quote' : 'right_double_quote' }
  }
  if (c === "'") {
    // Contextual single quote (matches djot): an apostrophe / closing
    // quote `’` when the previous char is alphanumeric (`it's`,
    // `John's`) OR the next char is a digit (decade elision `'70s`, and
    // `'24'` -> `’24’` as djot does); an opening quote `‘` in an open
    // context (`'word'`, `rock 'n' roll`); otherwise `’`.
    const next = text[i + 1] ?? ''
    const apostrophe = isAlnum(prev) || /[0-9]/.test(next) || !isQuoteOpenContext(prev)
    return {
      out: apostrophe ? '’' : '‘',
      len: 1,
      kind: apostrophe ? 'right_single_quote' : 'left_single_quote',
    }
  }
  return null
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
   */
  lineAnchors?: Array<{ offset: number; column: number }>
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
}

function inlineSource(overrides: Partial<InlineSource> = {}): InlineSource {
  const source: InlineSource = {
    baseOffset: overrides.baseOffset ?? 0,
    startLine: overrides.startLine ?? 1,
    startColumn: overrides.startColumn ?? 1,
  }
  if (overrides.lineAnchors) source.lineAnchors = overrides.lineAnchors
  if (overrides.anchored === false) source.anchored = false
  return source
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

  // Whether the current buffer's FIRST character is an escaped caret (`\^`),
  // which is literal and must not be read as a caption marker downstream.
  let bufEscapedCaret = false
  const flush = () => {
    if (buf) {
      const node = { type: 'text', value: buf } as Text
      if (bufEscapedCaret) node.escapedLeadingCaret = true
      out.push(withPos(node, source, text, bufStart, i))
      buf = ''
      bufLast = ''
      bufEscapedCaret = false
    }
  }

  const append = (value: string) => {
    if (!buf) bufStart = i
    buf += value
    if (value) bufLast = value[value.length - 1]!
  }

  while (i < text.length) {
    const c = text[i]!
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
        // Remember a leading escaped caret so it is never mistaken for a caption
        // marker (`\^ cap` after an image stays a paragraph, not a figure).
        if (nxt === '^' && buf === '') bufEscapedCaret = true
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
        // Carry the escaped-leading-caret flag (this path flushes the buffer
        // directly instead of via flush()), so `\^ cap %% note` is not misread
        // as a caption.
        const node = { type: 'text', value: trimmed } as Text
        if (bufEscapedCaret) node.escapedLeadingCaret = true
        out.push(withPos(node, source, text, bufStart, commentStart))
      }
      buf = ''
      bufEscapedCaret = false
      const nl = text.indexOf('\n', i)
      const end = nl === -1 ? text.length : nl
      const content = text.slice(i + 2, end).replace(/^[ \t]/, '')
      out.push(
        withPos({ type: 'comment', block: false, content } as Comment, source, text, commentStart, end),
      )
      i = end
      continue
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
        const value = text.slice(i + openLen).replace(/\s+$/, '')
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
        if (closed && text[end] !== '`' && innerEnd > tick + openLen && text[innerEnd - 1] !== '`') {
          flush()
          const content = stripVerbatimPadding(text.slice(tick + openLen, innerEnd))
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
    // block (no special first-token sigil). Like math it requires a CLOSED
    // span — a bare `!` before an unclosed run stays literal text and the run
    // becomes an ordinary (unclosed) code span.
    if (c === '!' && text[i + 1] === '`') {
      const { end, closed, openLen } = verbatimSpanEnd(text, i + 1)
      if (closed) {
        flush()
        const content = stripVerbatimPadding(text.slice(i + 1 + openLen, end - openLen))
        out.push(withPos({ type: 'literal_inline', content } as LiteralInline, source, text, i, end))
        i = end
        continue
      }
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
            // A digit-first / invalid payload (`{#1a}`) is literal (§14), and an
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
            rawRef: rest.slice(0, len),
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
          out.push(withPos({ type: 'footnote_ref', id: mfn[1]!.trim() } as FootnoteRef, source, text, i, i + mfn[0].length))
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
            // A digit-first / invalid payload (`{#1a}`) is literal (§14), and an
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
        // Reference link [text][ref]{attrs}; collapsed [text][] reuses the
        // text as the label. Text must be non-empty (djot).
        const mref = RE_REF_TAIL.exec(tail)
        if (mref && innerText !== '') {
          flush()
          let len = close + 1 + mref[0].length
          let attrs: Attrs | undefined
          if (mref[2]) {
            // A digit-first / invalid payload (`{#1a}`) is literal (§14), and an
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
            // fallback for an unresolved ref preserves the full source.
            rawRef: rest.slice(0, len),
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
        out.push(withPos({ type: 'footnote_ref', id: mfn[1]!.trim() } as FootnoteRef, source, text, i, i + mfn[0].length))
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
          out.push({
            type: 'span',
            children: scanInline(innerText, shiftSource(source, text, i + 1), inFootnote),
            attrs: parseAttrs(ms[1]!),
            pos: sourcePos(source, text, i, i + close + 1 + ms[0].length),
          } as Span)
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
      const sym = (i === 0 || !/[A-Za-z0-9_]/.test(text[i - 1]!)) ? RE_SYMBOL.exec(rest) : null
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
        if (source.anchored !== false) cref.pos = sourcePos(source, text, i, i + cr[0].length)
        out.push(cref)
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
        // A digit-first / invalid payload (`{#1a}`) is literal (§14), not an
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
        out.push({
          type: 'substitution',
          oldText: sub[1]!,
          newText: sub[2]!,
          pos: sourcePos(source, text, i, i + sub[0].length),
        } as CriticSubstitute)
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
      // A digit-first / otherwise invalid payload (`{#1a}`, `{2=v}`) makes the
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
    if (start < text.length && !/\s/.test(text[start]!)) {
      let searchPos = start
      for (;;) {
        const close = findClose(text, searchPos, '*/')
        if (close === -1) break
        const inner = text.slice(start, close)
        // The content must not end in whitespace (nor be empty). A trailing
        // space closer like `/*x */` is not bold-italic; skip this `*/` and
        // look for a later one before giving up (parity with carve-php).
        if (inner === '' || /\s/.test(inner[inner.length - 1]!)) {
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
  node.pos = sourcePos(source, text, start, end)
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
  pos.endLine = point.line
  pos.endColumn = point.column
  pos.endOffset = point.offset
}

function sourcePos(
  source: InlineSource,
  text: string,
  start: number,
  end: number,
): Position {
  const startPoint = pointAt(source, text, start)
  const endPoint = pointAt(source, text, end)
  return {
    startLine: startPoint.line,
    endLine: endPoint.line,
    startColumn: startPoint.column,
    endColumn: endPoint.column,
    startOffset: startPoint.offset,
    endOffset: endPoint.offset,
  }
}

function shiftSource(source: InlineSource, text: string, by: number): InlineSource {
  const point = pointAt(source, text, by)
  return {
    baseOffset: source.baseOffset + by,
    startLine: point.line,
    startColumn: point.column,
  }
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
 */
function pointAt(
  source: InlineSource,
  text: string,
  offset: number,
): { line: number; column: number; offset: number } {
  const indices = newlineIndices(text)
  // Count newlines strictly before `offset` (binary search for the insertion
  // point of `offset` in the sorted indices).
  let lo = 0
  let hi = indices.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (indices[mid]! < offset) {
      lo = mid + 1
    } else {
      hi = mid
    }
  }
  const newlinesBefore = lo
  const line = source.startLine + newlinesBefore
  // Offset of this line's start within the LOCAL text.
  const lineStart = newlinesBefore === 0 ? 0 : indices[newlinesBefore - 1]! + 1
  const withinLine = offset - lineStart

  const anchor = source.lineAnchors?.[newlinesBefore]
  if (anchor) {
    return { line, column: anchor.column + withinLine, offset: anchor.offset + withinLine }
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
        // The leading fragment (starting at offset 0) inherits the
        // escaped-leading-caret flag, so an escaped caption whose text is an
        // abbreviation (`\^ ABC`) is not misread as a caption after splitting.
        if (last === 0 && node.escapedLeadingCaret) frag.escapedLeadingCaret = true
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
      const def = defs.get(node.ref)
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
      const def = defs.get(node.ref)
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
  // An attribute name (id, class, key) is a grammar identifier:
  // `(letter | '_'), {letter | digit | '_' | '-'}` -- it may NOT start with a
  // digit. A digit-first name (`.123`, `#1`, `2=v`) makes the whole block an
  // invalid attribute block, so it stays literal (§14) -- stricter than djot.
  // The bareword (boolean-attribute) alternative comes after key=value so a
  // `key=value` is consumed whole, and before `\s+`. It makes `{disabled}` and
  // `{.c disabled}` valid blocks (boolean attrs) rather than literal text.
  const stripped = inner.replace(
    /(?:#[a-zA-Z_][\w-]*)|(?:\.[a-zA-Z_][\w-]*)|(?:[a-zA-Z_][\w-]*=(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\S+))|(?:[a-zA-Z_][\w-]*)|\s+/g,
    '',
  )
  return stripped === ''
}

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
  // An attribute name is a grammar identifier (letter or `_` first, then
  // letters / digits / `_` / `-`); a digit-first token is not a valid
  // attribute and is skipped here (the payload is rejected as invalid
  // upstream by isValidAttrPayload, so the block stays literal).
  // The bareword alternative (m[7]) is LAST so `key=value` matches as a
  // key/value, not as a bareword `key` with a leftover `=value`. A bareword is
  // a value-less (boolean) attribute -> rendered `name=""` (djot-php form).
  const re = /(?:#([a-zA-Z_][\w-]*))|(?:\.([a-zA-Z_][\w-]*))|(?:([a-zA-Z_][\w-]*)=(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|(\S+)))|(?:([a-zA-Z_][\w-]*))/g
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
    } else if (m[7]) {
      if (m[7] === 'id') {
        // A bare boolean `id` also feeds the id slot (value ''), last-wins and
        // single -- `{id id=j}` -> `id="j"`, `{id}` -> `id=""` -- so `id` never
        // enters keyValues and no duplicate `id` attribute can be produced.
        attrs.id = ''
        note('#id')
      } else {
        // Boolean attribute: a bare word with no value.
        attrs.keyValues = { ...(attrs.keyValues ?? {}), [m[7]]: '' }
        note(m[7])
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
