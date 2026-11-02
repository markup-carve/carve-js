import { type Emphasis, type InlineNode, type Position, SMART_PUNCTUATION_GLYPHS } from '../../ast.js'
import { backtickRunEnds } from './backtick-run-index.js'
import { extendsGrapheme } from '../../grapheme-extender.js'
import { destinationSlotEnds, RE_EMPTY_LINK_REST, RE_LINK_REST, scanDestination } from '../../link-destination.js'
import {
  type BracketClose,
  buildBracketMap,
  crossrefBodyCanEnd,
  type CrossrefMemo,
  RE_AUTOLINK_STICKY,
  verbatimSpanEnd,
} from './parse-brackets.js'
import { inlineOpaqueEnds, RE_INLINE_ATTR, RE_RAW_INLINE } from './parse-inline-opaque.js'
import { trimStructural } from '../parse-prepass-core.js'
import { isCarveWhitespace } from '../../trim-non-nbsp.js'

// ============================================================================
// Inline parsing
// ============================================================================

// Footnote reference `[^label]`. A label is a physical-line identifier: it
// contains neither `]` nor a source newline. Letting this cross a soft break
// creates an id no definition marker (which is necessarily one line) can bind.
export const RE_FOOTNOTE_REF = /^\[\^([^\]\r\n]+)\]/

// extension_name = identifier = (letter|'_'){letter|digit|'_'|'-'}
// (grammar.ebnf:968-969,1122) -- a lone `_` is a valid extension name.
export const RE_EXTENSION_OPEN = /^:([a-zA-Z_][\w-]*)\[/

// For each `[`, the `]` an extension opened there closes at: the one at bracket
// depth zero, or the first unescaped one when the `[` is unbalanced (carve#4513).
export function extensionCloses(text: string): Int32Array {
  const close = new Int32Array(text.length + 1).fill(-1)
  const open: number[] = []
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\\') i++
    else if (text[i] === '[') open.push(i)
    else if (text[i] === ']' && open.length) close[open.pop()!] = i
  }
  const escaped = new Uint8Array(text.length + 1)
  for (let i = 0; i < text.length; i++) if (text[i] === '\\') escaped[++i] = 1
  let unclosed = -1
  for (let i = text.length - 1; i >= 0; i--) {
    if (text[i] === ']' && !escaped[i]) unclosed = i
    if (text[i] === '[' && close[i] === -1) close[i] = unclosed
  }
  return close
}

/**
 * The format a raw inline's `{=format}` tail can name.
 *
 * Exported because the HTML importer rebuilds a raw inline from PART 10 §13a's
 * `data-carve-raw` carrier: a value this does not match is not a format, and
 * the writer NORMALIZES what it is given, so `h t m l` would be written back
 * as `{=html}` - which is how a carrier smuggled markup past the mode gate.
 */
export const RE_RAW_INLINE_FORMAT = /^[a-zA-Z][\w-]*$/

// Symbol shortcode `:name:` (after extension, which needs `[`).
// The first name char is a letter, digit, `+` or `-` (so `:+1:` / `:-1:`
// parse), but never `_` — `:_x_:` would steal from underline. Scanning the
// symbol at the opening `:` also gives it precedence over smart typography,
// so `:+-:` is the symbol `+-`, not a `±` between colons (grammar PART 9 §7).
export const RE_SYMBOL = /^:([a-zA-Z0-9+-][\w+-]*):/

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

// `crossref_id` ends at a space, `>` or a line break; a tab inside the id is content.
export const RE_CROSSREF = /^<\/#([^> \n\r]+)>/

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
export const ATTR_INERT_PREV = new Set([
  'text',
  // `escaped_char` carries no attributes tail in the grammar, and neither does
  // the text run around it, so a block after one matches no production and is
  // literal. Attaching it to `escaped_text`, whose renderer emits nothing, made
  // the source characters vanish (carve-js#1766).
  'escaped_text',
  'non_breaking_space',
  'soft_break',
  'hard_break',
  'cell_wrap',
  'mention',
  'tag',
  'heading_ref',
  // Smart typography is a source-to-glyph substitution, not one of PART 9's
  // inline attribute carriers. Attaching a block here consumes source that no
  // renderer has an element on which to emit.
  'smart_punctuation',
  // Editorial substitution and comment have no attribute slot (carve#2138,
  // CARVE-P3-017 names only addition and deletion). Attaching here dropped the
  // block at render, the author's `{.k}` vanishing without trace.
  'substitution',
  'critic_comment',
  // Braced comments also end the attribute run (carve#2929).
  'comment',
])

/**
 * The whole tail of a link or image: `(destination)`, optionally with a title
 * and an attribute block. Returns the shape the regex it replaced returned --
 * full match, destination, the two title spellings, attribute payload -- so
 * the call sites read the same either way.
 */
export function execLinkTail(tail: string, canReadAttrs?: (offset: number) => boolean): [string, string, string | undefined, string | undefined, string | undefined] | null {
  const scanned = scanDestination(tail)
  if (scanned === null) return null
  const rest = (scanned.dest === '' ? RE_EMPTY_LINK_REST : RE_LINK_REST).exec(tail.slice(scanned.end))
  if (rest === null) return null
  const end = scanned.end + rest[0].length
  const attrs = tail[end] === '{' && (canReadAttrs === undefined || canReadAttrs(end))
    ? RE_INLINE_ATTR.exec(tail.slice(end)) : null
  return [tail.slice(0, end + (attrs?.[0].length ?? 0)), scanned.dest, rest[1], rest[2], attrs?.[1]]
}

export const RE_REF_TAIL = /^\[([^\]]*)\]/

export const RE_SPAN_TAIL = /^\{((?:[^}"'\n]|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')*)\}/

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
export function stripVerbatimPadding(content: string): string {
  // ALL-SPACE IS MEASURED IN CARVE'S WHITESPACE, not the host language's
  // (carve#977, PART 7). A native `.trim()` called ` <VT> ` all-space, so the
  // padding stayed on and `` ` <VT> ` `` rendered `<code> <VT> </code>` where
  // `` ` x ` `` renders `<code>x</code>` - a vertical tab deciding, in the one
  // test that separates padding from content, that a space is not padding.
  if (trimStructural(content) === '') return content
  return content.replace(/^ ([\s\S]*) $/, '$1')
}

// A BRACED HYPHEN PAIR IS AN EN DASH (markup-carve/carve#1447). The bare run
// carries a flanking guard, so `x --verbose y` stays literal and an author who
// MEANT a dash in that position had no way to say so. This is that way, and it
// cost nothing: the string it took was an empty `<del>`.
export const RE_BRACED_EN_DASH = /^\{--\}/

export const PAIR_MARKERS = '/*_^,~=+-'

// Every braced opener needs a whole delimiter: the forced spans, the editorial
// frames and the comment `{%` (CARVE-P3-025).
export const BRACED_OPENER_MARKERS = '/*_^,~=+-#%'

export function splitBracedOpener(text: string, open: number): boolean {
  const marker = text[open + 1]
  return marker !== undefined && BRACED_OPENER_MARKERS.includes(marker) && extendsGrapheme(text, open + 2)
}

// `guarded`: the opener follows a `_` or `/` and opens only if that one does.
// `crossed`: a marker glued before the opener closes first, so E2 demotes the opener.
export interface BarePair { close: number; end: number; guarded?: boolean; crossed?: boolean }

export interface InlinePairView {
  tables: Array<Int32Array | undefined>
  attributeTails: Map<number, number>
  barePairs: Map<number, BarePair>
  offset: number
}

export const FORCED_TYPE: Record<string, Emphasis['type']> = {
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
export const RE_MENTION = /^@([a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*)/

export const RE_TAG = /^#([a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*)/

export const SMART_TOKENS: Array<[string, string, string]> = [
  ['<-->', '↔', 'left_right_arrow'],
  ['-->', '→', 'rightwards_arrow'],
  ['<--', '←', 'leftwards_arrow'],
  ['<=>', '⇔', 'left_right_double_arrow'],
  ['==>', '⇒', 'rightwards_double_arrow'],
  ['<==', '⇐', 'leftwards_double_arrow'],
  ['(tm)', '™', 'trademark'],
  ['...', '…', 'ellipsis'],
  ['<=', '≤', 'less_than_or_equal'],
  ['>=', '≥', 'greater_than_or_equal'],
  ['!=', '≠', 'not_equal'],
  ['+-', '±', 'plus_minus'],
]

/**
 * Allocate a run of `n` hyphens (n >= 2) into em/en dashes, matching
 * djot + carve-php: all em when divisible by 3, all en when divisible by
 * 2, otherwise max em-dashes with the remainder as en-dashes (a
 * remainder of 1 trades one em for two en). 2->–, 3->—, 4->––, 5->—–.
 */
export function allocateDashes(n: number): string {
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
export const isFlankSpace = (ch: string) => /[ \t\n\r\u00a0\0]/.test(ch)

export const isQuoteSpace = (ch: string) => /[ \t\n\r\u00a0]/.test(ch)

export const isQuoteAlnum = (ch: string) => /[\p{L}\p{N}]/u.test(ch)

const UNICODE_WORD = /[\p{L}\p{N}]/u
export const wordAfter = (text: string, at: number): boolean => {
  const point = text.codePointAt(at)
  return point !== undefined && UNICODE_WORD.test(String.fromCodePoint(point))
}
export const wordBefore = (text: string, at: number): boolean => {
  if (at === 0) return false
  const last = at - 1
  const start = last > 0 && text.charCodeAt(last) >= 0xdc00 && text.charCodeAt(last) <= 0xdfff
    && text.charCodeAt(last - 1) >= 0xd800 && text.charCodeAt(last - 1) <= 0xdbff ? last - 1 : last
  return wordAfter(text, start)
}

export const QUOTE_LETTER_RUN = /\p{L}+/uy

// Braced comments that open the content count as nothing for quote direction (carve#4552).
const LEADING_COMMENTS = /^(?:\{%(?:(?!%\})[\s\S])*%\})+/
export const leadingCommentsEnd = (text: string): number => LEADING_COMMENTS.exec(text)?.[0].length ?? 0

// A braced comment counts as nothing for every flank test (carve#4719), so these
// step over the comments adjacent to `at`.
let commentSpans: { text: string; ends: Map<number, number>; opens: Map<number, number> } | undefined
function commentSpansOf(text: string) {
  if (commentSpans?.text === text) return commentSpans
  const ends = new Map<number, number>()
  const opens = new Map<number, number>()
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '\\') i++
    else if (c === '`') {
      const span = verbatimSpanEnd(text, i)
      if (!span.closed) break
      i = span.end - 1
    } else if (c === '{' && text[i + 1] === '%' && !extendsGrapheme(text, i + 2)) {
      const close = text.indexOf('%}', i + 2)
      if (close === -1) break
      ends.set(i, close + 2)
      opens.set(close + 2, i)
      i = close + 1
    }
  }
  return commentSpans = { text, ends, opens }
}
export const flankIndexAfter = (text: string, at: number): number => {
  if (text[at] !== '{' || text[at + 1] !== '%') return at
  const { ends } = commentSpansOf(text)
  let i = at
  for (let end = ends.get(i); end !== undefined; end = ends.get(i)) i = end
  return i
}
export const flankIndexBefore = (text: string, at: number): number => {
  if (text[at - 1] !== '}' || text[at - 2] !== '%') return at
  const { opens } = commentSpansOf(text)
  let i = at
  for (let open = opens.get(i); open !== undefined; open = opens.get(i)) i = open
  return i
}

export const ELISION_WORDS = new Set(['tis', 'tisn', 'twas', 'twasn', 'twere', 'twill', 'twould', 'em', 'cause', 'til', 'n', 'bout'])

// A hard break and an escaped space read as the flank character they render, not as their backslash (PART 3).
export const flankCharAt = (text: string, i: number): string => {
  if (text[i] !== '\\') return i < text.length ? String.fromCodePoint(text.codePointAt(i)!) : ''
  if (i + 1 >= text.length || text[i + 1] === '\n') return '\n'
  return text[i + 1] === ' ' ? '\u00a0' : '\\'
}

// R1 (CARVE-P3-023): after a dash or a slash, a quote closes before end, whitespace or closing punctuation.
export const closesAfterDash = (prev: string, next: string) =>
  '-–—/'.includes(prev) && prev !== '' && (next === '' || isQuoteSpace(next) || `"'.,;:!?)]`.includes(next))

// Adjudicated smart-quote opening context (matches carve-rs on these inputs):
// a straight quote curls OPENING when preceded by start-of-content, Unicode
// whitespace (incl. NBSP, handled below via the U+E000 placeholder), or one of
// the operator/opening-punctuation chars `( [ { = : - /`. Sentence punctuation
// (`. , ; ! ?`), letters, digits and closing brackets stay CLOSING. The en/em
// dash also opens (a quote right after a `--` dash run opens), as does a quote
// directly after an opening curly quote (nested-quote context).
// Letters outside the BMP are two UTF-16 units; the quote rules judge whole code points.
export const codePointAfter = (text: string, i: number): string => {
  const cp = text.codePointAt(i + 1)
  return cp === undefined ? '' : String.fromCodePoint(cp)
}

export const isQuoteOpenContext = (prev: string) =>
  prev === '' ||
  /[ \t\n\r\u00a0([{\-–—/=:]/.test(prev) ||
  prev === '“' ||
  prev === '‘'

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
 * Nodes without a known trailing character are treated as word-adjacent.
 */
export function lastEmittedGlyph(previous: InlineNode): string {
  if (previous && previous.type === 'smart_punctuation') {
    const glyph = previous.glyph ?? SMART_PUNCTUATION_GLYPHS[previous.kind]
    if (glyph) return glyph
  }
  // An escaped character is its own node but still the character before the
  // quote, and quote flanking reads that character: `\{"quoted"` opens on the
  // brace exactly as an unescaped `{` would (corpus 163).
  if (previous && previous.type === 'non_breaking_space') return '\u00a0'
  if (previous && previous.type === 'escaped_text') return previous.value
  if (previous.type === 'symbol') return ':'
  if (previous.type === 'text') return previous.value.slice(-1)
  // A line break is whitespace to quote flanking, so a quote starting a line opens (carve#2822).
  if (previous && (previous.type === 'soft_break' || previous.type === 'hard_break' || previous.type === 'cell_wrap')) return '\n'
  return 'x'
}

export interface InlineSource {
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
   * also carries markup.
   */
  rangeShift?: number
  cellWraps?: ReadonlyMap<number, { line: number; row?: number; col?: number; pos?: Position }>
  wrapShift?: number
}

/**
 * One local range of an inline text that maps exactly to a document region.
 *
 * Local offset `o` with `from <= o <= to` sits at document offset
 * `offset + (o - from)`, on `line`, at column `column + (o - from)`. A range
 * never spans a newline, which is what lets `line` be a single number.
 */
export interface AnchorRange {
  from: number
  to: number
  offset: number
  line: number
  column: number
}

export function inlineSource(overrides: Partial<InlineSource> = {}): InlineSource {
  const source: InlineSource = {
    baseOffset: overrides.baseOffset ?? 0,
    startLine: overrides.startLine ?? 1,
    startColumn: overrides.startColumn ?? 1,
  }
  if (overrides.lineAnchors) source.lineAnchors = overrides.lineAnchors
  if (overrides.anchorShift) source.anchorShift = overrides.anchorShift
  if (overrides.anchoredRanges) source.anchoredRanges = overrides.anchoredRanges
  if (overrides.rangeShift) source.rangeShift = overrides.rangeShift
  if (overrides.cellWraps) source.cellWraps = overrides.cellWraps
  if (overrides.wrapShift) source.wrapShift = overrides.wrapShift
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
export function anchorRangeAt(ranges: readonly AnchorRange[], offset: number): AnchorRange | undefined {
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

/**
 * The emphasis kinds held against bare openers in the current inline scope.
 *
 * A bare span inherits the enclosing kinds. A braced native span starts a
 * scope holding its own kind against bare openers; a further braced native
 * child can nest that kind (CARVE-P9-043). A link label or table cell starts
 * with no held kinds.
 */
export const NO_OPEN_KINDS: ReadonlySet<string> = new Set()

export interface EmphasisMatch {
  node: Emphasis
  end: number
}

export interface EmphasisMemo {
  // Inside an inline note: a `[^` there is no footnote reference.
  noteBody?: boolean
  // Per delimiter, scan positions known to reach no closer. Not a single bound:
  // an opener inside a skipped plain brace group does not scan a suffix.
  failed: Map<string, Uint8Array>
  lastBrace: number
  lastCritic?: number
  boldItalic?: { closers: number[]; minimumOwners: number[]; width: number }
  // Closer walks run for an outer opener's E2 check, by delimiter, start and end.
  closes?: Map<string, number>
  // Each link or image destination's `(` mapped to its closing `)`, built once.
  destinations?: Map<number, number>
  // The same, with every glued bracket taking a destination (`nested` in the
  // core grammar), as the editorial insert, delete and substitution scans read.
  nestedDestinations?: Map<number, number>
  // Each `[` mapped to its balanced `]`, built once. Same map the inline pass
  // resolves a label with, so the scan hides exactly the run the parser builds.
  brackets?: BracketClose
  crossref?: CrossrefMemo
}

const combinedCloserAt = (text: string, at: number): boolean => {
  const before = flankIndexBefore(text, at)
  const after = flankIndexAfter(text, at + 2)
  return before > 0 && !isCarveWhitespace(text[before - 1]) && !extendsGrapheme(text, after) && !wordAfter(text, after)
}

// `bracedEnd` gives the exclusive end of a forced span or editorial frame
// opening at a `{`, or -1, as the parser pairs it.
export function combinedSpanCloser(text: string, start: number, memo: EmphasisMemo, bracedEnd?: (open: number) => number, ownsBlock?: (at: number) => boolean): number | undefined {
  if (!memo.boldItalic) {
    const closers: number[] = []
    const owners: number[] = []
    const codeEnds = backtickRunEnds(text)
    const brackets = emphasisBrackets(text, memo)
    const destinations = linkDestinations(text, memo)
    const atoms = atomicLinkRegions(text)
    const attributes = new Map<number, number>()
    const opaqueEnds = text.includes('{') ? inlineOpaqueEnds(text, codeEnds, destinations, new Map(), attributes, brackets) : attributes
    let atom = 0
    const boundaries: Array<{ open: number; end: number; opaque: boolean }> = []
    for (let close = 0; close < text.length - 1; close++) {
      while (boundaries.length && boundaries.at(-1)!.end <= close) boundaries.pop()
      if (text[close] === '\\') { close++; continue }
      if (text[close] === '`') {
        const end = codeEnds![close]!
        if (end === -1) break
        close = end - 1
        continue
      }
      // A `%%` comment inside the shape ends at the next closer token, and
      // nothing in it is an atom (PART 9 §9 P1, carve#4042).
      if (text[close] === '%' && text[close + 1] === '%' && (text[close - 1] === ' ' || text[close - 1] === '\n')) {
        let k = close + 2
        while (k < text.length - 1 && text[k] !== '\n' && !(text[k] === '*' && text[k + 1] === '/' && combinedCloserAt(text, k))) k++
        close = k - 1
        continue
      }
      while (atom < atoms.length && atoms[atom]![1] <= close) atom++
      // Destination, attribute, and atomic-link contents are text to the
      // outer scanner. A `[` inside one must not open a bracket boundary that
      // reaches past that opaque region.
      const opaque = boundaries.at(-1)?.opaque === true
      if (!opaque && atom < atoms.length && atoms[atom]![0] === close) {
        boundaries.push({ open: close, end: atoms[atom]![1], opaque: true })
      }
      if (!opaque && text[close] === '[') {
        const end = brackets(close)
        if (end !== undefined) boundaries.push({ open: close, end: end + 1, opaque: false })
      }
      if (!opaque && text[close] === '(' && text[close - 1] === ']') {
        const end = destinations.get(close)
        if (end !== undefined) boundaries.push({ open: close, end: end + 1, opaque: true })
      }
      if (!opaque && text[close] === '{') {
        // A braced inline is a child boundary too (PART 9 E2a, section 22).
        const braced = bracedEnd?.(close) ?? -1
        // A block after a bare marker is opaque only where a pair owns it.
        const unowned = attributes.has(close) && '*/_~='.includes(text[close - 1] ?? ' ') && ownsBlock?.(close) === false
        const end = braced === -1 && !unowned ? opaqueEnds.get(close) ?? attributes.get(close) : undefined
        if (braced !== -1) boundaries.push({ open: close, end: braced, opaque: false })
        else if (end !== undefined) boundaries.push({ open: close, end, opaque: true })
      }
      if (text[close] !== '*' || text[close + 1] !== '/') continue
      // bare_closer('/'): the outer `/` does not close before a letter or digit
      // (carve#3217), so that `*/` is content and a later one may close.
      if (combinedCloserAt(text, close)) {
        closers.push(close)
        owners.push(boundaries.at(-1)?.open ?? -1)
      }
    }
    // A closer belongs to a child only when that child's opener is after the
    // combined opener. A combined span opened inside the child can still use
    // a closer there. Minimum owner positions let each lookup skip inaccessible
    // candidates in logarithmic time, even for many openers before many children.
    let width = 1
    while (width < closers.length) width *= 2
    const minimumOwners = new Array<number>(width * 2).fill(Infinity)
    for (let i = 0; i < owners.length; i++) minimumOwners[width + i] = owners[i]!
    for (let i = width - 1; i > 0; i--) minimumOwners[i] = Math.min(minimumOwners[i * 2]!, minimumOwners[i * 2 + 1]!)
    memo.boldItalic = { closers, minimumOwners, width }
  }
  const { closers, minimumOwners, width } = memo.boldItalic
  let low = 0
  let high = closers.length
  while (low < high) {
    const mid = (low + high) >>> 1
    if (closers[mid]! <= start) low = mid + 1
    else high = mid
  }
  const nextReachable = (node: number, left: number, right: number): number | undefined => {
    if (right <= low || minimumOwners[node]! >= start) return undefined
    if (right - left === 1) return left
    const middle = (left + right) >>> 1
    return nextReachable(node * 2, left, middle) ?? nextReachable(node * 2 + 1, middle, right)
  }
  const index = nextReachable(1, 0, width)
  return index === undefined ? undefined : closers[index]
}

export function newEmphasisMemo(): EmphasisMemo {
  return { failed: new Map(), lastBrace: -2 }
}

/** `buildBracketMap` over one inline text, built at most once per scan. */
export function emphasisBrackets(text: string, memo: EmphasisMemo): BracketClose {
  memo.brackets ??= text.includes('[') ? buildBracketMap(text, false, undefined, undefined, memo.noteBody !== true) : () => undefined

  return memo.brackets
}

// The braced inlines E2a names, as sticky copies of the matchers the main loop
// uses, so the scan hides exactly the region the parser builds a node from.

// Sticky copies of the raw-inline format and link-tail matchers used by the
// main loop, so the scan hides exactly the region it builds a node from.
export const RE_RAW_INLINE_STICKY = new RegExp(RE_RAW_INLINE.source.replace(/^\^/, ''), 'y')

export const RE_LINK_REST_STICKY = new RegExp(RE_LINK_REST.source.replace(/^\^/, ''), 'y')

export const RE_EMPTY_LINK_REST_STICKY = new RegExp(RE_EMPTY_LINK_REST.source.replace(/^\^/, ''), 'y')

// Autolinks and cross-references outside code spans, as [start, end) pairs.
// PART 8 resolves them before links, so a `[` inside one opens no run.
export function atomicLinkRegions(text: string): Array<[number, number]> {
  const regions: Array<[number, number]> = []
  if (!text.includes('<')) return regions
  const codeEnds = text.includes('`') ? backtickRunEnds(text) : undefined
  const crossrefs: CrossrefMemo = { lastCloser: text.lastIndexOf('>') }
  for (let at = 0; at < text.length; at++) {
    const ch = text[at]
    if (ch === '\\') { at++; continue }
    if (ch === '`') {
      const end = codeEnds?.[at] ?? -1
      if (end === -1) break
      at = end - 1
      continue
    }
    if (ch !== '<') continue
    if (text.startsWith('</#', at) && text[at + 3] !== '>' && crossrefBodyCanEnd(text, at + 3, crossrefs)) {
      const end = text.indexOf('>', at + 3) + 1
      regions.push([at, end])
      at = end - 1
      continue
    }
    RE_AUTOLINK_STICKY.lastIndex = at
    const autolink = RE_AUTOLINK_STICKY.exec(text)
    if (autolink) {
      regions.push([at, at + autolink[0].length])
      at += autolink[0].length - 1
    }
  }
  return regions
}

// Only a bracket pair the parser can build a link or image from has a
// destination: not a footnote reference `[^n]` nor an inline note `^[...]`. The
// attribute block after the `)` is not part of what E2a hides.
export function linkDestinations(text: string, memo: EmphasisMemo, nested = false): Map<number, number> {
  if (nested ? memo.nestedDestinations : memo.destinations) return (nested ? memo.nestedDestinations : memo.destinations)!
  const found = new Map<number, number>()
  if (nested) memo.nestedDestinations = found
  else memo.destinations = found
  const firstLinkTail = text.indexOf('](')
  if (firstLinkTail === -1) return found
  const sharedSlots: { first: number; ends?: Map<number, number> } = { first: firstLinkTail + 1 }
  const brackets = buildBracketMap(text, false, undefined, sharedSlots)
  // A destination inside a destination is already hidden by the one around it,
  // and scanning it again is what makes a nest of them quadratic. Brackets come
  // in ascending order, so the outermost of a nest is reached first.
  let covered = -1
  const destinationOpeners = new Set((sharedSlots.ends ??= destinationSlotEnds(text, sharedSlots.first)).keys())
  const atoms = atomicLinkRegions(text)
  let atom = 0
  // Glued brackets pair up left to right: a run glued to a text half is the
  // label of a reference pair and takes no destination (`[b][a](u)`). A
  // footnote or note bracket does not start a pair.
  const textHalves = new Set<number>()
  for (let open = text.indexOf('['); open !== -1; open = text.indexOf('[', open + 1)) {
    while (atom < atoms.length && atoms[atom]![1] <= open) atom++
    if (atom < atoms.length && atoms[atom]![0] < open) continue
    const close = brackets(open)
    if (close === undefined) continue
    if (!nested && textHalves.has(open - 1)) continue
    // A `{^` opener owns its `^`, so the bracket after it is no inline note.
    const note = !nested && (text[open + 1] === '^' || text[open - 1] === '^' && text[open - 2] !== '{')
    if (!note) textHalves.add(close)
    if (close + 1 <= covered) continue
    if (text[close + 1] !== '(' || note) continue
    if (!destinationOpeners.has(close + 1)) continue
    const scanned = scanDestination(text, close + 1)
    if (scanned === null) continue
    const restPattern = scanned.dest === '' ? RE_EMPTY_LINK_REST_STICKY : RE_LINK_REST_STICKY
    restPattern.lastIndex = scanned.end
    const rest = restPattern.exec(text)
    if (rest === null) continue
    const end = scanned.end + rest[0].length - 1
    found.set(close + 1, end)
    covered = end
  }
  return found
}
