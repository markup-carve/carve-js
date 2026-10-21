import { RE_RAW_INLINE, RE_INLINE_ATTR, spanAttrProvablyInvalid, inlineOpaqueEnds, suffixHasChar, suffixHasPair } from './parse-inline-opaque.js'
import { buildBracketMap, verbatimSpanEnd, crossrefBodyCanEnd, RE_AUTOLINK, RE_AUTOLINK_STICKY } from './parse-brackets.js'
export { buildBracketMap, rawBracketRunCloses, rawImageBracketRunCloses, forEachCrossrefRun, RE_AUTOLINK, AUTOLINK_BODY_EXCLUDED } from './parse-brackets.js'
export type { BracketClose, CrossrefMemo } from './parse-brackets.js'
import type { BracketClose, CrossrefMemo } from './parse-brackets.js'
import { createLineBlockParser, type LineBlockHost } from './parse-line-block.js'
import { createTableBlockParser, type TableBlockHost } from './parse-table-block.js'
import { createListStateTracker } from './parse-list-state.js'
import { createRebasePass } from './parse-rebase.js'
import { createInlineScanner, type InlineScannerSession } from './parse-inline-scanner.js'
import { createLinkDefinitionCollector } from './parse-link-definitions.js'
import { createDefinitionListParser } from './parse-definition-list.js'
/*
 * Carve parser — linear-time, block + inline.
 *
 * Block lexer reads line by line; inline parser does a single scan
 * over each block's text content. No backtracking.
 */

import { createListParser } from './parse-list.js'
import { Lexer, layoutWork, normalizeNewlines, isBlankLine, indentColumns, sliceColumns, TRAILING_WS } from './parse-lexer.js'
export { layoutWork, isBlankLine } from './parse-lexer.js'
import { replaceLoneSurrogates } from './well-formed.js'
import { AppendOnlyCloser } from './append-only-closer.js'
import { backtickRunEnds } from './backtick-run-index.js'
import { SubstitutionScanner } from './substitution-scanner.js'
import { ScopedFenceClosers } from './scoped-fence-closers.js'
import { LiteralCommentClosers } from './literal-comment-closers.js'
import { AttachmentFenceClosers, FailedScanRanges } from './attachment-fence-closers.js'
import { tableColumnsFromAttrs, tableRowGroupsFromAttrs } from './table-source-metadata.js'
import { expandLineBlockWhitespace, dropTrailingSpaces, verseSourceOffset, restoreVerseGaps } from './verse-whitespace.js'
import { parseAttrs, isValidAttrPayload, isValidInlineAttrPayload, unescapeAttrValue, isEmptyAttrs } from './attribute-parser.js'
export { parseAttrs } from './attribute-parser.js'
import type { LinkDef } from './inline-resolution.js'
export type { LinkDef } from './inline-resolution.js'
import { accumulateAttrs, mergeAttrs } from './attribute-merge.js'
export { mergeAttrs } from './attribute-merge.js'
import { applyAbbreviations, applyLinkDefs } from './inline-resolution.js'
import { mapInlineChildren, visitInlineChildren } from './inline-children.js'
import { referenceLink, referenceImage } from './reference-resolution.js'
import { definitionLinePosition, dropPositions, toCodepointPositions } from './source-positions.js'
import { resolveSpanGrid } from './table-spans.js'
import { delimitedTable, setDelimitedPayloadLines } from './delimited-table.js'
import type {
  SmartPunctuation,
  AbbreviationDef,
  Admonition,
  Attrs,
  BlockNode,
  BlockQuote,
  CodeBlock,
  CitationGroup,
  Comment,
  DefinitionItem,
  DefinitionList,
  Directive,
  Div,
  LineBlock,
  Document,
  Emphasis,
  Figure,
  FigureGroup,
  Heading,
  HeadingLevel,
  Image,
  InlineNode,
  List,
  Math,
  Paragraph,
  Position,
  RawBlock,
  VerbatimCellWrap,
  Table,
  TaskState,
  Text,
  ThematicBreak,
  LinkReferenceDefinition,
} from './ast.js'
import { GENERATED_CONTENT_KINDS, SMART_PUNCTUATION_GLYPHS } from './ast.js'
import type { CarveExtension, MatcherContext, InlineMatch } from './extension.js'
import type { AsciiHeadingIdMode } from './heading-ids.js'
import { utf8ByteLength } from './abbr-budget.js'
import { entriesToWire } from './definition-list-wire.js'
import { isCarveWhitespace, trimNonNbsp, trimEndSpaceTab, trimEndNonNbsp } from './trim-non-nbsp.js'
import { extendsGrapheme } from './grapheme-extender.js'
import { ownValue, setOwn } from './own-property.js'
import { codeContent } from './verbatim-payload.js'
import { markAboveContentColumn, markSecondLineLazy } from './paragraph-indent.js'
import { normalizeRefLabel } from './label-key.js'
import { completeDestinationOpeners, linkDestinationValue, scanDestination, RE_LINK_REST, RE_EMPTY_LINK_REST } from './link-destination.js'
export { normalizeRefLabel } from './label-key.js'

export interface ParseOptions {
  /**
   * Record source positions on the returned tree. Default true. Set false for
   * a smaller tree to serialize or compare. Internal spans needed for source
   * ownership remain available during parsing; lint and source-line rendering
   * require positions. This option is not a guarantee of faster parsing.
   */
  positions?: boolean
  /** Format label applied to a bare `---` frontmatter fence. Default 'yaml'. */
  defaultFrontmatterFormat?: string
  /**
   * Lowercase auto-generated heading ids (GitHub/SSG-style anchors), folded per
   * code point so it stays portable. Default false: ids are case-preserving.
   * Cross-references compare ids exactly either way.
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
  onUnclosedCodeFence?: (fence: UnclosedCodeFence) => void
  onRefusedContinuationMarker?: (marker: RefusedContinuationMarker) => void
  /** Reports a recognized container whose malformed metadata was dropped. */
  onInvalidContainerMetadata?: (container: UnclosedContainer) => void
  /**
   * Called for each block-attribute run that reached no block, because the
   * document or the container holding it ended first (PART 9 §15 A4). Like
   * {@link onUnclosedContainer}, this reports parser state that is intentionally
   * not serialized: nothing is emitted for the run, so the AST cannot say it was
   * ever written.
   */
  onDanglingBlockAttributes?: (run: DanglingBlockAttributes) => void
}

export interface DanglingBlockAttributes {
  line: number
  column: number
  startOffset: number
  endOffset: number
  /**
   * Set when the run is the ENTIRE body of a footnote definition or a
   * description, where deleting the line destroys the construct rather than
   * tidying it (PART 2, MARKER REQUIRES CONTENT).
   */
  wholeBodyOf?: 'footnote' | 'description'
}

export interface UnclosedContainer {
  kind: 'div' | 'admonition' | 'directive' | 'line block' | 'hard-break block' | 'block quote'
  line: number
  column: number
  startOffset: number
  endOffset: number
  fenceWidth: number
}

export interface UnclosedCodeFence {
  line: number
  column: number
  marker: string
  endLine: number
  reason: 'document' | 'container' | 'continuation'
}

export interface RefusedContinuationMarker {
  line: number
  column: number
  host: 'document' | 'list item' | 'definition description' | 'footnote' | 'block quote'
  reason: 'blank' | 'document' | 'sibling' | 'left' | 'right' | 'wrong-column'
  firstBlock?: boolean
}

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


const FENCE_TRAILING_WS = '[ \\t]*$'

/**
 * A line matcher whose `[label]` slot closes where the reader's own bracket scan
 * does, rather than at the first `]`.
 *
 * The `label` production takes a BALANCED run (markup-carve/carve#2576), and a
 * regex cannot spell one - which is why the slot was written flat as
 * `\[[^\]]*\]` in the colon opener and the fence info line, the two spellings of
 * the one production, and why both lost a label holding a nested bracket. So the
 * slot matches greedily here and each label group is checked against
 * `buildBracketMap`: the same scan the inline pass resolves a link label with, so
 * a nested bracket, an escaped `]` and a `]` inside a code span read the same way
 * in both, and an UNCLOSED backtick run swallows the closer and leaves the line as
 * prose - which is what a link text does with the same bytes.
 *
 * `test` and `exec` keep RegExp's own signatures, so every tracker that asks
 * whether a line opens the block gets this one answer instead of a second.
 *
 * THE SLOT IS `[^\n]*`, NOT `.*`. JavaScript's dot also excludes U+2028 and
 * U+2029, which the flat `[^\]]*` accepted, so a dot would have turned a label
 * holding one into prose. How those two characters read is a question of its own
 * and is not answered here.
 */
function balancedLabelMatcher(
  re: RegExp,
  labelGroups: readonly number[],
): { test: (line: string) => boolean, exec: (line: string) => RegExpExecArray | null } {
  const exec = (line: string): RegExpExecArray | null => {
    const m = re.exec(line)
    if (m === null) return null
    for (const group of labelGroups) {
      const raw = m[group]
      // A greedy slot reaches the LAST `]` on the line, so an unbalanced run
      // arrives here rather than being silently cut short at the first one.
      if (raw !== undefined && buildBracketMap(raw)(0) !== raw.length - 1) return null
    }

    return m
  }

  return { test: (line) => exec(line) !== null, exec }
}

const RE_BACKTICK_FENCE_CLOSE_3 = new RegExp('^`{3,}' + FENCE_TRAILING_WS)
const RE_TILDE_FENCE_CLOSE_3 = new RegExp('^~{3,}' + FENCE_TRAILING_WS)

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
  if (marker.length === 3) return marker[0] === '`' ? RE_BACKTICK_FENCE_CLOSE_3 : RE_TILDE_FENCE_CLOSE_3
  return new RegExp(`^${marker[0]}{${marker.length},}${FENCE_TRAILING_WS}`)
}

const RE_FENCE = balancedLabelMatcher(
  new RegExp(
    '^()(`{3,}|~{3,}) ?(?:([a-zA-Z0-9_+#/.-]+)(?: +("[^"]*"))?(?: +(\\[[^\\n]*\\]))?' +
      '|("[^"]*")(?: +(\\[[^\\n]*\\]))?|(\\[[^\\n]*\\]))?' +
      FENCE_TRAILING_WS,
  ),
  [5, 7, 8],
)
/** A colon run, whichever of the colon-fence blocks it goes on to open. */
const RE_COLON_RUN = /^:{3,}/
/** True when `line`, already at its container's content column, opens a code or raw fence. */
export function opensCodeFence(line: string): boolean {
  return RE_FENCE.test(line) || RE_RAW_FENCE.test(line)
}

const RE_UNORDERED = /^(?=([ \t]*))\1[-*] +[ \t]*([^ \t\r\n][^\r\n]*)$/
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
  /^(?=([ \t]*))\1([0-9]+|[ivxlcdm]+|[IVXLCDM]+|[a-z]|[A-Z]|(?=\.))([.)]) +[ \t]*([^ \t\r\n][^\r\n]*)$/
// Task states (matches djot-php): `x`/`X` are checked; ` `, `-`, `_`,
// `>`, `?` are all accepted and render as an unchecked checkbox.
const RE_TASK = /^(?=([ \t]*))\1[-*] +\[([ xX\-_>?])\] +[ \t]*([^ \t\r\n][^\r\n]*)$/

/** PART 11 §6g. A checked box records nothing: `[X]` and `[x]` are one state. */
function authoredTaskState(state: string, checked: boolean): TaskState | undefined {
  if (checked || state === ' ') return undefined
  return state as TaskState
}
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
  /^(?=([ \t]*))\1((?:[-*])|(?:[0-9]+|[ivxlcdm]+|[IVXLCDM]+|[a-z]|[A-Z]|(?=\.))[.)])\{((?:[^}"'\n]|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')*)\}( +[^ \t\r\n][^\r\n]*)$/
const RE_ITEM_ATTR_HEAD =
  /^(?=([ \t]*))\1((?:[-*])|(?:[0-9]+|[ivxlcdm]+|[IVXLCDM]+|[a-z]|[A-Z]|(?=\.))[.)])\{((?:[^}"'\n]|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')*)\}( +)(?=[^ \t])/
// Strip a valid abutting `{...}` from a marker line so the bare marker regexes
// match, returning the stripped line plus the parsed attributes. Returns null
// when there is no abutting brace or the brace is not a valid attribute payload
// (then `-{...}` is not a marker and the line stays ordinary text, mirroring the
// inline-span disambiguation, grammar §14).
interface ItemAttributeMarker {
  stripped: string
  attrs: Attrs | undefined
  markerLine?: string
  contentOffset?: number
  headWidth?: number
}

const RE_TASK_CONTENT_HEAD = /^\[([ xX\-_>?])\] +[ \t]*(?=[^ \t])/

function extractItemAttr(line: string, terminatorFree = false): ItemAttributeMarker | null {
  const m = (terminatorFree ? RE_ITEM_ATTR_HEAD : RE_ITEM_ATTR).exec(line)
  if (!m || !isValidInlineAttrPayload(m[3]!)) return null
  const parsed = parseAttrs(m[3]!)
  // Empty braces remove marker metadata without adding an empty AST attribute object.
  const attrs = isEmptyAttrs(parsed) ? undefined : parsed
  if (!terminatorFree) return { stripped: m[1]! + m[2]! + m[4]!, attrs }

  const contentOffset = m[0].length
  const content = line.slice(contentOffset)
  const head = m[1]! + m[2]! + m[4]!
  const taskWidth = RE_TASK_CONTENT_HEAD.exec(content)?.[0].length ?? 0
  // Classifiers need the marker, an optional checkbox, and one payload character.
  // The body stays a slice of the source instead of a slice of a flattened rope.
  return {
    attrs, contentOffset, headWidth: head.length,
    markerLine: head + content.slice(0, taskWidth + 1),
    get stripped() {
      if (layoutWork.on) layoutWork.seam += head.length + content.length
      return head + content
    },
  }
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
function trimStructural(text: string): string {
  return trimNonNbsp(text)
}

const trimCellPadding = (text: string): string => {
  let start = 0
  let end = text.length
  while (start < end && text.charCodeAt(start) === 0x20) start++
  while (end > start && text.charCodeAt(end - 1) === 0x20) end--
  if (start === 0 && end === text.length) return text

  return text.slice(start, end)
}

const RE_CONTINUATION_MARKER = /^\+[ \t]*$/

function isContinuationMarker(line: string): boolean {
  return RE_CONTINUATION_MARKER.test(line)
}

const RE_FIRST_BLOCK_MARKER = new RegExp('^[ \\t]*\\+' + TRAILING_WS)

function isPhysicalContinuationMarker(line: string): boolean {
  return /^(?:>(?: ?))*\+[ \t]*$/.test(line)
}

function isStackedFirstBlockQuoteMarker(line: string): boolean {
  return /^[ \t]*(?:(?:[-*] (?:\[[ xX]\] )?|(?:[0-9]+|[ivxlcdm]+|[IVXLCDM]+|[a-z]|[A-Z])[.)] )+|: +|\[\^[^\]]+\]: +)(?:> ?)+\+[ \t]*$/.test(line.replace(/^(?:> ?)+/, ''))
}

function firstBlockOpenerContent(line: string): boolean {
  if (!endsInPlus(line)) return false
  let rest = line.trimStart()
  for (let depth = 0; depth < 8; depth++) {
    if (isContinuationMarker(rest)) return true
    const marker = taskMatch(rest) ?? unorderedMatch(rest) ?? orderedMatch(rest)
    if (marker !== null) { rest = marker.at(-1) ?? ''; continue }
    const quote = quotedLineText(rest, false)
    if (quote !== null) { rest = quote; continue }
    return false
  }
  return false
}

const RE_BLOCKQUOTE = /^>(?:(?: |(?=(?:> ?)*\+[ \t]*$))(.*)|[\t][ \t]*|)$/
const RE_VALID_ADMONITION_OPEN = balancedLabelMatcher(
  /^(:{3,}) +([a-zA-Z0-9_][\w-]*)(?: +("[^"]*"))?(?: +(\[[^\n]*\]))?[ \t]*$/,
  [4],
)
// Invalid metadata does not erase a recognized container (carve#2693).
const RE_CONTAINER_PREFIX = /^(:{3,}) +([a-zA-Z0-9_][\w-]*)(?=$|[\s\u0085"{\[“”])[^\r\n]*$/

export function hasInvalidContainerMetadata(line: string): boolean {
  return RE_VALID_ADMONITION_OPEN.exec(line) === null && RE_CONTAINER_PREFIX.test(line)
}

const RE_ADMONITION_OPEN = {
  exec(line: string): RegExpExecArray | null {
    return RE_VALID_ADMONITION_OPEN.exec(line) ?? RE_CONTAINER_PREFIX.exec(line)
  },
  test(line: string): boolean {
    return this.exec(line) !== null
  },
}

function isFigureGroupOpener(line: string, inFigureGroup: boolean): boolean {
  const match = RE_VALID_ADMONITION_OPEN.exec(line)
  return match !== null && match[2] === 'figure' && match[3] === undefined && match[4] === undefined && !inFigureGroup
}

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
const RE_DIV_OPEN = balancedLabelMatcher(/^(:{3,}) *(\[[^\n]*\])?[ \t]*$/, [2])
const RE_DEFLIST_TERM = /^::(?!:) [ \t]*(?=[^ \t])(.+)$/

// MARKER REQUIRES CONTENT ignores TRAILING WHITESPACE, and NO TRAILING
// WHITESPACE spells whitespace `' ' | '\t'` here - so a body of nothing but
// tabs is a trailing run and opens no description. `: <TAB>` folds into the
// term, the way `:` + tab already does without the space, and the way an empty
// term marker `:: ` folds (markup-carve/carve#1836).
//
// The separator run is SPACES ONLY, so a body may still START with a tab:
// `: <TAB>text` opens with the tab as content, and a vertical tab or a no-break
// space is content too.
const RE_DEFLIST_DEF = /^:( +)(?=.*[^ \t])([^ ].*)$/

/**
 * Whether `line`, read at its own content, is a definition TERM or DESCRIPTION
 * marker line. Both patterns are anchored, so the indentation comes off first.
 */
const deflistMarkerLine = (line: string): boolean => {
  const flush = line.replace(/^[ \t]+/, '')
  return RE_DEFLIST_TERM.test(flush) || RE_DEFLIST_DEF.test(flush)
}

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
/**
 * `*[ABBR]: expansion`, the only shape a definition line has.
 *
 * Exported because the HTML importer rebuilds these from PART 10 §13a's
 * `data-carve-abbreviations` carrier: a line this does not match is not a
 * definition, and emitting one as an `abbreviation_def` would put a visible
 * paragraph into the document instead.
 */
export const RE_ABBR_DEF = /^\*\[([A-Za-z0-9]+)\]: +(?![ \t]*$)([^]+)$/u
/**
 * A link reference definition, as PART 9R's `linkDefs` symbol table describes
 * it: `label -> (url, title?, attrs?)`. `attrs` come from a TRAILING attribute
 * block on the definition line and transfer to every link that resolves the
 * label (PART 9R R1, carve#604).
 */

/**
 * The ASCII punctuation a backslash escapes into an `escaped_text` node
 * (grammar `ascii_punctuation`, the full set including `& : ; ?`).
 *
 * Exported because the HTML importer rebuilds an `escaped_text` from PART 10
 * §13a's `data-carve-escaped` carrier and has to ask the question this parser
 * asks: a character outside the set spells no escape, and writing one back
 * emits a literal backslash the source never held.
 */
export const RE_ESCAPABLE_PUNCTUATION = /[\\`*_{}\[\]()#+\-.!~^/<>@%|=,"'$&:;?]/

/**
 * `reference_definition`, whole: label, destination, optional title, optional
 * trailing attribute block, anchored at the line ending.
 *
 * The block is matched here rather than scanned off the line first (carve#604,
 * reverted by markup-carve/carve-js#1868). A scan that walks the line from its
 * start cannot tell a brace or a quote in the DESTINATION from one opening the
 * block, so `[a]: /u{x} {.c}` and `[a]: it's {.c}` both fell through to prose.
 * Matched as `\{.*\}` after exactly one space and validated below, they read
 * as the production has them. With no space the braces are destination
 * (`[a]: /u{.c}`).
 */
const RE_LINK_DEF =
  /^[ \t]*\[(?!@)([^\]]+)\]: +(\P{White_Space}+)(?: (?:"((?:[^"\\]|\\[\s\S])*)"|'((?:[^'\\]|\\[\s\S])*)'))?(?: (\{.*\}))?[ \t]*$/u
const RE_EMPTY_LINK_DEF = /^[ \t]*\[(?![@^])([^\]]+)\]:[ \t]*$/

/** A reference definition read off one line. */
export interface LinkDefMatch {
  label: string
  href: string
  title: string | undefined
  attrText: string | null
}

/**
 * The production's own test, and the only spelling of it. Every predicate here
 * that asks "is this line a definition" reads this, so narrowing the rule
 * changes all of them at once.
 */
function matchLinkDef(line: string): LinkDefMatch | null {
  const empty = RE_EMPTY_LINK_DEF.exec(line)
  if (empty !== null) return { label: empty[1]!, href: '', title: undefined, attrText: null }
  const m = RE_LINK_DEF.exec(line)
  if (m === null) return null
  const href = linkDestinationValue(m[2]!)
  if (href === null) return null
  // An invalid block is not `attributes`, so it is leftover content and the
  // anchor disposes of the line (CARVE-P3-006).
  let attrText: string | null = null
  if (m[5] !== undefined) {
    attrText = m[5].slice(1, -1)
    if (!isValidInlineAttrPayload(attrText) || isEmptyAttrs(parseAttrs(attrText))) return null
  }

  return { label: m[1]!, href, title: m[3] ?? m[4], attrText }
}

function isLinkDefLine(line: string): boolean {
  return matchLinkDef(line) !== null
}
/**
 * `[^label]: body`, the footnote definition line.
 *
 * Exported because the HTML importer rebuilds an authored label from PART 10
 * §13a's `data-carve-footnote-label` carrier and has to ask the question this
 * parser asks. A hand-spelled "no whitespace" rule was stricter than the
 * grammar and rejected `[^my note]`, which the parser reads and the exporter
 * writes.
 */
export const RE_FOOTNOTE_DEF = /^\[\^([^\]]+)\]:(?=[ \t]*[^ \t]) +([^]+)$/

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

/**
 * `text` with EVERY line's trailing space-and-tab run removed.
 */
function dropTrailingWhitespace(text: string): string {
  let from = 0
  let pieces: string[] | undefined
  for (let end = text.indexOf('\n');;) {
    if (end < 0) end = text.length
    let keep = end
    while (keep > from && (text.charCodeAt(keep - 1) === 32 || text.charCodeAt(keep - 1) === 9)) keep--
    if (keep !== end) {
      (pieces ??= []).push(text.slice(from, keep))
      from = end
    }
    if (end === text.length) break
    end = text.indexOf('\n', end + 1)
  }
  return pieces ? pieces.join('') + text.slice(from) : text
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
  // A slot is counted, not weighed (CARVE-P9-082): `||` and `| |` are one empty
  // cell, and only a lone `|` has no slot.
  return splitTableRow(rowAttrsFromLine(line).body).length > 0
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
const RE_BARE_IMAGE = /^!\[([^\]]*)\]\(([^)\s]*)(?: "((?:[^"\\]|\\[\s\S])*)"| '((?:[^'\\]|\\[\s\S])*)')?[ \t]*\)(?:\{((?:[^}"'\n]|"(?:[^"\\]|\\[\s\S])*"|'(?:[^'\\]|\\[\s\S])*')+)\})?[ \t]*$/
// Frontmatter close fence: bare `---` only.
const RE_RAW_FENCE = new RegExp('^(`{3,}|~{3,}) ?=([a-zA-Z][\\w-]*)' + FENCE_TRAILING_WS)
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

/**
 * Whether the `%%` at `i` opens the trailing inline comment form.
 *
 * A marker needs an immediately preceding SPACE or the start of its host run.
 * A line break also starts a run; tabs are content (CARVE-P9-041).
 *
 * A balanced bracket label starts a host run at `runStart`. Inside emphasis the marker
 * has the opening delimiter in front of it, which is not a separator, so
 * `/%% c/` keeps its text (corpus 518).
 */
const opensInlineComment = (text: string, i: number, atRunStart = false, runStart = 0): boolean =>
  text[i] === '%' &&
  text[i + 1] === '%' &&
  (text[i - 1] === ' ' ||
    text[i - 1] === '\n' ||
    (atRunStart && i === runStart))

/**
 * `text` with a trailing comment and its whole separating run removed, for a
 * container's `[label]`.
 *
 * The cut is on the STRING because the non-HTML targets write the label as the
 * source the author typed, so a label still carrying the comment would leak it
 * into Markdown, plain text and ANSI. WHERE it cuts is the label's own inline
 * run's answer: the run is scanned and the boundary is its top-level comment
 * node's start, so a `%%` that a closed construct scopes is not a marker here
 * either (ruled on markup-carve/carve#2618).
 *
 * Deriving it rather than restating it is the point. A second scan spelling out
 * which constructs are opaque answers differently the day one of them moves, and
 * each miss deletes visible label text - markup-carve/carve-rs#2158 found three
 * in a row that way. An escape or a nested comment needs no rule here: the run
 * has already decided, and only its own trailing comment reaches this.
 */
const stripTrailingComment = (text: string): string => {
  // A label with no marker in it cannot have a trailing comment, and most have
  // none - so the run is scanned only where the answer can differ.
  if (!text.includes('%%')) return text
  const nodes = parseRefLabelInlines(text)
  const last = nodes[nodes.length - 1]
  if (last?.type !== 'comment' || last.block) return text
  const start = last.pos?.startOffset
  return start === undefined ? text : text.slice(0, start).replace(/ +$/, '')
}
// A bare uniform fence closer, shared by native and prepass lookahead.
const RE_FENCE_CLOSER = new RegExp('^(`{3,}|~{3,})' + FENCE_TRAILING_WS)

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
  inherited?: Lexer,
): Lexer {
  const sub = new Lexer(source, opts, lineNumberOffset, unclosedContainerKeys, inherited)
  if (sourceLineMap) sub.sourceLineMap = sourceLineMap
  // A source fragment's EOF uses the same line coordinates as its payload.
  if (typeof source === 'string') sub.documentLineCount = sub.lineNumber(sub.lineCount - 1)
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
/**
 * THE LAZY FRAME (PART 9 SS10 I2, markup-carve/carve-js#1609).
 *
 * Prepended to a line a block quote admitted as LAZY continuation text. Its
 * first character is not whitespace, so the line stands at column 0 AND
 * matches no block opener at all - which is the whole difference between a
 * frame and a dedent. A dedented line still re-classifies at the column it
 * was dedented to, and that is what opened a real code fence under
 * `> - :: t` for a line the quote had already folded into the term.
 *
 * Unforgeable rather than merely unlikely: `parse` replaces every U+0000 with
 * U+FFFD before the first line is read (PART 0 INPUT), so no document can
 * spell it.
 */
const LAZY_FRAME = '\u0000L\u0000'

/**
 * A line with the LAZY frame removed.
 *
 * Every consumer that turns a line into TEXT calls this; the predicates
 * deliberately do not, because failing them is what the frame is for. The
 * def-list ENTRY matcher is the one predicate that unframes, which is PART 9
 * SS24 C3's lenient entry.
 */
function stripLazyFrame(line: string): string {
  // Nested collectors may frame the same line more than once.
  while (line.startsWith(LAZY_FRAME)) line = line.slice(LAZY_FRAME.length)
  return line
}

/** Recorded at a literal prefix strip; discard if later collection changes the text. */
export interface StrippedLineOrigin {
  text: string
  parentIndex: number
  prefix: number
  /** Virtual syntax borrows one source boundary but contributes no characters. */
  virtual?: boolean
}

function nestedSubLexer(
  parent: Lexer,
  lines: readonly string[],
  startLineIndex: number,
  sourceLineMap?: number[],
  origins?: ReadonlyMap<number, StrippedLineOrigin>,
  contiguous = false,
): Lexer {
  // The default map is parallel to the Lexer's OWN lines, which drop one
  // trailing blank (see the constructor), so it is built to that length -
  // the length `normalizedSourceLines` used to report for the joined text.
  // Parallel to the Lexer's OWN lines, which no longer drop a trailing blank
  // from an array source, so the map covers every line handed over.
  contiguous = contiguous && layoutWork.reuseColonViews
  const mapLength = lines.length
  if (layoutWork.on && !sourceLineMap && !contiguous) layoutWork.geometryEntries += mapLength
  const sub = subLexer(
    lines,
    parent.parseOptions,
    parent.lineNumberOffset + startLineIndex,
    sourceLineMap ?? (contiguous ? undefined : Array.from({ length: mapLength }, (_l, i) => parent.lineNumber(startLineIndex + i))),
    parent.unclosedContainerKeys,
    parent,
  )
  sub.columnParent = parent
  sub.columnOrigins = origins
  sub.usesContainerFenceLookahead = true
  sub.nested = true
  sub.documentLineCount = parent.documentLineCount
  sub.documentLacksFinalBreak = parent.documentLacksFinalBreak
  sub.rootLines = parent.rootLines ?? parent.lines
  sub.depth = parent.depth + 1
  sub.inFigureGroup = parent.inFigureGroup
  sub.inFootnoteBody = parent.inFootnoteBody
  sub.hostBody = parent.hostBody
  sub.hostMarkerColumn = parent.hostMarkerColumn
  sub.hostContentColumn = parent.hostContentColumn
  sub.hostQuoteDepth = parent.hostQuoteDepth
  sub.nonAuthoredDefinitionStarts = parent.nonAuthoredDefinitionStarts
  sub.returnedDescriptionOwnerColumns = parent.returnedDescriptionOwnerColumns
  sub.definitionLeadFromItemMarker = parent.definitionLeadFromItemMarker
  sub.consumesHostedLinkDefs = parent.consumesHostedLinkDefs
  if (contiguous) {
    const origin = parent.contiguousOrigin
    sub.contiguousOrigin = { lexer: origin?.lexer ?? parent, start: (origin?.start ?? 0) + startLineIndex }
  } else {
    attachDocumentOffsets(sub, parent, startLineIndex, origins)
  }
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
function attachDocumentOffsets(sub: Lexer, parent: Lexer, startLineIndex: number, origins?: ReadonlyMap<number, StrippedLineOrigin>): void {
  // A parent whose own offsets are local cannot anchor a child: the child would
  // inherit local numbers and believe they were document ones, which is how a
  // list inside a `+`-continued blockquote reported "\n- i" for the text "item".
  if (!parent.hasDocumentOffsets) return
  const offsets: number[] = []
  const widths: number[] = []
  const boundaries: NonNullable<Lexer['sourceBoundaries']> = []
  const prefixMemoLines: boolean[] = []

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

  for (let i = 0; i < sub.lineCount; i++) {
    if (layoutWork.on) layoutWork.geometryEntries++
    const mapped = sub.sourceLineMap?.[i]
    const subLine = sub.lineAt(i)
    if (subLine === undefined) return
    const origin = origins?.get(i)
    if (origin && origin.text === subLine && origin.parentIndex >= previousIndex &&
        (mapped === undefined || mapped === parent.lineNumber(origin.parentIndex))) {
      const parentIndex = origin.parentIndex
      previousIndex = parentIndex
      boundaries.push({ parent, line: parentIndex, start: origin.prefix, synthetic: origin.virtual ? subLine.length : 0 })
      const lead = leadingWhitespace(subLine)
      const anchor = parent.sourceBoundary(parentIndex, origin.prefix + lead)
      offsets.push(anchor.offset - lead)
      widths.push(anchor.column - 1 - lead)
      prefixMemoLines.push(!origin.virtual && parent.prefixMemoAllowed(parentIndex))
      if (!origin.virtual) {
        sub.inheritTerminatorFree(i, parent, parentIndex)
        sub.inheritLeadingWhitespace(i, parent, parentIndex, origin.prefix)
      }
      continue
    }
    let literalSuffix: boolean | undefined
    // A LAZY-FRAMED LINE IS STILL PLACEABLE (markup-carve/carve-js#1624). The
    // frame is three characters no document can spell, prepended by the quote
    // collector, and the line's indentation is stripped with it - so the frame
    // makes the sub-line neither a suffix of its document line nor a
    // synthetic-indent case, and this used to decline the whole sub-lexer.
    // Declining costs every position under it: the folded paragraph and each of
    // its inlines came out with no `pos` at all, while the containers above
    // ended at the line before the text they own. The real content IS a suffix,
    // which is all an anchor needs.
    const unframed = stripLazyFrame(subLine)
    const framed = unframed !== subLine
    const anchorsTo = (candidate: number): boolean => {
      const parentLine = parent.lineAt(candidate) ?? ''
      literalSuffix = parentLine.endsWith(subLine)
      return (
        literalSuffix ||
        parentLine.endsWith(withoutSyntheticIndent(subLine)) ||
        (framed && parentLine.endsWith(unframed))
      )
    }
    const parentIndex =
      mapped === undefined
        ? startLineIndex + i
        : (parentLineIndices(parent).get(mapped) ?? []).find(
            (candidate) => candidate >= previousIndex && anchorsTo(candidate),
          )
    if (parentIndex === undefined) return declinePositions(sub)
    // Document order must not go backwards, or a block spanning first-to-last
    // line reports an end before its start. A map that jumps back is one this
    // cannot reason about, so it declines rather than emitting that.
    if (i > 0 && parentIndex < previousIndex) return declinePositions(sub)
    previousIndex = parentIndex
    const parentLine = parent.lineAt(parentIndex)
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
    const isLiteralSuffix = literalSuffix ?? parentLine.endsWith(subLine)
    if (isLiteralSuffix) {
      sub.inheritTerminatorFree(i, parent, parentIndex)
      sub.inheritLeadingWhitespace(i, parent, parentIndex, parentLine.length - subLine.length)
    }
    prefixMemoLines.push(isLiteralSuffix && (parent.prefixMemoAllowed(parentIndex)))
    let prefix = parentLine.length - subLine.length
    let synthetic = 0
    if (framed && parentLine.endsWith(unframed)) {
      // The frame occupies no source, so the anchor is the unframed content's
      // own prefix - the three characters are charged nowhere. The frame is
      // gone before any length is measured off this line: the paragraph
      // collector strips it as it pushes, which is where a framed line becomes
      // text.
      prefix = parentLine.length - unframed.length
      synthetic = subLine.length - unframed.length
    } else if (!isLiteralSuffix) {
      // Only reached when the line is NOT a literal suffix, which is the
      // straddling-tab case alone - so the synthetic-indent trim is computed
      // here rather than for every line.
      const trimmed = withoutSyntheticIndent(subLine)
      synthetic = subLine.length - trimmed.length
      if (synthetic === 0 || !parentLine.endsWith(trimmed)) return declinePositions(sub)
      prefix = parentLine.length - trimmed.length
      // The residual indentation is a view of the boundary after the tab.
      // It advances no authored source codepoint.
    }

    // A parent frame has already been excluded from its source offset.
    if (!parent.sourceBoundaries?.[parentIndex] && !parent.contiguousOrigin) {
      prefix -= parentLine.length - stripLazyFrame(parentLine).length
    }

    if (boundaries.length <= i) boundaries.push({ parent, line: parentIndex, start: prefix, synthetic })

    const lead = leadingWhitespace(subLine)
    const anchor = parent.sourceBoundary(parentIndex, prefix + Math.max(0, lead - synthetic))
    const offset = anchor.offset - lead
    const width = anchor.column - 1 - lead
    // The virtual base may be negative when synthetic indentation precedes
    // the first source character. Only the projected boundary must be valid.
    if (anchor.offset < 0) return declinePositions(sub)

    // Inline scanners add local indexes to these virtual bases.
    offsets.push(offset)
    widths.push(width)
  }

  sub.prefixMemoLines = prefixMemoLines
  sub.sourceOffsetMap = offsets
  sub.linePrefixWidths = widths
  sub.sourceBoundaries = boundaries
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
  for (let i = 0; i < lexer.lineCount; i++) {
    const number = lexer.lineNumber(i)
    const bucket = built.get(number)
    if (bucket) bucket.push(i)
    else built.set(number, [i])
  }
  lexer.lineIndicesByNumber = built
  return built
}

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

// Shared only for the synchronous recursion budget: extensions can re-enter
// public parse(), whose document state belongs to a separate session.
let inlineDepth = 0

export function parse(source: string, opts: ParseOptions = {}): Document {
  return new ParseSession().parse(source, opts)
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
    node.pos = definitionLinePosition(
      lexer.lines, lexer.sourceOffsetMap ?? lexer.lineOffsets, def.line, source.length,
      lexer.lineStartColumn(def.line),
    )
    authored.push(node)
  }
  authored.sort((a, b) => (a.pos?.startOffset ?? 0) - (b.pos?.startOffset ?? 0))
  children.push(...authored)
}


/**
 * Normalize an explicit `[label]: url` reference label for matching:
 * whitespace-collapsed but case-SENSITIVE. Djot does "no case normalization
 * on reference definitions" (links_and_images spec), and Carve keeps a
 * case-mismatched reference unresolved -> literal (corpus 36). Implicit
 * heading references match heading TEXT exactly too, adding NFC (heading-ids.ts).
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
  let offset = 0
  for (;;) {
    const before = offset
    let quote = offset
    while (raw[quote] === ' ' || raw[quote] === '\t') quote++
    if (raw[quote] === '>' && (raw[quote + 1] === ' ' || quote + 1 === raw.length)) {
      offset = Math.min(quote + 2, raw.length)
    }
    RE_PREPASS_MARKER_STRIP_AT.lastIndex = offset
    const marker = RE_PREPASS_MARKER_STRIP_AT.exec(raw)
    if (marker && (marker[2] === undefined || isValidInlineAttrPayload(marker[2]))) {
      offset += marker[0].length
    }
    if (afterTerm) {
      RE_DESCRIPTION_PREFIX_AT.lastIndex = offset
      const description = RE_DESCRIPTION_PREFIX_AT.exec(raw)
      if (description) offset += description[0].length
    }
    if (offset === before) return raw.slice(offset)
  }
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
const RE_PREPASS_MARKER =
  /^([ \t]*)(?:[-*]|(?:[0-9]+|[ivxlcdm]+|[IVXLCDM]+|[a-z]|[A-Z]|(?=\.))[.)])(?:\{([^}]*)\})? +/
// The same marker with a task box after it, for the `afterMarker` strip below.
const RE_PREPASS_MARKER_STRIP =
  /^([ \t]*)(?:[-*]|(?:[0-9]+|[ivxlcdm]+|[IVXLCDM]+|[a-z]|[A-Z]|(?=\.))[.)])(?:\{([^}]*)\})? +(?:\[[ xX\-_>?]\] +)?/

const RE_PREPASS_MARKER_STRIP_AT = new RegExp(RE_PREPASS_MARKER_STRIP.source.slice(1), 'y')
const RE_DESCRIPTION_PREFIX_AT = new RegExp(RE_DESCRIPTION_PREFIX.source.slice(1), 'y')

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
export interface PrepassScope {
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
 * instead:
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
      // definitions in the sample below. The cap keeps
      // it O(the column) rather than O(the indentation run).
      indentColumns(view, scope.contentCol) >= scope.contentCol)
  )
}

/**
 * Does the prepass's view of a line START A BLOCK, so that no paragraph is left
 * open below it?
 */
function prepassOpensBlock(
  line: string,
  // A BARE `+` NAMES A BLOCK ONLY INSIDE SOMETHING. §17 L3 attaches it to the
  // container that holds it, and at document level nothing holds it: every reader
  // renders a lone `+` as prose there, whatever stands above it. Read as an
  // opener anyway, it declared the paragraph over, so the marker below it opened
  // a real item and that item's definition registered while the page printed the
  // whole run as text (carve-js#2310). Only the caller holding the container
  // stack passes this; everywhere else the line is all there is.
  plusOpens = true,
): boolean {
  return (
    line === '' ||
    lineOpensBlock(line) ||
    RE_COMMENT_LINE.test(line) ||
    isBlockAttributeLine(line) ||
    (plusOpens && isContinuationMarker(line)) ||
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
export interface OpenContainer {
  col: number
  quote: boolean
  /** The column the container's own marker starts at. */
  base: number
}

/** One container peeled off a line's own prefix by `composeContainerPrefix`. */
interface PeeledContainer {
  /** The column the container's content starts at. */
  content: number
  quote: boolean
  /** Whether it CONTINUES a container already open, rather than opening one. */
  matched: boolean
  /** The column this marker itself starts at. */
  marker: number
  /**
   * Whether this marker FOLDS into the open item's lead text instead of
   * opening one. PART 9 §24 C3: below an item's content column no opener
   * nests, and at the base column a marker starts a sibling - so the fold
   * window is the columns strictly BETWEEN the two, and nowhere else
   * (markup-carve/carve-js#1598).
   *
   * A marker that folds opens NOTHING, so the container stack does not move
   * under it either.
   */
  folds: boolean
  /**
   * Whether the walk was standing in a QUOTE this line did not re-mark. The
   * line never reached the list inside that quote, so its marker is the
   * quote's lazy paragraph text whatever column it sits at - a different
   * question from the item window above, and one the container stack answers
   * on its own.
   */
  behindQuote: boolean
}

/**
 * Peel a line's container prefix the way PART 9 §24 C5 hands a body down, and
 * report the column the line's own content starts at.
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
  // Set once a marker closes the open container it stands at: past that the
  // line is inside the new item, and no deeper open container is re-entered.
  let closed = false
  for (;;) {
    const rest = raw.slice(pos)
    const ind = leadingWhitespace(rest)
    const col = pos + ind
    while (!closed && depth < open.length && !open[depth]!.quote && open[depth]!.col <= col) {
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
      peeled.push({ content, quote: true, matched, marker: col, folds: false, behindQuote: false })
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
    const matched = !closed && depth < open.length && !open[depth]!.quote && open[depth]!.col === content
    // THE CONTAINER THIS MARKER IS WRITTEN INSIDE, if the walk is still
    // standing in one. An ITEM folds the marker into its lead text over the
    // columns strictly between its base and its content column, and nowhere
    // else. A QUOTE the line did not re-mark is a different answer, kept apart
    // from the window: the marker is that quote's lazy text whatever its
    // column, but the container stack still moves under it. Past the last open
    // container there is no owner and the marker nests.
    const owner = !closed && depth < open.length ? open[depth]! : null
    const behindQuote = owner !== null && owner.quote
    const folds = owner !== null && !owner.quote && col > owner.base && col < owner.col
    if (matched) depth++
    else if (owner !== null && !owner.quote && !folds) closed = true
    peeled.push({ content, quote: false, matched, marker: col, folds, behindQuote })
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
      last.type === 'admonition' || last.type === 'directive' ||
      last.type === 'figure_group' || last.type === 'line_block'
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
  while (start >= 0 && !isBlankLine(lexer.lineAt(start)!)) start--
  start++
  if (start === candidate) return null
  let runBytes = 0
  for (let i = start; i < candidate; i++) runBytes += utf8ByteLength(lexer.lineAt(i)!) + 1
  return { start, cost: runBytes * 2 + utf8ByteLength(lexer.lineAt(candidate)!) }
}

function spendLazyProbeBudget(lexer: Lexer, candidate: number, budget: number): number {
  const priced = lazyProbeCost(lexer, candidate)
  return priced && priced.cost <= budget ? budget - priced.cost : budget
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
export interface PendingAttrCarry {
  attrs: Attrs | null
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

/** A `{table}`-marked csv/tsv code block outside the parser (a code include, I1c), converted as an authored fence is. */
export function markedDelimitedTable(code: CodeBlock): Table | null {
  if (code.attrs?.keyValues?.table !== '') return null
  const table = delimitedTable(code, code.attrs)
  if (table) deriveTableMetadata(table)
  return table
}

function deriveTableMetadata(table: Table): void {
  const columns = tableColumnsFromAttrs(table.attrs)
  if (columns) table.columns = columns
  const attrs = table.sourceFormat && table.attrs?.keyValues?.['header-rows'] === undefined &&
    ['footer-rows', 'body-rows', 'body-header-rows', 'body-header-cols'].some(key => table.attrs?.keyValues?.[key] !== undefined)
    ? { ...table.attrs, keyValues: { ...(table.attrs?.keyValues ?? {}), 'header-rows': String(table.rows.filter((row) => row.cells[0]?.header).length) } }
    : table.attrs
  const rowGroups = tableRowGroupsFromAttrs(attrs, table.rows.length)
  if (rowGroups) table.rowGroups = rowGroups
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
  return probeBlockAttributes(lexer, firstLine) !== null
}

function tryCollectBlockAttributes(lexer: Lexer): Attrs | null {
  const result = probeBlockAttributes(lexer)
  if (!result) return null
  for (let k = 0; k < result.count; k++) lexer.consume()
  return result.attrs
}

function probeBlockAttributes(lexer: Lexer, firstLine?: string): { attrs: Attrs; count: number } | null {
  // The override changes the opening-column test; continuation lines still
  // come from this lexer, as they did in the paragraph classifier.
  if (!/^\{/.test(firstLine ?? lexer.peek()!)) return null
  let collected = ''
  let count = 0
  for (;;) {
    const line = lexer.peek(count)
    if (line === undefined || (count > 0 && isBlankLine(line))) return null
    const closed = line.includes('}')
    // A continuation is a complete attribute fragment: quoted values cannot
    // cross a newline. Reject a later opener before re-reading its whole tail.
    if (count > 0 && !closed && !isValidAttrPayload('\n' + line + '\n')) return null
    collected += (count === 0 ? '' : '\n') + line
    count++
    if (closed) {
      const attrs = parseBlockAttributeRun(collected)
      return attrs ? { attrs, count } : null
    }
  }
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
      for (const [k, v] of Object.entries(attrs.keyValues)) setOwn(keyValues, k, v)
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

/*
 * A CONTAINER ENDS AT ITS LAST PLACED CHILD (PART 12 §4, markup-carve/carve#1522
 * and markup-carve/carve#1524).
 */
// Parser-only ownership: a closed fenced quote keeps its closer even when
// its children are empty or hoisted (CARVE-P12-014, carve-js#2345).
const explicitlyClosedQuotes = new WeakSet<object>()

const ENDS_AT_LAST_PLACED_CHILD = new Set([
  'block_quote',
  'definition_list',
  'heading',
  'list',
  'list_item',
])

/*
 * The block types whose span may begin PART WAY INTO the leading indentation,
 * mirroring `INDENT_LATITUDE` in the spec's `scripts/spec/ast-positions.mjs`.
 *
 * The indent is what places a nested item's marker, so a CONTAINER's span
 * legitimately starts inside it - at its parent's content column. A LEAF has no
 * child to place, so PART 12 §4 reads literally there and its span begins at
 * its own markup (markup-carve/carve#1928, ruled for this engine as
 * markup-carve/carve-js#1631).
 *
 * A TYPE SET rather than "has children", for the reason the spec gives: an
 * EMPTY container is still a container, and a leaf that happens to hold inline
 * children is still reached by its own markup.
 */
const INDENT_LATITUDE = new Set([
  'admonition',
  'block_quote',
  'definition_list',
  'directive',
  'div',
  'line_block',
  'list',
  'list_item',
  'table',
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
  if (lexer.suppressPositions || lexer.parseOptions.positions === false) return
  const endLineIndex = Math.max(startLineIndex, endLineIndexExclusive - 1)
  // A LAZY-FRAMED end line carries three codepoints the source never held (the
  // #1630 frame that keeps a container-folded closer from closing an
  // unterminated fence). `lineOffset`/`lineStartColumn` already anchor to the
  // UNFRAMED content (attachDocumentOffsets discounts the frame from the line's
  // prefix), so the end must be measured from the unframed length too - counting
  // the frame here leaked its width into every span whose end fell on a framed
  // line, running a fence's end three columns past its last character and its
  // end offset past document length (carve-js#1963, mirroring carve-rs#1559).
  const rawEndLine = lexer.lineAt(endLineIndex) ?? ''
  const endLine = stripLazyFrame(rawEndLine)
  const opening = lexer.sourceBoundary(startLineIndex, 0)
  const ending = lexer.sourceBoundary(
    endLineIndex,
    rawEndLine !== endLine && (lexer.sourceBoundaries?.[endLineIndex] || lexer.contiguousOrigin)
      ? rawEndLine.length : endLine.length,
  )
  node.pos = {
    startLine: lexer.lineNumber(startLineIndex),
    endLine: lexer.lineNumber(endLineIndex),
    startColumn: opening.column,
    endColumn: ending.column,
    startOffset: opening.offset,
    endOffset: ending.offset,
  }
  const type = (node as { type?: string }).type
  // A LEAF BEGINS AT ITS MARKUP. The line offset above is the start of the
  // LINE, which for an indented leaf is the first space of a run that places
  // nothing - a `comment` at a description body's column started on the fourth
  // space rather than on its `%`. Containers keep the latitude and are excluded;
  // `paragraph` is in neither camp and is overwritten by its first inline below.
  if (type !== undefined && !INDENT_LATITUDE.has(type)) {
    const startLine = lexer.lineAt(startLineIndex) ?? ''
    const lead = leadingWhitespace(startLine)
    if (lead > 0) {
      const marker = lexer.sourceBoundary(startLineIndex, lead)
      node.pos.startOffset = marker.offset
      node.pos.startColumn = marker.column
    }
  }
  if (type === 'list' || type === 'list_item') {
    const startLine = lexer.lineAt(startLineIndex) ?? ''
    const lead = leadingWhitespace(startLine)
    const documentLine = (lexer.rootLines ?? lexer.lines)[node.pos.startLine - 1]
    const behindMarkup = documentLine !== undefined && /\S/.test(documentLine.slice(0, Math.max(0, opening.column - 1)))
    if (lead > 0 && (lexer.sublistsCarryAuthoredBase || behindMarkup || (lexer.sourceBoundaries?.[startLineIndex]?.synthetic ?? 0) > 0)) {
      const marker = lexer.sourceBoundary(startLineIndex, lead)
      node.pos.startColumn = marker.column
      node.pos.startOffset = marker.offset
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
  if (type !== undefined && ENDS_AT_LAST_PLACED_CHILD.has(type) && !explicitlyClosedQuotes.has(node)) {
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
      const startLine = lexer.lineAt(startLineIndex) ?? ''
      const lead = leadingWhitespace(startLine)
      const marker = EMPTIED_CONTAINER_MARKUP[type]!.exec(startLine.slice(lead))?.[0]?.length ?? 0
      node.pos.endLine = node.pos.startLine
      const end = lexer.sourceBoundary(startLineIndex, lead + marker)
      node.pos.endColumn = end.column
      node.pos.endOffset = end.offset
    }
  }
  // A continuation marker below this admonition's authored column belongs to
  // its enclosing item. The colon-body scanner may consume that line while
  // looking for a closer, but it is not part of this node's source extent.
  if (type === 'admonition' && endLineIndexExclusive > startLineIndex + 1) {
    const lastIndex = endLineIndexExclusive - 1
    const lastLine = lexer.rootLines?.[lexer.lineNumber(lastIndex) - 1] ?? lexer.lineAt(lastIndex) ?? ''
    const plusColumn = lastLine.indexOf('+') + 1
    if (/^(?:[ \t]*>[ \t]*)*[ \t]*\+[ \t]*$/.test(lastLine) && plusColumn > 0 && plusColumn < node.pos.startColumn!) {
      const children = (node as { children?: Array<{ pos?: Position }> }).children ?? []
      const lastChild = [...children].reverse().find((child) => child.pos !== undefined)?.pos
      if (lastChild) {
        node.pos.endLine = lastChild.endLine
        if (lastChild.endColumn !== undefined) node.pos.endColumn = lastChild.endColumn
        if (lastChild.endOffset !== undefined) node.pos.endOffset = lastChild.endOffset
      } else {
        const end = lexer.sourceBoundary(startLineIndex, (lexer.lineAt(startLineIndex) ?? '').length)
        node.pos.endLine = node.pos.startLine
        node.pos.endColumn = end.column
        node.pos.endOffset = end.offset
      }
    }
  }
}

// Raw passthrough block: ```=FORMAT … ``` . Content is verbatim; the
// renderer emits it only when FORMAT matches the output (html).
function parseRawBlock(lexer: Lexer): RawBlock {
  const start = lexer.pos
  const m = RE_RAW_FENCE.exec(lexer.consume())!
  const marker = m[1]!
  const format = m[2]!
  const closeRe = fenceCloseRe(marker)
  const lines: string[] = []
  let lastPayloadLineIndex = -1
  let closed = false
  while (!lexer.eof()) {
    if (lexer.attachmentBoundaries.has(lexer.lineNumber(lexer.pos))) break
    const ln = lexer.peek()!
    if (closeRe.test(ln)) {
      lexer.consume()
      closed = true
      break
    }
    lastPayloadLineIndex = lexer.pos
    lexer.consume()
    // SAME AS `parseFence`, and for the same reason: the frame did its work in
    // the closer test above, keeping a closing run the CONTAINER folded in from
    // closing this block, and a verbatim body is where a framed line becomes
    // text. Without this the sentinel reached rendered raw output on 180 of 400
    // nested raw-fence documents - a `=FORMAT` lead is a fence too, so the
    // collector frames its folded lines exactly as it does a code fence's.
    lines.push(stripLazyFrame(ln))
  }
  if (!closed) lexer.reportUnclosedCodeFence(start, marker, 0)
  const terminated = !lexer.documentLacksFinalBreak || lastPayloadLineIndex < 0 || lexer.lineNumber(lastPayloadLineIndex) < lexer.documentLineCount
  return { type: 'raw_block', format, content: codeContent(lines, terminated) }
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
// quadratic path this index exists to close.
//
// Too narrow, an opener is told no closer exists and swallows the rest of the
// document past a closer that is really there. So this constant follows the
// real matcher whenever the real matcher WIDENS, and may lag it only when it
// narrows.
const RE_ANY_FENCE_CLOSER = new RegExp('^[ \\t]*(`{3,}|~{3,})' + FENCE_TRAILING_WS)

const RE_PREPASS_ANY_FENCE_CLOSER = new RegExp(
  '^(?:[ \\t]*>)*[ \\t]*(?:(?:[-*+]|[0-9]+[.)]|[A-Za-z][.)])[ \\t]+)*[ \\t]*(`{3,}|~{3,})' + FENCE_TRAILING_WS,
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
export interface CloserIndex {
  comment: Pick<ReadonlyMap<number, number>, 'get'>
  colon: Pick<ReadonlyMap<number, number>, 'get'>
  code: Map<string, { runs: number[]; lastAtLeast: number[] }>
  scopedCode?: (marker: string, after: number) => boolean
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
function buildCodeCloserIndex(lines: readonly string[], re: RegExp): CloserIndex['code'] {
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
  return finishCodeCloserIndex(codeLast)
}

function finishCodeCloserIndex(codeLast: Map<string, Map<number, number>>): CloserIndex['code'] {
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

function buildCloserIndex(lines: readonly string[]): CloserIndex {
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
  if (!lexer.fenceCloserIndex && lexer.contiguousOrigin) {
    const { lexer: origin, start } = lexer.contiguousOrigin
    if (!origin.scopedFenceCloserIndex) {
      if (layoutWork.on) layoutWork.closerLines += origin.lineCount
      origin.scopedFenceCloserIndex = new ScopedFenceClosers(origin.lines, RE_ANY_FENCE_CLOSER, RE_COMMENT_BLOCK_ANY, RE_ANY_COLON_CLOSER)
    }
    const shared = origin.scopedFenceCloserIndex
    const end = start + lexer.lineCount
    const last = (kind: 'comment' | 'colon') => ({ get(width: number): number | undefined {
      const at = shared.last(kind, width, start, end)
      return at === undefined ? undefined : at - start
    } })
    lexer.fenceCloserIndex = { comment: last('comment'), colon: last('colon'), code: new Map(),
      scopedCode: (marker, after) => shared.codeIn(marker, start + after + 1, end) }
  }
  lexer.fenceCloserIndex ??= buildCloserIndex(lexer.lines)

  return lexer.fenceCloserIndex
}

/** Whether a code/raw closer for `marker` may occur after line index `after`. */
function codeCloserPossible(index: CloserIndex, marker: string, after: number): boolean {
  return index.scopedCode ? index.scopedCode(marker, after) : codeCloserPossibleIn(index.code, marker, after)
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
function exactCloserPossible(last: Pick<ReadonlyMap<number, number>, 'get'>, len: number, after: number): boolean {
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
  //     about, one quote deeper.
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
 */
function commentRunLines(lexer: Lexer): Map<number, { line: number; depth: number }[]> {
  if (lexer.commentRunLines !== undefined) return lexer.commentRunLines
  const m = new Map<number, { line: number; depth: number }[]>()
  for (let i = 0; i < lexer.lineCount; i++) {
    const raw = lexer.lineAt(i)!
    const afterTerm = RE_AFTER_TERM.test(stripContainerPrefixes(lexer.lineAt(i - 1) ?? ''))
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

/** Remember each container boundary across its comment openers. */
export type CommentScopeMemo = Map<string, { from: number; end: number }>

/**
 * The first line after `from` at which the opener's container is over.
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
  let end = lexer.lineCount
  for (let i = from + 1; i < lexer.lineCount; i++) {
    const raw = lexer.lineAt(i)!
    // The blank-line half first: it is two array reads, where the quote and
    // column measurements below are regexes, and it rejects almost every line.
    if (isBlankLine(raw) || !isBlankLine(lexer.lineAt(i - 1) ?? '')) continue
    // AND A CONTINUATION MARKER IS NOT A DEPARTURE. `+` at column 0 after a
    // blank line attaches the next block to the item rather than ending it
    // (PART 17), so the fence is still inside its container and the closer
    // below the marker is still its own. Taken as the boundary, the region
    // never opened and the definition inside it went live while the comment
    // body above it stayed invisible - the leak, one marker over.
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
 */
function quotedCommentHasCloser(lexer: Lexer, fence: number, fromIndex: number): boolean {
  for (let i = fromIndex + 1; i < lexer.lineCount; i++) {
    const quoted = RE_BLOCKQUOTE.exec(lexer.lineAt(i)!)
    if (!quoted) return false
    const run = RE_COMMENT_BLOCK_ANY.exec(quoted[1] ?? '')
    if (run && run[1]!.length === fence) return true
  }

  return false
}

function literalCommentHasCloser(lexer: Lexer, width: number, from: number, depth: number, floor: number): boolean {
  const cache = lexer.literalCommentClosers ??= new Map()
  let run = cache.get(depth)
  if (run === undefined || from < run.start || from >= run.end) {
    const start = depth < 0 ? 0 : from
    let end = start
    const columns: number[] = []
    const widths: Array<number | undefined> = []
    for (; end < lexer.lineCount; end++) {
      const line = lexer.lineAt(end)!
      let at = 0
      for (let level = 0; level <= depth; level++) {
        const prefix = quotePrefixLength(line, at, line.length)
        if (prefix === 0) { at = -1; break }
        at += prefix
      }
      if (at < 0) break
      const content = line.slice(at)
      columns.push(isBlankLine(content) || RE_COMMENT_LINE.test(content) ? Infinity : indentColumns(content))
      widths.push(commentFenceRun(content))
    }
    run = { start, end, index: new LiteralCommentClosers(columns, widths) }
    cache.set(depth, run)
  }
  return run.index.hasCloser(width, from - run.start, floor)
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
 * the bound never advanced, so the lookahead stayed quadratic.
 */
interface FenceCloserMemoEntry {
  from: number
  end?: number
  maxRun: number
}
export type QuotedFenceCloserMemo = Map<string, FenceCloserMemoEntry>

/**
 * Find a code or raw fence closer within this list item. The memo uses only
 * the fence character as its key. A column key diverged from the
 * executable spec; re-measure before changing it.
 */
function itemFenceHasCloser(
  lexer: Lexer,
  marker: string,
  fromIndex: number,
  contentCol: number,
  memo: QuotedFenceCloserMemo,
  // Where the container has ended, so nothing further is this fence's to
  // close. The memo stays sound because that line does not depend on which
  // opener asked.
  endsContainer: (line: string, afterBlank: boolean, index: number) => boolean,
  columnAt?: (index: number) => number | undefined,
  literalPayload = false,
  quoteDepth?: number,
  quoteColumn = 0,
  alternateCloserColumn?: number,
): boolean {
  const char = marker[0]!
  const start = fromIndex + 1
  if (fenceCloserMemoRefutes(memo, char, marker.length, start)) return false
  const closeRe = fenceCloseRe(marker)
  let maxRun = 0
  let afterBlank = false
  for (let i = start; i < lexer.lineCount; i++) {
    if (columnAt && layoutWork.on) layoutWork.closerLines++
    const line = lexer.lineAt(i)!
    if (endsContainer(line, afterBlank, i)) break
    if (isBlankLine(line)) {
      afterBlank = true
      continue
    }
    afterBlank = false
    const column = columnAt ? columnAt(i) : alternateCloserColumn === undefined ? indentColumns(line, contentCol) : indentColumns(line)
    if (column === undefined || column < contentCol || (columnAt && column !== contentCol)) continue
    if (alternateCloserColumn !== undefined && column !== contentCol && column !== alternateCloserColumn) continue
    let dedented = literalPayload ? line.replace(/^[ \t]+/, '') : columnAt ? line.slice(lexer.lineLeadingWhitespace(i)) : sliceColumns(line, contentCol, true)
    if (column === alternateCloserColumn) dedented = dedented.trimStart()
    if (quoteDepth !== undefined) {
      dedented = sliceColumns(line, contentCol, true)
      let missing = false
      for (let depth = 0; depth <= quoteDepth; depth++) {
        const width = quotePrefixLength(dedented, 0, dedented.length)
        if (width === 0) { missing = true; break }
        dedented = dedented.slice(width)
      }
      if (missing) continue
      const indent = indentColumns(dedented)
      if (quoteColumn >= 0 && indent !== quoteColumn) continue
      if (quoteColumn === -2 && indent === 0) continue
      dedented = dedented.replace(/^[ \t]+/, '')
    }
    if (closeRe.test(dedented)) return true
    const closer = RE_FENCE_CLOSER.exec(dedented)
    if (closer && closer[1]![0] === char) maxRun = Math.max(maxRun, closer[1]!.length)
  }
  memo.set(char, { from: start, maxRun })

  return false
}

/**
 * A line's content with every leading list marker walked off.
 *
 * AN OPENER MAY BE WRITTEN ON A MARKER LINE, and only where a block may begin:
 * `:  - ``` ` opens a code block, while the same marker-shaped line with no blank
 * above it folds into the open paragraph (§10 I2) and opens nothing.
 */
function markerFreeContent(line: string): string {
  // A CHARACTER OFFSET, not a column strip. `markerContentColumn` measures the
  // marker's width on the flushed line, and `sliceColumns` only removes
  // whitespace, so it cannot walk a marker off.
  let content = line.replace(/^[ \t]+/, '')
  for (;;) {
    // AN ABUTTING ATTRIBUTE COMES OFF FIRST, because that is the spelling
    // `markerContentColumn` measures: it reports the width of `-{.x} ` with the
    // braces already gone, so slicing the ORIGINAL line by it lands inside the
    // attribute and the rest of the line reads as prose.
    const attr = extractItemAttr(content)
    const marked = attr ? attr.stripped : content
    // THE CHECKBOX GOES WITH THE MARKER. `markerContentColumn` reports a task's
    // content column as the bullet's width, which is what §17 measures a body
    // against - but the box is part of what the marker writes, and a fence behind
    // one opens the same block a bare bullet's does.
    const task = RE_TASK.exec(marked)
    if (task !== null) {
      content = task[task.length - 1]!.replace(/^[ \t]+/, '')
      continue
    }
    const width = markerContentColumn(marked)
    if (width <= 0) return content
    content = marked.slice(width).replace(/^[ \t]+/, '')
  }
}

/**
 * Does a container's own collected stream hold an OPEN comment span? -- §28,
 * markup-carve/carve#2488.
 *
 * A container ends at a comment written below its content column, which is right
 * for an OPENER and for the `%%` line form and wrong INSIDE a span the container
 * already holds: §28 pairs the delimiters, indentation is part of neither
 * (markup-carve/carve#2471), and everything between them is payload. Ending there
 * split the span, the container's own parse then read an opener with no closer -
 * one `%%` line comment - and PUBLISHED the payload while dropping both
 * delimiters.
 *
 * The caller still asks the SHAPE. Only a comment-shaped line is exempt: a payload
 * line below the column is not comment-shaped, so §24 C3 still hands it to the
 * enclosing parse.
 *
 * ASKED OF THE COLLECTED LINES, not of a fence tracker's flag. The trackers read
 * each line at the container's dedent and their opener tests refuse an indented
 * run, so a span a DESCENDANT holds is invisible to them.
 *
 * A verbatim fence's payload is opaque, so a `%%%` written inside one is content.
 */
/**
 * One container's resumable walk. A collector only ever APPENDS to its own line
 * array, so a walk that read the first `index` of them needs to read no line
 * twice - which is what keeps a container holding many spans linear instead of
 * re-reading its whole body per delimiter.
 */
interface CommentSpanScan {
  index: number
  opaque: { comment: boolean; char: string; run: number } | null
  atBlockStart: boolean
}

const newCommentSpanScan = (): CommentSpanScan => ({ index: 0, opaque: null, atBlockStart: true })

function bodyHoldsOpenCommentSpan(
  lines: readonly string[],
  scan: CommentSpanScan,
  // Openers with no closer anywhere: each is one line comment (§28) and opens no span.
  degraded?: ReadonlySet<number>,
): boolean {
  for (; scan.index < lines.length; scan.index++) {
    const line = stripLazyFrame(lines[scan.index]!).replace(/^[ \t]+/, '')
    const open = scan.opaque
    if (open !== null) {
      let closed = false
      if (open.comment) closed = commentFenceRun(line) === open.run
      else {
        const run = RE_FENCE_CLOSER.exec(line)
        closed = run !== null && run[1]![0] === open.char && run[1]!.length >= open.run
      }
      if (closed) {
        scan.opaque = null
        scan.atBlockStart = true
      }
      continue
    }
    if (line === '') {
      scan.atBlockStart = true
      continue
    }
    const opener = scan.atBlockStart ? markerFreeContent(line) : line
    scan.atBlockStart = false
    const code = RE_FENCE.exec(opener) ?? RE_RAW_FENCE.exec(opener)
    if (code !== null) {
      const marker = RE_FENCE.test(opener) ? code[2]! : code[1]!
      scan.opaque = { comment: false, char: marker[0]!, run: marker.length }
      continue
    }
    const comment = commentFenceRun(opener)
    if (comment !== undefined && degraded?.has(scan.index) !== true) scan.opaque = { comment: true, char: '%', run: comment }
  }

  return scan.opaque?.comment === true
}

/** Whether the memo already proves no closer for `len` of `char` from `start`. */
function fenceCloserMemoRefutes(
  memo: QuotedFenceCloserMemo,
  char: string,
  len: number,
  start: number,
): boolean {
  const cached = memo.get(char)

  return cached !== undefined && start >= cached.from &&
    (cached.end === undefined || start <= cached.end) && len > cached.maxRun
}

/** Search within one quote depth; cache misses only through its next boundary. */
function quotedFenceHasCloser(
  lexer: Lexer,
  marker: string,
  fromIndex: number,
  memo: QuotedFenceCloserMemo,
  depth = 0,
  column = 0,
): boolean {
  const char = marker[0]!
  const key = `${depth}:${column}:${char}`
  const start = fromIndex + 1
  if (fenceCloserMemoRefutes(memo, key, marker.length, start)) return false
  const closeRe = fenceCloseRe(marker)
  let maxRun = 0
  let end = start
  for (; end < lexer.lineCount; end++) {
    const line = lexer.lineAt(end)!
    let at = 0
    for (let level = 0; level <= depth; level++) {
      const width = quotePrefixLength(line, at, line.length)
      if (width === 0) {
        at = -1
        break
      }
      at += width
    }
    if (at < 0) break
    const residual = line.slice(at)
    if (column >= 0 && indentColumns(residual) !== column) continue
    if (column === -2 && indentColumns(residual) === 0) continue
    const content = column < 0 ? residual.replace(/^[ \t]+/, '') : sliceColumns(residual, column, true)
    if (closeRe.test(content)) return true
    const closer = RE_FENCE_CLOSER.exec(content)
    if (closer && closer[1]![0] === char) maxRun = Math.max(maxRun, closer[1]!.length)
  }
  memo.set(key, { from: start, end, maxRun })

  return false
}

// Block comment: a `%%%`+ opener, closed by a line whose delimiter run has the
// SAME length (more `%` nest). Not rendered.
function commentLineContent(line: string): string {
  // ONE separator character, and it is `whitespace` (markup-carve/carve#977).
  return trimEndSpaceTab(line.replace(/^[ \t]*%%/, '').replace(/^[ \t]/, ''))
}

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
  // Container prefixes are already removed; the remaining payload keeps its bytes.
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
    lines.push(stripLazyFrame(ln))
  }
  return { type: 'comment', block: true, content: lines.join('\n') }
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
  for (const node of nodes) {
    // A cell wrap points to the authored `+`, even when surrounding text
    // cannot be mapped after fragments from different rows are joined.
    if (node.type !== 'cell_wrap') delete node.pos
    if (node.type === 'citation_group') {
      for (const item of node.items) delete item.pos
    }
    visitInlineChildren(node, stripPositions, undefined)
  }
  return nodes
}

function stripPositionsOutsideRow(nodes: InlineNode[], start: number, end: number): InlineNode[] {
  for (const node of nodes) {
    // A marker from a later row can record a join here, outside this row's
    // own source span (carve#3172).
    if (node.pos && node.pos.startOffset !== undefined && node.pos.endOffset !== undefined &&
      (node.pos.startOffset < start || node.pos.endOffset > end)) delete node.pos
    if (node.type === 'citation_group') {
      for (const item of node.items) {
        if (item.pos && item.pos.startOffset !== undefined && item.pos.endOffset !== undefined &&
          (item.pos.startOffset < start || item.pos.endOffset > end)) delete item.pos
      }
    }
    visitInlineChildren(node, children => stripPositionsOutsideRow(children, start, end), undefined)
  }
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

export function colonFenceOpenerLen(line: string): number | null {
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
  const named = RE_ADMONITION_OPEN.exec(line)
  if (named) return GENERATED_CONTENT_KINDS.has(named[2]!) ? 'directive' : 'admonition'
  return 'div'
}

function consumeOpaqueColonFenceBodySpan(
  lexer: Lexer,
  lines: ColonFenceBodyLine[],
  lineIndex: number,
  text: string,
  literalOwnerLine?: number,
  canOpenUnclosed = false,
  hostCloserAt?: (lineIndex: number) => boolean,
): boolean {
  const fenceText = literalOwnerLine === undefined ? text : text.replace(/^[ \t]+/, '')
  const rawOpen = RE_RAW_FENCE.exec(fenceText)
  const codeOpen = rawOpen === null ? RE_FENCE.exec(fenceText) : null
  const marker = rawOpen?.[1] ?? codeOpen?.[2]
  if (marker !== undefined) {
    // A fence that interrupts a paragraph needs a closer. After a closed child
    // leaves no paragraph, an unclosed fence opens and runs to this host's edge.
    const closes = fenceHasCloser(lexer, marker, literalOwnerLine !== undefined)
    if (lexer.quoteLazyLines.has(lexer.lineNumber(lineIndex)) || (!closes && !canOpenUnclosed)) return false
    const closeRe = fenceCloseRe(marker)
    const openerColumn = indentColumns(text)
    const authoredRunColumn = (at: number, line: string): number => {
      const prefix = lexer.lineStartColumn(at) - 1
      const source = (lexer.rootLines ?? lexer.lines)[lexer.lineNumber(at) - 1]
      let column = 0
      if (source !== undefined && prefix <= source.length) {
        for (let i = 0; i < prefix; i++) column += source[i] === '\t' ? 4 - column % 4 : 1
      } else column = prefix
      for (const char of line) {
        if (char === '\t') column += 4 - column % 4
        else if (char === ' ') column++
        else break
      }
      return column
    }
    const authoredColumn = authoredRunColumn(lineIndex, text)
    const isCodeFence = codeOpen !== null
    lexer.consume()
    lines.push({ text, lineIndex })
    while (!lexer.eof()) {
      const innerLineIndex = lexer.pos
      const innerText = lexer.peek()!
      const content = innerText.replace(/^[ \t]+/, '')
      const bandPayload = literalOwnerLine === undefined &&
        authoredRunColumn(innerLineIndex, innerText) <= authoredColumn
      const bandCloser = bandPayload && closeRe.test(content)
      if (!closes && hostCloserAt?.(innerLineIndex)) break
      if (!closes && !bandCloser && !isBlankLine(innerText) && indentColumns(innerText) < openerColumn) break
      lexer.consume()
      lines.push({ text: bandPayload ? content : innerText, lineIndex: innerLineIndex })
      if (bandCloser) break
      if (literalOwnerLine !== undefined ? closeRe.test(innerText.replace(/^[ \t]+/, '')) :
        closeRe.test(innerText) && (!isCodeFence || leadingWhitespace(innerText) <= 3)) break
    }
    return true
  }

  const commentOpen = RE_COMMENT_BLOCK_ANY.exec(text)
  if (commentOpen !== null &&
      !(literalOwnerLine !== undefined && lexer.literalCommentLineOpeners.has(`${literalOwnerLine}:${lexer.lineNumber(lineIndex)}`)) &&
      commentBlockHasCloser(lexer, commentOpen[1]!.length)) {
    const fence = commentOpen[1]!.length
    lexer.consume()
    lines.push({ text, lineIndex })
    while (!lexer.eof()) {
      const innerLineIndex = lexer.pos
      const innerText = lexer.peek()!
      const commentClose = RE_COMMENT_BLOCK_ANY.exec(innerText)
      lexer.consume()
      lines.push({ text: innerText, lineIndex: innerLineIndex })
      if (commentClose !== null && commentClose[1]!.length === fence) break
    }
    return true
  }

  return false
}

interface ColonFenceBodyView {
  lexer: Lexer
  start: number
  length: number
  closed: boolean
}

type ColonFenceBody = ColonFenceBodyLine[] | ColonFenceBodyView

function nestedColonLexer(parent: Lexer, body: ColonFenceBody, start: number): Lexer {
  if (Array.isArray(body)) {
    if (layoutWork.on) layoutWork.bodyEntries += body.length * 2
    const unchanged = body.every((line) => line.text === parent.lineAt(line.lineIndex))
    return nestedSubLexer(parent, body.map((line) => line.text), start, undefined, undefined, unchanged)
  }
  const sub = nestedSubLexer(parent, [], start, undefined, undefined, true)
  sub.useLineView(body.lexer, body.start, body.length)
  return sub
}

function collectColonFenceBody(lexer: Lexer, opener: ColonFenceOpener): ColonFenceBody {
  const origin = lexer.contiguousOrigin
  const index = (origin?.lexer ?? lexer).colonFenceEnds
  const base = origin?.start ?? 0
  const knownEnd = layoutWork.reuseColonViews ? index.get(base + opener.lineIndex) : undefined
  if (knownEnd !== undefined && knownEnd - base <= lexer.lineCount) {
    const end = knownEnd - base
    const start = lexer.pos
    const closed = end < lexer.lineCount
    lexer.pos = end + Number(closed)
    return { lexer: origin?.lexer ?? lexer, start: base + start, length: end - start, closed }
  }
  const lines: ColonFenceBodyLine[] = []
  const stack: ColonFenceOpener[] = [opener]
  let paragraphOpen: boolean = false
  let paragraphPrefix: string | false = false
  let markerLineLiteral: { width: number; column: number } | undefined
  const authoredColonColumn = (at: number, width: number): number | undefined => {
    const source = lexer.rootLines?.[lexer.lineNumber(at) - 1]
    const markerAt = source?.indexOf(':'.repeat(width)) ?? -1
    if (source === undefined || markerAt < 0) return undefined
    let column = 0
    for (const char of source.slice(0, markerAt)) column += char === '\t' ? 4 - (column % 4) : 1
    return column
  }
  // Only the innermost container's own closer ends an unclosed fence. An
  // ancestor's width closes nothing there, so stopping on it ran the body to EOF.
  const hostCloserAt = (at: number): boolean => {
    const candidate = lexer.lineAt(at) ?? ''
    const width = RE_ADMONITION_CLOSE.exec(candidate)?.[1]?.length
    const owner = stack[stack.length - 1]
    if (width === undefined || owner === undefined || owner.fenceWidth !== width) return false
    const ownerColumn = authoredColonColumn(owner.lineIndex, width)
    const column = authoredColonColumn(at, width)
    return ownerColumn === undefined || column === undefined
      ? indentColumns(candidate) === indentColumns(lexer.lineAt(owner.lineIndex) ?? '')
      : column === ownerColumn
  }

  while (!lexer.eof()) {
    if (layoutWork.on) layoutWork.colonLines++
    const lineIndex = lexer.pos
    const text = lexer.peek()!
    const interruptsParagraph: boolean = paragraphOpen && startsInterruptingBlock(lexer)
    if (consumeOpaqueColonFenceBodySpan(lexer, lines, lineIndex, text, undefined, !paragraphOpen && markerLineLiteral === undefined, hostCloserAt)) {
      paragraphOpen = false
      paragraphPrefix = false
      continue
    }
    const close = RE_ADMONITION_CLOSE.exec(text)

    if (close && close[1]!.length === stack[stack.length - 1]?.fenceWidth) {
      lexer.consume()
      const closed = stack.pop()!
      index.set(base + closed.lineIndex, base + lineIndex)
      if (stack.length === 0) break
      lines.push({ text, lineIndex })
      paragraphOpen = false
      paragraphPrefix = false
      continue
    }

    lexer.consume()
    lines.push({ text, lineIndex })
    const markerColumn = text.includes('|') ? markerContentColumn(text) : -1
    const markerBody = markerColumn >= 0 ? markerFreeContent(text) : ''
    if (markerColumn >= 0 && RE_LINE_BLOCK_OPEN.test(markerBody)) {
      markerLineLiteral = { width: colonFenceOpenerLen(markerBody)!, column: markerColumn }
    } else if (markerLineLiteral && indentColumns(text) === markerLineLiteral.column &&
        RE_ADMONITION_CLOSE.exec(text.trimStart())?.[1]?.length === markerLineLiteral.width) {
      markerLineLiteral = undefined
      paragraphOpen = false
      paragraphPrefix = false
      continue
    }
    if (stack.at(-1)!.kind === 'line block') continue
    const openerLen = colonFenceOpenerLen(text)
    if (openerLen !== null) {
      stack.push({
        kind: colonFenceKind(text),
        lineIndex,
        fenceWidth: openerLen,
      })
      paragraphOpen = false
      paragraphPrefix = false
      continue
    }
    // A quote or item line that carries paragraph text leaves a paragraph open
    // even where it interrupts the one above (`> para` then `> more`). An item
    // prefix is `-<content column>;`: a line reaching that column is read
    // there, so a block at it closes the item's paragraph (CARVE-P0-011).
    const leavesParagraphOpen = (line: string, wasOpen: string | false, interrupted: boolean, inItem = false): string | false => {
      const block = inItem ? line.trimStart() : line
      if (isBlankLine(line) || leavesNoParagraph(block) || RE_HEADING.test(block) || RE_HR.test(block) ||
        (block === line.trimStart() && isLinkDefLine(block)) || isTableRow(block)) return false
      const quote = RE_BLOCKQUOTE.exec(block)
      if (quote) {
        const inner = quote[1] !== undefined &&
          leavesParagraphOpen(quote[1], wasOpen && wasOpen[0] === '>' ? wasOpen.slice(1) : false, false)
        return inner && `>${inner}`
      }
      const open = wasOpen ? RE_ITEM_PREFIX.exec(wasOpen) : null
      if (open && /^ */.exec(line)![0].length >= Number(open[1])) {
        const inner = leavesParagraphOpen(line.slice(Number(open[1])), wasOpen && wasOpen.slice(open[0].length), interrupted, true)
        return inner && open[0] + inner
      }
      const marked = extractItemAttr(line)?.stripped ?? line
      const item = RE_TASK.exec(marked)?.[3] ?? RE_UNORDERED.exec(marked)?.[2] ?? RE_ORDERED.exec(marked)?.[4]
      if (wasOpen && !interrupted && (item === undefined || !(open || inItem))) return wasOpen
      if (item !== undefined) {
        const inner = leavesParagraphOpen(item, false, false)
        return inner && `-${markerContentColumn(line)};${inner}`
      }
      return ((!interrupted && (wasOpen || !lineOpensBlock(line))) || opensParagraphInBlock(line)) ? 'p' : false
    }
    paragraphPrefix = leavesParagraphOpen(text, paragraphPrefix, interruptsParagraph)
    paragraphOpen = paragraphPrefix !== false
  }

  for (const unclosed of stack) index.set(base + unclosed.lineIndex, base + lexer.pos)
  for (const unclosed of stack.slice(0, Math.max(0, MAX_NESTING_DEPTH - lexer.depth))) {
    lexer.reportUnclosedContainer(unclosedContainerFromOpener(lexer, unclosed))
  }
  return lines
}

// An item's prefix in the colon-body scan's paragraph state: `-<content column>;`.
const RE_ITEM_PREFIX = /^-(\d+);/

// A comment line and a block-attribute line are not paragraph text.
function leavesNoParagraph(text: string): boolean {
  return RE_COMMENT_LINE.test(text) || isBlockAttributeLine(text.trimEnd())
}

// A quote or list line whose content is paragraph text leaves that paragraph
// open, so an unclosed fence on the next line cannot interrupt it (§10 I4).
function opensParagraphInBlock(text: string): boolean {
  const quote = RE_BLOCKQUOTE.exec(text)
  if (quote) {
    const content = quote[1]
    return content !== undefined && !isBlankLine(content) && !leavesNoParagraph(content) &&
      (!lineOpensBlock(content) || opensParagraphInBlock(content))
  }
  const content = (RE_TASK.exec(text)?.[3] ?? RE_UNORDERED.exec(text)?.[2] ?? RE_ORDERED.exec(text)?.[4])
  return content !== undefined && !leavesNoParagraph(content) &&
    (!lineOpensBlock(content) || opensParagraphInBlock(content))
}

function collectLiteralColonFenceBody(lexer: Lexer, opener: ColonFenceOpener): ColonFenceBodyLine[] {
  const literalOwnerLine = lexer.lineNumber(opener.lineIndex)
  const lines: ColonFenceBodyLine[] = []
  let closed = false

  while (!lexer.eof()) {
    const lineIndex = lexer.pos
    const text = lexer.peek()!
    if (consumeOpaqueColonFenceBodySpan(lexer, lines, lineIndex, text, literalOwnerLine)) continue
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
  | { kind: 'paragraph'; absorbingFence: boolean; term?: boolean; itemParagraph?: boolean }
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

interface QuoteFenceHosts {
  initialMarkerColumn?: number | undefined
  columns: number[]
  markers: number[]
  kinds: ('item' | 'note' | 'description')[]
  terms: boolean[]
  colons?: Array<{ width: number; column: number; floor: number; awaitingBody: boolean; literal: boolean; markerBody?: boolean; opaque?: OpaqueGroup }>
  /**
   * The fence a list item or footnote inside this quote holds open. `column` is
   * where the opener sits and `floor` the host's own content column; the two
   * differ for an over-indented opener, and then a closer at either one ends it.
   */
  fence: { marker: string; column: number; floor: number } | null
  /** The column of the definition list a `: ` line at it continues. */
  definitionList?: number | undefined
  commentBoundary?: boolean
  rejectedItemComment?: boolean
  commentBoundaryBelow?: boolean
}

function trackQuoteHostFence(
  content: string, state: BlockQuoteLazyState,
  hasCloser: (marker: string, column?: number) => boolean,
  terminatorFree: boolean,
  hasCommentCloser: (width: number, floor: number) => boolean,
  wasInTable: boolean,
): boolean {
  const host = state.hosts ??= { columns: [0], markers: [], kinds: [], terms: [], fence: null }
  const rejectedItemComment = host.rejectedItemComment === true
  delete host.rejectedItemComment
  const afterComment = host.commentBoundary === true
  const afterCommentBelow = host.commentBoundaryBelow === true
  delete host.commentBoundary
  delete host.commentBoundaryBelow
  const column = indentColumns(content)
  const text = content.replace(/^[ \t]*/, '')
  if (host.fence) {
    const open = host.fence
    if (text !== '' && column < open.floor) host.fence = null
    else {
      if (
        (column === open.floor || column === open.column) &&
        fenceCloseRe(open.marker).test(text)
      ) host.fence = null
      closeBlockQuoteParagraph(state)
      return true
    }
  }
  const heldColon = host.colons?.at(-1)
  const commentRun = heldColon && RE_COMMENT_LINE.test(text) ? commentFenceRun(text) : undefined
  if (heldColon && RE_COMMENT_LINE.test(text) && commentRun === undefined &&
      (!heldColon.literal || column < heldColon.floor)) {
    closeBlockQuoteParagraph(state)
    return true
  }
  if (heldColon?.literal && column < heldColon.floor) {
    host.colons!.pop()
    closeBlockQuoteParagraph(state)
    if (commentRun !== undefined && hasCommentCloser(commentRun, column)) return false
  }
  const literal = host.colons?.at(-1)
  if (literal?.literal && column >= literal.floor) {
    if (literal.opaque) {
      const closedPayload = literal.opaque.closes(text)
      if (text !== '') {
        state.mode = { kind: 'paragraph', absorbingFence: false }
      } else closeBlockQuoteParagraph(state)
      if (closedPayload) delete literal.opaque
      return true
    }
    const group = opaqueGroupCloser(text)
    if (group && (group.belowBaseCloses ? hasCommentCloser(group.run, literal.floor) :
      column >= literal.floor &&
      hasCloser(group.char.repeat(group.run), literal.floor === 0 ? -2 : -1))) literal.opaque = group
    const close = /^(:{3,})[ \t]*$/.exec(text)
    if (close && close[1]!.length === literal.width && (column === literal.floor || column === literal.column)) {
      host.colons!.pop()
      if (literal.floor === 0) state.colonWidths.pop()
    }
    // Line-block payload is inline content, whatever its block shape.
    if (host.colons?.at(-1) === literal && text !== '') {
      state.mode = { kind: 'paragraph', absorbingFence: false }
    } else closeBlockQuoteParagraph(state)
    return true
  }
  if (RE_COMMENT_LINE.test(text)) {
    if (!blockQuoteParagraphOpen(state) && host.markers.length > 0 && column < host.columns.at(-1)!) {
      while (host.markers.length > 0 && host.markers.at(-1)! >= column) {
        host.columns.pop(); host.markers.pop(); host.kinds.pop(); host.terms.pop()
      }
      if (host.colons) host.colons = host.colons.filter(open => open.floor <= host.columns.at(-1)!)
      if (host.markers.length === 0) { host.rejectedItemComment = true; closeBlockQuoteParagraph(state); return true }
    }
    let low = 0
    let high = host.columns.length
    while (low < high) {
      const middle = (low + high) >>> 1
      if (host.columns[middle]! <= column) low = middle + 1
      else high = middle
    }
    const level = Math.max(0, low - 1)
    const floor = host.columns[level]!
    const colons = host.colons ?? []
    low = 0
    high = colons.length
    while (low < high) {
      const middle = (low + high) >>> 1
      if (colons[middle]!.floor <= floor) low = middle + 1
      else high = middle
    }
    const open = colons[low - 1]
    if ((commentFenceRun(text) !== undefined && column < host.columns.at(-1)!) ||
        !(host.kinds[level - 1] === 'item' && open && floor === open.floor && column > open.column)) {
      host.commentBoundary = true
      host.commentBoundaryBelow = commentFenceRun(text) !== undefined && column < host.columns.at(-1)!
    }
    return false
  }
  if (text === '') { if (host.markers.length === 0) host.initialMarkerColumn = undefined; return false }
  if (quotedLineText(content, terminatorFree) !== null) {
    host.columns = [0]; host.markers = []; host.kinds = []; host.terms = []
    host.colons = []
    host.initialMarkerColumn = undefined
    host.definitionList = undefined
    return false
  }
  const paragraph = blockQuoteParagraphOpen(state)
  if (afterComment && host.kinds.at(-1) === 'item' && column > 0 &&
      column < host.columns.at(-1)! &&
      !(!afterCommentBelow && opensCodeFence(text) && host.colons?.some(open => open.floor <= column && open.column < column)) &&
      (!lineOpensBlock(text) || isListMarkerLine(text) || column < host.columns[1]! ||
        ((host.colons?.length ?? 0) > 0 && (RE_FENCE.test(text) || RE_RAW_FENCE.test(text))))) {
    state.mode = { kind: 'paragraph', absorbingFence: false }
    return true
  }
  const sibling = host.markers.some((col, i) => col === column && host.kinds[i] === 'item')
  const leftOfOutermost = host.markers.length > 0 && column < host.markers[0]!
  // A marker below an ancestor's content column can remain paragraph text.
  // Retain its existing fence host instead of inventing a sibling item.
  const structuralMarker = host.markers.some((marker, i) => host.kinds[i] === 'item' &&
    column <= marker && column >= host.columns[i]!)
  const lazyMarker = paragraph && markerPrefixLength(text, 0, prefixWalkBound(text)) > 0 &&
    host.markers.length > 0 && column > host.markers[0]! &&
    !structuralMarker && column < host.columns.at(-1)!
  const lazyItem = paragraph && !host.kinds.includes('note') && host.kinds.at(-1) === 'item' && column < host.columns.at(-1)! &&
    (lazyMarker || (bottomBlockLeavesParagraphOpen(text) && !lineOpensBlock(text) && !opensWrappedAttributeBlock(text)))
  if (lazyItem && host.colons) host.colons = host.colons.filter(open => !open.awaitingBody || open.markerBody === true)
  while (!lazyItem && host.columns.length > 1 && host.columns.at(-1)! > column) {
    host.columns.pop(); host.markers.pop(); host.kinds.pop(); host.terms.pop()
  }
  const colons = host.colons ??= []
  while (colons.length > 0 && colons.at(-1)!.floor > host.columns.at(-1)!) colons.pop()
  const insideItem = host.kinds.at(-1) === 'item'
  let inner = text
  let at = column
  let blockStart = false
  for (;;) {
    const width = markerPrefixLength(inner, 0, prefixWalkBound(inner))
    if (width > 0) {
      if (lazyMarker && lazyItem) break
      if (paragraph && !insideItem && !sibling && !leftOfOutermost) break
      host.initialMarkerColumn ??= at
      host.markers.push(at)
      const attrs = extractItemAttr(inner)
      const markerText = attrs?.stripped ?? inner
      at += RE_TASK.test(markerText) ? 2 : width - (inner.length - markerText.length)
      host.columns.push(at)
      host.kinds.push('item')
      host.terms.push(false)
      blockStart = true
      const tail = inner.slice(width)
      at += indentColumns(tail)
      inner = tail.replace(/^[ \t]*/, '')
      continue
    }
    // A quote does not rebase (CARVE-P0-004): past its column the line is text.
    const note = host.kinds.length > 0 || at === 0 ? RE_FOOTNOTE_DEF.exec(inner) : null
    if (note) {
      host.markers.push(at); host.columns.push(at + 2); host.kinds.push('note'); host.terms.push(false)
      at += 2
      inner = note[2]!
      blockStart = true
      break
    }
    // A description body is a host too: its column is where the body's blocks open.
    const description = at === host.columns.at(-1)! && host.definitionList === at ? RE_DEFLIST_DEF.exec(inner) : null
    if (description) {
      host.markers.push(at); host.columns.push(at + 1 + description[1]!.length)
      host.kinds.push('description'); host.terms.push(false)
      at += 1 + description[1]!.length
      inner = description[2]!
      blockStart = true
    }
    break
  }
  if (blockStart && RE_DEFLIST_TERM.test(inner)) host.terms[host.terms.length - 1] = true
  if (blockStart && host.kinds.at(-1) === 'item' && host.kinds.includes('note') &&
      !opensCodeFence(inner) && colonFenceOpenerLen(inner) === null && !RE_DEFLIST_TERM.test(inner)) {
    closeBlockQuoteParagraph(state)
    return true
  }
  if (RE_DEFLIST_TERM.test(inner)) host.definitionList = at
  else if (host.definitionList !== undefined && column <= host.definitionList &&
    host.kinds.at(-1) !== 'description') host.definitionList = undefined
  const floor = host.columns.at(-1)!
  const pendingColonBody = colons.at(-1)?.awaitingBody === true
  if (blockStart && state.mode.kind === 'paragraph') state.mode.absorbingFence = false
  if (floor > 0) {
    const bare = /^(:{3,})[ \t]*$/.exec(inner)
    const open = colons.at(-1)
    if (bare && open && bare[1]!.length === open.width &&
        (at === open.column || at === open.floor)) {
      colons.pop()
      closeBlockQuoteParagraph(state)
      return true
    }
    if (bare && open && at !== open.column && at !== open.floor) {
      if (host.kinds.at(-1) === 'note') {
        closeBlockQuoteParagraph(state)
        return true
      }
      return false
    }
    if (open) open.awaitingBody = false
    if (open?.literal) {
      closeBlockQuoteParagraph(state)
      return true
    }
    const width = colonFenceOpenerLen(inner)
    if (insideItem && open && floor === open.floor && at > open.column && !(afterComment && opensCodeFence(inner)) &&
        !hostedAuthoredBlockOpener(inner)) {
      if (afterComment && width !== null) {
        closeBlockQuoteParagraph(state)
        return true
      }
      if (width === null && /^(:{3,})/.exec(inner)?.[1]?.length === open.width) {
        state.mode = { kind: 'paragraph', absorbingFence: true }
        return true
      }
      return false
    }
    const absorbedBare = bare !== null && state.mode.kind === 'paragraph' && state.mode.absorbingFence
    if (absorbedBare || (width === null && /^:{3,}/.test(inner) &&
        !(blockStart && host.kinds.at(-1) === 'note'))) {
      state.mode = { kind: 'paragraph', absorbingFence: true }
      return true
    }
    if (width !== null && !absorbedBare) {
      colons.push({ width, column: at, floor, awaitingBody: blockStart,
        literal: RE_LINE_BLOCK_OPEN.test(inner), markerBody: blockStart })
      closeBlockQuoteParagraph(state)
      return true
    }
  }
  if (floor === 0 && at === 0 && RE_LINE_BLOCK_OPEN.test(inner)) {
    colons.push({ width: colonFenceOpenerLen(inner)!, column: at, floor, awaitingBody: false, literal: true })
  }
  const code = RE_FENCE.exec(inner)
  const raw = code ? null : RE_RAW_FENCE.exec(inner)
  const marker = code?.[2] ?? raw?.[1] ?? null
  if (marker && (floor > 0 || (rejectedItemComment && at > 0 && !paragraph))) {
    const colon = colons.at(-1)
    // AN OVER-INDENTED OPENER IS STILL THE HOST'S FENCE. §24 C3 asks a processor
    // to NAME a block opener past the item's canonical content column, not to
    // refuse it, so the host holds its payload exactly as it holds a canonical
    // one - and a flush-left line then reaches no open paragraph. Read as a
    // continuation instead, it put a document-level line inside the fence
    // (carve-js#2350). Its closer may sit at its own column or at the host's.
    const overIndented = at !== floor
    if (blockStart || !paragraph || (pendingColonBody && colon && (at === colon.floor || at === colon.column)) ||
      hasCloser(marker, floor) || (overIndented && hasCloser(marker, at))) {
      host.fence = { marker, column: at, floor }
      closeBlockQuoteParagraph(state)
      return true
    }
  }
  if (!blockStart && at === floor && host.terms.length > 0 &&
      (!paragraph || lineOpensBlock(inner) || RE_DEFLIST_DEF.test(inner) || isBlockAttributeLine(inner)))
    host.terms[host.terms.length - 1] = false
  if (floor > 0 && at >= floor && !blockStart && !host.terms.at(-1)) {
    if (RE_BLOCKQUOTE.test(inner) && !markerLineState(inner).leavesParagraphOpen) {
      closeBlockQuoteParagraph(state)
      return true
    }
    const row = isTableRow(inner) || (wasInTable && RE_TABLE_CONT.test(inner))
    if (row || RE_HEADING.test(inner) || RE_HR.test(inner) || isLinkDefLine(inner) ||
        (host.kinds.at(-1) === 'item' && RE_DEFLIST_TERM.test(inner)) ||
        (host.kinds.at(-1) !== 'note' && isBlockAttributeLine(inner))) {
      state.inTable = row
      closeBlockQuoteParagraph(state)
      return true
    }
  }
  return false
}

export interface BlockQuoteLazyState {
  hosts?: QuoteFenceHosts
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

function demoteQuotedColonCandidates(state: BlockQuoteLazyState): void {
  let level = state
  for (;;) {
    if (level.hosts?.colons?.some(open => open.awaitingBody)) {
      level.hosts.colons = level.hosts.colons.filter(open => !open.awaitingBody || open.markerBody === true)
    }
    if (level.mode.kind !== 'quote') return
    level = level.mode.inner
  }
}

/** Iterative for the reason `trackBlockQuoteLazyState` is: the chain is as deep as the document nests. */
const blockQuoteParagraphOpen = (state: BlockQuoteLazyState): boolean => {
  let level = state
  while (level.mode.kind === 'quote') level = level.mode.inner

  return level.mode.kind === 'paragraph'
}

const blockQuoteParagraphClaimOpen = (state: BlockQuoteLazyState): boolean => {
  let level = state
  while (level.mode.kind === 'quote') {
    if (level.hosts?.kinds.includes('note')) return false
    level = level.mode.inner
  }
  return level.mode.kind === 'paragraph' && !level.hosts?.kinds.includes('note')
}

/** How many quotes are open below the one `state` tracks. */
const openQuoteDepth = (state: BlockQuoteLazyState): number => {
  let depth = 0
  for (let mode = state.mode; mode.kind === 'quote'; mode = mode.inner.mode) depth++
  return depth
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
  hasFenceCloser: (marker: string, depth?: number, column?: number) => boolean,
  descent?: QuoteDescent,
  prefixMemo?: Map<number, number>,
  atColumn = true,
  hasLiteralCommentCloser?: (fence: number, depth: number, floor: number) => boolean,
): void {
  if (!atColumn) demoteQuotedColonCandidates(state)
  let text = content
  let level = state
  const terminatorFree = !/[\n\r\u2028\u2029]/.test(content)
  let commentCloser = hasCommentCloser
  let fenceCloser = (marker: string, column?: number) => hasFenceCloser(marker, 0, column)
  if (descent) {
    descent.levels = 0
    descent.preserved = false
  }
  let paragraphOpen: boolean | undefined
  let literalDepth = 0
  const continuesParagraph = (): boolean => paragraphOpen ??= blockQuoteParagraphOpen(state)
  for (;;) {
    const descend = classifyQuotedLine(
      text, level, commentCloser, fenceCloser, continuesParagraph, terminatorFree, descent, prefixMemo, atColumn,
      hasLiteralCommentCloser === undefined ? commentCloser : (width, floor) => {
        if (descent && literalDepth > 0) descent.askedBelowTop = true
        return hasLiteralCommentCloser(width, literalDepth, floor)
      },
    )
    if (descend === null) return
    text = descend.text
    level = descend.state
    literalDepth++
    if (!descent) continue
    descent.levels++
    if (commentCloser === hasCommentCloser) {
      // The lookups scan the CALLER's lines, so below the top level they may
      // answer for the wrong depth. A chain that asked one is not handed down.
      commentCloser = (fence) => {
        descent.askedBelowTop = true
        return hasCommentCloser(fence)
      }
      fenceCloser = (marker, column) => {
        descent.askedBelowTop = true
        return hasFenceCloser(marker, descent.levels, column)
      }
    }
  }
}

/**
 * `RE_BLOCKQUOTE`'s captured text, or null. On a line holding no line
 * terminator the regex's `.*` cannot fail, so the marker alone decides and the
 * rest of the line is not re-read at every level of a deep quote chain.
 */
/** Whether the last character before trailing spaces and tabs is `+`, without a scan past them. */
function endsInPlus(text: string): boolean {
  let end = text.length - 1
  while (end >= 0 && (text[end] === ' ' || text[end] === '\t' || text[end] === '\n' || text[end] === '\r')) end--
  return end >= 0 && text[end] === '+'
}

function quotedLineText(content: string, terminatorFree: boolean): string | null {
  if (/^>(?:> ?)*\+[ \t]*$/.test(content)) return content.slice(1)
  if (!terminatorFree) {
    const quoted = RE_BLOCKQUOTE.exec(content)
    return quoted ? (quoted[1] ?? '') : null
  }
  if (content === '>' || (content.startsWith('>\t') && isBlankLine(content.slice(1)))) return ''

  return content.startsWith('> ') ? content.slice(2) : null
}

/** What one `trackBlockQuoteLazyState` call did below the level it was given. */
interface QuoteDescent {
  /** Quote levels the line descended through. */
  levels: number
  /** Sticky: a closer lookup ran below the top level on some line. */
  askedBelowTop: boolean
  /** The line left the existing nested paragraph state unchanged. */
  preserved?: boolean
}

/**
 * A nested quote's lazy state, computed by the quote around it.
 *
 * The enclosing quote's tracker feeds its inner quote exactly the lines the
 * nested parse will feed its own tracker, so the nested quote can start from
 * that state instead of replaying its lines, which would descend the whole
 * chain again at every level. Valid for the quote at line 0 of the sub-lexer,
 * over its first `lines` quoted lines, and `depth` levels down.
 */
export interface QuoteLazyHint {
  state: BlockQuoteLazyState
  lines: number
  depth: number
  /** `blockQuoteParagraphOpen` of the state, once asked: the walk is as long as the chain. */
  paragraphOpen?: boolean
}

function classifyQuotedLine(
  content: string,
  state: BlockQuoteLazyState,
  hasCommentCloser: (fence: number) => boolean,
  hasFenceCloser: (marker: string, column?: number) => boolean,
  continuesParagraph: () => boolean,
  terminatorFree = false,
  descent?: QuoteDescent,
  prefixMemo?: Map<number, number>,
  atColumn = true,
  hasLiteralCommentCloser: (width: number, floor: number) => boolean = hasCommentCloser,
): { text: string; state: BlockQuoteLazyState } | null {
  // Absorption belongs to ONE open paragraph, so it ends wherever that
  // paragraph does: cleared here and re-armed only in the two branches that
  // continue the same paragraph, exactly as `trackItemLazyState` does it.
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
  if (atColumn && trackQuoteHostFence(content, state, hasFenceCloser, terminatorFree, hasLiteralCommentCloser, wasInTable)) return null
  const wasAbsorbing = state.mode.kind === 'paragraph' && state.mode.absorbingFence
  const wasTerm = state.mode.kind === 'paragraph' && state.mode.term && !RE_DEFLIST_DEF.test(content)
  const wasItemParagraph = state.mode.kind === 'paragraph' && state.mode.itemParagraph === true
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
  const quoted = quotedLineText(content, terminatorFree)
  if (quoted !== null) {
    const inner: BlockQuoteLazyState =
      state.mode.kind === 'quote'
        ? state.mode.inner
        : { mode: { kind: 'closed' }, inTable: false, colonWidths: [], attrRun: null }
    state.mode = { kind: 'quote', inner }

    return { text: quoted, state: inner }
  }
  // A term accepts lazy text under PART 0 and CARVE-P2-028, including
  // inside a quote (markup-carve/carve-js#2860).
  if (RE_DEFLIST_TERM.test(content)) {
    state.mode = { kind: 'paragraph', absorbingFence: false, term: true }
    return null
  }
  // Invisible definitions leave no leaf that can accept a following lazy line.
  // Abbreviation definitions are recognized only at document level.
  if (
    RE_FOOTNOTE_DEF.test(content) ||
    (leadingWhitespace(content) === 0 && isLinkDefLine(content))
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
    if (state.mode.kind === 'quote' && continuesParagraph()) {
      let inner = state.mode.inner
      while (inner.mode.kind === 'quote') inner = inner.mode.inner
      inner.mode = { kind: 'paragraph', absorbingFence: true }
      return null
    }
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
    if (hasLiteralCommentCloser(commentRun, 0)) {
      state.mode = { kind: 'comment_fence', length: commentRun }
    } else {
      closeBlockQuoteParagraph(state)
    }
    return null
  }
  // Lazy text preserves the inner paragraph for the next marked line.
  if (state.mode.kind === 'quote' && continuesParagraph()) {
    if (descent && descent.levels === 0) descent.preserved = true
    return null
  }
  if (wasItemParagraph && isListMarkerLine(content) &&
      !bottomBlockLeavesParagraphOpen(markerLineBottomBlock(content, prefixMemo))) {
    closeBlockQuoteParagraph(state)
    return null
  }
  // A list at block start carries its first block's continuation state.
  // A marker in an existing paragraph is still ordinary paragraph text.
  if (!blockQuoteParagraphOpen(state) && isListMarkerLine(content)) {
    const nested = markerLineState(content, prefixMemo)
    if (!nested.leavesParagraphOpen || nested.bottomIsContinuationMarker) {
      closeBlockQuoteParagraph(state)
      return null
    }
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
  // A footnote's extent takes no lazy line (CARVE-P0-012): its text opens no paragraph here.
  if (atColumn && state.hosts?.kinds.at(-1) === 'note') {
    closeBlockQuoteParagraph(state)
    return null
  }
  state.mode = { kind: 'paragraph', absorbingFence: wasAbsorbing,
    ...(wasTerm ? { term: true } : {}),
    ...((wasItemParagraph || (isListMarkerLine(content) && !blockQuoteParagraphOpen(state))) ? { itemParagraph: true } : {}) }

  return null
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
  // The regex is a gate on the line's shape, not a second spelling of
  // `link_destination`: it let `(` through as the destination of
  // `![a](( ")")` and kept the backslash of `![a](/i\(x)`, both of which the
  // inline tail already reads the other way (markup-carve/carve-js#1872). A
  // run it captures that the production refuses falls through to a paragraph,
  // where that tail reads it.
  return (
    m !== null &&
    // Check the whole line because opaque spans can extend beyond the label.
    buildBracketMap(line)(1) === 2 + m[1]!.length &&
    (m[2] === '' || linkDestinationValue(m[2]!) !== null) &&
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

/** The unordered/task bullet character (`-`, `*`, or `+`) of a line. */
function unorderedMarkerChar(line: string): string {
  return line.replace(/^\s*/, '').charAt(0)
}

/** Preserve capture indices while matching only the marker on terminator-free lines. */
function unorderedMatch(line: string, terminatorFree = false): RegExpExecArray | null {
  if (!terminatorFree) return RE_UNORDERED.exec(line)
  const match = RE_UNORDERED_HEAD.exec(line)
  if (!match) return null
  const content = line.slice(match[0].length)
  match[0] = line
  match.push(content)
  return match
}

const RE_UNORDERED_HEAD = /^(?=([ \t]*))\1[-*] +[ \t]*(?=[^ \t])/
const RE_ORDERED_HEAD = /^(?=([ \t]*))\1([0-9]+|[ivxlcdm]+|[IVXLCDM]+|[a-z]|[A-Z]|(?=\.))([.)]) +[ \t]*(?=[^ \t])/
const RE_TASK_HEAD = /^(?=([ \t]*))\1[-*] +\[([ xX\-_>?])\] +[ \t]*(?=[^ \t])/

function markerMatch(line: string, full: RegExp, head: RegExp, terminatorFree: boolean): RegExpExecArray | null {
  if (!terminatorFree) return full.exec(line)
  const match = head.exec(line)
  if (!match) return null
  const content = line.slice(match[0].length)
  match[0] = line
  match.push(content)
  return match
}

function orderedMatch(line: string, terminatorFree = false): RegExpExecArray | null {
  return markerMatch(line, RE_ORDERED, RE_ORDERED_HEAD, terminatorFree)
}

function taskMatch(line: string, terminatorFree = false): RegExpExecArray | null {
  return markerMatch(line, RE_TASK, RE_TASK_HEAD, terminatorFree)
}

function matchListMarker(
  line: string,
  isTask: boolean,
  isOrdered: boolean,
  terminatorFree = false,
): RegExpExecArray | null {
  if (isTask) return taskMatch(line, terminatorFree)
  if (isOrdered) {
    // An ordered list is not continued by a task or unordered marker.
    if (taskMatch(line, terminatorFree) !== null) return null
    return orderedMatch(line, terminatorFree)
  }
  // Unordered: not continued by task or ordered markers.
  if (taskMatch(line, terminatorFree) !== null || orderedMatch(line, terminatorFree) !== null) return null
  return unorderedMatch(line, terminatorFree)
}

// The visual content column of a list-marker line (`- x` -> 2, `1. x` -> 3,
// `- [ ] x` -> 6), or -1 if the line is not a list marker. Each marker regex
// captures the item content as its LAST group, so the content column is the
// column width of everything before that content. Used to decide, in the
// looseness scan, whether a line belongs to an item's sub-list (carve#322).
function markerContentColumn(line: string, terminatorFree = false, knownColumn?: number): number {
  // Mirror parseList's own content-column computation so the looseness scan
  // uses the SAME threshold the recursive sub-list parse uses -- including the
  // task convention (content column is base + 2, the bullet width, NOT the
  // `- [ ] ` checkbox width) and an abutting `{...}` attribute (stripped first).
  // A marker-attached block contributes zero (§24 C3), so the width is read
  // off the stripped line.
  const la = extractItemAttr(line, terminatorFree)
  const mline = la ? (la.markerLine ?? la.stripped) : line
  const base = knownColumn ?? indentColumns(line)
  if (taskMatch(mline, terminatorFree) !== null) return base + 2
  const m = orderedMatch(mline, terminatorFree) ?? unorderedMatch(mline, terminatorFree)
  if (!m) return -1
  const content = m[m.length - 1]!
  return base + (mline.length - leadingWhitespace(mline) - content.length)
}

// Ordered-list dialect, fixed by the first item's marker.
export type OlKind = 'dec' | 'alo' | 'aup' | 'rlo' | 'rup'

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
function orderedContinues(line: string, kind: OlKind, delim: string, terminatorFree = false): boolean {
  const o = orderedMatch(line, terminatorFree)
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
function isInvisibleLine(line: string, whitespace?: number): boolean {
  const l = whitespace === undefined ? line.replace(/^[ \t]+/, '') : line.slice(whitespace)
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

/**
 * Which lines a closed `%%%` comment block hides, opener and closer included.
 *
 * `isInvisibleLine` answers per line and therefore cannot see the block form at
 * all. An opener with no run of its exact width ahead opens nothing (PART 9
 * §28) and hides nothing, and a run inside VERBATIM payload is that block's
 * content rather than an opener - which is why the caller passes the item's
 * marker line too, since the fence may be authored on it.
 *
 * A verbatim opener is taken at face value here, without §10's closer lookahead,
 * and only a closer at column 0 ends its run. Both readings err toward STAYING
 * in the payload, and the cost of that is an unmarked comment block, which lands
 * the caller back on the reading it had before this pass existed.
 */
function commentBlockSpans(lines: string[]): boolean[] {
  const hidden = new Array<boolean>(lines.length).fill(false)
  // The last line carrying each run width, so an opener that cannot close is
  // refuted in O(1). Scanning to the end instead costs one suffix read per
  // unterminated opener, which is the ladder carve#2542 measured.
  const lastAt = new Map<number, number>()
  let canClose = false
  for (let k = 0; k < lines.length; k++) {
    const run = commentFenceRun(lines[k]!)
    if (run !== undefined) {
      if (lastAt.has(run)) canClose = true
      lastAt.set(run, k)
    }
  }
  if (!canClose) return hidden
  let verbatimClose: RegExp | null = null
  for (let k = 0; k < lines.length; k++) {
    const line = lines[k]!
    if (verbatimClose !== null) {
      if (verbatimClose.test(line)) verbatimClose = null
      continue
    }
    const run = commentFenceRun(line)
    if (run !== undefined) {
      if ((lastAt.get(run) ?? -1) <= k) continue
      // EXACT length closes; a shorter run inside a wider block is payload.
      let close = k + 1
      while (commentFenceRun(lines[close]!) !== run) close++
      for (let j = k; j <= close; j++) hidden[j] = true
      k = close
      continue
    }
    const opener = verbatimOpener(line)
    if (opener !== null) verbatimClose = fenceCloseRe(opener)
  }

  return hidden
}

/**
 * The fence run of a verbatim opener on `line`, reached through indentation and
 * through any number of list markers, else null.
 *
 * `commentFenceRun` is indent-tolerant (carve#624), so reading the opener at
 * column 0 alone leaves the two asymmetric: a `%%%` pair inside a DESCENDANT
 * item's code payload then reads as a comment block.
 */
function verbatimOpener(line: string): string | null {
  // Each marker consumes at least two characters, so `rest` strictly shrinks.
  let rest = line.replace(/^[ \t]+/, '')
  while (rest.length > 0) {
    const fence = RE_FENCE.exec(rest)
    if (fence) return fence[2]!
    const raw = RE_RAW_FENCE.exec(rest)
    if (raw) return raw[1]!
    const task = RE_TASK.exec(rest)
    const unordered = task ? null : RE_UNORDERED.exec(rest)
    const ordered = task ?? unordered ? null : RE_ORDERED.exec(rest)
    const content = task ? task[3] : unordered ? unordered[2] : ordered ? ordered[4] : undefined
    if (content === undefined) return null
    rest = content
  }

  return null
}

// Recognition is separate from interruption: a list marker recognized here
// can still fold into a paragraph under PART 9 §10 I2.
function lineOpensBlock(line: string): boolean {
  const first = line.charCodeAt(0)
  switch (first) {
    case 96: case 126:
      return RE_RAW_FENCE.test(line) || RE_FENCE.test(line)
    case 37:
      return RE_COMMENT_BLOCK.test(line)
    case 91:
      return RE_FOOTNOTE_DEF.test(line) || isLinkDefLine(line)
    case 35:
      return RE_HEADING.test(line)
    case 58:
      return RE_DEFLIST_TERM.test(line) ||
        (RE_ADMONITION_OPEN.test(line) && !RE_ADMONITION_CLOSE.test(line)) ||
        RE_DIV_OPEN.test(line) || RE_LINE_BLOCK_OPEN.test(line) ||
        RE_HARDBREAKS_OPEN.test(line) || RE_QUOTE_BLOCK_OPEN.test(line)
    case 62:
      return RE_BLOCKQUOTE.test(line)
    case 124:
      return isTableRow(line)
    case 95:
      return RE_HR.test(line)
    case 45: case 42:
      return RE_HR.test(line) || isListMarkerLine(line)
    default:
      // List markers alone allow indentation and decimal/letter prefixes.
      if (first === 32 || first === 9 || first === 46 ||
          (first >= 48 && first <= 57) || (first >= 65 && first <= 90) ||
          (first >= 97 && first <= 122)) {
        return isListMarkerLine(line)
      }
      return false
  }
}

/**
 * A line whose only shape is a LIST MARKER - the four spellings an item opens
 * with. Kept apart from `lineOpensBlock`, which answers for every opener.
 */
function isListMarkerLine(line: string): boolean {
  return (
    RE_TASK.test(line) ||
    RE_UNORDERED.test(line) ||
    RE_ORDERED.test(line) ||
    extractItemAttr(line) !== null
  )
}

function lazyContinuationEndsList(line: string, lexer: Lexer): boolean {
  // A MARKER THE QUOTE ABOVE ALREADY TOOK AS LAZY TEXT OPENS NOTHING HERE.
  // PART 0 lazy continuation folds an unmarked line into the innermost open
  // paragraph and names a list marker as NOT an exclusion, so `> - a` / `- m`
  // is one quote whose item paragraph is `a\n- m`. The quote collects the line
  // and hands it to this sub-parse, which read the marker a second time and
  // started a sibling item inside the quote (markup-carve/carve#1904).
  if (lexer.quoteLazyMarkerLines.has(lexer.lineNumber(lexer.pos))) return false
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
  // A DEGRADED COMMENT FENCE ENDS NOTHING (§28, markup-carve/carve#1903, ported
  // at carve-js#1607). With no exact-width closer ahead the opener is one
  // `comment_line` for every question the layout asks, container OWNERSHIP
  // included - and a `%%` line leaves the item open in every reader, so this
  // must too. The lookahead is the one §10 I4 already makes for a verbatim
  // fence, two lines up.
  //
  // A TERMINATED `%%%` here is untouched: a comment BLOCK written at the
  // document's own opener column still ends the item (corpus 214). The closer
  // is looked for AHEAD rather than on the next line, which is corpus 445 row 9.
  if (RE_COMMENT_BLOCK.test(line)) {
    return commentBlockHasCloser(lexer, RE_COMMENT_BLOCK.exec(line)![1]!.length)
  }
  return (
    // A flush-left colon-fence shaped line ends list lazy continuation
    // regardless of outer-stream closer lookahead. If the line belongs to the
    // item, it must be indented and parsed by the item sub-lexer; otherwise a
    // later flush-left `:::` can be incorrectly pulled in as the item's closer.
    (RE_ADMONITION_OPEN.test(line) && !RE_ADMONITION_CLOSE.test(line)) ||
    RE_DIV_OPEN.test(line) ||
    RE_LINE_BLOCK_OPEN.test(line) ||
    RE_HARDBREAKS_OPEN.test(line) ||
    RE_QUOTE_BLOCK_OPEN.test(line) ||
    (leadingWhitespace(line) === 0 && (RE_FOOTNOTE_DEF.test(line) || isLinkDefLine(line))) ||
    RE_HR.test(line) ||
    RE_HEADING.test(line) ||
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

/**
 * Which half of a definition-list entry the item's tracker last saw open: the
 * TERM (a `::` line), its DESCRIPTION body (a `:` line), or neither.
 */
type DefListOpening = false | 'term' | 'description'

type ItemOpaqueState =
  | { kind: 'code'; close: RegExp; column?: number }
  | { kind: 'comment'; length: number; paragraphBefore: boolean; atColumn: boolean; term?: boolean }

/**
 * A verbatim fence a DESCENDANT of a list item holds open, with its base.
 *
 * No comment arm: `commentFenceRun` accepts an INDENTED delimiter
 * (markup-carve/carve-js#816), so the item's own tracker already opens on a
 * descendant's `%%%` and a fence-shaped line in that payload is already body.
 * Tracking it here as well moved nothing over 1968 corpus documents and 13776
 * generated shapes.
 */
export interface DescendantOpaque { close: RegExp; base: number; markerLine?: boolean; holder?: number }

export interface ItemLazyState {
  retainedMarker?: boolean
  opaque: ItemOpaqueState | null
  termAfterComment?: boolean
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
  /** A consumed below-column comment retains a noninterrupting follower. */
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
  footnoteBodyColumn?: number
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
  //
  // WHICH HALF OF THE ENTRY IS OPEN, not just whether one is: with a
  // description body already open, a lazy `:` line folds into that body instead
  // of registering a second one, and the quoted-item arm below has to tell the
  // two apart (markup-carve/carve-js#1606).
  inDefList: DefListOpening
  // Whether the item's open paragraph has absorbed a MALFORMED colon fence and
  // is therefore taking the next fence-shaped line as text too (PART 9 §12,
  // "a colon-fence line that fails the opener test leaves the paragraph
  // expecting a closer"). The block layer has implemented that rule at top
  // level for a long time; this tracker did not, so it read the trailing `:::`
  // of `- item` / `  :::note` / `  body` / `  :::` as a div opener and closed
  // the item, where PART 1 S4 folds the following flush-left line into the
  // paragraph that was never interrupted (carve#891).
  absorbingFence: boolean
  inlineFenceParagraph?: boolean
  /** Reads a literal line block's marker-shaped payload, which opens no block. */
  literalLayout?: boolean
  // Fed by a definition body's collector rather than a list item's.
  definitionBody?: boolean
  descriptionColumn?: number
  /** Whether the stored description column came from a term. */
  descriptionHasTerm?: boolean
  closedBelowComment?: boolean
  // The column of the first fence run with no closer. Its rebase group runs to
  // the end of the item, so only a line at this exact column is authored again.
  unclosedFenceBase?: number
  // The collector's paragraph carry can contain a real code block in a colon body.
  inlineFenceBlock?: boolean
  unrebasedColonBody?: { width: number }
  // Only a marker-line container admits a named opener past its body column.
  markerColonBody?: boolean
  closedColonBody?: boolean
  closedLiteralComment?: boolean
  // How many colon-fence containers the item's own content currently holds
  // open. A bare `:::` with one open is that container's CLOSER, not an opener
  // and not absorbable text - which is why a malformed fence INSIDE an open
  // container arms nothing: the closer below it still has a container to close.
  divDepth: number
  literalColon?: { width: number; column: number; sourceLine?: number; awaitingBody?: boolean; rejectedComment?: boolean; opaque?: OpaqueGroup; absorbing?: boolean; belowComment?: number }
  authoredColon?: { width: number; column: number; depth: number; belowComment?: number }
  // The lines so far of a `{…}` block-attribute block that has not closed yet,
  // newline-joined, or null when the tracker is not inside one. §15 A5 lets the
  // block WRAP, so the tracker has to hold it open the way it holds a fence
  // open - otherwise `{.k` / `#x}` reads as two lines of prose and the container
  // keeps a paragraph nothing opened (markup-carve/carve#1281).
  attrRun: string | null
  /**
   * The leading run a container INSIDE the item currently owns, or -1.
   *
   * The same distinction `rebaseOverindentedBlocks` carries as `ownedColumn`. A
   * run the column owns is a NESTING LEVEL; any other run is an AUTHORED
   * over-indent. Without it the tracker held only the paragraph answer
   * `markerLineState` gave it, so the arm below could not tell the two apart and
   * reading a nested item's own column flush erased a level.
   *
   * In the CHARACTER unit `ItemLineFacts.whitespace` reports, which the lexer
   * has already measured for the line, so none of this re-scans a leading run.
   */
  ownedColumn: number
  /** Marker column for a descendant item, in this frame's coordinates. */
  ownedMarker?: number
  /**
   * Is `ownedColumn` an AUTHORED base rather than a nested marker's column?
   *
   * The two own different lines. A nested marker owns everything at or past its
   * content column; an authored base owns only what is PAST it, because a line
   * AT the base is more of the same block.
   */
  ownedAuthored: boolean
  /**
   * Q1 FOR THE DESCENDANT `ownedColumn` NAMES, while that frame is open.
   *
   * A below-column line continues a paragraph if and only if one is open at the
   * DEEPEST frame (`CARVE-P0-009`, markup-carve/carve#2884), and the arms below
   * answer for THIS item's column. A line at or past a nested marker's content
   * column is the deeper item's, so it is classified there - by this same
   * tracker, one frame in, which is what makes a fence span, a `:::` container
   * and a quote answer as well as the three one-line blocks do.
   *
   * Null until a nested marker opens a frame, and dropped again when a line
   * lands back at this item's own content. An AUTHORED over-indent keeps the
   * narrower arm below instead: a line AT an authored base is more of the same
   * block, so a fence written there is the one its paragraph ABSORBED.
   */
  deepest?: ItemLazyState | null
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
  return state.opaque !== null || state.divDepth > 0
}

function isRetainableLineComment(lexer: Lexer, content: string): boolean {
  if (!RE_COMMENT_LINE.test(content.trimStart())) return false
  const run = commentFenceRun(content.trimStart())
  return run === undefined || !commentBlockHasCloser(lexer, run)
}

function retainCommentBoundary(state: ItemLazyState): void {
  state.lazyFoldable = false
  state.commentAtColumn = true
  state.ownedColumn = -1
  state.deepest = null
}

/**
 * The index past the closer of a matched `%%%` fence opening at `at`, or
 * undefined. The first bare run of the same width closes it at any column.
 * CARVE-P9-053: such a fence answers exactly as one `%%` line at the opener's column.
 */
function matchedCommentFenceEnd(
  lexer: Lexer,
  at: number = lexer.pos,
  endsContainer: (line: string) => boolean = () => false,
): number | undefined {
  const opener = lexer.lineAt(at)
  if (opener === undefined) return undefined
  const run = commentFenceRun(opener.replace(/^[ \t]+/, ''))
  if (run === undefined) return undefined
  for (let j = at + 1; ; j++) {
    const line = lexer.lineAt(j)
    if (line === undefined) return undefined
    if (commentFenceRun(line.replace(/^[ \t]+/, '')) === run) return j + 1
    if (endsContainer(line)) return undefined
  }
}

function retainBelowColumnComment(content: string, state: ItemLazyState, atColumn: boolean): boolean {
  if (atColumn || state.opaque !== null || state.literalColon !== undefined ||
      !RE_COMMENT_LINE.test(content.trimStart())) return false
  retainCommentBoundary(state)
  return true
}

/** An `ItemLazyState` that has seen nothing, for a collector that only reads fences. */
function verbatimOnlyLazyState(): ItemLazyState {
  return {
    opaque: null,
    invisibleAtColumn: false,
    commentAtColumn: false,
    inFootnoteBody: false,
    absorbingFence: false,
    divDepth: 0,
    lazyFoldable: false,
    inTable: false,
    quoteInner: null,
    inDefList: false,
    attrRun: null,
    ownedColumn: -1,
    ownedAuthored: false,
  }
}

/**
 * Give back what a buffered blank leaves inside an open verbatim region.
 *
 * A collector buffers a blank as `''`, which is right for a separator and wrong
 * for a line of spaces inside a fence: CARVE-P11-016 keeps that content.
 *
 * The pass runs AFTER the rebase, and it has to. `trackItemLazyState` reads a
 * fence FLUSH, and the rebase is what brings an authored base flush - asked
 * during collection, a body written past its minimum column never showed the
 * tracker a fence at all. The residue is measured past the OPENER's own source
 * column, because that is the column the code block's content is measured past.
 */
function restoreVerbatimBlanks(
  lines: string[],
  sourceLines: readonly (string | undefined)[],
  buffered: ReadonlySet<number>,
  openerColumn: (index: number) => number,
  factsAt?: (index: number) => ItemLineFacts | undefined,
): void {
  if (buffered.size === 0) return
  const state = verbatimOnlyLazyState()
  let column = -1
  for (let i = 0; i < lines.length; i++) {
    if (buffered.has(i)) {
      const source = sourceLines[i]
      if (source !== undefined && column >= 0 && insideOpenFence(state)) {
        lines[i] = sliceColumns(source, column, true)
      }
      trackItemLazyState(lines[i]!, state, undefined, true, undefined, factsAt?.(i))
      continue
    }
    const wasOpen = insideOpenFence(state)
    trackItemLazyState(lines[i]!, state, undefined, true, undefined, factsAt?.(i))
    if (!wasOpen && insideOpenFence(state)) column = openerColumn(i)
  }
}

/**
 * Does the item currently end on a BLOCK QUOTE WITH AN OPEN PARAGRAPH?
 */
function insideOpenQuoteParagraph(state: ItemLazyState): boolean {
  return state.quoteInner !== null && blockQuoteParagraphOpen(state.quoteInner)
}

export interface AttachedViewScan {
  colon?: Map<number, number>
  colonMisses?: Map<number, FailedScanRanges>
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
  cache: AttachedViewScan
  preciseClosers: () => AttachmentFenceClosers
  end: number
  contentColumn: number
  indexBase: number
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
  const run = marker === null ? commentFenceRun(line) : undefined
  if (marker !== null ? !codeCloserPossible(scan.index, marker, scan.base + i)
    : run === undefined || !exactCloserPossible(scan.index.comment, run, scan.base + i)) return -1
  const index = scan.preciseClosers()
  const end = marker !== null
    ? index.nextCode(marker, scan.indexBase + scan.base + i + 1, scan.indexBase + scan.end, scan.contentColumn)
    : index.nextComment(run!, scan.indexBase + scan.base + i + 1, scan.indexBase + scan.end)
  return end === undefined ? -1 : end - scan.indexBase - scan.base
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
  const memo = scan.cache.colon ??= new Map()
  const opener = scan.base + openIdx
  const cached = memo.get(opener)
  if (cached !== undefined) return cached < 0 ? -1 : cached - scan.base
  if (!exactCloserPossible(scan.index.colon, len, opener)) {
    memo.set(opener, -1)
    return -1
  }
  const misses = scan.cache.colonMisses ??= new Map()
  const fail = (stack: { opener: number; width?: number; ranges?: { start: number; end: number }[] }[]): number => {
    for (const frame of stack) memo.set(frame.opener, -1)
    for (const frame of stack) {
      if (frame.width === undefined || frame.ranges === undefined) continue
      let retained = misses.get(frame.width)
      if (retained === undefined) {
        retained = new FailedScanRanges()
        misses.set(frame.width, retained)
      }
      for (const range of frame.ranges) retained.add(range.start, range.end)
    }
    return -1
  }
  const lastClose = (width: number, from: number): number => {
    const last = scan.preciseClosers().lastColon(width, scan.indexBase + from, scan.indexBase + scan.end, scan.contentColumn)
    return last === undefined ? -1 : last - scan.indexBase
  }
  const rootLastClose = lastClose(len, opener + 1)
  if (rootLastClose < 0) return fail([{ opener }])
  const stack = [{ width: len, opener, lastClose: rootLastClose, ranges: [] as { start: number; end: number }[] }]
  for (let j = openIdx + 1; ; j++) {
    const frame = stack[stack.length - 1]!
    const position = scan.base + j
    if (misses.get(frame.width)?.has(position)) return fail(stack)
    const event = scan.preciseClosers().nextEvent(scan.indexBase + position, scan.indexBase + scan.end, scan.contentColumn)
    const next = event === undefined ? scan.end : event - scan.indexBase
    const previous = frame.ranges[frame.ranges.length - 1]
    if (previous?.end === position) previous.end = next + 1
    else frame.ranges.push({ start: position, end: next + 1 })
    if (event === undefined || next > frame.lastClose) return fail(stack)
    j = next - scan.base
    const line = scan.at(j)!
    if (layoutWork.on) layoutWork.attachmentColonLines++
    // Skipped from the line AFTER its opener: an opener with no info string is
    // closer-shaped itself and would otherwise end the span where it began.
    const span = opaqueSpanEnd(scan, j)
    if (span !== -1) {
      j = span
      continue
    }
    const close = RE_ADMONITION_CLOSE.exec(line)
    const closeLen = close?.[1]?.length
    if (closeLen === stack[stack.length - 1]!.width) {
      const frame = stack.pop()!
      memo.set(frame.opener, scan.base + j)
      if (stack.length === 0) return j
      continue
    }
    const open = closeLen ?? colonBlockOpenerRun(line)
    if (open === null) continue
    const known = memo.get(scan.base + j)
    if (known !== undefined) {
      if (known < 0) return fail(stack)
      j = known - scan.base
    } else stack.push({ width: open, opener: scan.base + j, lastClose: lastClose(open, scan.base + j + 1), ranges: [] })
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
/** The column a source line's content starts at, past any quote markers. */
function sourceQuotePrefixEnd(line: string, start: number): number {
  let end = start
  while (line[end] === ' ' || line[end] === '\t') end++
  if (line[end] !== '>') return -1
  end++
  if (line[end] === ' ' || line[end] === '\t') end++
  return end
}

function quotePrefixDepth(line: string): number {
  let depth = 0
  for (let offset = 0, end = sourceQuotePrefixEnd(line, offset); end >= 0; end = sourceQuotePrefixEnd(line, offset)) {
    depth++
    offset = end
  }
  return depth
}

function sourceQuoteBody(line: string): string {
  let offset = 0
  for (let end = sourceQuotePrefixEnd(line, offset); end >= 0; end = sourceQuotePrefixEnd(line, offset)) offset = end
  const body = line.slice(offset)
  return body.slice(leadingWhitespace(body))
}

function sourceColumn(line: string, quoteLevels = Infinity): number {
  let column = 0
  let offset = 0
  for (let level = 0; level < quoteLevels; level++) {
    const end = sourceQuotePrefixEnd(line, offset)
    if (end < 0) {
      if (quoteLevels !== Infinity) return Infinity
      break
    }
    for (; offset < end; offset++) column += line[offset] === '\t' ? 4 - column % 4 : 1
  }
  while (line[offset] === ' ' || line[offset] === '\t') {
    column += line[offset] === '\t' ? 4 - column % 4 : 1
    offset++
  }
  return column
}

function sourceQuoteLocalColumn(line: string, levels: number): number {
  let offset = 0
  for (let level = 0; level < levels; level++) {
    const end = sourceQuotePrefixEnd(line, offset)
    if (end < 0) return Infinity
    offset = end
  }
  return indentColumns(line.slice(offset))
}

function quoteIndentHasTab(line: string, levels: number): boolean {
  let offset = 0
  for (let level = 0; level < levels; level++) {
    const end = sourceQuotePrefixEnd(line, offset)
    if (end < 0) return false
    offset = end
  }
  const body = line.slice(offset)
  return body.slice(0, leadingWhitespace(body)).includes('\t')
}

function quoteBodyColumn(line: string, levels: number): number {
  let column = 0
  let offset = 0
  for (let level = 0; level < levels; level++) {
    const end = sourceQuotePrefixEnd(line, offset)
    if (end < 0) return Infinity
    for (; offset < end; offset++) column += line[offset] === '\t' ? 4 - column % 4 : 1
  }
  return column
}

function sourceColumnAt(line: string, offset: number): number {
  let column = 0
  for (let index = 0; index < offset; index++)
    column += line[index] === '\t' ? 4 - column % 4 : 1
  return column
}

type OpenMarker = { kind: 'list' | 'footnote' | 'description' | 'quote'; column: number; localColumn: number; quoteDepth: number; contentColumn: number; firstBlock: boolean }
type MarkerDecision = { owner?: OpenMarker; reason?: RefusedContinuationMarker['reason']; blockedByInnerList?: boolean; unprefixedQuoteFollower?: boolean }

class OpenMarkerClassifier {
  private stack: OpenMarker[] = []
  private decisions = new Map<number, MarkerDecision>()
  private scanned = 0

  constructor(private readonly lines: readonly string[]) {}

  get(index: number): MarkerDecision {
    while (this.scanned <= index && this.scanned < this.lines.length) this.step(this.scanned++)
    return this.decisions.get(index) ?? {}
  }

  private step(index: number): void {
    const line = this.lines[index]!
    const depth = quotePrefixDepth(line)
    const column = sourceColumn(line)
    const localColumn = depth > 0 ? sourceQuoteLocalColumn(line, depth) : column
    // `>+` and `> +` name the same quote level despite different physical
    // columns for the +. At the quote body's start, compare local columns.
    const useLocalColumn = depth > 0 && (quoteIndentHasTab(line, depth) || localColumn === 0)
    const markerColumn = useLocalColumn ? localColumn : column
    const body = sourceQuoteBody(line)
    if (isContinuationMarker(body)) {
      layoutWork.markerLinesClassified += Number(layoutWork.on)
      let owner: OpenMarker | undefined
      const deepestQuote = this.stack.reduce((deepest, entry) => entry.kind === 'quote'
        ? Math.max(deepest, entry.quoteDepth) : deepest, 0)
      const blockedByInnerList = depth > 0 && this.stack.some(entry => entry.kind === 'list' && entry.quoteDepth >= depth)
      for (let at = this.stack.length - 1; at >= 0; at--) {
        layoutWork.markerStackEntriesExamined += Number(layoutWork.on)
        const entry = this.stack[at]!
        if ((useLocalColumn ? entry.localColumn : entry.column) === markerColumn &&
            entry.quoteDepth === depth && (depth === 0 || depth >= deepestQuote)) { owner = entry; break }
      }
      const follower = this.lines[index + 1]
      if (follower !== undefined) layoutWork.markerFollowerProbes += Number(layoutWork.on)
      const followerColumn = follower === undefined ? Infinity : useLocalColumn
        ? sourceQuoteLocalColumn(follower, depth) : sourceColumn(follower, depth)
      const followerBody = follower === undefined ? '' : sourceQuoteBody(follower)
      const sibling = follower !== undefined && followerColumn === markerColumn &&
        (unorderedMatch(followerBody) !== null || orderedMatch(followerBody) !== null)
      const unprefixedQuoteFollower = depth === 0 && owner?.kind === 'description' && sibling &&
        this.stack.some(entry => entry.kind === 'quote' && entry.quoteDepth > 0)
      const reason: MarkerDecision['reason'] = owner === undefined ? 'wrong-column'
        : follower === undefined ? 'document'
          : isBlankLine(followerBody) ? 'blank'
            : followerColumn < markerColumn ? 'left'
              : followerColumn > markerColumn ? 'right'
                : sibling && owner.kind === 'list' ? 'sibling' : undefined
      this.decisions.set(index, { ...(owner ? { owner } : {}), ...(reason ? { reason } : {}),
        ...(blockedByInnerList ? { blockedByInnerList } : {}), ...(unprefixedQuoteFollower ? { unprefixedQuoteFollower } : {}) })
      return
    }
    if (isBlankLine(line)) return
    this.stack = this.stack.filter(entry => entry.kind !== 'quote')
    while (this.stack.length && (this.stack.at(-1)!.quoteDepth > depth ||
      this.stack.at(-1)!.quoteDepth === depth && this.stack.at(-1)!.column >= column)) this.stack.pop()
    for (let level = 1; level <= depth; level++) {
      const quoteColumn = quoteBodyColumn(line, level)
      this.stack.push({ kind: 'quote', column: quoteColumn, localColumn: 0, quoteDepth: level,
        contentColumn: quoteColumn, firstBlock: false })
    }
    let inner = body
    let innerColumn = column
    let innerLocalColumn = localColumn
    let innerDepth = depth
    for (let level = 0; level < 32; level++) {
      const marker = taskMatch(inner) ?? unorderedMatch(inner) ?? orderedMatch(inner)
      if (marker !== null) {
        const content = marker.at(-1) ?? ''
        const width = inner.length - content.length
        this.stack.push({ kind: 'list', column: innerColumn, localColumn: innerLocalColumn, quoteDepth: innerDepth,
          contentColumn: innerColumn + width, firstBlock: isContinuationMarker(content) })
        innerColumn += width
        innerLocalColumn += width
        inner = content.trimStart()
        continue
      }
      const quoted = quotedLineText(inner, false)
      if (quoted !== null) {
        innerDepth++
        innerColumn += inner.length - quoted.length
        innerLocalColumn = indentColumns(quoted)
        this.stack.push({ kind: 'quote', column: innerColumn, localColumn: innerLocalColumn, quoteDepth: innerDepth,
          contentColumn: innerColumn, firstBlock: isContinuationMarker(quoted) })
        inner = quoted.trimStart()
        continue
      }
      if (inner.startsWith('[^') && inner.includes(']:'))
        this.stack.push({ kind: 'footnote', column: innerColumn, localColumn: innerLocalColumn, quoteDepth: innerDepth, contentColumn: innerColumn + 2, firstBlock: false })
      else if (inner.startsWith(': '))
        this.stack.push({ kind: 'description', column: innerColumn, localColumn: innerLocalColumn, quoteDepth: innerDepth, contentColumn: innerColumn + 2, firstBlock: false })
      break
    }
  }
}

const markerClassifiers = new WeakMap<readonly string[], OpenMarkerClassifier>()

function markerDecision(lexer: Lexer, lineIndex: number): MarkerDecision {
  const root = lexer.rootLines ?? lexer.lines
  let classifier = markerClassifiers.get(root)
  if (classifier === undefined) markerClassifiers.set(root, classifier = new OpenMarkerClassifier(root))
  return classifier.get(lexer.lineNumber(lineIndex) - 1)
}

function attachesAtDocumentColumnZero(lexer: Lexer, markerColumn = 0, quoteLevels = Infinity, firstBlock = false): boolean {
  if (lexer.pos > 0) {
    const marker = (lexer.rootLines ?? lexer.lines)[lexer.lineNumber(lexer.pos - 1) - 1]
    if (marker !== undefined && isContinuationMarker(sourceQuoteBody(marker)) && !firstBlock) {
      const decision = markerDecision(lexer, lexer.pos - 1)
      if (decision.reason !== undefined && decision.reason !== 'wrong-column') return false
    }
  }
  // THE DOCUMENT'S OWN LINES, OR THIS LEXER'S IF IT IS THE DOCUMENT. Only a
  // SUB-lexer carries `rootLines`; the root lexer's `lines` ARE the document,
  // and reading the absence as "cannot answer" made the gate return true for
  // every container parsed at top level - which is every one of them
  // (markup-carve/carve#1814). The distinction that matters is source column
  // versus FRAME column, and at the root those are the same number.
  const root = lexer.rootLines ?? lexer.lines
  const line = root[lexer.lineNumber(lexer.pos) - 1]
  if (line === undefined) return true
  if (firstBlock && sourceColumn(line, 0) === 0 && !isListMarkerLine(line)) return true
  if (quoteLevels === Infinity) {
    let offset = 0
    for (let end = sourceQuotePrefixEnd(line, offset); end >= 0; end = sourceQuotePrefixEnd(line, offset)) offset = end
    return indentColumns(line.slice(offset)) === markerColumn
  }
  const column = sourceColumn(line, quoteLevels)
  return column === markerColumn
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
export function isBlockAttributeLine(content: string): boolean {
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
 * ordinary prose line makes each one pay for that predicate.
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

// Read the quote prefix without mistaking a partial window for the end of the line.
function quotePrefixLength(content: string, from: number, bound: number): number {
  if (content[from] !== '>') return 0
  if (from + 1 === bound) return 1
  if (content[from + 1] === ' ') return 2
  if (/^(?:> ?)*\+[ \t]*$/.test(content.slice(from + 1, bound))) return 1
  if (content[from + 1] !== '\t') return 0
  // A tab starts no quote separator unless the entire remainder is line-final layout.
  for (let at = from + 1; at < bound; at++) {
    if (content[at] !== ' ' && content[at] !== '\t') return 0
  }
  return bound - from
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
  // Every pattern opens with `[ \t]*` and then needs a non-blank character, so
  // the indent is counted once and only the window past it reaches the regexes.
  // The window ENDS stay where they were: a window cut through a task box can
  // match as a bare bullet, and moving the cut would change that answer.
  let lead = from
  for (let code = content.charCodeAt(lead); lead < bound && (code === 32 || code === 9); code = content.charCodeAt(++lead));
  if (lead === bound) return 0
  for (let width = PREFIX_WINDOW; ; width *= 2) {
    const end = Math.min(from + width, bound)
    if (end > lead) {
      const window = content.slice(lead, end)
      const marked = extractItemAttr(window)?.stripped ?? window
      const item = RE_TASK.exec(marked) ?? RE_ORDERED.exec(marked) ?? RE_UNORDERED.exec(marked)
      // The attribute block is stripped OUT of `marked`, so the marker length is
      // measured against the window rather than against `marked`: the content is
      // a suffix of both, and only the window still holds the braces.
      if (item) return lead - from + window.length - item[item.length - 1]!.length
    }
    if (end === bound) return 0
  }
}

/**
 * How much of `content` is container prefix - any interleaving of block quote
 * markers and list item markers, in any order and to any depth.
 */
function walkContainerPrefix(content: string, memo?: Map<number, number>): number {
  const cached = memo?.get(content.length)
  if (cached !== undefined) return cached
  const bound = prefixWalkBound(content)
  const offsets: number[] = []
  let at = 0
  for (;;) {
    const suffix = memo?.get(content.length - at)
    if (suffix !== undefined) { at += suffix; break }
    if (memo) offsets.push(at)
    const quote = quotePrefixLength(content, at, bound)
    if (quote > 0) {
      at += quote
      continue
    }
    const marker = markerPrefixLength(content, at, bound)
    if (marker === 0) break
    at += marker
  }
  // Descendant items receive these same suffixes after stripping their marker.
  // Share only offsets; each item creates its own mutable continuation state.
  for (const offset of offsets) memo!.set(content.length - offset, at - offset)
  return at
}

/**
 * The quote a marker line ends on, tracked, or null when it ends on none.
 *
 * The marker line never goes through the running tracker, so a quote opened
 * there arrived at the next line as a FRESH one and forgot the table, fence or
 * div it was holding: `:  > | a |` / `   > + b |` read the continuation row
 * with no row above it (markup-carve/carve#1348, corpus 349-5).
 */
function markerLineQuoteState(content: string, memo?: Map<number, number>): BlockQuoteLazyState | null {
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
    undefined,
    memo,
  )

  return inner
}


/**
 * Does the block written ON a list item's MARKER LINE leave an open paragraph
 * behind it?
 */
/**
 * The block at the BOTTOM of a marker line's stack, as text.
 *
 * Split out of the classifier so the three questions asked of a marker line -
 * does it leave a paragraph, does it end on a table row, and what quote does it
 * end on - are answered from ONE walk. Asking them separately walked the prefix
 * twice per marker line.
 */
function markerLineBottomBlock(content: string, memo?: Map<number, number>): string {
  // `> > # H` is the quote's question twice over, and `- - # H` is the
  // sub-item's, whose first block is the heading exactly as a bare `- # H`'s
  // is - so the strip runs to the bottom of the stack. It is a WALK BY OFFSET:
  // every regex it consults is anchored with `$`, so re-slicing the remainder
  // per marker cost O(N * line length) on a line of N markers (carve-js#1190).
  const walked = walkContainerPrefix(content, memo)

  return walked === 0 ? content : content.slice(walked)
}

/**
 * Is the first LIST in this marker line's run nested INSIDE a quote?
 *
 * Prefix order matters: the list in `> - ` is the quote's and
 * dies with it, where the list in `- > ` is the outer container and outlives the
 * quote it holds (markup-carve/carve-js#2540). Asking only "both kinds present"
 * moved all 30 of the `- > ` shapes off the oracle.
 */
function markerRunListIsQuoteHeld(content: string): boolean {
  const bound = prefixWalkBound(content)
  let at = 0
  let quoted = false
  for (;;) {
    const quote = quotePrefixLength(content, at, bound)
    if (quote > 0) {
      quoted = true
      at += quote
      continue
    }
    const marker = markerPrefixLength(content, at, bound)
    if (marker === 0) return false

    return quoted
  }
}

/**
 * Track the first closer of the description body's nested lead, reading only
 * lines appended since the previous query. A closed nested fence leaves no
 * paragraph until a following block opens one.
 */
function descriptionLeadFenceScans(lead: string): {
  code: AppendOnlyCloser
  paragraphOpen: (lines: readonly string[], fallback: boolean, hasCloser: (marker: string, extraColumns?: number) => boolean, atContentColumn: boolean) => boolean
} {
  const bottom = markerLineBottomBlock(lead)
  const nested = bottom !== lead
  const fence = nested ? RE_FENCE.exec(bottom) ?? RE_RAW_FENCE.exec(bottom) : null
  const close = fence ? fenceCloseRe(RE_FENCE.test(bottom) ? fence[2]! : fence[1]!) : undefined
  const bound = prefixWalkBound(lead)
  let at = 0
  let column = 0
  for (;;) {
    const prefix = markerPrefixLength(lead, at, bound)
    if (prefix === 0) break
    column += markerContentColumn(lead.slice(at, at + prefix) + 'x')
    at += prefix
  }
  const ownFence = at > 0 ? RE_FENCE.exec(lead.slice(at)) ?? RE_RAW_FENCE.exec(lead.slice(at)) : null
  const ownClose = ownFence ? fenceCloseRe(RE_FENCE.test(lead.slice(at)) ? ownFence[2]! : ownFence[1]!) : undefined
  let next = 1
  let closed = false
  let ownsBody = true
  const trailing = verbatimOnlyLazyState()

  return {
    code: new AppendOnlyCloser(close ? line => close.test(line.replace(/^[ \t]+/, '')) : undefined),
    paragraphOpen: (lines, fallback, hasCloser, atContentColumn) => {
      if (ownClose === undefined) return fallback
      if (!ownsBody) return false
      for (; next < lines.length; next++) {
        const line = lines[next]!
        if (!closed) {
          const indent = indentColumns(line)
          if (atContentColumn && !isBlankLine(line) && indent < column) {
            ownsBody = false
            return false
          }
          if (indent === column && ownClose.test(line.trimStart())) closed = true
          continue
        }
        trackItemLazyState(sliceColumns(line, column), trailing, hasCloser)
      }

      return closed ? trailing.lazyFoldable : false
    },
  }
}

/**
 * Does a nested marker line leave the ITEM'S OWN PARAGRAPH open, for the lines
 * the description body takes below that item's content column?
 *
 * `markerLineState`'s `leavesParagraphOpen` answers one question short of this
 * one: a code or raw FENCE leaves the flag set, which is the accident
 * markup-carve/carve-js#2531 named, and a fence is a BLOCK - the oracle reads a
 * line below a fenced item as the body's own, where it folds the same line into
 * an item ending in prose, a quote with an open paragraph or a
 * nested item. Measured over the lead kinds rather than assumed
 * (markup-carve/carve-js#2535).
 *
 * The one spelling both call sites ask in - the body's lead and every later line
 * the body takes AT its own column.
 */
function nestedItemHoldsOpenParagraph(content: string, memo?: Map<number, number>): boolean {
  if (!markerLineState(content, memo).leavesParagraphOpen) return false
  const bottom = markerLineBottomBlock(content, memo)

  return !RE_FENCE.test(bottom) && !RE_RAW_FENCE.test(bottom) &&
    !colonFenceShapeEndsLazyContinuation(bottom)
}

function markerLineState(content: string, memo?: Map<number, number>): {
  leavesParagraphOpen: boolean
  endsOnTableRow: boolean
  bottomIsContinuationMarker: boolean
  wrappedAttributeRun: string | null
  quote: BlockQuoteLazyState | null
} {
  const bottom = markerLineBottomBlock(content, memo)
  const quote = markerLineQuoteState(content, memo)
  const fenceShaped = RE_FENCE.test(bottom) || RE_RAW_FENCE.test(bottom) ||
    colonFenceShapeEndsLazyContinuation(bottom)
  let hasNestedQuote = false
  if (fenceShaped && quote === null) {
    const prefix = content.slice(0, content.length - bottom.length)
    if (prefix.includes('>')) {
      for (let at = 0; at < prefix.length;) {
        const quoted = quotePrefixLength(prefix, at, prefix.length)
        if (quoted > 0) { hasNestedQuote = true; break }
        const marker = markerPrefixLength(prefix, at, prefix.length)
        if (marker === 0) break
        at += marker
      }
    }
  }

  return {
    leavesParagraphOpen: (quote !== null || hasNestedQuote) && fenceShaped
      ? false : bottomBlockLeavesParagraphOpen(bottom),
    endsOnTableRow: quote === null && isTableRow(bottom),
    // A bare `+` at the bottom of the marker line is the CONTINUATION MARKER
    // (§17 L3), and what it names is a document-column-0 block. It is not
    // prose, so it opens no paragraph an INDENTED line could fold into - see
    // the fold branch that reads this (markup-carve/carve#1436).
    bottomIsContinuationMarker: quote === null && isContinuationMarker(bottom),
    wrappedAttributeRun: opensWrappedAttributeBlock(bottom) ? bottom : null,
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
 * Is `content` more text of a paragraph that holds an unclosed fence run?
 *
 * A line that opens a block ends that paragraph instead (section 10), and the
 * block may be a closed one that leaves nothing for a below-column line to
 * continue (CARVE-P0-009). `base` is the column the unclosed run was authored
 * at: a line at exactly that column was rebased with it and is read flush.
 */
function continuesInlineFenceParagraph(content: string, base: number | undefined, terminatorFree: boolean): boolean {
  if (!bottomBlockLeavesParagraphOpen(content)) return false
  const text = content.trimStart()
  if (opensCodeFence(text)) return false
  if (markerPrefixLength(text, 0, prefixWalkBound(text)) > 0 || quotedLineText(text, terminatorFree) !== null) return false
  const atBase = base !== undefined && base > 0 && text !== content && indentColumns(content, base + 1) === base
  return !atBase || bottomBlockLeavesParagraphOpen(text)
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

export interface ItemLineFacts {
  quoteFenceCloser?: (marker: string, depth?: number, column?: number) => boolean
  terminatorFree: boolean
  whitespace?: number | undefined
  prefixMemo?: Map<number, number> | undefined
  rebasedFrame?: boolean | undefined
  /**
   * May a line at or past a nested marker's content column be classified in
   * that DESCENDANT's frame (`CARVE-P0-009`, markup-carve/carve#2884)?
   *
   * The LIST ITEM host opts in. A description body does not: a flush-left fence
   * line below a closed nested fence is clamped to one column there and stays
   * the outer item's text, which is its own ruling (carve-js#2515, carve#1958)
   * and is what the executable spec still writes.
   */
  descendantFrames?: boolean | undefined
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
  // `|<|` and the padded `| < |` are colspan markers. A glued `<` followed
  // by a space (`|< |`) is an alignment run on an empty cell.
  if (trimCellPadding(src) === '<' && (src === '<' || (src.startsWith(' ') && src.endsWith(' ')))) return { header: false, span: 'colspan', content: '' }

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
 * so a cell whose whole payload is `^` or `<` needs an escape when written
 * with span padding. A glued `<` followed by a space reads as alignment, but
 * the writer cannot rely on that spelling for every cell shape.
 *
 * The predicate is over the PAYLOAD, so it answers the question the writer can
 * ask before it has decided which prefix the cell takes. Both of the parser's
 * span decisions above are reached with `i === 0`. A leading `^` sets
 * `invalidAxis`; a padded `<` is caught before the alignment run scan.
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
  /** Continuation text on a span marker, joined to its origin after the span walk. */
  joins?: Array<{ frag: string; at: FragmentPlace | null; marker: FragmentPlace | null; sep: FragmentPlace | null; line: number; rowIndex: number }>
  /** The `+` of the continuation line the last fragment came from. */
  lastMarker?: number
  wraps?: Array<{ offset: number; line: number; row?: number; col?: number; pos?: Position }>
}

interface FragmentPlace {
  offset: number
  line: number
  column: number
}

/** Appends one `+` continuation fragment to a cell's collected source. */
function joinFragment(target: RawCell, frag: string, at: FragmentPlace | null, line?: number, row?: number, marker?: FragmentPlace | null, sep?: FragmentPlace | null, col?: number): void {
  const fragStart = target.raw ? target.raw.length + 1 : 0
  // A second fragment from the same `+` line joins across that line's own pipe,
  // so its marker is the pipe and not the `+` the first join already covers.
  const sameLine = marker && target.lastMarker === marker.offset
  if (marker) target.lastMarker = marker.offset
  else delete target.lastMarker
  if (sameLine) marker = sep ?? null
  if (target.raw && line !== undefined) (target.wraps ??= []).push({
    offset: fragStart - 1, line, ...(row ? { row } : {}), ...(col !== undefined ? { col } : {}),
    ...(marker ? { pos: {
      startLine: marker.line, endLine: marker.line,
      startColumn: marker.column, endColumn: marker.column + 1,
      startOffset: marker.offset, endOffset: marker.offset + 1,
    } } : {}),
  })
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
  if (at) {
    const range: AnchorRange = { from: fragStart, to: fragStart + frag.length, ...at }
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
  const stripped = trimEndSpaceTab(line)
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

/**
 * Split a table row into cells, reporting where each one STARTS in the line.
 *
 * The start index is what lets a cell carry a real span (PART 12 section 4)
 * instead of none. Rows with escapes or verbatim spans need a character scan;
 * ordinary rows can slice cells directly from the source.
 */
export function splitTableRowSpans(
  line: string,
  carried?: readonly number[],
): Array<{ text: string; start: number }> {
  if (carried === undefined && !line.includes('\\') && !line.includes('`')) {
    const cells: Array<{ text: string; start: number }> = []
    const begin = line[0] === '|' || line[0] === '+' ? 1 : 0
    const bodyEnd = trimEndSpaceTab(line).length
    const scanEnd = bodyEnd > begin && line[bodyEnd - 1] === '|' ? bodyEnd - 1 : line.length
    let start = begin
    for (let pipe = line.indexOf('|', start); pipe !== -1 && pipe < scanEnd; pipe = line.indexOf('|', start)) {
      cells.push({ text: line.slice(start, pipe), start })
      start = pipe + 1
    }
    const last = line.slice(start, scanEnd)
    if (scanEnd < line.length || trimStructural(last) !== '') cells.push({ text: last, start })
    return cells
  }
  const cells: Array<{ text: string; start: number }> = []
  let buf = ''
  let cellIndex = 0
  let openRun = carried?.[0] ?? 0
  let i = 0
  // Skip the leading row marker: `|` (standard) or `+` (continuation)
  if (line[0] === '|' || line[0] === '+') i = 1
  let cellStart = i
  const bodyEnd = trimEndSpaceTab(line).length
  const scanEnd = bodyEnd > i && line[bodyEnd - 1] === '|' ? bodyEnd - 1 : line.length
  for (; i < scanEnd; i++) {
    const ch = line[i]!
    if (openRun === 0 && ch === '\\' && /[!-/:-@\[-`{-~]/.test(line[i + 1] ?? '')) {
      buf += line.slice(i, i + 2)
      i++
      continue
    }
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
function fenceHasCloser(lexer: Lexer, marker: string, literalPayload = false): boolean {
  if (!literalPayload && lexer.usesContainerFenceLookahead) {
    const key = `${lexer.lineNumber(lexer.pos)}:${marker}`
    // A container above answered for a fence it could see the closer of and this
    // scope cannot, so that answer outranks the one keyed the same way here.
    const handed = lexer.descendantFenceAnswers.get(key)
    if (handed !== undefined) return handed
    const inherited = lexer.fenceLookaheadAnswers.get(key)
    if (inherited !== undefined) return inherited
  }
  const char = marker[0]!
  const memoKey = literalPayload ? `payload:${char}` : char
  const start = lexer.pos + 1
  if (fenceCloserMemoRefutes(lexer.fenceCloserMemo, memoKey, marker.length, start)) return false
  const closeRe = fenceCloseRe(marker)
  let maxRun = 0
  for (let i = start; i < lexer.lineCount; i++) {
    const source = lexer.lineAt(i)!
    const l = literalPayload ? source.replace(/^[ \t]+/, '') : source
    // A quote's lazy line is paragraph text wherever it was spliced, so it
    // closes no fence it lands inside (markup-carve/carve-js#2272).
    if (lexer.quoteLazyLines.has(lexer.lineNumber(i))) continue
    if (closeRe.test(l)) return true
    const closer = RE_FENCE_CLOSER.exec(l)
    if (closer && closer[1]![0] === char) maxRun = Math.max(maxRun, closer[1]!.length)
  }
  // No closer for this marker ahead. Record how long the longest same-character
  // run from here was, so a later opener (pos only advances, so it scans a
  // suffix whose runs can only be shorter) is O(1) whenever it is longer.
  lexer.fenceCloserMemo.set(memoKey, { from: start, maxRun })
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
  sublistArm = true,
  abbreviationArm = true,
  invisibleArms = true,
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
      // A line already admitted as quote continuation remains paragraph text.
      if (lexer.quoteLazyLines.has(lexer.lineNumber(lexer.pos))) return false
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
        (abbreviationArm && lexer.atDocumentLevel && RE_ABBR_DEF.test(ln)) ||
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
      // A footnote body admits definitions past its rebased content column.
      return (
        invisibleArms &&
        (i === 0 || lexer.inFootnoteBody) &&
        !lexer.declinedLinkDefLines.has(lexer.lineNumber(lexer.pos)) &&
        (isLinkDefLine(ln) || RE_FOOTNOTE_DEF.test(ln))
      )
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
      // (markup-carve/carve-js#864).
      return invisibleArms && peekBlockAttributes(lexer, content === undefined ? undefined : ln)
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
    text += '\n' + stripLazyFrame(next)
    // Only the internal lazy frame is removed; the source line starts here.
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

function leadingWhitespace(line: string): number {
  let n = 0
  while (n < line.length && (line[n] === ' ' || line[n] === '\t')) n++
  return n
}


/**
 * The next line after `index` holding a comment fence of exactly `width`, or
 * -1. Indexed once, so a closer is found without rescanning per opener.
 */
function commentCloserLookup(lines: readonly string[], stripQuotes = true): (width: number, index: number) => number {
  let byWidth: Map<number, number[]> | undefined
  return (width, index) => {
    if (!byWidth) {
      byWidth = new Map()
      lines.forEach((line, at) => {
        const run = commentFenceRun((stripQuotes ? line.replace(/^(?:[ \t]*>(?: |$))+/, '') : line).replace(/^[ \t]+/, ''))
        if (run === undefined) return
        const list = byWidth!.get(run)
        if (list) list.push(at)
        else byWidth!.set(run, [at])
      })
    }
    const at = byWidth.get(width) ?? []
    let lo = 0
    let hi = at.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (at[mid]! <= index) lo = mid + 1
      else hi = mid
    }
    return lo < at.length ? at[lo]! : -1
  }
}

function hostedAuthoredBlockOpener(text: string): boolean {
  return RE_FENCE.test(text) || RE_RAW_FENCE.test(text) || RE_HEADING.test(text) ||
    RE_BLOCKQUOTE.test(text) || RE_HR.test(text) || isTableRow(text) ||
    (!RE_ADMONITION_CLOSE.test(text) && colonBlockOpenerRun(text) !== null)
}

// CARVE-P0-004, CARVE-P0-011: in a list item's colon body a link definition or an
// attribute line past the box's column also opens on its authored base (carve#3087).
function hostedColonBodyOpener(text: string): boolean {
  return hostedAuthoredBlockOpener(text) || (isLinkDefLine(text) && !RE_FOOTNOTE_DEF.test(text)) || isBlockAttributeLine(text.trimEnd())
}

/** Whether a line starts an authored block outside the body's first sublist. */
function isParentAuthoredBlock(line: string, firstMarkerColumn: number, followsBlank = false): boolean {
  const column = indentColumns(line, firstMarkerColumn)
  if (column >= firstMarkerColumn) return false
  const opener = sliceColumns(line, column, true)
  return markerContentColumn(opener) < 0 && (column === 0 ? (hostedAuthoredBlockOpener(opener) && !opensCodeFence(opener)) || (followsBlank && !RE_COMMENT_LINE.test(opener)) : lineOpensItemBlock(opener))
}

/**
 * The closer test for the opaque group this line opens, or null for a line that
 * opens none. A code or raw fence closes on a run of at least its own length, a
 * comment fence on one of exactly its own (PART 9 §28).
 */
interface OpaqueGroup {
  closes: (candidate: string) => boolean
  /** The delimiter character and run length, for the closerless memo. */
  char: string
  run: number
  /**
   * Does a closing run below the group's base still close it?
   *
   * The `%%%` fence's closer is indentation-insensitive (PART 9 §28's grammar
   * note), so it does. A verbatim fence re-bases its closer on the column it
   * opened at, and a run below that reaches neither its base nor the container's
   * own column is payload (CARVE-P0-004).
   */
  belowBaseCloses: boolean
}

function opaqueGroupCloser(line: string): OpaqueGroup | null {
  const code = RE_FENCE.exec(line) ?? RE_RAW_FENCE.exec(line)
  if (code !== null) {
    const marker = RE_FENCE.test(line) ? code[2]! : code[1]!
    const close = fenceCloseRe(marker)

    return {
      closes: (candidate) => close.test(candidate),
      char: marker[0]!,
      run: marker.length,
      belowBaseCloses: false,
    }
  }
  const comment = commentFenceRun(line)
  if (comment !== undefined) {
    return {
      closes: (candidate) => commentFenceRun(candidate) === comment,
      char: '%',
      run: comment,
      belowBaseCloses: true,
    }
  }

  return null
}

/**
 * What a group's closer scan has already proved absent, so a RUN of unterminated
 * openers costs one walk rather than one each.
 *
 * `from` only grows inside a group, so a scan that found no closer from an
 * earlier line found none from a later one either. A verbatim closer matches on
 * AT LEAST its own length, so the longest same-character run seen refutes every
 * longer one; a comment closer matches on exactly its own, so that key is the
 * length itself. The same bound `fenceCloserMemoRefutes` carries one collector up.
 */
export interface GroupCloserMemo {
  verbatim: Map<string, { from: number; maxRun: number }>
  comment: Map<number, number>
}

/**
 * Read a line of a rebase group at the content its delimiters are measured from.
 * Indentation is part of neither a fence's opener nor its closer (PART 9 §28), so
 * a run written below the base still reads as one.
 */
const groupLineContent = (line: string, base: number): string =>
  indentColumns(line, base) >= base ? sliceColumns(line, base, true) : line.replace(/^[ \t]+/, '')

/** Does an opaque group opened here find its closer further down? */
function opaqueGroupCloses(
  group: OpaqueGroup,
  lines: readonly string[],
  from: number,
  base: number,
  folded: ReadonlySet<number> | undefined,
  memo: GroupCloserMemo,
  containerColumn = 0,
): boolean {
  const cached = group.belowBaseCloses ? memo.comment.get(group.run) : memo.verbatim.get(group.char)
  if (group.belowBaseCloses) {
    if (cached !== undefined && from >= (cached as number)) return false
  } else {
    const seen = cached as { from: number; maxRun: number } | undefined
    if (seen !== undefined && from >= seen.from && group.run > seen.maxRun) return false
  }
  let maxRun = 0
  for (let k = from; k < lines.length; k++) {
    const line = lines[k]!
    if (isBlankLine(line)) continue
    // CARVE-P0-014: a below-column run is searched past, never matched.
    if (indentColumns(line, containerColumn) < containerColumn) continue
    if (!group.belowBaseCloses && !closerReachesBase(k, folded)) continue
    const content = groupLineContent(line, base)
    if (group.closes(content)) return true
    if (!group.belowBaseCloses) {
      const run = RE_FENCE_CLOSER.exec(content)
      if (run !== null && run[1]![0] === group.char) maxRun = Math.max(maxRun, run[1]!.length)
    }
  }
  if (group.belowBaseCloses) memo.comment.set(group.run, from)
  else memo.verbatim.set(group.char, { from, maxRun })

  return false
}

/**
 * Does this line stand where a closer for the group can stand?
 *
 * A folded line belongs to the host's paragraph. Every other line has an
 * available prefix that is removed before measuring its closing run.
 */
const closerReachesBase = (index: number, folded: ReadonlySet<number> | undefined): boolean =>
  folded?.has(index) !== true

// Skip a quote's marked lines and lazy paragraph continuation during rebasing.
function rebasedQuoteEnd(lines: string[], start: number, quote: Lexer): number {
  const state = markerLineQuoteState(lines[start]!)!
  let fenceCloserMemo: QuotedFenceCloserMemo | undefined
  while (++quote.pos < lines.length) {
    const next = lines[quote.pos]!
    const marked = RE_BLOCKQUOTE.exec(next)
    if (marked) {
      trackBlockQuoteLazyState(
        marked[1] ?? '', state,
        (width) => quotedCommentHasCloser(quote, width, quote.pos),
        (marker, depth, column) => quotedFenceHasCloser(quote, marker, quote.pos, fenceCloserMemo ??= new Map(), depth, column),
      )
      continue
    }
    if (isBlankLine(next) || RE_CAPTION.test(next) ||
        (leadingWhitespace(next) > 0 && isLinkDefLine(next.trimStart())) ||
        colonFenceShapeEndsLazyContinuation(next) ||
        startsInterruptingBlock(quote, undefined, false) || !blockQuoteParagraphOpen(state)) break
    demoteQuotedColonCandidates(state)
  }
  return quote.pos - 1
}

function sourceCodeFenceEnd(
  lines: string[], start: number, base: number, marker: string,
  heldFoldedLines: Set<number>, takenBelowColumn: ReadonlySet<number> | undefined,
  onFenceBodyLine: ((index: number) => void) | undefined,
  onUnclosedCodeFence: (() => void) | undefined,
  authoredBase: number, sourceLines: readonly (string | undefined)[],
): number {
  let end = start
  const close = fenceCloseRe(marker)
  let closed = false
  for (let j = start + 1; j < lines.length; j++) {
    const candidate = lines[j]!
    end = j
    onFenceBodyLine?.(j)
    if (isBlankLine(candidate)) continue
    const source = sourceLines[j]
    if (source === undefined) {
      const column = indentColumns(candidate, base)
      if (column < base) {
        continue
      }
      if (takenBelowColumn?.has(j)) { heldFoldedLines.add(j); continue }
      if (close.test(sliceColumns(candidate, base, true))) { closed = true; break }
      continue
    }
    const column = indentColumns(source)
    if (takenBelowColumn?.has(j)) heldFoldedLines.add(j)
    if (column >= base && column <= authoredBase && !heldFoldedLines.has(j) &&
        close.test(candidate.slice(leadingWhitespace(candidate)))) {
      lines[j] = candidate.slice(leadingWhitespace(candidate))
      closed = true
      break
    }
  }
  if (!closed) onUnclosedCodeFence?.()
  return end
}

// Keep a code fence's payload and closer in the same rebasing group.
function rebasedCodeFenceEnd(
  lines: string[],
  start: number,
  base: number,
  marker: string,
  heldFoldedLines: Set<number>,
  takenBelowColumn?: ReadonlySet<number>,
  onFenceBodyLine?: (index: number) => void,
  onUnclosedCodeFence?: () => void,
  stopsParagraph?: (line: string, index: number) => boolean,
): number {
  let end = start
  const close = fenceCloseRe(marker)
  // Measure a run below the base after removing its available prefix.
  let closed = false
  for (let j = start + 1; j < lines.length; j++) {
    const candidate = lines[j]!
    if (stopsParagraph?.(candidate, j)) break
    end = j
    onFenceBodyLine?.(j)
    if (isBlankLine(candidate)) continue
    // A folded line belongs to the host paragraph, not this fence.
    if (takenBelowColumn?.has(j) === true) {
      heldFoldedLines.add(j)
      continue
    }
    const column = indentColumns(candidate, base)
    if (column < base) {
      continue
    }
    if (close.test(sliceColumns(candidate, base, true))) {
      closed = true
      break
    }
  }
  if (!closed) onUnclosedCodeFence?.()
  return end
}

// Find a colon group's extent while retaining folded-line ownership.
function rebasedColonGroupEnd(
  lines: string[],
  start: number,
  base: number,
  width: number,
  heldFoldedLines: Set<number>,
  findCommentCloser: (width: number, index: number) => number,
  closerMemo: GroupCloserMemo,
  takenBelowColumn?: ReadonlySet<number>,
  onFenceBodyLine?: (index: number) => void,
  nestedBodyLines?: Set<number>,
  usesHostMinimum = false,
  emptyHostMinimum = false,
  preserveNestedNoteColumn = false,
): number {
  let end = start
  const stack = [{ width, literal: RE_LINE_BLOCK_OPEN.test(groupLineContent(lines[start]!, base)) }]
  const holdsFoldedLines = base > 0 && takenBelowColumn !== undefined && takenBelowColumn.size > 0
  // The opaque group open inside this container, if any. Only the hold below
  // consults it: a folded line inside a verbatim or comment payload is that
  // payload's, and its delimiter has to travel with the dedent.
  let opaque: OpaqueGroup | null = null
  // Colon bodies keep the indentation host's minimum even when their opener
  // has a deeper authored base. Child blocks use that minimum for ownership.
  // Rebase them during the existing scan before the outer body skips them.
  const authored = [{ column: usesHostMinimum ? 0 : base, paragraph: false }]
  let authoredInlineFence = false
  let authoredCodeClose: RegExp | undefined
  let authoredCodeAdjustment = 0
  let authoredBelowBaseRun = false
  let authoredChildColumn = -1
  let authoredChildBlank = false
  let authoredChildBlockBoundary = false
  // CARVE-P0-009: a child that leaves no paragraph open lets a fence below its column leave it.
  let authoredChildState: ItemLazyState | undefined
  const childFenceCloses = (j: number) => (marker: string, extraColumns = 0): boolean => {
    const group = opaqueGroupCloser(marker)
    if (group === null) return false
    const column = authoredChildColumn + extraColumns
    let memo = childCloserMemos.get(column)
    if (memo === undefined) childCloserMemos.set(column, memo = { verbatim: new Map(), comment: new Map() })
    return opaqueGroupCloses(group, lines, j + 1, column, takenBelowColumn, memo)
  }
  const childCloserMemos = new Map<number, GroupCloserMemo>()
  for (let j = start + 1; j < lines.length; j++) {
    let candidate = lines[j]!
    let authoredColumn: number | undefined
    const insideAuthoredCode = authoredCodeClose !== undefined
    if (nestedBodyLines && authoredChildColumn >= 0) {
      if (opaque === null && RE_COMMENT_LINE.test(candidate.trimStart()) &&
          (commentFenceRun(candidate.trimStart()) === undefined ||
            indentColumns(candidate, authoredChildColumn) >= authoredChildColumn)) authoredChildBlockBoundary = true
      if (isBlankLine(candidate)) authoredChildBlank = true
      else if (opaque === null && (authoredChildBlank || hostedAuthoredBlockOpener(candidate.trimStart()) || RE_ADMONITION_CLOSE.test(candidate.trimStart()))) {
        const column = authoredColumn = indentColumns(candidate, authoredChildColumn)
        const childClosed = authoredChildState !== undefined && !authoredChildState.lazyFoldable && !insideOpenFence(authoredChildState)
        if (column < authoredChildColumn && (authoredChildBlank ||
            ((column === authored.at(-1)!.column && lineOpensItemBlock(candidate.trimStart())) ||
              (column > authored.at(-1)!.column && (colonFenceOpenerLen(candidate.trimStart()) !== null ||
                ((authoredChildBlockBoundary || childClosed) && opensCodeFence(candidate.trimStart()))))))) authoredChildColumn = -1
        else if (column >= authoredChildColumn && authoredChildState !== undefined) {
          trackItemLazyState(sliceColumns(candidate, authoredChildColumn, true), authoredChildState, childFenceCloses(j))
          // The line block closer still closes its child when an unmatched code
          // run in that child was read as inline text.
          const closer = RE_ADMONITION_CLOSE.exec(candidate.trimStart())
          if (closer && column === authoredChildColumn &&
              closer[1]!.length === authoredChildState.literalColon?.width) {
            delete authoredChildState.literalColon
            authoredChildState.divDepth = Math.max(0, authoredChildState.divDepth - 1)
            authoredChildState.lazyFoldable = false
          }
        }
      }
    }
    if (authoredCodeClose) {
      if (authoredCodeAdjustment > 0 && indentColumns(candidate, authoredCodeAdjustment) < authoredCodeAdjustment &&
          opensCodeFence(candidate.trimStart())) authoredBelowBaseRun = true
      if (authoredCodeAdjustment !== 0 && !takenBelowColumn?.has(j) &&
          !(authoredBelowBaseRun && indentColumns(candidate, authoredCodeAdjustment) < authoredCodeAdjustment)) {
        candidate = authoredCodeAdjustment < 0
          ? ' '.repeat(-authoredCodeAdjustment) + candidate
          : sliceColumns(candidate, Math.min(authoredCodeAdjustment, indentColumns(candidate)), true)
        lines[j] = candidate
      }
      if (indentColumns(candidate, base + 1) === base && authoredCodeClose.test(groupLineContent(candidate, base))) {
        authoredCodeClose = undefined
        authoredBelowBaseRun = false
      }
    } else if (nestedBodyLines && opaque === null && !authoredCodeClose && stack.length === authored.length && authoredChildColumn < 0 &&
        !stack.at(-1)!.literal && !authoredInlineFence) {
      const column = authoredColumn ??= indentColumns(candidate, hostedColonBodyOpener(candidate.trimStart()) ? Infinity : authored.at(-1)!.column + 4)
      while (!isBlankLine(candidate) && authored.length > 1 && column < authored.at(-1)!.column) authored.pop()
      const owner = authored.at(-1)!
      const rebasesHere = !emptyHostMinimum || !owner.paragraph || column >= base
      const text = sliceColumns(candidate, column, true)
      const markerColumn = /^[*+\-0-9A-Za-z]/.test(text) ? markerContentColumn(text, false, 0) : -1
      const childColumn = markerColumn < 0 ? -1 : column + markerColumn
      if (childColumn >= 0) {
        authoredChildColumn = childColumn
        authoredChildBlank = false
        authoredChildBlockBoundary = false
        authoredChildState = verbatimOnlyLazyState()
        trackItemLazyState(text.slice(markerColumn), authoredChildState, childFenceCloses(j))
      }
      const code = RE_FENCE.exec(text) ?? RE_RAW_FENCE.exec(text)
      if (rebasesHere && code && column === owner.column && owner.paragraph &&
          !opaqueGroupCloses(opaqueGroupCloser(text)!, lines, j + 1, column, takenBelowColumn, closerMemo)) authoredInlineFence = true
      if (rebasesHere && code && column >= owner.column && (column > owner.column ||
          opaqueGroupCloses(opaqueGroupCloser(text)!, lines, j + 1, column, takenBelowColumn, closerMemo))) {
        authoredCodeClose = fenceCloseRe(RE_FENCE.test(text) ? code[2]! : code[1]!)
        authoredCodeAdjustment = column - base
        authoredBelowBaseRun = false
      }
      const closeRun = RE_ADMONITION_CLOSE.exec(text)
      const closesOwner = closeRun?.[1]?.length === stack.at(-1)!.width
      if (rebasesHere && authoredChildColumn < 0 && !closesOwner &&
          (column >= owner.column && (closeRun === null || column === owner.column) && colonBlockOpenerRun(text) !== null)) {
        authored.push({ column, paragraph: false })
      }
      const current = authored.at(-1)!
      const blockColumn = column > current.column && hostedColonBodyOpener(text) && childColumn < 0 ? column : current.column
      if (rebasesHere && blockColumn !== base && column >= blockColumn &&
          !(preserveNestedNoteColumn && RE_FOOTNOTE_DEF.test(text.trimStart())) &&
          (blockColumn > base || usesHostMinimum && hostedAuthoredBlockOpener(text))) {
        candidate = blockColumn < base
          ? ' '.repeat(base - blockColumn) + candidate
          : sliceColumns(candidate, blockColumn - base, true)
        lines[j] = candidate
        authoredColumn = undefined
      }
      if (closesOwner && column === current.column) {
        if (authored.length > 1) authored.pop()
        authored.at(-1)!.paragraph = false
      } else current.paragraph = !isBlankLine(candidate) &&
        !(column === current.column && lineOpensItemBlock(text))
    }
    if (nestedBodyLines && stack.at(-1)!.literal && authored.at(-1)!.column > base) {
      const current = authored.at(-1)!
      const column = indentColumns(candidate, current.column + 1)
      if (column >= current.column) {
        const text = sliceColumns(candidate, current.column, true)
        candidate = sliceColumns(candidate, current.column - base, true)
        lines[j] = candidate
        authoredColumn = undefined
        if (column === current.column && RE_ADMONITION_CLOSE.test(text)) authored.pop()
      }
    }
    if (stack.length > 1) nestedBodyLines?.add(j)
    end = j
    // The container parses its own list markers after paragraph folding.
    // They must not split the host item's collected stream (carve#2474).
    onFenceBodyLine?.(j)
    if (isBlankLine(candidate) || insideAuthoredCode) continue
    const column = authoredColumn === undefined ? indentColumns(candidate, base) : Math.min(authoredColumn, base)
    // THE OPAQUE GROUP IS TRACKED BEFORE THE COLUMN TEST, because its closing
    // run may be written below the base and this pass still has to know the
    // payload ended there.
    const insideOpaque = opaque !== null
    if (
      opaque !== null &&
      (opaque.belowBaseCloses || closerReachesBase(j, takenBelowColumn)) &&
      opaque.closes(groupLineContent(candidate, base))
    ) {
      opaque = null
    }
    // A below-base run is payload unless it closes at the container's own column.
    if (column < base) {
      const closesAtColumn =
        column === 0 &&
        RE_ADMONITION_CLOSE.exec(candidate)?.[1]?.length === stack.at(-1)!.width
      if (!closesAtColumn) continue
    }
    const local = column === 0 ? candidate : sliceColumns(candidate, base, true)
    if (insideOpaque) {
      continue
    } else if (holdsFoldedLines && takenBelowColumn?.has(j) === true) {
      // A FOLDED LINE IS NOT AT THIS GROUP'S BASE. Its leading run is
      // alignment under the host that folded it in from below that host's own
      // content column, not an authored column - and at an over-indent of ONE
      // the two spellings collide, because a line written in the band between
      // column zero and the host's content column keeps exactly the single
      // residual column the rebased opener carries. So a `:::` there closed a
      // group the host never placed it in, and a heading, rule or quote there
      // became a block (markup-carve/carve-js#2243).
      //
      // Held rather than skipped, because the dedent below must leave the line
      // alone too - moving it onto the base is what re-classified it.
      //
      // NOT INSIDE AN OPAQUE PAYLOAD, which is the arm above: a fence's own
      // closing run can be written in that band, and holding it there left the
      // payload open and the container's own closer nested inside it.
      heldFoldedLines.add(j)
      continue
    } else if (column >= base) {
      // ONLY A FENCE THAT CLOSES OPENS A PAYLOAD (§10 I4 for the verbatim
      // kinds, §28 for the comment one). Without the lookahead an
      // unterminated run made every line after it payload, which handed a
      // folded heading, rule or quote marker to the dedent again.
      //
      const group = opaqueGroupCloser(local)
      if (group !== null && (group.belowBaseCloses
        ? findCommentCloser(group.run, j) > j
        : opaqueGroupCloses(group, lines, j + 1, base, takenBelowColumn, closerMemo))) {
        opaque = group
      }
    }
    const run = RE_ADMONITION_CLOSE.exec(local)
    if (run && stack.at(-1)!.width === run[1]!.length) {
      stack.pop()
      if (stack.length === 0) break
    } else if (!stack.at(-1)!.literal) {
      const opener = colonBlockOpenerRun(local)
      if (opener !== null) stack.push({ width: opener, literal: RE_LINE_BLOCK_OPEN.test(local) })
    }
  }
  return end
}

function markerNoteFenceReach(lines: readonly string[], absorbedMarkers: ReadonlySet<number>, comments: ReadonlySet<number>): 'closed' | 'unclosed' | 'boundary' | null {
  let closer: RegExp | null = null
  let openerColumn = -1
  let childColumn = -1
  let childCloser: RegExp | null = null
  let childOpenerColumn = -1
  let afterBlank = false
  for (const [index, line] of lines.entries()) {
    if (comments.has(index)) continue
    const column = indentColumns(line)
    if (column < FOOTNOTE_BODY_COLUMN && !isBlankLine(line)) {
      if (closer === null) return null
      const laterCloser = lines.slice(index + 1).some(candidate =>
        indentColumns(candidate) === openerColumn && closer!.test(candidate.trimStart()))
      return laterCloser ? 'boundary' : 'unclosed'
    }
    if (isBlankLine(line)) { afterBlank = true; continue }
    const text = line.trimStart()
    if (closer !== null) {
      if (column === openerColumn && closer.test(text)) return 'closed'
      continue
    }
    if (childCloser !== null) {
      if (column === childOpenerColumn && childCloser.test(text)) childCloser = null
      continue
    }
    if (childColumn >= 0 && column < childColumn && !isBlankLine(line)) childColumn = -1
    const fence = RE_FENCE.exec(text) ?? RE_RAW_FENCE.exec(text)
    if (childColumn >= 0 && column >= childColumn) {
      if (fence !== null) {
        childCloser = fenceCloseRe(RE_FENCE.test(text) ? fence[2]! : fence[1]!)
        childOpenerColumn = column
      }
      continue
    }
    if (isListMarkerLine(text)) {
      if (!absorbedMarkers.has(index)) childColumn = column + markerContentColumn(text)
      afterBlank = false
      continue
    }
    if (afterBlank && RE_COMMENT_LINE.test(text)) return null
    afterBlank = false
    if (RE_FOOTNOTE_DEF.test(text) || (lineOpensItemBlock(text) && fence === null && !RE_COMMENT_LINE.test(text))) return null
    if (fence !== null) {
      closer = fenceCloseRe(RE_FENCE.test(text) ? fence[2]! : fence[1]!)
      openerColumn = column
    }
  }
  return closer === null ? null : 'unclosed'
}

function markerNoteCommentFenceOpeners(lines: readonly string[], absorbedMarkers: ReadonlySet<number>, comments: ReadonlySet<number>, outerTailOnly = false): number[] {
  const openers: number[] = []
  let closer: RegExp | null = null
  let openerColumn = -1
  let childColumn = -1
  let belowNoteBody = false
  let nestedMarkerSeen = false
  for (const [index, line] of lines.entries()) {
    if (isBlankLine(line) || comments.has(index)) continue
    const column = indentColumns(line)
    const text = line.trimStart()
    if (column < FOOTNOTE_BODY_COLUMN) belowNoteBody = true
    if (closer !== null) {
      if (column === openerColumn && closer.test(text)) closer = null
      continue
    }
    if (childColumn >= 0 && column < childColumn) childColumn = -1
    const fence = RE_FENCE.exec(text) ?? RE_RAW_FENCE.exec(text)
    if (fence !== null) {
      closer = fenceCloseRe(RE_FENCE.test(text) ? fence[2]! : fence[1]!)
      openerColumn = column
    }
    if (childColumn >= 0 && column >= childColumn) continue
    if (RE_FOOTNOTE_DEF.test(text) || (isListMarkerLine(text) && !absorbedMarkers.has(index))) {
      // A later comment and fence cannot grant the outer item a tail claim.
      // The rebase scan still needs that fence opener at its authored column.
      if (outerTailOnly) nestedMarkerSeen = true
      if (isListMarkerLine(text)) childColumn = column + markerContentColumn(text)
    }
    if (!nestedMarkerSeen && !belowNoteBody && column >= FOOTNOTE_BODY_COLUMN && RE_COMMENT_LINE.test(text) &&
        indentColumns(lines[index + 1] ?? '') >= FOOTNOTE_BODY_COLUMN &&
        opensCodeFence(lines[index + 1]?.trimStart() ?? '')) openers.push(index + 1)
  }
  return openers
}

/**
 * The last line of a comment at or past a marker-line note's body column that
 * starts at the lexer, or -1. A `%%%` span counts only with its closer inside
 * the note.
 */
function coveredNoteComment(lexer: Lexer, line: string, floor: number): number {
  if (isBlankLine(line) || indentColumns(line, floor) < floor) return -1
  const text = line.trimStart()
  if (!RE_COMMENT_LINE.test(text)) return -1
  const run = commentFenceRun(text)
  if (run === undefined) return lexer.pos
  for (let at = lexer.pos + 1; at < lexer.lineCount; at++) {
    const candidate = lexer.lineAt(at)!
    if (isBlankLine(candidate)) continue
    if (indentColumns(candidate, floor) < floor) return -1
    if (commentFenceRun(candidate.trimStart()) === run) return at
  }
  return -1
}

// CARVE-P2-017's AT band: a non-list, non-fence block opener at or past a
// marker-line note's body column opens inside the note. 'open' means no line
// has dropped below that column since, so nothing may continue the note lazily.
function markerNoteOpenerReach(lines: readonly string[], absorbedMarkers: ReadonlySet<number>, comments: ReadonlySet<number>): 'open' | 'closed' | null {
  let closer: RegExp | null = null
  let openerColumn = -1
  let childColumn = -1
  let found = false
  for (const [index, line] of lines.entries()) {
    if (isBlankLine(line) || comments.has(index)) continue
    const column = indentColumns(line)
    if (column < FOOTNOTE_BODY_COLUMN) return found ? 'closed' : null
    const text = line.trimStart()
    if (closer !== null) {
      if (column === openerColumn && closer.test(text)) closer = null
      continue
    }
    if (childColumn >= 0 && column >= childColumn) continue
    childColumn = -1
    if (RE_FOOTNOTE_DEF.test(text)) return found ? 'closed' : null
    const fence = RE_FENCE.exec(text) ?? RE_RAW_FENCE.exec(text)
    if (fence !== null) {
      closer = fenceCloseRe(RE_FENCE.test(text) ? fence[2]! : fence[1]!)
      openerColumn = column
      continue
    }
    if (isListMarkerLine(text)) {
      if (!absorbedMarkers.has(index)) childColumn = column + markerContentColumn(text)
      continue
    }
    if (RE_COMMENT_LINE.test(text) || commentFenceRun(text) !== undefined) continue
    if (lineOpensItemBlock(text)) found = true
  }
  return found ? 'open' : null
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
  rebaseOverindentedBlocks(rebased, undefined, -1, true)

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

// ============================================================================
// Inline parsing
// ============================================================================

// Footnote reference `[^label]`. A label is a physical-line identifier: it
// contains neither `]` nor a source newline. Letting this cross a soft break
// creates an id no definition marker (which is necessarily one line) can bind.
const RE_FOOTNOTE_REF = /^\[\^([^\]\r\n]+)\]/
// extension_name = identifier = (letter|'_'){letter|digit|'_'|'-'}
// (grammar.ebnf:968-969,1122) -- a lone `_` is a valid extension name.
const RE_EXTENSION = /^:([a-zA-Z_][\w-]*)\[([^\]]*)\]/
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
// `crossref_id` ends at a space, `>` or a line break; a tab inside the id is content.
const RE_CROSSREF = /^<\/#([^> \n\r]+)>/
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
function execLinkTail(tail: string, canReadAttrs?: (offset: number) => boolean): [string, string, string | undefined, string | undefined, string | undefined] | null {
  const scanned = scanDestination(tail)
  if (scanned === null) return null
  const rest = (scanned.dest === '' ? RE_EMPTY_LINK_REST : RE_LINK_REST).exec(tail.slice(scanned.end))
  if (rest === null) return null
  const end = scanned.end + rest[0].length
  const attrs = tail[end] === '{' && (canReadAttrs === undefined || canReadAttrs(end))
    ? RE_INLINE_ATTR.exec(tail.slice(end)) : null
  return [tail.slice(0, end + (attrs?.[0].length ?? 0)), scanned.dest, rest[1], rest[2], attrs?.[1]]
}
const RE_REF_TAIL = /^\[([^\]]*)\]/
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

// A BRACED HYPHEN PAIR IS AN EN DASH (markup-carve/carve#1447). The bare run
// carries a flanking guard, so `x --verbose y` stays literal and an author who
// MEANT a dash in that position had no way to say so. This is that way, and it
// cost nothing: the string it took was an empty `<del>`.
const RE_BRACED_EN_DASH = /^\{--\}/

const PAIR_MARKERS = '/*_^,~=+-'

// Every braced opener needs a whole delimiter: the forced spans, the editorial
// frames and the comment `{%` (CARVE-P3-025).
const BRACED_OPENER_MARKERS = '/*_^,~=+-#%'
function splitBracedOpener(text: string, open: number): boolean {
  const marker = text[open + 1]
  return marker !== undefined && BRACED_OPENER_MARKERS.includes(marker) && extendsGrapheme(text, open + 2)
}

export interface InlinePairView {
  tables: Array<Int32Array | undefined>
  attributeTails: Map<number, number>
  barePairs: Map<number, { close: number; end: number }>
  offset: number
}
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
const isFlankSpace = (ch: string) => /[ \t\n\r\u00a0\0]/.test(ch)
const isQuoteSpace = (ch: string) => /[ \t\n\r\u00a0]/.test(ch)
const isQuoteAlnum = (ch: string) => /[\p{L}\p{N}]/u.test(ch)
const QUOTE_LETTER_RUN = /\p{L}+/uy
const ELISION_WORDS = new Set(['tis', 'tisn', 'twas', 'twasn', 'twere', 'twill', 'twould', 'em', 'cause', 'til', 'n', 'bout'])
const closesAfterDash = (prev: string, next: string) =>
  '-–—'.includes(prev) && prev !== '' && (next === '' || isQuoteSpace(next) || `"'.,;:!?)]`.includes(next))
// Adjudicated smart-quote opening context (matches carve-rs on these inputs):
// a straight quote curls OPENING when preceded by start-of-content, Unicode
// whitespace (incl. NBSP, handled below via the U+E000 placeholder), or one of
// the operator/opening-punctuation chars `( [ { = : - /`. Sentence punctuation
// (`. , ; ! ?`), letters, digits and closing brackets stay CLOSING. The en/em
// dash also opens (a quote right after a `--` dash run opens), as does a quote
// directly after an opening curly quote (nested-quote context).
// Letters outside the BMP are two UTF-16 units; the quote rules judge whole code points.
const codePointAfter = (text: string, i: number): string => {
  const cp = text.codePointAt(i + 1)
  return cp === undefined ? '' : String.fromCodePoint(cp)
}
const isQuoteOpenContext = (prev: string) =>
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
function lastEmittedGlyph(previous: InlineNode): string {
  if (previous && previous.type === 'smart_punctuation') {
    const glyph = previous.glyph ?? SMART_PUNCTUATION_GLYPHS[previous.kind]
    if (glyph) return glyph
  }
  // An escaped character is its own node but still the character before the
  // quote, and quote flanking reads that character: `\{"quoted"` opens on the
  // brace exactly as an unescaped `{` would (corpus 163).
  if (previous && previous.type === 'non_breaking_space') return '\u00a0'
  if (previous && previous.type === 'escaped_text') return previous.value
  if (previous.type === 'text') return previous.value.slice(-1)
  // A line break is whitespace to quote flanking, so a quote starting a line opens (carve#2822).
  if (previous && (previous.type === 'soft_break' || previous.type === 'hard_break' || previous.type === 'cell_wrap')) return '\n'
  return 'x'
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
  return new ParseSession().parseRefLabelInlines(label)
}

/**
 * The inline nodes of a CONTAINER LABEL - a div's, an admonition's or a fence's
 * unconsumed `[label]`.
 *
 * `CARVE-P9-041` enumerates a div label among the hosts that HAVE an inline run,
 * so the fallback publishes that run and not the characters the author typed
 * (ruled on markup-carve/carve#2572). The label is held as text here, the way the
 * oracle's own layout tree holds it, so the scan happens where it is rendered.
 *
 * Positions are stripped: the label reaches this from an AST field, which carries
 * no offset of its own, and PART 12 section 4 forbids inventing one.
 */
export function parseContainerLabelInlines(label: string): InlineNode[] {
  return stripPositions(new ParseSession().parseRefLabelInlines(label))
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

/**
 * The emphasis kinds held against bare openers in the current inline scope.
 *
 * A bare span inherits the enclosing kinds. A braced native span starts a
 * scope holding its own kind against bare openers; a further braced native
 * child can nest that kind (CARVE-P9-043). A link label or table cell starts
 * with no held kinds.
 */
const NO_OPEN_KINDS: ReadonlySet<string> = new Set()

export interface EmphasisMatch {
  node: Emphasis
  end: number
}

export interface EmphasisMemo {
  // Per delimiter, scan positions known to reach no closer. Not a single bound:
  // an opener inside a skipped plain brace group does not scan a suffix.
  failed: Map<string, Uint8Array>
  lastBrace: number
  lastCritic?: number
  boldItalic?: number[]
  // Each link or image destination's `(` mapped to its closing `)`, built once.
  destinations?: Map<number, number>
  // Each `[` mapped to its balanced `]`, built once. Same map the inline pass
  // resolves a label with, so the scan hides exactly the run the parser builds.
  brackets?: BracketClose
  crossref?: CrossrefMemo
}

function combinedSpanCloser(text: string, start: number, memo: EmphasisMemo): number | undefined {
  if (!memo.boldItalic) {
    memo.boldItalic = []
    let offset = 0
    for (;;) {
      const close = text.indexOf('*/', offset)
      if (close === -1) break
      // bare_closer('/'): the outer `/` does not close before a letter or digit
      // (carve#3217), so that `*/` is content and a later one may close.
      if (close > 0 && !isCarveWhitespace(text[close - 1]) && !extendsGrapheme(text, close + 2) && !/[A-Za-z0-9]/.test(text[close + 2] ?? '')) memo.boldItalic.push(close)
      offset = close + 1
    }
  }
  const closers = memo.boldItalic
  let low = 0
  let high = closers.length
  while (low < high) {
    const mid = (low + high) >>> 1
    if (closers[mid]! <= start) low = mid + 1
    else high = mid
  }
  return closers[low]
}

function newEmphasisMemo(): EmphasisMemo {
  return { failed: new Map(), lastBrace: -2 }
}

/** `buildBracketMap` over one inline text, built at most once per scan. */
function emphasisBrackets(text: string, memo: EmphasisMemo): BracketClose {
  memo.brackets ??= text.includes('[') ? buildBracketMap(text) : () => undefined

  return memo.brackets
}

// The braced inlines E2a names, as sticky copies of the matchers the main loop
// uses, so the scan hides exactly the region the parser builds a node from.

// Sticky copies of the raw-inline format and link-tail matchers used by the
// main loop, so the scan hides exactly the region it builds a node from.
const RE_RAW_INLINE_STICKY = new RegExp(RE_RAW_INLINE.source.replace(/^\^/, ''), 'y')
const RE_LINK_REST_STICKY = new RegExp(RE_LINK_REST.source.replace(/^\^/, ''), 'y')
const RE_EMPTY_LINK_REST_STICKY = new RegExp(RE_EMPTY_LINK_REST.source.replace(/^\^/, ''), 'y')

// Autolinks and cross-references outside code spans, as [start, end) pairs.
// PART 8 resolves them before links, so a `[` inside one opens no run.
function atomicLinkRegions(text: string): Array<[number, number]> {
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
function linkDestinations(text: string, memo: EmphasisMemo): Map<number, number> {
  if (memo.destinations) return memo.destinations
  const found = new Map<number, number>()
  memo.destinations = found
  if (!text.includes('](')) return found
  const brackets = buildBracketMap(text)
  // A destination inside a destination is already hidden by the one around it,
  // and scanning it again is what makes a nest of them quadratic. Brackets come
  // in ascending order, so the outermost of a nest is reached first.
  let covered = -1
  const destinationOpeners = completeDestinationOpeners(text)
  const atoms = atomicLinkRegions(text)
  let atom = 0
  for (let open = text.indexOf('['); open !== -1; open = text.indexOf('[', open + 1)) {
    while (atom < atoms.length && atoms[atom]![1] <= open) atom++
    if (atom < atoms.length && atoms[atom]![0] < open) continue
    const close = brackets(open)
    if (close === undefined) continue
    if (close + 1 <= covered) continue
    if (text[close + 1] !== '(' || text[open + 1] === '^' || text[open - 1] === '^') continue
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

export const listStateHelpers = {
  FOOTNOTE_BODY_COLUMN,
  RE_ADMONITION_CLOSE,
  RE_ADMONITION_OPEN,
  RE_BLOCKQUOTE,
  RE_COMMENT_LINE,
  RE_DEFLIST_DEF,
  RE_DEFLIST_TERM,
  RE_DIV_OPEN,
  RE_FENCE,
  RE_FOOTNOTE_DEF,
  RE_HARDBREAKS_OPEN,
  RE_HEADING,
  RE_HR,
  RE_INVISIBLE_BLOCK_LEAD,
  RE_LINE_BLOCK_OPEN,
  RE_QUOTE_BLOCK_OPEN,
  RE_RAW_FENCE,
  RE_TABLE_CONT,
  blockQuoteParagraphOpen,
  bottomBlockLeavesParagraphOpen,
  colonBlockOpenerRun,
  colonFenceOpenerLen,
  commentFenceRun,
  continuesInlineFenceParagraph,
  extractItemAttr,
  fenceCloseRe,
  hostedAuthoredBlockOpener,
  isBlockAttributeLine,
  isLinkDefLine,
  isTableRow,
  leadingWhitespace,
  lineOpensBlock,
  markerLineState,
  markerPrefixLength,
  opaqueGroupCloser,
  opensCodeFence,
  opensWrappedAttributeBlock,
  orderedMatch,
  prefixWalkBound,
  quotedLineText,
  taskMatch,
  trackBlockQuoteLazyState,
  trackWrappedAttributeRun,
  unorderedMatch,
  verbatimOnlyLazyState,
}
const trackItemLazyState = createListStateTracker(listStateHelpers)

export const rebaseHelpers = {
  FOOTNOTE_BODY_COLUMN,
  LAZY_FRAME,
  RE_ADMONITION_CLOSE,
  RE_ADMONITION_OPEN,
  RE_BLOCKQUOTE,
  RE_CAPTION,
  RE_COMMENT_LINE,
  RE_DEFLIST_DEF,
  RE_DEFLIST_TERM,
  RE_FENCE,
  RE_FOOTNOTE_DEF,
  RE_HEADING,
  RE_HR,
  RE_LINE_BLOCK_OPEN,
  RE_LINK_DEF,
  RE_ORDERED,
  RE_RAW_FENCE,
  RE_TASK,
  RE_UNORDERED,
  blockQuoteParagraphOpen,
  bottomBlockLeavesParagraphOpen,
  collectLiteralColonFenceBody,
  colonBlockOpenerRun,
  colonFenceOpenerLen,
  commentCloserLookup,
  commentFenceRun,
  extractItemAttr,
  fenceCloseRe,
  hostedAuthoredBlockOpener,
  isBlockAttributeLine,
  isContinuationMarker,
  isLinkDefLine,
  isListMarkerLine,
  isParentAuthoredBlock,
  isTableRow,
  leadingWhitespace,
  lineOpensBlock,
  lineOpensItemBlock,
  markerContentColumn,
  markerFreeContent,
  markerLineQuoteState,
  opaqueGroupCloser,
  opaqueGroupCloses,
  opensCodeFence,
  opensWrappedAttributeBlock,
  peekBlockAttributes,
  quotePrefixDepth,
  rebasedCodeFenceEnd,
  rebasedColonGroupEnd,
  rebasedQuoteEnd,
  sourceCodeFenceEnd,
  sourceColumn,
  stripLazyFrame,
  trackBlockQuoteLazyState,
  trackItemLazyState,
  verbatimOnlyLazyState,
}
const rebaseOverindentedBlocks = createRebasePass(rebaseHelpers)

export const listHelpers = {
  FOOTNOTE_BODY_COLUMN,
  LAZY_FRAME,
  RE_ADMONITION_CLOSE,
  RE_ADMONITION_OPEN,
  RE_BLOCKQUOTE,
  RE_CAPTION,
  RE_COLON_RUN,
  RE_COMMENT_LINE,
  RE_DEFLIST_DEF,
  RE_DEFLIST_TERM,
  RE_DIV_OPEN,
  RE_FENCE,
  RE_FENCE_CLOSER,
  RE_FIRST_BLOCK_MARKER,
  RE_FOOTNOTE_DEF,
  RE_HARDBREAKS_OPEN,
  RE_HR,
  RE_LINE_BLOCK_OPEN,
  RE_ORDERED,
  RE_QUOTE_BLOCK_OPEN,
  RE_RAW_FENCE,
  RE_TASK,
  RE_UNORDERED,
  attachBlockPos,
  attachesAtDocumentColumnZero,
  authoredTaskState,
  blockQuoteParagraphOpen,
  bodyHoldsOpenCommentSpan,
  bottomBlockLeavesParagraphOpen,
  buildCloserIndex,
  codeCloserPossible,
  colonBlockOpenerRun,
  colonFenceOpenerLen,
  colonFenceShapeEndsLazyContinuation,
  commentBlockHasCloser,
  commentBlockSpans,
  commentFenceRun,
  coveredNoteComment,
  deflistContentCol,
  deflistMarkerLine,
  endsInPlus,
  exactCloserPossible,
  extractItemAttr,
  fenceCloseRe,
  firstBlockOpenerContent,
  insideOpenFence,
  insideOpenQuoteParagraph,
  isBlockAttributeLine,
  isColonFenceOpener,
  isContinuationMarker,
  isInvisibleLine,
  isLinkDefLine,
  isListMarkerLine,
  isParentAuthoredBlock,
  isPhysicalContinuationMarker,
  isRetainableLineComment,
  isStackedFirstBlockQuoteMarker,
  itemFenceHasCloser,
  lazyContinuationEndsList,
  leadingWhitespace,
  lineOpensBlock,
  lineOpensItemBlock,
  literalCommentHasCloser,
  markerContentColumn,
  markerDecision,
  markerFreeContent,
  markerLineBottomBlock,
  markerLineQuoteState,
  markerLineState,
  markerNoteCommentFenceOpeners,
  markerNoteFenceReach,
  markerNoteOpenerReach,
  markerPrefixLength,
  matchListMarker,
  matchedCommentFenceEnd,
  nestedSubLexer,
  newCommentSpanScan,
  olKindOf,
  olStartOf,
  olTypeOf,
  opensCodeFence,
  orderedContinues,
  orderedMatch,
  prefixWalkBound,
  quoteBodyColumn,
  quoteIndentHasTab,
  quotePrefixDepth,
  quotePrefixLength,
  quotedLineText,
  restoreVerbatimBlanks,
  retainCommentBoundary,
  sourceColumn,
  sourceQuoteBody,
  sourceQuoteLocalColumn,
  startsInterruptingBlock,
  stripLazyFrame,
  subLexer,
  taskMatch,
  trackBlockQuoteLazyState,
  unorderedMarkerChar,
  unorderedMatch,
  verbatimOnlyLazyState,
  walkContainerPrefix
}

export const definitionListHelpers = { ...listHelpers,
  trackItemLazyState,
  rebaseOverindentedBlocks,
  RE_ABBR_DEF,
  RE_COMMENT_BLOCK_ANY,
  RE_HEADING,
  commentLineContent,
  descriptionLeadFenceScans,
  dropTrailingWhitespace,
  endsHeadingOrQuote,
  isTableRow,
  markerRunListIsQuoteHeld,
  nestedItemHoldsOpenParagraph,
  parseCommentBlock,
  retainBelowColumnComment,
  sourceColumnAt,
  trimEndSpaceTab,
}
const parseDefinitionListWithHelpers = createDefinitionListParser(definitionListHelpers)

export const linkDefinitionHelpers = { ...listHelpers,
  RE_ABBR_DEF,
  RE_AFTER_TERM,
  RE_COMMENT_BLOCK_ANY,
  RE_DEFLIST_SEPARATOR,
  RE_PREPASS_ANY_FENCE_CLOSER,
  buildCodeCloserIndex,
  codeCloserPossibleIn,
  commentCloserInScope,
  composeContainerPrefix,
  containerQuoteDepth,
  dropTrailingWhitespace,
  normalizeRefLabel,
  parseAttrs,
  prepassMarker,
  prepassOpensBlock,
  scopeHoldsLine,
  spendLazyProbeBudget,
  stripContainerPrefixes,
  stripContainerPrefixesKeepIndent,
  trackWrappedAttributeRun,
  unescapeAttrValue,
  utf8ByteLength,
}
const collectLinkDefsWithHelpers = createLinkDefinitionCollector(linkDefinitionHelpers)

export const inlineScannerHelpers = { ...listHelpers,
  ATTR_INERT_PREV,
  FORCED_TYPE,
  MAX_NESTING_DEPTH,
  NO_OPEN_KINDS,
  RE_AUTOLINK,
  RE_BRACED_EN_DASH,
  RE_CROSSREF,
  RE_ESCAPABLE_PUNCTUATION,
  RE_EXTENSION,
  RE_FOOTNOTE_REF,
  RE_INLINE_ATTR,
  RE_MENTION,
  RE_RAW_INLINE,
  RE_REF_TAIL,
  RE_SPAN_TAIL,
  RE_SYMBOL,
  RE_TAG,
  accumulateAttrs,
  buildBracketMap,
  completeDestinationOpeners,
  crossrefBodyCanEnd,
  execLinkTail,
  extendsGrapheme,
  isEmptyAttrs,
  isValidInlineAttrPayload,
  lastEmittedGlyph,
  newEmphasisMemo,
  opensInlineComment,
  parseAttrs,
  referenceImage,
  referenceLink,
  spanAttrProvablyInvalid,
  splitBracedOpener,
  stripVerbatimPadding,
  suffixHasChar,
  suffixHasPair,
  symbolOpensAt,
  trimEndSpaceTab,
  trimStructural,
  unescapeAttrValue,
  verbatimSpanEnd,
  get inlineDepth() { return inlineDepth },
}
const scanInlineInnerWithHelpers = createInlineScanner(inlineScannerHelpers)

const parseListWithHelpers = createListParser(listHelpers, trackItemLazyState, rebaseOverindentedBlocks)

// ============================================================================
// Attribute block parsing — {#id .class key=value key="value with spaces"}
// ============================================================================

export const lineBlockHelpers = {
  RE_LINE_BLOCK_OPEN,
  collectLiteralColonFenceBody,
  dropTrailingSpaces,
  expandLineBlockWhitespace,
  inlineSource,
  isBlankLine,
  mapInlineChildren,
  restoreVerseGaps,
  stripLazyFrame,
  stripPositions,
  trimEndSpaceTab,
  verseSourceOffset,
  visitInlineChildren
}
const parseLineBlockWithHelpers = createLineBlockParser(lineBlockHelpers)

export const tableBlockHelpers = {
  RE_CAPTION,
  RE_TABLE_CONT,
  inlineSource,
  isBlankLine,
  isGfmDelimiterRow,
  isTableRow,
  joinFragment,
  openVerbatimRun,
  parseCellMarkers,
  resolveSpanGrid,
  rowAttrsFromLine,
  splitTableRowSpans,
  stripPositions,
  stripPositionsOutsideRow,
  trimCellPadding
}
const parseTableBlock = createTableBlockParser(tableBlockHelpers)

/** State owned by one synchronous parse operation. */
export class ParseSession {
  private lineBlockHost: LineBlockHost | undefined
  private tableBlockHost: TableBlockHost | undefined
  captionLineScopes: Set<number>[] = []
  private measuringAttachedBlock = false

  private recordAttachedCaption(lexer: Lexer, index: number): void {
    if (!this.probingLazyParagraph && !this.measuringAttachedBlock) {
      this.captionLineScopes.at(-1)?.add(lexer.lineNumber(index))
    }
  }
  // Cache successful lexical matches; container ownership is checked at each use.
  private linkDefMatches: Map<string, LinkDefMatch> | undefined

  private matchLinkDef(line: string): LinkDefMatch | null {
    if (!line.includes(']:')) return null
    const cached = this.linkDefMatches?.get(line)
    if (cached) return cached
    const matched = matchLinkDef(line)
    if (matched) (this.linkDefMatches ??= new Map()).set(line, matched)
    return matched
  }

  private isLinkDefLine(line: string): boolean {
    return this.matchLinkDef(line) !== null
  }

  private markerPrefixMemos = new WeakMap<readonly string[], Map<number, Map<number, number>>>()
  markerFenceMemos = new WeakMap<Map<number, number>, Map<number, { offset: number; column: number; close: RegExp | null }>>()
  markerFenceHolderColumns = new WeakMap<readonly string[], Map<number, number>>()

  // Only literal source suffixes share numeric offsets; reconstructed lines do not.
  markerPrefixMemo(lexer: Lexer, index: number): Map<number, number> | undefined {
    if (!lexer.hasDocumentOffsets || !lexer.prefixMemoAllowed(index)) return undefined
    const root = lexer.rootLines ?? lexer.lines
    let lines = this.markerPrefixMemos.get(root)
    if (!lines) this.markerPrefixMemos.set(root, lines = new Map())
    const line = lexer.lineNumber(index)
    let memo = lines.get(line)
    if (!memo) lines.set(line, memo = new Map())
    return memo
  }
  private linkLabelDepth = 0

  // Matchers belong to this parse; fragment parsing scopes its matcher context.
  activeMatchers: CarveExtension[] = []

  private activeMatcherCtx: MatcherContext | null = null

  /**
   * The document being parsed, for the one field that promises VERBATIM SOURCE.
   */
  private activeDocument: string | null = null
  recordPositions = true

  // A definition pre-pass probe parses a source fragment through the block layer.
  // Matchers remain active during that parse, but its own definition scan must not
  // start another probe (a matcher may recursively call ctx.parseBlocks too).
  private probingLazyParagraph = false
  private definitionRegionLines: Set<number> | null = null
  private inMatcherRequest = false
  // Set on the line-ownership probe only: a paragraph's inlines never decide
  // which lines a block consumes, so the probe leaves them unscanned.
  private skipParagraphInlines = false

  parse(source: string, opts: ParseOptions = {}): Document {
    const sourceByteLength = utf8ByteLength(source)
    this.recordPositions = opts.positions !== false
    this.newlineIndexCache.clear()
    this.markerPrefixMemos = new WeakMap()
    this.markerFenceMemos = new WeakMap()
    this.markerFenceHolderColumns = new WeakMap()
    this.activeQuoteCharacters = opts.extensions
      ?.map((extension) => extension.quoteCharacters)
      .filter((quotes): quotes is readonly [string, string, string, string] => quotes !== undefined)
      .at(-1) ?? this.activeQuoteCharacters
    this.quoteGlyphHasNul = this.activeQuoteCharacters.some((glyph) => glyph.includes('\0'))
    // Strip a single leading UTF-8 BOM (U+FEFF) at the DOCUMENT start so `﻿# T`
    // is a heading, not literal text. Only here in the root entry -- nested
    // sub-lexers (blockquote/admonition/extension bodies) keep a leading BOM
    // literal (`> ﻿# T` stays a quoted paragraph), matching carve-php / carve-rs.
    const strippedBom = source.charCodeAt(0) === 0xfeff
    if (strippedBom) source = source.slice(1)
    // Replace any NUL (U+0000) with the U+FFFD replacement character so a control
    // byte never reaches output (decided cross-impl behavior; WHATWG-style).
    if (source.includes('\0')) source = source.replace(/\0/g, '�')
    // A lone surrogate becomes U+FFFD too, so output is always well-formed
    // (CARVE-P0-023).
    source = replaceLoneSurrogates(source)
    const lexer = new Lexer(
      source,
      opts,
      0,
      opts.onUnclosedContainer || opts.onDanglingBlockAttributes || opts.onInvalidContainerMetadata ? new Set<string>() : undefined,
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
    this.activeDocument = strippedBom ? '﻿' + source : source
    // ACTIVATED BEFORE THE DEFINITION PREPASS, not after. The pass itself calls
    // no matcher, but it now asks whether one is registered: an extension's
    // `matchBlock` may claim any line, and a claimed line reads as prose to a
    // line-shape test. `makeMatcherCtx` captures the definition maps by
    // reference, so building it first sees the same tables the pass fills.
    this.activeMatchers = (opts.extensions ?? []).filter((e) => e.matchInline || e.matchBlock)
    this.activeMatcherCtx = this.activeMatchers.length ? this.makeMatcherCtx(lexer, opts) : null
    // First pass: collect abbreviation and reference-link definitions so
    // they can be resolved regardless of document order (grammar §6).
    this.collectLinkDefs(lexer)
    const children = this.parseBlocks(lexer, 0)
    appendLinkReferenceDefinitions(children, lexer, strippedBom ? '\ufeff' + source : source)
    const doc: Document = { type: 'document', children }
    // Record the source byte length so renderers can size the
    // abbreviation-expansion budget (DoS guard); see render-html/markdown/ansi.
    doc.srcByteLength = sourceByteLength
    if (lexer.frontmatter) doc.frontmatter = lexer.frontmatter
    if (lexer.footnoteDefs.size) doc.footnoteDefs = Object.fromEntries(lexer.footnoteDefs)
    if (lexer.footnoteDefPos.size) doc.footnoteDefPos = Object.fromEntries(lexer.footnoteDefPos)
    if (opts.positions === false) return dropPositions(doc)
    else toCodepointPositions(doc, strippedBom ? '\ufeff' + source : source)
    return doc
  }

  // The MatcherContext handed to an extension's matchers, bound to a specific
  // lexer's definition tables. Recursive parsing resolves that lexer's defs so
  // extension-parsed content behaves like core nested content, not an isolated
  // snippet.
  private makeMatcherCtx(lexer: Lexer, opts: ParseOptions): MatcherContext {
    const session = this
    return {
      get inLinkLabel() { return session.linkLabelDepth > 0 },
      parseInlines: (t) => this.withMatcherRequest(() => this.parseInline(t, lexer.abbrDefs, lexer.linkDefs)),
      parseBlocks: (s) => this.withMatcherRequest(() => {
        const outerScopes = this.captionLineScopes
        this.captionLineScopes = []
        try {
          return this.parseBlockSource(s, opts, lexer)
        } finally {
          this.captionLineScopes = outerScopes
        }
      }),
      linkDefs: lexer.linkDefs,
      abbrDefs: lexer.abbrDefs,
    }
  }

  private withMatcherRequest<T>(parse: () => T): T {
    const previous = this.inMatcherRequest
    this.inMatcherRequest = true
    try {
      return parse()
    } finally {
      this.inMatcherRequest = previous
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
  private parseBlockSource(source: string, opts: ParseOptions, root: Lexer): BlockNode[] {
    const sourceLines = normalizedSourceLines(source)
    const anchor = root.pos + 1
    const sourceLineMap =
      sourceLines.length > 0 &&
      sourceLines.every((line, i) => root.lineAt(anchor + i) === line)
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
    this.collectLinkDefs(sub)
    if (!this.activeMatchers.length) return this.parseBlocks(sub, 0)
    const prevCtx = this.activeMatcherCtx
    this.activeMatcherCtx = this.makeMatcherCtx(sub, opts)
    try {
      return this.parseBlocks(sub, 0)
    } finally {
      this.activeMatcherCtx = prevCtx
    }
  }

  // Offer the active block matchers the line at the lexer cursor, in registration
  // order. On a match, advance the lexer by linesConsumed and return the node.
  // Core block constructs are dispatched first (see parseBlockInner), so an
  // extension only sees lines core declined.
  private tryBlockMatchers(lexer: Lexer): BlockNode | null {
    const ctx = this.activeMatcherCtx
    if (!ctx) return null
    for (const ext of this.activeMatchers) {
      if (!ext.matchBlock) continue
      const res = ext.matchBlock(lexer.lines, lexer.pos, ctx)
      if (res && res.linesConsumed > 0) {
        for (let k = 0; k < res.linesConsumed && !lexer.eof(); k++) lexer.consume()
        return res.node
      }
    }
    return null
  }

  private scanLinkLabel(text: string, source: InlineSource, inFootnote: boolean): InlineNode[] {
    this.linkLabelDepth++
    try {
      // A LABEL IS A HOST, not a span inside one: its inline run starts here, so a
      // `%%` written first in it needs no separator (CARVE-P9-041, corpus 518).
      return this.scanInline(text, source, inFootnote, false, NO_OPEN_KINDS, true)
    } finally {
      this.linkLabelDepth--
    }
  }

  // Offer the active inline matchers the position `pos` in `text`, in
  // registration order. Returns the first match whose end advances past pos.
  private tryInlineMatchers(text: string, pos: number): InlineMatch | null {
    const ctx = this.activeMatcherCtx
    if (!ctx || (this.definitionRegionLines && !this.inMatcherRequest)) return null
    for (const ext of this.activeMatchers) {
      if (!ext.matchInline) continue
      const res = ext.matchInline(text, pos, ctx)
      if (res && res.end > pos && res.end <= text.length) return res
    }
    return null
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
  private lineFoldsIntoOpenParagraph(
    lexer: Lexer,
    candidate: number,
    budget: number,
  ): boolean | 'unknown' {
    // `'unknown'` means THE PROBE DID NOT RUN, not "it does not fold". PART 9R
    // R1a lets the bound stay but forbids spending it as an answer, so the caller
    // reaches the answer statically instead (markup-carve/carve#1895).
    if (this.probingLazyParagraph) return 'unknown'
    const priced = lazyProbeCost(lexer, candidate)
    if (!priced || priced.cost > budget) return 'unknown'
    const before = lexer.lines.slice(priced.start, candidate).join('\n')
    const after = `${before}\n${lexer.lineAt(candidate)!}`
    const probe = (source: string): LazyProbeFrame => {
      const { onUnclosedContainer: _ignored, onInvalidContainerMetadata: _invalidIgnored, ...callerOptions } = lexer.parseOptions
      const options: ParseOptions = { ...callerOptions, positions: false }
      const sub = new Lexer(source, options)
      sub.atDocumentLevel = true
      sub.suppressPositions = true
      const previousCtx = this.activeMatcherCtx
      this.activeMatcherCtx = this.activeMatchers.length ? this.makeMatcherCtx(sub, options) : null
      try {
        this.collectLinkDefs(sub)
        return lazyProbeFrame(this.parseBlocks(sub, 0))
      } finally {
        this.activeMatcherCtx = previousCtx
      }
    }
    this.probingLazyParagraph = true
    try {
      const a = probe(before)
      const b = probe(after)
      return b.endsInParagraph && a.levels.join('\0') === b.levels.join('\0')
    } finally {
      this.probingLazyParagraph = false
    }
  }

  private verseOwnedLines(lexer: Lexer): boolean[] | undefined {
    if (!lexer.lines.some((line, index) => index >= lexer.pos && line.includes('::: ') && line.trimEnd().endsWith('|')) ||
        !lexer.lines.some((line, index) => index >= lexer.pos && line.includes(']:'))) return undefined
    const owned = Array<boolean>(lexer.lineCount).fill(false)
    const parser = new ParseSession()
    parser.probingLazyParagraph = true
    parser.definitionRegionLines = new Set()
    // Ownership is a set of line numbers; spans and paragraph text are discarded.
    parser.recordPositions = false
    parser.skipParagraphInlines = true
    // Core inline callbacks do not participate in source-line ownership.
    // Explicit matcher context requests still use the complete matcher set.
    parser.activeMatchers = this.activeMatchers
    const probe = new Lexer(lexer.lines, { positions: false })
    probe.pos = lexer.pos
    probe.depth = lexer.depth
    probe.nested = lexer.nested
    probe.hostBody = lexer.hostBody
    probe.hostContentColumn = lexer.hostContentColumn
    probe.hostQuoteDepth = lexer.hostQuoteDepth
    probe.definitionLeadFromItemMarker = lexer.definitionLeadFromItemMarker
    probe.nonAuthoredDefinitionStarts = lexer.nonAuthoredDefinitionStarts
    probe.returnedDescriptionOwnerColumns = lexer.returnedDescriptionOwnerColumns
    probe.atDocumentLevel = lexer.atDocumentLevel
    probe.inFootnoteBody = lexer.inFootnoteBody
    parser.activeMatcherCtx = parser.activeMatchers.length ? parser.makeMatcherCtx(probe, {}) : null
    parser.parseBlocks(probe, 0)
    for (const line of parser.definitionRegionLines) {
      if (line > 0 && line <= owned.length) owned[line - 1] = true
    }
    return owned
  }

  private collectLinkDefs(lexer: Lexer) {
    const parseSession = this
    return collectLinkDefsWithHelpers({
      get definitionRegionLines() { return parseSession.definitionRegionLines },
      get activeMatchers() { return parseSession.activeMatchers },
      get probingLazyParagraph() { return parseSession.probingLazyParagraph },
      verseOwnedLines: this.verseOwnedLines.bind(this),
      isLinkDefLine: this.isLinkDefLine.bind(this),
      matchLinkDef: this.matchLinkDef.bind(this),
      lineFoldsIntoOpenParagraph: this.lineFoldsIntoOpenParagraph.bind(this),
    }, lexer)
  }

  parseBlocks(lexer: Lexer, baseIndent: number, carry?: PendingAttrCarry): BlockNode[] {
    const out: BlockNode[] = []
    const listMarkerColumns = new Set<number>()
    // Leading block-attribute lines (grammar PART 9 §15) accumulate here
    // and attach to the next block. They float across blank lines; a
    // dangling run with no following block is dropped -- unless a `carry` says
    // this stream is only HALF of one the caller split, in which case the run
    // travels to the other half instead of dying at the seam.
    let pending: Attrs | null = carry?.attrs ?? null
    // Where the OLDEST line of the current pending run sits, so A4 can say which
    // `{...}` died rather than only that one did. Null whenever `pending` is.
    let pendingAt: number | null = null
    while (!lexer.eof()) {
      const line = lexer.peek()!
      if (lexer.rootLines === undefined && lexer.consumedContinuationLines.has(lexer.lineNumber(lexer.pos))) {
        lexer.consume()
        continue
      }
      if (isBlankLine(line)) {
        // Blank lines do NOT reset pending block attributes (§15 reach).
        lexer.consume()
        continue
      }
      // Stop at lower indent (caller's responsibility to detect this)
      const indent = leadingWhitespace(line)
      if (indent < baseIndent) break

      const attrLineIndex = lexer.pos
      const ba = tryCollectBlockAttributes(lexer)
      if (ba) {
        pending = pending ? accumulateAttrs(pending, ba) : ba
        if (pendingAt === null) pendingAt = attrLineIndex
        continue
      }

      const sibling = lexer.peek(1)
      if (out.at(-1)?.type === 'list' && isContinuationMarker(line) && sibling !== undefined &&
          isListMarkerLine(sibling) && indentColumns(line) === indentColumns(sibling) &&
          listMarkerColumns.has(indentColumns(line))) {
        lexer.interruptRefusedSiblingPlusLine = lexer.pos
      }
      let node = this.parseBlock(lexer)
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
        const candidate = node.type === 'code_block' ? node
          : node.type === 'figure' && node.target.type === 'code_block' ? node.target : undefined
        if (candidate && node.attrs?.keyValues?.table === '') {
          const table = delimitedTable(candidate, node.attrs)
          if (table) {
            if (node.type === 'figure') {
              table.caption = node.caption
              if (node.pos) table.pos = node.pos
            }
            node = table
          }
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
        if (node.type === 'list') listMarkerColumns.add(indentColumns(line))
      }
      // A VISIBLE block absorbs any pending attrs; an invisible one leaves them
      // pending for the next block (A2a, above).
      if (!invisible) {
        pending = null
        pendingAt = null
      }
    }
    // A dangling pending run (no following block) is dropped -- or, when the
    // caller split one stream in two, handed on to the next half.
    if (carry) carry.attrs = pending
    // Nothing is emitted for a run that died here, so this is the only place the
    // fact exists. `carry` streams are excluded: there the run lives on in the
    // other half, and reporting it at the seam would name a loss that is not
    // happening (carve-js#2240).
    // Two conditions, and both are load-bearing. `hostBodyRoot` rather than
    // `hostBody` because the latter is propagated, so a `::: note` inside a
    // description body would claim to BE that body; `out.length === 0` because a
    // run below real content is not the whole body either (carve-js#2408).
    else if (pending && pendingAt !== null) {
      lexer.reportDanglingBlockAttributes(
        pendingAt,
        out.length === 0 ? (lexer.hostBodyRoot ?? undefined) : undefined,
      )
    }
    return out
  }

  private parseBlock(lexer: Lexer): BlockNode | null {
    const startLine = lexer.pos
    const node = this.parseBlockInner(lexer)
    if (node) attachBlockPos(lexer, node, startLine, lexer.pos)
    return node
  }

  private parseBlockInner(lexer: Lexer): BlockNode | null {
    const line = lexer.peek()!
    const hostedLinkDef =
      lexer.consumesHostedLinkDefs === 'all' ||
      (lexer.consumesHostedLinkDefs === 'lazy' &&
        lexer.quoteLazyLines.has(lexer.lineNumber(lexer.pos)))
    const hostedLinkDefLine = hostedLinkDef ? stripLazyFrame(line) : line

    // Past the nesting limit, stop opening recursive containers and treat the
    // line as paragraph text. Prevents a call-stack overflow on pathologically
    // nested input (e.g. thousands of `> `); see MAX_NESTING_DEPTH.
    if (lexer.depth >= MAX_NESTING_DEPTH) return this.parseParagraph(lexer, true)

    // Block-level constructs in priority order
    if (RE_RAW_FENCE.test(line)) return parseRawBlock(lexer)
    if (RE_FENCE.test(line)) return this.parseFence(lexer)
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
      return { type: 'comment', block: false, content: commentLineContent(l) }
    }
    if (RE_LINE_BLOCK_OPEN.test(line)) return this.parseLineBlock(lexer)
    if (RE_HARDBREAKS_OPEN.test(line)) return this.parseHardBreaksBlock(lexer)
    if (RE_QUOTE_BLOCK_OPEN.test(line)) return this.parseQuoteBlock(lexer)
    // A typed `::: word` admonition opens immediately; if no exact closer appears
    // ahead, it auto-closes at EOF.
    if (RE_ADMONITION_OPEN.test(line) && !RE_ADMONITION_CLOSE.test(line))
      return this.parseAdmonition(lexer)
    // Bare `:::` or attributes-only `::: {…}` opens a generic div (the
    // admonition branch above already claimed the `::: word` form).
    if (RE_DIV_OPEN.test(line)) return this.parseDiv(lexer)
    // PART 12 §7: only at document level. In a container the line falls through
    // to the paragraph branch and is preserved as the text the author typed.
    if (lexer.atDocumentLevel && RE_ABBR_DEF.test(line)) {
      return parseAbbrDef(lexer)
    }
    // Footnote definition: consume the def line + indented continuation
    // and stash the parsed body (tested before RE_LINK_DEF).
    if (RE_FOOTNOTE_DEF.test(line)) return this.parseFootnoteDef(lexer)
    // A NESTED footnote def, indented past a consuming container's own content
    // column, is registered on the host's behalf exactly as a link def is
    // (markup-carve/carve-js#1638). The flush test above misses it - the marker
    // sits past column 0 - but a container that consumes hosted definitions
    // consumes an indented footnote def the same way; parseFootnoteDef strips the
    // marker's indent. Footnote-shaped, so it is NOT caught by the link-def arm
    // below, which excludes `[^`.
    if (
      !line.startsWith(LAZY_FRAME) &&
      (!lexer.itemLazyLines.has(lexer.lineNumber(lexer.pos)) ||
        lexer.hostedFootnoteLines.has(lexer.lineNumber(lexer.pos))) &&
      (lexer.inFootnoteBody || hostedLinkDef ||
        (lexer.consumesHostedLinkDefs !== 'lazy' &&
          (lexer.hostBody === 'list' || lexer.hostBody === 'description'))) &&
      RE_FOOTNOTE_DEF.test(hostedLinkDefLine.replace(/^[ \t]+/, ''))
    ) {
      return this.parseFootnoteDef(lexer)
    }
    // Reference-link definitions were collected in the first pass; the
    // line itself produces no block (consume it so it is not a paragraph).
    // Strict column-0 rule: RE_LINK_DEF is whitespace-tolerant (its leading
    // `[^\S ]*` matches spaces/tabs so a quoted/nested def is still
    // recognized in other passes), but a def is a block opener and opens ONLY at
    // its container's content column (column 0 here). An INDENTED `[x]: …` line is
    // literal paragraph text -- and, since RE_LINK_DEF also matches `[^fn]: …`, an
    // indented footnote def (missed by the flush-anchored RE_FOOTNOTE_DEF above)
    // must not be swallowed here either. A footnote body is the exception: its
    // containers absorb residual indentation at or past their content column.
    if (
      (!line.startsWith(LAZY_FRAME) || lexer.hostBody === 'list') &&
      (leadingWhitespace(hostedLinkDefLine) === 0 ||
        // A FOOTNOTE DEF IS NOT A LINK DEF, though `RE_LINK_DEF` matches both.
        // The flush-anchored test above missed an indented one, so without this
        // the note body's leniency swallowed a NESTED footnote definition and its
        // reference dangled (the oracle registers it).
        (lexer.inFootnoteBody && !/^[ \t]*\[\^/.test(hostedLinkDefLine)) ||
        (hostedLinkDef && !/^[ \t]*\[\^/.test(hostedLinkDefLine))) &&
      this.isLinkDefLine(hostedLinkDefLine) &&
      !lexer.literalLazyLinkDefLines.has(lexer.lineNumber(lexer.pos)) &&
      // NOTHING COLLECTED IT, SO NOTHING MAY REMOVE IT. Under-collecting is the
      // error PART 9R R1a licenses; deleting the author's line is the one it
      // rules out, and carve#1883 forbids returning a document missing text the
      // author typed. Falling through leaves the line as the paragraph it looks
      // like (markup-carve/carve-js#1597).
      (!lexer.declinedLinkDefLines.has(lexer.lineNumber(lexer.pos)) || hostedLinkDef)
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
    if (RE_HEADING.test(line)) return this.parseHeading(lexer)
    // Definition list starts on a `:: term` line (two colons, not three).
    if (RE_DEFLIST_TERM.test(line)) return this.parseDefinitionList(lexer)
    if (quotedLineText(line, lexer.lineTerminatorFree(lexer.pos)) !== null) return this.parseBlockQuote(lexer)
    if (
      taskMatch(line, lexer.lineTerminatorFree(lexer.pos)) !== null ||
      unorderedMatch(line, lexer.lineTerminatorFree(lexer.pos)) !== null ||
      orderedMatch(line, lexer.lineTerminatorFree(lexer.pos)) !== null ||
      extractItemAttr(line, lexer.lineTerminatorFree(lexer.pos)) !== null
    )
      return this.parseList(lexer)
    if (isTableRow(line)) return this.parseTable(lexer)
    if (isBlockImageLine(line) && imageIsBlock(lexer)) return this.parseBlockImage(lexer)
    // Extension block matchers run after every core construct, before the
    // paragraph fallback: extensions add syntax, they never hijack core.
    if (this.activeMatchers.length) {
      const matched = this.tryBlockMatchers(lexer)
      if (matched) return matched
    }
    // A line that is nothing but a display-math span (`$$`…``) standalone on its
    // block is a candidate EQUATION; when a caption follows it is numbered like a
    // figure/table/listing (#87). Diverted here, before the paragraph fallback,
    // because parseParagraph would otherwise fold the caption line into the math
    // paragraph.
    if (line.trimStart().startsWith('$$`')) {
      const eq = this.parseEquationBlock(lexer)
      if (eq) return eq
    }
    return this.parseParagraph(lexer)
  }

  // Parse a standalone display-math line, optionally wrapping it in a figure when
  // a caption follows (a numbered equation). Returns null when the line is not
  // solely display math, or when non-blank prose follows with no blank line (so
  // the line belongs to a normal multi-line paragraph instead).
  private parseEquationBlock(lexer: Lexer): Paragraph | Figure | null {
    // Mirror parseParagraph's leading-whitespace strip + base-position folding so
    // an indented standalone equation is still recognized and the math span keeps
    // its true source offset.
    const lineIndex = lexer.pos
    const raw = lexer.peek()!
    const firstLead = raw.match(/^[ \t]+/)?.[0].length ?? 0
    const inline = this.parseInline(raw.replace(/^[ \t]+/, ''), lexer.abbrDefs, lexer.linkDefs, {
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
    // A display-math equation line reaches here already dispatched as a block, so
    // it stands at its container's content column by construction.
    const para: Paragraph = { type: 'paragraph', children: inline }
    // §4: a caption attaches across at most one blank line.
    if (cap && blanks <= 1) {
      this.recordAttachedCaption(lexer, lexer.pos + la)
      for (let i = 0; i <= la; i++) lexer.consume()
      // The block loop spans the FIGURE, so the equation paragraph it wraps would
      // otherwise have no position of its own (PART 12 §4). The equation occupies
      // exactly its own line; the figure spans that plus the caption.
      attachBlockPos(lexer, para, lineIndex, lineIndex + 1)
      return {
        type: 'figure',
        target: para,
        caption: this.parseCaptionInline(lexer, cap[1]!),
      } as Figure
    }
    // Non-blank, non-caption text immediately follows: let parseParagraph fold
    // the math and that text into one paragraph (preserve existing behavior).
    if (after !== undefined && blanks === 0) return null
    // Standalone display math with no caption: a plain single-math paragraph.
    lexer.consume()
    return para
  }

  private parseHeading(lexer: Lexer): Heading {
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
    text = trimEndSpaceTab(text)

    const node: Heading = { type: 'heading', level, children: [] }
    // djot-strict: a heading takes its attributes on the PRECEDING block-
    // attribute line (§15), not as a trailing `{…}` on its own line. A `{…}`
    // at the end of the heading text is therefore ordinary inline content.
    // Column where the content starts on the first line (the marker + spaces).
    const textColumn = line.length - line.replace(/^#{1,6} +/, '').length + 1
    node.children = this.parseInline(text, lexer.abbrDefs, lexer.linkDefs, {
      anchored: lexer.hasDocumentOffsets,
      baseOffset: lexer.lineOffset(lineIndex) + textColumn - 1,
      startLine: lexer.lineNumber(lineIndex),
      startColumn: lexer.lineStartColumn(lineIndex) + textColumn - 1,
    })
    return node
  }

  private parseFence(lexer: Lexer): CodeBlock | Figure {
    const fenceStartIndex = lexer.pos
    const open = lexer.consume()
    const m = RE_FENCE.exec(open)!
    const marker = m[2]!
    const indent = m[1]!.length
    const lang = m[3] || undefined
    // Header is the quoted group (with or without a language); label is the
    // bracketed group from whichever alternative matched. Strip the delimiters.
    const headerRaw = m[4] ?? m[6]
    const labelRaw = m[5] ?? m[7] ?? m[8]
    const header = headerRaw ? headerRaw.slice(1, -1) : undefined
    const label = labelRaw ? labelRaw.slice(1, -1) : undefined
    const closeRe = fenceCloseRe(marker)
    const lines: string[] = []
    const payloadPositions: { offset: number; line: number; column: number; text: string }[] = []
    let lastPayloadLineIndex = -1
    let closed = false
    while (!lexer.eof()) {
      if (lexer.attachmentBoundaries.has(lexer.lineNumber(lexer.pos))) break
      const ln = lexer.peek()!
      const folded = lexer.itemLazyLines.has(lexer.lineNumber(lexer.pos))
      if (!folded && closeRe.test(ln) && ln.length - ln.trimStart().length <= 3) {
        lexer.consume()
        closed = true
        break
      }
      lastPayloadLineIndex = lexer.pos
      lexer.consume()
      // The frame did its work in the closer test above - it is what keeps a
      // closing run the CONTAINER folded in from closing this block - and a
      // verbatim body is where a framed line becomes text, so it comes off here
      // (markup-carve/carve-js#1630).
      // Below-column payload carries host alignment, not code indentation.
      const body = folded ? stripLazyFrame(ln).replace(/^[ \t]+/, '') : stripLazyFrame(ln)
      // Strip the common indent of the opening fence (Djot rule)
      const payload = body.slice(Math.min(indent, leadingWhitespace(body)))
      lines.push(payload)
      if (lexer.hasDocumentOffsets && ln.endsWith(payload)) {
        const prefixWidth = [...ln.slice(0, ln.length - payload.length)].length
        payloadPositions.push({
          offset: lexer.lineOffset(lastPayloadLineIndex) + prefixWidth,
          line: lexer.lineNumber(lastPayloadLineIndex),
          column: lexer.lineStartColumn(lastPayloadLineIndex) + prefixWidth,
          text: payload,
        })
      }
    }
    if (!closed) lexer.reportUnclosedCodeFence(fenceStartIndex, marker, indent)
    const fenceEndIndex = lexer.pos
    // CARVE-P12-064: `content` is the payload's LITERAL text. Every line carries
    // its own break, so a zero-line payload is `""` whether the fence closed or
    // not, and only a payload whose last line is the document's last - with no
    // break behind it in the source - ends mid-line.
    const terminated =
      !lexer.documentLacksFinalBreak ||
      lastPayloadLineIndex < 0 ||
      lexer.lineNumber(lastPayloadLineIndex) < lexer.documentLineCount
    const cb: CodeBlock = { type: 'code_block', content: codeContent(lines, terminated) }
    if ((lang === 'csv' || lang === 'tsv') && payloadPositions.length === lines.length) {
      setDelimitedPayloadLines(cb, payloadPositions)
    }
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
        this.recordAttachedCaption(lexer, lexer.pos + lookahead)
        for (let i = 0; i <= lookahead; i++) lexer.consume()
        // The block loop spans the FIGURE, so the fence it wraps would otherwise
        // have no position of its own (PART 12 §4). It ends where the caption
        // begins - the same treatment the captioned image and blockquote already
        // get.
        attachBlockPos(lexer, cb, fenceStartIndex, fenceEndIndex)
        return {
          type: 'figure',
          target: cb,
          caption: this.parseCaptionInline(lexer, cap[1]!),
        } as Figure
      }
    }
    return cb
  }

  // Footnote definition. The def line's trailing text plus following lines
  // indented by >= 2 spaces (single blank lines allowed between chunks)
  // form the note body, parsed as blocks. First definition for a label
  // wins. Emits no block — the body is stashed on lexer.footnoteDefs and
  // rendered in the endnotes section.
  private parseFootnoteDef(lexer: Lexer): null {
    const defLineIndex = lexer.pos
    const defLineRaw = lexer.consume()
    // A note's body column is measured from its OWN marker: §16 asks for two
    // columns past the marker, not two past the frame's zero. A properly nested
    // note rebases to column zero, so `markerColumn` is 0 and `bodyColumn` is the
    // fixed minimum of two. A note that opens one column shy of its host's body
    // column keeps a residual marker indent here (the `i < m+2` nested-note
    // geometry of carve-js#1653 / markup-carve/carve#1946): its body column is
    // then `markerColumn + 2`, so a trailing line below the note's own content
    // column is NOT claimed by it and falls to the surviving ancestor note. Left
    // at the fixed 2 the innermost note over-reached, taking a line that belongs
    // to the outer note.
    const markerColumn = indentColumns(defLineRaw)
    const bodyColumn = markerColumn + FOOTNOTE_BODY_COLUMN
    const authoredLine = lexer.rootLines?.[lexer.lineNumber(defLineIndex) - 1]
    const authoredBodyColumn = authoredLine === undefined ? undefined
      : sourceColumn(authoredLine) + FOOTNOTE_BODY_COLUMN
    const m = RE_FOOTNOTE_DEF.exec(defLineRaw.replace(/^[ \t]+/, ''))!
    // Preserve the raw label as the AST/source-layout spelling. Resolution and
    // duplicate handling derive their shared ASCII-whitespace key separately.
    const label = m[1]!
    const bodyLines = [m[2]!]
    const bodyLineNumbers = [lexer.lineNumber(defLineIndex)]
    // The source line each collected line came from, and which of them were
    // buffered blanks. `restoreVerbatimBlanks` reads both after the rebase.
    const bodySourceLines: (string | undefined)[] = [defLineRaw]
    const bufferedBlanks = new Set<number>()
    // The def line's own content starts past its marker, which is ASCII, so the
    // prefix length is its column width.
    const defContentColumn =
      markerColumn + (defLineRaw.replace(/^[ \t]+/, '').length - m[2]!.length)
    let pendingBlanks = 0
    let pendingBlankLineNumbers: number[] = []
    let pendingBlankSources: string[] = []
    let nestedSourceBodyColumn: number | undefined
    const noteSpanScan = newCommentSpanScan()
    const lazyState = verbatimOnlyLazyState()
    // First-block form (`[^a]: +`, as `- +` and `:  +`): a lone `+` as the whole
    // marker-line content, with a non-blank line at document column 0 below it,
    // is a marker, and that line's block is the body. An invisible line (a
    // definition or a comment) is passed over as under `- +`, so a further
    // footnote definition is no boundary here. Otherwise the `+` stays text.
    let firstBlockAttached = false
    const below = lexer.peek()
    if (/^\+[ \t]*$/.test(m[2]!) && below !== undefined && !isBlankLine(below) &&
        attachesAtDocumentColumnZero(lexer, sourceColumn((lexer.rootLines ?? lexer.lines)[lexer.lineNumber(defLineIndex) - 1] ?? defLineRaw), 0, true)) {
      const { lines: attached, lineNumbers: attachedLineNumbers } = this.collectAttachedBlock(
        lexer,
        (a) => isBlankLine(a) || /^\+[ \t]*$/.test(a),
        0, true, sourceColumn((lexer.rootLines ?? lexer.lines)[lexer.lineNumber(defLineIndex) - 1] ?? defLineRaw), 0, true,
      )
      firstBlockAttached = true
      bodyLines[0] = ''
      bodySourceLines[0] = undefined
      for (const a of attached) {
        bodyLines.push(a)
        bodySourceLines.push(a)
      }
      bodyLineNumbers.push(...attachedLineNumbers)
    }
    if (!firstBlockAttached) trackItemLazyState(m[2]!, lazyState, () => false)
    let retainedBelowComment = false
    const nestedMarkerHasText = RE_FOOTNOTE_DEF.exec(m[2]!)?.[2]?.trim() !== '' && RE_FOOTNOTE_DEF.test(m[2]!)
    let termTextContinuation = false
    const belowColumnCommentFence = new Set<number>()
    let commentFenceUntil = 0
    while (!lexer.eof()) {
      const ln = lexer.peek()!
      const sourceLine = lexer.rootLines?.[lexer.lineNumber(lexer.pos) - 1]
      if (lexer.hostBody === 'description' && pendingBlanks > 0 &&
          authoredBodyColumn !== undefined && sourceLine !== undefined && !isBlankLine(sourceLine) &&
          sourceColumn(sourceLine) < authoredBodyColumn && indentColumns(ln, bodyColumn) >= bodyColumn) break
      if (lexer.hostBody === 'list' && defLineIndex === 0 && nestedSourceBodyColumn !== undefined &&
          sourceLine !== undefined && !isBlankLine(sourceLine) &&
          indentColumns(sourceLine, nestedSourceBodyColumn) < nestedSourceBodyColumn) break
      if (isBlankLine(ln)) {
        retainedBelowComment = false
        termTextContinuation = false
        trackItemLazyState('', lazyState)
        pendingBlanks++
        pendingBlankLineNumbers.push(lexer.lineNumber(lexer.pos))
        pendingBlankSources.push(ln)
        lexer.consume()
        continue
      }
      // Form B: a lone `+` attaches the FOLLOWING flush-left block to the note
      // with no indentation (the same continuation marker lists and block quotes
      // use); the attached block ends at a blank line, another `+`, or the next
      // footnote definition - unless a fence this block opened is still open, in
      // which case all three are body text (corpus category 279).
      const noteMarkerLine = isContinuationMarker(ln.slice(leadingWhitespace(ln)))
      const noteMarker = noteMarkerLine ? markerDecision(lexer, lexer.pos) : undefined
      if (pendingBlanks === 0 && lazyState.opaque === null &&
          noteMarker?.owner?.kind === 'footnote' && noteMarker.reason !== undefined) {
        // The note still owns this marker even when the next block misses its
        // marker column. The body collector leaves the + as text below.
        lexer.reportRefusedContinuationMarker(lexer.pos, markerColumn + 1,
          'footnote', noteMarker.reason)
      }
      if (pendingBlanks === 0 && noteMarkerLine &&
          (isPhysicalContinuationMarker(sourceLine ?? ln) || noteMarker?.owner?.kind === 'footnote' && noteMarker.reason === undefined) &&
          sourceColumn((lexer.rootLines ?? lexer.lines)[lexer.lineNumber(lexer.pos)] ?? '', quotePrefixDepth(sourceLine ?? ln)) ===
            sourceColumn(sourceLine ?? ln) &&
          !(sourceLine !== undefined && quotePrefixDepth(sourceLine) > 0 &&
            sourceColumn(sourceLine) === quoteBodyColumn(sourceLine, quotePrefixDepth(sourceLine)) &&
            quotePrefixDepth((lexer.rootLines ?? lexer.lines)[lexer.lineNumber(lexer.pos)] ?? '') > quotePrefixDepth(sourceLine)) &&
          !isBlankLine((lexer.rootLines ?? lexer.lines)[lexer.lineNumber(lexer.pos)])) {
        const plusLineNumber = lexer.lineNumber(lexer.pos)
        lexer.consume()
        pendingBlanks = 0
        pendingBlankLineNumbers = []
        pendingBlankSources = []
        // ...AND THE NOTE ENDS WHERE A COMMENT ENDS IT. The gate below decides
        // whether this `+` is a marker at all; when it is not, the line is an
        // ordinary invisible line at document column 0, and a footnote body ends
        // at one of those exactly as it ends at a comment line there
        // (markup-carve/carve#1814). Asked one line early because this loop's
        // own continuation branch would otherwise claim the following line before
        // any extent is measured. The `+` is consumed either way, so the
        // enclosing parse resumes on the line the marker did not take.
        if (!attachesAtDocumentColumnZero(lexer, sourceColumn(sourceLine ?? ln), quotePrefixDepth(sourceLine ?? ln))) break
        const { lines: attached, lineNumbers: attachedLineNumbers } = this.collectAttachedBlock(
          lexer,
          (a) => isBlankLine(a) || /^\+[ \t]*$/.test(a) || RE_FOOTNOTE_DEF.test(a),
          0,
          true,
          sourceColumn(sourceLine ?? ln),
          quotePrefixDepth(sourceLine ?? ln),
        )
        if (attached.length > 0) {
          bodyLines.push('')
          bodyLineNumbers.push(plusLineNumber)
          bodySourceLines.push(undefined)
          for (const a of attached) {
            bodyLines.push(a)
            bodySourceLines.push(a)
          }
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
      if (indentColumns(ln, bodyColumn) >= bodyColumn) {
        for (let k = 0; k < pendingBlanks; k++) {
          bufferedBlanks.add(bodyLines.length)
          bodyLines.push('')
          bodyLineNumbers.push(pendingBlankLineNumbers[k]!)
          bodySourceLines.push(pendingBlankSources[k])
        }
        pendingBlanks = 0
        pendingBlankLineNumbers = []
        pendingBlankSources = []
        const content: string = retainedBelowComment && !RE_COMMENT_LINE.test(ln.trimStart())
          ? ln.trimStart() : sliceColumns(ln, bodyColumn, true)
        const belowQuotedComment = lazyState.quoteInner !== null && RE_COMMENT_LINE.test(content.trimStart())
        // The line reaches this body's column, so a definition on it registers
        // here even where a nested item takes it as lazy text (CARVE-P0-020).
        if (lazyState.opaque === null && RE_FOOTNOTE_DEF.test(content.trimStart()))
          lexer.hostedFootnoteLines.add(lexer.lineNumber(lexer.pos))
        if (lexer.hostBody === 'list' && defLineIndex === 0 && RE_FOOTNOTE_DEF.test(ln.trimStart()) && sourceLine !== undefined) {
          nestedSourceBodyColumn = indentColumns(sourceLine) + FOOTNOTE_BODY_COLUMN
        }
        if (content !== content.trimStart() && lazyState.opaque === null && commentFenceUntil <= lexer.pos)
          commentFenceUntil = matchedCommentFenceEnd(lexer) ?? commentFenceUntil
        if (lexer.pos < commentFenceUntil) belowColumnCommentFence.add(bodyLines.length)
        // Past the body column a definition is term text; at it, it registers (CARVE-P0-010).
        bodyLines.push(termTextContinuation && RE_DEFLIST_TERM.test(bodyLines[0] ?? '') && content !== content.trimStart() &&
          (RE_FOOTNOTE_DEF.test(content.trimStart()) || isLinkDefLine(content.trimStart()))
          ? LAZY_FRAME + content.trimStart() : content)
        if (RE_DEFLIST_TERM.test(bodyLines[0] ?? '') && /^:[ \t]+/.test(content.trimStart()))
          termTextContinuation = true
        trackItemLazyState(content, lazyState, (marker) => itemFenceHasCloser(lexer, marker, lexer.pos, bodyColumn, new Map(), (line, blank) => blank && indentColumns(line, bodyColumn) < bodyColumn))
        retainedBelowComment = belowQuotedComment && /^[ \t]*>/.test(lexer.peek(1) ?? '')
        bodyLineNumbers.push(lexer.lineNumber(lexer.pos))
        bodySourceLines.push(ln)
        lexer.consume()
      } else if (
        // A COMMENT INSIDE A SPAN THIS BODY ALREADY HOLDS IS NOT ONE OF THE
        // COMMENTS THAT END IT (markup-carve/carve-js#2255,
        // markup-carve/carve#2488). The note ends at a comment below its column,
        // and the other half of a span the body opened is not that comment - see
        // `bodyHoldsOpenCommentSpan`. The reported host hides the payload at a
        // delimiter REACHING column two and did not at column zero or one, which is
        // the band this covers.
        pendingBlanks === 0 &&
        commentFenceRun(ln.replace(/^[ \t]+/, '')) !== undefined &&
        bodyHoldsOpenCommentSpan(bodyLines, noteSpanScan)
      ) {
        // ONE COLUMN of the authored indentation is kept, as the list collector
        // keeps it, so the body's own parse cannot read a delimiter written below
        // its column back as an authored column-0 one. A delimiter already AT
        // column 0 keeps it (markup-carve/carve-js#1623).
        const flush = ln.replace(/^[ \t]+/, '')
        bodyLines.push(flush === ln ? ln : ' ' + flush)
        bodyLineNumbers.push(lexer.lineNumber(lexer.pos))
        bodySourceLines.push(ln)
        lexer.consume()
      } else if (
        pendingBlanks === 0 && indentColumns(ln, bodyColumn) < bodyColumn && ln !== ln.trimStart() &&
        (retainedBelowComment || lazyState.lazyFoldable) && lazyState.opaque === null &&
        matchedCommentFenceEnd(lexer) !== undefined
      ) {
        // A matched fence below the column retains the note as a `%%` line does.
        const end = matchedCommentFenceEnd(lexer)!
        while (lexer.pos < end) {
          const line = lexer.peek()!
          belowColumnCommentFence.add(bodyLines.length)
          bodyLines.push(line)
          bodyLineNumbers.push(lexer.lineNumber(lexer.pos))
          bodySourceLines.push(line)
          lexer.itemLazyLines.add(lexer.lineNumber(lexer.pos))
          lexer.consume()
        }
        retainedBelowComment = retainBelowColumnComment('%%', lazyState, false)
      } else if (
        pendingBlanks === 0 && !RE_FOOTNOTE_DEF.test(ln) &&
        !(retainedBelowComment && isColonFenceOpener(ln.trimStart())) &&
        (retainedBelowComment || ((lazyState.lazyFoldable || (nestedMarkerHasText && bodyLines.length > 1)) && isRetainableLineComment(lexer, ln))) &&
        (isRetainableLineComment(lexer, ln) ||
          !startsInterruptingBlock(lexer, ln, false, false, ln === ln.trimStart()))
      ) {
        const content = retainedBelowComment && !RE_COMMENT_LINE.test(ln.trimStart())
          ? ln.trimStart()
          : ln
        bodyLines.push(content)
        bodyLineNumbers.push(lexer.lineNumber(lexer.pos))
        bodySourceLines.push(ln)
        lexer.itemLazyLines.add(lexer.lineNumber(lexer.pos))
        trackItemLazyState(content, lazyState, (marker) => itemFenceHasCloser(lexer, marker, lexer.pos, markerColumn, new Map(), (line, blank) => blank && indentColumns(line, bodyColumn) < bodyColumn), false,
          (run) => commentBlockHasCloser(lexer, run))
        retainedBelowComment = retainBelowColumnComment(content, lazyState, false)
        lexer.consume()
      } else {
        break
      }
    }
    if (!lexer.footnoteDefs.has(label)) {
      // A recognized opener at or beyond the note's minimum column establishes
      // its authored column as a local base (carve#1729). The collector has
      // already removed the fixed two-column body margin.
      // A fence taken below the column keeps that column, as a `%%` line does.
      const rebaseEligible = belowColumnCommentFence.size === 0 ? undefined
        : new Set(bodyLines.map((_, k) => k).filter((k) => !belowColumnCommentFence.has(k)))
      if (bodyLines.length !== 1 || !/^[A-Za-z][A-Za-z0-9 .]*$/.test(bodyLines[0]!)) {
        rebaseOverindentedBlocks(
          bodyLines, rebaseEligible, -1, true, true, undefined, undefined, undefined, false,
          undefined, undefined, { markerBody: lexer.hostBody === 'list' && defLineIndex === 0 },
          undefined, undefined, false, false, true,
        )
        restoreVerbatimBlanks(bodyLines, bodySourceLines, bufferedBlanks, (index) =>
          index === 0 ? defContentColumn : indentColumns(bodySourceLines[index] ?? ''),
        )
      }
      const sub = nestedSubLexer(lexer, bodyLines, defLineIndex, bodyLineNumbers)
      sub.sublistsCarryAuthoredBase = true
      sub.inFootnoteBody = true
      sub.hostBody = 'footnote'
      sub.hostBodyRoot = 'footnote'
      lexer.footnoteDefs.set(label, bodyLines.length === 1 && trimEndSpaceTab(bodyLines[0] ?? '') === '{empty}' ? [] : this.parseBlocks(sub, 0))
      // The definition runs from its `[^label]:` marker to the last line it
      // consumed. The body blocks cannot supply that: the marker is not part of
      // any of them, so a span derived from the body would start inside the
      // definition (carve-js#480).
      //
      // Only when this lexer can express a document offset - inside an unmapped
      // container the numbers mean something else, and §4 forbids inventing one.
      if (lexer.hasDocumentOffsets) {
        let lastIndex = Math.max(defLineIndex, lexer.pos - 1)
        while (lastIndex > defLineIndex && isBlankLine(lexer.lineAt(lastIndex) ?? '')) lastIndex--
        const lastLine = lexer.lineAt(lastIndex) ?? ''
        // A span begins at the `[^label]:` marker, not at the line start. When
        // this definition is nested one column shy of its parent's body margin,
        // the sub-lexer strips a fixed margin and leaves a residual space ahead
        // of the marker; the start must skip it (PART 12 §4, carve#1963).
        const defLine = lexer.lineAt(defLineIndex) ?? ''
        const defLead = defLine.length - defLine.replace(/^[ \t]+/, '').length
        const pos: Position = {
          startLine: lexer.lineNumber(defLineIndex),
          endLine: lexer.lineNumber(lastIndex),
          startColumn: lexer.lineStartColumn(defLineIndex) + defLead,
          endColumn: lexer.lineStartColumn(lastIndex) + lastLine.length,
          startOffset: lexer.lineOffset(defLineIndex) + defLead,
          endOffset: lexer.lineOffset(lastIndex) + lastLine.length,
        }
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

  private parseAdmonition(lexer: Lexer): Admonition | Directive | FigureGroup {
    const openLineIndex = lexer.pos
    const open = lexer.consume()
    const m = RE_ADMONITION_OPEN.exec(open)!
    const fence = m[1]!.length
    const kind = m[2]!
    const invalidMetadata = RE_VALID_ADMONITION_OPEN.exec(open) === null
    if (invalidMetadata) {
      const recovered = unclosedContainerFromOpener(lexer, {
        kind: GENERATED_CONTENT_KINDS.has(kind) ? 'directive' : 'admonition',
        lineIndex: openLineIndex,
        fenceWidth: fence,
      })
      recovered.endOffset = recovered.startOffset + open.length
      lexer.reportInvalidContainerMetadata(recovered)
    }
    // PART 9 §4c: a BARE `::: figure` opener - kind only, no quoted title, no
    // `[label]` - is a composite figure group, not an admonition. An opener
    // carrying either piece of metadata does not match the figure production and
    // stays a generic container (the group node has no title/label fields by
    // design). A bare opener inside an OPEN group's body is demoted the same way:
    // groups do not nest, which is what `inFigureGroup` carries through the
    // recursion.
    const isFigureGroup = isFigureGroupOpener(open, lexer.inFigureGroup)
    // The opener carries an optional quoted title only (grammar
    // quoted_title; PART 9 §12). The quotes delimit the title and are
    // stripped (not part of the rendered text); an explicitly empty `""`
    // still counts as a supplied (empty) title. No inline attributes -- the
    // opener regex already rejected any trailing `{...}`.
    const titleText = m[3] !== undefined ? m[3]!.slice(1, -1) : undefined
    // Optional inert grouping `[label]` (PART 9 §12): a group extension (tabs)
    // uses it as the tab name; core does not render it.
    const label = m[4] !== undefined ? stripTrailingComment(m[4]!.slice(1, -1)) : undefined
    const inner = collectColonFenceBody(lexer, {
      // Which of the two named-container types this fence opens, so an unclosed
      // one is reported as the thing it was (CARVE-P12-057).
      kind: GENERATED_CONTENT_KINDS.has(kind) ? 'directive' : 'admonition',
      lineIndex: openLineIndex,
      fenceWidth: fence,
    })
    const subLexer = nestedColonLexer(lexer, inner, openLineIndex + 1)
    subLexer.consumesHostedLinkDefs =
      lexer.hostBody === 'description' || lexer.hostBody === 'footnote' ? 'all' : false
    if (isFigureGroup) subLexer.inFigureGroup = true
    const children = this.parseBlocks(subLexer, 0)
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
          this.recordAttachedCaption(lexer, lexer.pos + lookahead)
          for (let i = 0; i <= lookahead; i++) lexer.consume()
          group.caption = this.parseCaptionInline(lexer, cap[1]!)
        }
      }
      // A preceding block-attribute line is the only way to attribute the group
      // (same as the admonition below); parseBlocks applies it to the returned
      // node.
      return group
    }
    // CARVE-P12-057: a named container whose kind names GENERATED CONTENT is a
    // `directive`, not an `admonition`. The kind list is CLOSED - a seventh
    // generated-looking word (`endnotes`, `contents`) takes the admonition branch
    // below, because the clause rules that "every other named container is an
    // `admonition`".
    //
    // Keep the quoted opener title for either named container type. An explicit
    // empty title still occupies the title slot.
    let title: InlineNode[] | undefined
    if (titleText !== undefined) {
      const titleStart = open.indexOf(m[3]!) + 1
      title = this.parseInline(titleText, lexer.abbrDefs, lexer.linkDefs, {
        anchored: lexer.hasDocumentOffsets && titleStart > 0,
        baseOffset: lexer.lineOffset(openLineIndex) + titleStart,
        startLine: lexer.lineNumber(openLineIndex),
        startColumn: lexer.lineStartColumn(openLineIndex) + titleStart,
      })
    }
    if (GENERATED_CONTENT_KINDS.has(kind)) {
      const directive: Directive = { type: 'directive', kind, children }
      if (title !== undefined) directive.title = title
      if (label !== undefined) directive.label = label
      return directive
    }
    const node: Admonition = { type: 'admonition', kind, children }
    if (title !== undefined) node.title = title
    if (label !== undefined) {
      node.label = label
    }
    // No inline opener attributes (strict djot): a preceding block-attribute
    // line is the only way to attribute an admonition, and parseBlocks
    // applies it to the returned node.
    return node
  }

  private parseLineBlock(lexer: Lexer): LineBlock {
    const session = this
    const host = this.lineBlockHost ??= {
      get definitionRegionLines() { return session.definitionRegionLines },
      get inMatcherRequest() { return session.inMatcherRequest },
      get inLineBlock() { return session.inLineBlock },
      set inLineBlock(value) { session.inLineBlock = value },
      get activeMatchers() { return session.activeMatchers },
      get quoteGlyphHasNul() { return session.quoteGlyphHasNul },
      parseInline: this.parseInline.bind(this),
    }
    return parseLineBlockWithHelpers(host, lexer)
  }

  // `::: \` hard-break block. Unlike the line block, the body is parsed as
  // ordinary blocks (so nested admonitions / lists work); soft breaks are then
  // promoted to hard breaks ONLY in the div's DIRECT paragraph children, and
  // there is no leading-whitespace preservation. Emits `<div class="hardbreaks">`.
  private parseHardBreaksBlock(lexer: Lexer): Div {
    const openLineIndex = lexer.pos
    const m = RE_HARDBREAKS_OPEN.exec(lexer.consume())!
    const fence = m[1]!.length
    const inner = collectColonFenceBody(lexer, {
      kind: 'hard-break block',
      lineIndex: openLineIndex,
      fenceWidth: fence,
    })
    const subLexer = nestedColonLexer(lexer, inner, openLineIndex + 1)
    const children = this.parseBlocks(subLexer, 0)
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
  private parseQuoteBlock(lexer: Lexer): BlockQuote | Figure {
    const openLineIndex = lexer.pos
    const m = RE_QUOTE_BLOCK_OPEN.exec(lexer.consume())!
    const fence = m[1]!.length
    const inner = collectColonFenceBody(lexer, {
      kind: 'block quote',
      lineIndex: openLineIndex,
      fenceWidth: fence,
    })
    const subLexer = nestedColonLexer(lexer, inner, openLineIndex + 1)
    const bq: BlockQuote = { type: 'block_quote', fenced: true, children: this.parseBlocks(subLexer, 0) }
    const quoteEndIndex = lexer.pos
    // The collector excludes its own closer from `inner`. At EOF without a
    // closer, the last consumed line is still part of the body.
    if (Array.isArray(inner) ? (inner.at(-1)?.lineIndex ?? openLineIndex) < quoteEndIndex - 1 : inner.closed) {
      explicitlyClosedQuotes.add(bq)
    }
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
        this.recordAttachedCaption(lexer, lexer.pos + lookahead)
        for (let i = 0; i <= lookahead; i++) lexer.consume()
        // The TARGET keeps its own span, as every other caption host's does.
        // Wrapping without this left a captioned fenced quote as the one block
        // quote in the vocabulary with no `pos`, which the position rules would
        // report the moment a corpus document reached the shape.
        attachBlockPos(lexer, bq, openLineIndex, quoteEndIndex)
        return { type: 'figure', target: bq, caption: this.parseCaptionInline(lexer, cap[1]!) } as Figure
      }
    }
    return bq
  }

  private parseDiv(lexer: Lexer): Div {
    const openLineIndex = lexer.pos
    const m = RE_DIV_OPEN.exec(lexer.consume())!
    const fence = m[1]!.length
    // Optional inert grouping `[label]` on a typeless div (`::: [First]`).
    const label = m[2] !== undefined ? stripTrailingComment(m[2]!.slice(1, -1)) : undefined
    const inner = collectColonFenceBody(lexer, {
      kind: 'div',
      lineIndex: openLineIndex,
      fenceWidth: fence,
    })
    const subLexer = nestedColonLexer(lexer, inner, openLineIndex + 1)
    // No inline opener attributes (strict djot): a bare `:::` carries none;
    // a preceding block-attribute line attaches them in parseBlocks.
    const node: Div = { type: 'div', children: this.parseBlocks(subLexer, 0) }
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
  private parseDefinitionList(lexer: Lexer): DefinitionList {
    return parseDefinitionListWithHelpers({
      collectAttachedBlock: this.collectAttachedBlock.bind(this),
      markerPrefixMemo: this.markerPrefixMemo.bind(this),
      parseBlocks: this.parseBlocks.bind(this),
      parseInline: this.parseInline.bind(this),
    }, lexer)
  }

  private parseBlockQuote(lexer: Lexer): BlockQuote | Figure {
    const firstLineIndex = lexer.pos
    const inner: string[] = []
    const origins = new Map<number, StrippedLineOrigin>()
    const innerLineNumbers: number[] = []
    const state: BlockQuoteLazyState = {
      mode: { kind: 'closed' },
      inTable: false,
      colonWidths: [],
      attrRun: null,
    }
    let fenceCloserMemo: QuotedFenceCloserMemo | undefined
    // Quoted lines not yet fed to the tracker. `state` is read only when an
    // unmarked line asks whether the paragraph is still open (or a `+` closes
    // it), so tracking waits until then. The tracker descends every nested
    // quote on the line, and a quote that ends at EOF or a blank line would
    // otherwise pay that at every level - quadratic in the nesting depth.
    const untracked: Array<[content: string, lineIndex: number]> = []
    const given = firstLineIndex === 0 ? lexer.quoteLazyHint : null
    lexer.quoteLazyHint = null
    const descent: QuoteDescent = { levels: 0, askedBelowTop: false }
    // The state this quote hands its own nested quote; see `QuoteLazyHint`.
    let handDown = null as QuoteLazyHint | null
    let trackedBefore = false
    let paragraphOpen: boolean | undefined
    const trackLine = (content: string, lineIndex: number): void => {
      paragraphOpen = undefined
      trackBlockQuoteLazyState(
        content,
        state,
        (fence) => quotedCommentHasCloser(lexer, fence, lineIndex),
        (marker, depth, column) =>
          !lexer.quoteLazyLines.has(lexer.lineNumber(lineIndex)) &&
          quotedFenceHasCloser(lexer, marker, lineIndex, fenceCloserMemo ??= new Map(), depth, column),
        descent,
        this.markerPrefixMemo(lexer, lineIndex),
        !lexer.quoteLazyLines.has(lexer.lineNumber(lineIndex)),
        (fence, depth, floor) => literalCommentHasCloser(lexer, fence, lineIndex, depth, floor),
      )
      // Reuse the handed-down state only while lazy text leaves it unchanged.
      if (!descent.preserved && handDown && state.mode.kind === 'quote' && state.mode.inner === handDown.state) handDown = null
    }
    const trackUntracked = (): void => {
      if (trackedBefore) {
        for (const [content, lineIndex] of untracked) trackLine(content, lineIndex)
        untracked.length = 0
        return
      }
      trackedBefore = true
      const prefix = untracked.length
      let depth: number
      if (given !== null && given.lines === prefix) {
        Object.assign(state, given.state)
        paragraphOpen = given.paragraphOpen
        depth = given.depth - 1
      } else {
        // Each line continues the inner quotes the line before it opened, so
        // the chain is one set of states down to the shallowest line's depth.
        depth = Infinity
        for (const [content, lineIndex] of untracked) {
          trackLine(content, lineIndex)
          depth = Math.min(depth, descent.levels)
        }
        if (descent.askedBelowTop) depth = 0
      }
      untracked.length = 0
      if (depth >= 1 && state.mode.kind === 'quote') {
        handDown = { state: state.mode.inner, lines: prefix, depth }
      }
    }
    const quoteTermLead = /^\s*>[ \t]+::[ \t]+/.test(lexer.lineAt(firstLineIndex) ?? '')
    let quoteTermContinuation = quoteTermLead
    const quoteRootLine = lexer.rootLines?.[lexer.lineNumber(firstLineIndex) - 1] ?? ''
    const quoteMarkerOffset = quoteRootLine.indexOf('>')
    // A quote opened on a footnote's marker line is reached at the note's body
    // column, two past the marker, not at its own `>` (CARVE-P0-010).
    const noteLead = /^(.*?)\[\^[^\]]+\]:[ \t]+>/.exec(quoteRootLine)
    const quoteMarkerColumn = lexer.hostBodyRoot === 'footnote' && noteLead !== null &&
      noteLead[0].length - 1 === quoteMarkerOffset
      ? noteLead[1]!.length + FOOTNOTE_BODY_COLUMN
      : Math.max(0, quoteMarkerOffset)
    const localQuoteDepth = quotePrefixDepth(lexer.lineAt(firstLineIndex) ?? '')
    const localQuoteOffset = lexer.hasDocumentOffsets ? lexer.lineStartColumn(firstLineIndex) - 1 : -1
    const physicalQuoteColumn = localQuoteOffset >= 0
      ? sourceColumnAt(quoteRootLine, localQuoteOffset)
      : Math.max(quoteMarkerColumn,
        sourceColumn(quoteRootLine, Math.max(0, quotePrefixDepth(quoteRootLine) - localQuoteDepth)))
    let emptyFirstBlockMarker = false
    while (!lexer.eof()) {
      const ln = lexer.peek()!
      const quoted = quotedLineText(ln, lexer.lineTerminatorFree(lexer.pos))
      if (quoted !== null) {
        const lineIndex = lexer.pos
        lexer.consume()
        const content = quoted
        if (isBlankLine(content)) quoteTermContinuation = false
        const markerSourceLine = (lexer.rootLines ?? lexer.lines)[lexer.lineNumber(lineIndex) - 1]
        const precedingSourceLine = (lexer.rootLines ?? lexer.lines)[lexer.lineNumber(lineIndex) - 2]
        const quoteMarkerIsWrongColumn = isContinuationMarker(content.trimStart()) &&
          markerSourceLine !== undefined && precedingSourceLine !== undefined &&
          quotePrefixDepth(precedingSourceLine) >= quotePrefixDepth(markerSourceLine) &&
          markerDecision(lexer, lineIndex).reason === 'wrong-column'
        // First-block form (`> +`, as `- +` and `:  +`): a lone `+` as the whole
        // first line of a quote, at any depth, is a marker when a flush-left line
        // outside the quote follows, and that line's block is the innermost
        // quote's body. Before a blank, a quoted line or the end it stays text.
        if (endsInPlus(content) && !quoteMarkerIsWrongColumn &&
            (isPhysicalContinuationMarker(lexer.rootLines?.[lexer.lineNumber(lineIndex) - 1] ?? ln) ||
              lineIndex === firstLineIndex) &&
            this.opensFirstBlockQuote(lexer, lineIndex, content, lineIndex === firstLineIndex ? 0 : -1, () => {
          trackUntracked()
          return openQuoteDepth(state)
        })) {
          const stackedSource = (lexer.rootLines ?? lexer.lines)[lexer.lineNumber(lineIndex) - 1] ?? ln
          const stackedDepth = quotePrefixDepth(stackedSource)
          const followerSource = (lexer.rootLines ?? lexer.lines)[lexer.lineNumber(lexer.pos) - 1] ?? ''
          const followerColumn = sourceColumn(followerSource, stackedDepth)
          const { lines: attached, lineNumbers: attachedLineNumbers } = this.collectAttachedBlock(
            lexer,
            (next) => isBlankLine(next) || /^\+[ \t]*$/.test(next),
            0,
            true,
            isStackedFirstBlockQuoteMarker(stackedSource) ? (followerColumn === Infinity ? 0 : followerColumn) : physicalQuoteColumn,
            isStackedFirstBlockQuoteMarker(stackedSource) ? stackedDepth : 0,
            true,
          )
          if (/^\+[ \t]*$/.test(content)) {
            if (attached.length > 0) lexer.attachmentBoundaries.add(attachedLineNumbers[0]!)
            if (attached.length > 0 && inner.length > 0 && !isBlankLine(inner.at(-1)!)) {
              inner.push('')
              innerLineNumbers.push(attachedLineNumbers[0]!)
            }
          } else {
            // A nested quote keeps its `+` line and receives the block raw behind
            // it, so its own parse takes this same branch one level down.
            if (lexer.lineTerminatorFree(lineIndex)) origins.set(inner.length, { text: content, parentIndex: lineIndex, prefix: ln.length - content.length })
            inner.push(content)
            innerLineNumbers.push(lexer.lineNumber(lineIndex))
          }
          for (const attachedLine of attached) inner.push(attachedLine)
          innerLineNumbers.push(...attachedLineNumbers)
          if (attached.length > 0) {
            inner.push('')
            innerLineNumbers.push(attachedLineNumbers[attachedLineNumbers.length - 1]!)
          }
          trackUntracked()
          closeBlockQuoteParagraph(state)
          handDown = null
          continue
        }
        if (lineIndex === firstLineIndex && endsInPlus(content) &&
            isStackedFirstBlockQuoteMarker(markerSourceLine ?? ln) &&
            lexer.peek() !== undefined && !isListMarkerLine(lexer.peek()!.trimStart()) &&
            quotedLineText(lexer.peek()!, lexer.lineTerminatorFree(lexer.pos)) === null) emptyFirstBlockMarker = true
        if (lineIndex !== firstLineIndex && markerSourceLine !== undefined &&
            isPhysicalContinuationMarker(markerSourceLine) &&
            quotePrefixDepth(markerSourceLine) > 0) {
          const follower = (lexer.rootLines ?? lexer.lines)[lexer.lineNumber(lineIndex)]
          const depth = quotePrefixDepth(markerSourceLine)
          if (follower !== undefined && quotePrefixDepth(follower) === depth &&
              sourceColumn(follower, depth) === sourceColumn(markerSourceLine, depth) &&
              isListMarkerLine(sourceQuoteBody(follower))) {
            lexer.reportRefusedContinuationMarker(lineIndex,
              sourceColumnAt(markerSourceLine, markerSourceLine.lastIndexOf('+')) + 1,
              'block quote', 'sibling')
          }
        }
        if (lineIndex !== firstLineIndex && markerSourceLine !== undefined &&
            precedingSourceLine !== undefined && isPhysicalContinuationMarker(markerSourceLine) &&
            quotePrefixDepth(precedingSourceLine) > quotePrefixDepth(markerSourceLine)) {
          // A marker at a surviving outer quote level is still a marker when
          // it cannot take a block. The inner quote may retain it as text.
          const follower = (lexer.rootLines ?? lexer.lines)[lexer.lineNumber(lineIndex)]
          const markerDepth = quotePrefixDepth(markerSourceLine)
          if (follower === undefined || isBlankLine(follower) ||
              quotePrefixDepth(follower) !== markerDepth || sourceQuoteLocalColumn(follower, markerDepth) !== 0) {
            lexer.reportRefusedContinuationMarker(lineIndex,
              sourceColumnAt(markerSourceLine, markerSourceLine.lastIndexOf('+')) + 1, 'block quote',
              follower === undefined ? 'document' : isBlankLine(follower) ? 'blank' : 'right')
          }
        }
        if (lexer.lineTerminatorFree(lineIndex)) origins.set(inner.length, { text: content, parentIndex: lineIndex, prefix: ln.length - content.length })
        inner.push(content)
        untracked.push([content, lineIndex])
        innerLineNumbers.push(lexer.lineNumber(lineIndex))
        continue
      }
      // Continuation marker (Carve, PART 9 §17): a lone `+` at column 0 after a
      // quoted line attaches the FOLLOWING flush-left block to the quote -- the
      // un-prefixed analogue of the list-item form, so a real block (list, fenced
      // code, table, ...) can join the quote without repeating `>`. Collect the
      // block's lines (up to a blank line or a further `+`) and
      // splice them into the quote body behind a blank-line separator, so they
      // parse as their own block instead of folding into the quoted paragraph.
      const physicalPlus = (lexer.rootLines ?? lexer.lines)[lexer.lineNumber(lexer.pos) - 1] ?? ln
      const quoteMarkerLine = isContinuationMarker(ln.slice(leadingWhitespace(ln)))
      const quotePlusDecision = quoteMarkerLine ? markerDecision(lexer, lexer.pos) : undefined
      const quotePlusDepth = quotePrefixDepth(physicalPlus)
      const quotePlusColumn = sourceColumn(physicalPlus)
      const quoteFollower = (lexer.rootLines ?? lexer.lines)[lexer.lineNumber(lexer.pos)]
      let quotePlusBody = physicalPlus
      let quoteFollowerBody = quoteFollower ?? ''
      for (let depth = 0; depth < quotePlusDepth; depth++) {
        quotePlusBody = quotedLineText(quotePlusBody, false) ?? ''
        quoteFollowerBody = quotedLineText(quoteFollowerBody, false) ?? quoteFollowerBody
      }
      if (quoteMarkerLine &&
          quotePlusDecision?.reason !== 'sibling' &&
          !(quotePlusDepth === 0 && quotePrefixDepth(quoteRootLine) > 1 &&
            quotePlusColumn > quoteMarkerColumn) &&
          !(quotePlusColumn > 0 && quotePlusDecision?.reason === 'wrong-column' &&
            isListMarkerLine((quoteFollower ?? '').trimStart())) &&
          !(quotePlusDepth > 0 && quotePlusDepth < quotePrefixDepth(quoteRootLine) &&
            quotePlusDecision?.reason === 'wrong-column' && quotePlusDecision.blockedByInnerList) &&
          isContinuationMarker(quotePlusBody.trimStart()) &&
          (quotePlusColumn === physicalQuoteColumn || quotePlusDecision?.owner?.kind === 'list' &&
            quotePlusDecision.owner.column === quotePlusColumn && quotePlusDecision.reason === undefined) &&
          quoteFollower !== undefined &&
          !isBlankLine(quoteFollowerBody) &&
          (quotePlusDepth === 0 || quotePrefixDepth(quoteFollower) === quotePlusDepth ||
            quotePlusColumn > quoteBodyColumn(physicalPlus, quotePlusDepth)) &&
          sourceColumn(quoteFollower, quotePlusDepth) === quotePlusColumn) {
        lexer.consume()
        const { lines: attached, lineNumbers: attachedLineNumbers } = this.collectAttachedBlock(
          lexer,
          (next) => isBlankLine(next) || /^\+[ \t]*$/.test(next),
          0,
          true,
          quotePlusColumn,
          quotePlusDepth,
        )
        if (attached.length > 0) {
          lexer.attachmentBoundaries.add(attachedLineNumbers[0]!)
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
          trackUntracked()
          closeBlockQuoteParagraph(state)
        }
        continue
      }
      const lazyFootnote = RE_FOOTNOTE_DEF.test(stripLazyFrame(ln).trimStart()) &&
        indentColumns(lexer.rootLines?.[lexer.lineNumber(lexer.pos) - 1] ?? ln) < quoteMarkerColumn
      if (
        isBlankLine(ln) ||
        (lexer.hostBody === 'list' && !lazyFootnote && leadingWhitespace(ln) >= FOOTNOTE_BODY_COLUMN && RE_FOOTNOTE_DEF.test(ln.trimStart())) ||
        (RE_CAPTION.test(ln) && !lexer.itemLazyLines.has(lexer.lineNumber(lexer.pos))) ||
        colonFenceShapeEndsLazyContinuation(ln) ||
        (quoteTermContinuation && RE_HEADING.test(ln)) ||
        (quoteTermContinuation && (
          RE_HR.test(ln) || isTableRow(ln) ||
          (leadingWhitespace(ln) === 0 && (RE_FOOTNOTE_DEF.test(ln) || isLinkDefLine(ln) || isBlockAttributeLine(ln))) ||
          RE_COMMENT_LINE.test(ln)
        )) ||
        (lexer.hostBody !== null && RE_FOOTNOTE_DEF.test(ln.trimStart()) &&
          !lexer.quoteLazyLines.has(lexer.lineNumber(lexer.pos)) &&
          indentColumns(lexer.rootLines?.[lexer.lineNumber(lexer.pos) - 1] ?? ln) >= quoteMarkerColumn) ||
        (!quoteTermContinuation && !lazyFootnote && startsInterruptingBlock(lexer, undefined, false))
      ) {
        break
      }
      // A non-`>` line inside an open fence/comment, or after a block that left no
      // open paragraph (heading/table/fence/thematic/div), terminates the quote
      // instead of being swallowed. This is also what ends the quote on a lazy
      // list marker when no open paragraph precedes it.
      trackUntracked()
      paragraphOpen ??= blockQuoteParagraphClaimOpen(state)
      if (handDown && handDown.paragraphOpen === undefined) handDown.paragraphOpen = paragraphOpen
      if (!paragraphOpen && !lazyFootnote) break
      if (leadingWhitespace(ln) === 0 && (deflistMarkerLine(ln) || isListMarkerLine(ln)) &&
          !lexer.quoteLazyLines.has(lexer.lineNumber(lexer.pos))) {
        let leaf = state
        while (leaf.mode.kind === 'quote') leaf = leaf.mode.inner
        // A marker at the surviving document column ends the open term.
        if (leaf.mode.kind === 'paragraph' && (leaf.mode.term || leaf.hosts?.terms.at(-1))) break
      }
      const lineIndex = lexer.pos
      lexer.consume()
      const lazyLinkDef = this.isLinkDefLine(ln)
      if (lazyLinkDef && lexer.declinedLinkDefLines.has(lexer.lineNumber(lineIndex))) {
        lexer.literalLazyLinkDefLines.add(lexer.lineNumber(lineIndex))
      }
      // THE LINE IS THE QUOTE'S LAZY TEXT, AND A MARKER DOES NOT SURVIVE THE
      // HAND-OVER (PART 0 lazy continuation, markup-carve/carve#1904). Below it
      // parses as the quote's body, where the marker read as an opener again and
      // put an item INSIDE the quote for a line carrying no `>`.
      //
      // AT EVERY COLUMN, including one an enclosing item hands out (ruled on
      // markup-carve/carve#1905, ported at carve-js#1615). A QUOTE IS REACHED BY
      // ITS MARKER, AND A COLUMN NEVER REACHES INTO ONE - so a line writing no
      // `>` is in no quote wherever it lands, and §24 C3 never governs it. The
      // hold-back this used to carry made the marker twin differ from the
      // paragraph twin, which folds there in every reader.
      if (isListMarkerLine(ln)) {
        lexer.quoteLazyMarkerLines.add(lexer.lineNumber(lineIndex))
      }
      // The shape-blind half of the same fact, for the consumers the two sets
      // above do not serve.
      lexer.quoteLazyLines.add(lexer.lineNumber(lineIndex))
      const lazyDefinition = RE_FOOTNOTE_DEF.test(stripLazyFrame(ln).trimStart()) ||
        (isLinkDefLine(stripLazyFrame(ln).trimStart()) &&
          indentColumns(lexer.rootLines?.[lexer.lineNumber(lineIndex) - 1] ?? ln) < quoteMarkerColumn)
      if (lazyDefinition) lexer.literalLazyLinkDefLines.add(lexer.lineNumber(lineIndex))
      inner.push(ln.startsWith(LAZY_FRAME) ? ln : isListMarkerLine(ln) || lazyDefinition || quoteTermContinuation
        ? LAZY_FRAME + ln.replace(/^[ \t]+/, '') : ln)
      innerLineNumbers.push(lexer.lineNumber(lineIndex))
      if (!lazyLinkDef) trackLine(ln, lineIndex)
    }
    const subLexer = nestedSubLexer(lexer, inner, firstLineIndex, innerLineNumbers, origins)
    subLexer.quoteLazyHint = handDown
    // A QUOTE'S CONTENT COLUMN COMES FROM ITS MARKER, so the note body's leniency
    // stops here. A footnote body absorbs residual indentation because its blocks
    // are REBASED to an authored base; a quote is not rebased, and an indented
    // definition after `>` is literal text there exactly as at top level
    // (markup-carve/carve-js#1628).
    subLexer.inFootnoteBody = false
    subLexer.consumesHostedLinkDefs = lexer.hostBody === null ? false : 'lazy'
    const children = this.parseBlocks(subLexer, 0)
    if (emptyFirstBlockMarker && children[0]?.type === 'paragraph') {
      const parts = children[0].children
      if (parts[0]?.type === 'text' && /^\+[ \t]*$/.test(parts[0].value)) {
        parts.splice(0, parts[1]?.type === 'soft_break' ? 2 : 1)
        if (parts.length === 0) children.shift()
      }
    }
    const bq: BlockQuote = { type: 'block_quote', children }
    const quoteEndIndex = lexer.pos
    // §4d: a quote built out of nothing but structural-only `>` lines is not a
    // captionable host. It holds nothing the caption could be about, and taking
    // one binds the caption across the container change that opened the quote -
    // which is how `| a |` / blank / `>` / blank / `^ cap` captioned an empty
    // quote nobody wrote the caption under (markup-carve/carve#2892).
    if (children.length === 0) return bq
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
        this.recordAttachedCaption(lexer, lexer.pos + lookahead)
        for (let i = 0; i <= lookahead; i++) lexer.consume()
        attachBlockPos(lexer, bq, firstLineIndex, quoteEndIndex)
        return {
          type: 'figure',
          target: bq,
          caption: this.parseCaptionInline(lexer, cap[1]!),
        } as Figure
      }
    }
    return bq
  }

  private parseBlockImage(lexer: Lexer): Image | Figure {
    const imageLineIndex = lexer.pos
    const line = lexer.consume()
    const m = RE_BARE_IMAGE.exec(line)!
    // `isBlockImageLine` has already read the run as a destination, so the
    // escapes are resolved here as they are on the inline tail.
    const img: Image = { type: 'image', src: m[2] === '' ? '' : linkDestinationValue(m[2]!)!, alt: unescapeAttrValue(m[1]!) }
    const title = m[3] ?? m[4]
    if (title !== undefined) img.title = unescapeAttrValue(title)
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
        this.recordAttachedCaption(lexer, lexer.pos + lookahead)
        for (let i = 0; i <= lookahead; i++) lexer.consume()
        // The block loop attaches a span to whatever this returns, so a figure
        // gets one and its TARGET would be left without - PART 12 section 4 wants
        // one on every node but the root. The image occupies exactly its own line;
        // the figure spans that plus the caption.
        attachBlockPos(lexer, img, imageLineIndex, imageLineIndex + 1)
        return {
          type: 'figure',
          target: img,
          caption: this.parseCaptionInline(lexer, cap[1]!),
        } as Figure
      }
    }
    return img
  }

  private foldedAttachedDefinitionEnd(lines: readonly string[], end: number, probe: Lexer): number {
    // The verse ownership probe omits registration, so its empty table cannot establish a boundary.
    if (this.definitionRegionLines || !lines.slice(0, end).some(line => /^[ \t]+\[/.test(line))) return end
    const ownership = subLexer(lines.slice(0, end), probe.parseOptions, 0)
    ownership.nested = true
    ownership.suppressPositions = true
    ownership.depth = probe.depth
    this.collectLinkDefs(ownership)
    const notes = new Set([...probe.footnoteDefs.keys()].map(normalizeRefLabel))
    const claimed = new Set<string>()
    const commentClose = commentCloserLookup(lines)
    let opaque: OpaqueGroup | null = null
    let termColumn: number | null = null
    for (let index = 0; index < end; index++) {
      const line = lines[index]!
      if (isBlankLine(line)) {
        if (opaque === null) termColumn = null
        continue
      }
      const column = indentColumns(line)
      const text = sliceColumns(line, column, true)
      if (opaque !== null) {
        if (opaque.closes(text)) opaque = null
        continue
      }
      if (termColumn !== null) {
        if (column > termColumn && markerContentColumn(text) < 0) {
          const folded = opaqueGroupCloser(text)
          if (folded?.char === '%' && commentClose(folded.run, index) !== -1) opaque = folded
          continue
        }
        if (
          RE_HEADING.test(text) || RE_HR.test(text) || RE_BLOCKQUOTE.test(text) ||
          this.isLinkDefLine(text) || RE_FOOTNOTE_DEF.test(text) || markerContentColumn(text) >= 0 ||
          RE_FENCE.test(text) || RE_RAW_FENCE.test(text) || RE_CAPTION.test(text) ||
          RE_COMMENT_LINE.test(text) || /^::? /.test(text)
        ) {
          termColumn = null
        }
      }
      if (RE_DEFLIST_TERM.test(text)) termColumn = column
      const group = opaqueGroupCloser(text)
      if (group !== null && (group.char !== '%' || commentClose(group.run, index) !== -1)) {
        opaque = group
        continue
      }
      const footnote = RE_FOOTNOTE_DEF.exec(text)
      const link = this.matchLinkDef(text)
      if (footnote === null && link === null) continue
      const key = normalizeRefLabel(footnote?.[1] ?? link!.label)
      const kind = footnote !== null ? 'f' : 'l'
      const registered = footnote !== null ? notes.has(key) : ownership.linkDefs.has(key)
      if (column > 0 && (claimed.has(kind + key) || !registered)) return index
      claimed.add(kind + key)
    }
    return end
  }

  /**
   * Collect the ONE flush-left block a `+` continuation marker attaches
   * (PART 9 §17 L3/L4).
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
  attachedBlockExtent(
    lexer: Lexer,
    limit: number,
    transform?: (line: string) => string,
    endAtFoldedDefinition = true,
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
    const matchers = this.activeMatchers
    const wasMeasuring = this.measuringAttachedBlock
    this.activeMatchers = []
    this.measuringAttachedBlock = true
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
        const node = this.parseBlock(probe)
        const invisible =
          node === null || node.type === 'abbreviation_def' || node.type === 'comment'
        if (!invisible || probe.eof()) break
      }
      const end = Math.min(Math.max(probe.pos, 1), limit)
      return endAtFoldedDefinition ? Math.max(1, this.foldedAttachedDefinitionEnd(lines, end, probe)) : end
    } finally {
      this.activeMatchers = matchers
      this.measuringAttachedBlock = wasMeasuring
    }
  }

  /**
   * Whether the quote line at `lineIndex` (already consumed, quoted text
   * `content`) is the first-block form: its quote chain ends in a lone `+`, the
   * innermost quote opens on this line, and the next line is a non-blank,
   * unquoted line at document column 0. `openDepth` is how many quotes below
   * this one are already open (0 on the quote's first line), or -1 to ask
   * `readOpenDepth` lazily.
   */
  private opensFirstBlockQuote(
    lexer: Lexer,
    lineIndex: number,
    content: string,
    openDepth: number,
    readOpenDepth: () => number,
  ): boolean {
    const next = lexer.peek()
    const sourceLine = (lexer.rootLines ?? lexer.lines)[lexer.lineNumber(lineIndex) - 1] ?? ''
    const nextQuoted = next === undefined ? null : quotedLineText(next, lexer.lineTerminatorFree(lexer.pos))
    if (next === undefined || isBlankLine(next) || isListMarkerLine(next.trimStart()) ||
        nextQuoted !== null && isBlankLine(nextQuoted) ||
        nextQuoted !== null &&
        !isStackedFirstBlockQuoteMarker(sourceLine)) return false
    const lineNumber = lexer.lineNumber(lineIndex)
    let chain = lexer.quoteChainEndsInPlus.get(lineNumber)
    if (chain !== undefined && chain.size === 0 && endsInPlus(content)) chain = undefined
    // A probe that parsed a nested quote first measured a shorter chain.
    if (chain !== undefined && chain.size > 0 && !chain.has(content.length) && content.length > Math.max(...chain.keys())) chain = undefined
    if (chain === undefined) {
      // Asked once per source line: every nested quote's text is a suffix of
      // this one, so its levels are looked up by length instead of rescanned.
      const suffixes = [content]
      for (let deeper = quotedLineText(content, false); deeper !== null; deeper = quotedLineText(deeper, false)) suffixes.push(deeper)
      chain = new Map()
      if (/^\+[ \t]*$/.test(suffixes[suffixes.length - 1]!)) {
        for (let k = 0; k < suffixes.length; k++) chain.set(suffixes[k]!.length, suffixes.length - 1 - k)
      }
      lexer.quoteChainEndsInPlus.set(lineNumber, chain)
    }
    const levels = chain.get(content.length)
    if (levels === undefined) return false
    if (levels === 0 ? openDepth !== 0 : (openDepth < 0 ? readOpenDepth() : openDepth) >= levels) return false
    return attachesAtDocumentColumnZero(lexer,
      isStackedFirstBlockQuoteMarker(sourceLine) ? sourceColumn(sourceLine) : sourceColumn(sourceLine, 0),
      isStackedFirstBlockQuoteMarker(sourceLine) ? quotePrefixDepth(sourceLine) : 0, true)
  }

  private collectAttachedBlock(
    lexer: Lexer,
    isBoundary: (line: string) => boolean,
    contentColumn = 0,
    endAtFoldedDefinition = true,
    markerColumn = 0,
    quoteLevels = Infinity,
    acceptFirstNonList = false,
  ): { lines: string[]; lineNumbers: number[]; startLineIndex: number } {
    const transform = contentColumn === 0 ? undefined : (line: string) => sliceColumns(line, contentColumn)
    // AND FLUSH-LEFT MEANS COLUMN 0 IS ASKED HERE, ONCE, FOR EVERY CONTAINER
    // (§17 L3, markup-carve/carve#1814). The predicate existed but only the list
    // item's three attach paths called it, so the footnote body, the definition
    // description and the block quote each reached out for a line the clause
    // leaves where the author wrote it: a `<dd>` whose content column is 3 pulled
    // in a column-1 or column-2 line, a note pulled in a column-1 line, and a
    // quote took a column-2 line that A QUOTE IS REACHED BY ITS MARKER (§10 I5,
    // markup-carve/carve#1384) puts in no quote at all. Every caller already
    // treats an EMPTY result as "the marker attached nothing" and lets its own
    // ordinary rules have the line, which is exactly what the clause's comment
    // spelling does.
    if (!attachesAtDocumentColumnZero(lexer, markerColumn, quoteLevels, acceptFirstNonList)) {
      return { lines: [], lineNumbers: [], startLineIndex: lexer.pos }
    }
    const scans = lexer.attachmentScans ??= new Map()
    let cache = scans.get(contentColumn)
    if (cache === undefined) {
      cache = {}
      scans.set(contentColumn, cache)
    }
    const origin = lexer.contiguousOrigin?.lexer ?? lexer
    const indexBase = lexer.contiguousOrigin?.start ?? 0
    const fenced = fencedBlockEnd({
      at: (offset) => {
        const line = lexer.peek(offset)
        return line === undefined ? undefined : transform ? transform(line) : line
      },
      index: closerIndex(lexer),
      cache,
      preciseClosers: () => {
        if (origin.attachmentFenceClosers === undefined) {
          if (layoutWork.on) layoutWork.fenceCandidateLines += origin.lineCount
          origin.attachmentFenceClosers = new AttachmentFenceClosers({
            length: origin.lineCount,
            lineAt: (index) => origin.lineAt(index)!,
          }, RE_ANY_FENCE_CLOSER, RE_COMMENT_BLOCK_ANY, RE_ANY_COLON_CLOSER,
          line => RE_FENCE.exec(line) !== null || RE_RAW_FENCE.exec(line) !== null || colonBlockOpenerRun(line) !== null)
        }
        return origin.attachmentFenceClosers
      },
      end: lexer.lineCount,
      contentColumn,
      indexBase,
      base: lexer.pos,
    })
    let take = 0
    if (fenced !== -1) {
      take = fenced + 1
    } else {
      while (lexer.peek(take) !== undefined) {
        const candidate = lexer.peek(take)!
        // A first-block marker can attach a flush-left block even when its
        // list marker is indented. Dedent ends the block only after it starts.
        const firstFlushLeft = take === 0 && contentColumn > 0 &&
          indentColumns(candidate) === 0 && !isBlankLine(candidate) && !isContinuationMarker(candidate) &&
          !lineOpensBlock(candidate)
        const firstNonList = acceptFirstNonList && take === 0 && !isBlankLine(candidate) &&
          !isContinuationMarker(candidate) && !isListMarkerLine(candidate)
        if (isBoundary(candidate) && !firstFlushLeft && !firstNonList) break
        take++
      }
      const measured = this.attachedBlockExtent(lexer, take, transform, endAtFoldedDefinition)
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

  collectAttachedListBlock(
    lexer: Lexer,
    isBoundary: (line: string) => boolean,
    baseIndent: number,
    endAtFoldedDefinition = true,
    markerColumn = 0,
    quoteLevels = Infinity,
  ): { lines: string[]; lineNumbers: number[]; startLineIndex: number } {
    const attached = this.collectAttachedBlock(lexer, isBoundary, baseIndent, endAtFoldedDefinition, markerColumn, quoteLevels, true)
    const first = attached.lines[0]
    const last = attached.lines.at(-1)
    const code = first === undefined ? null : RE_FENCE.exec(first) ?? RE_RAW_FENCE.exec(first)
    const codeMarker = code === null ? null : RE_FENCE.test(first!) ? code[2]! : code[1]!
    const closedCode = codeMarker !== null && last !== undefined && fenceCloseRe(codeMarker).test(last)
    const colon = first === undefined ? null : colonBlockOpenerRun(first)
    const closedColon = colon !== null && isFigureGroupOpener(first!, lexer.inFigureGroup) &&
      last !== undefined && RE_ADMONITION_CLOSE.exec(last)?.[1]?.length === colon
    if (codeMarker !== null && !closedCode) {
      while (!lexer.eof() && !isBlankLine(lexer.peek()!)) {
        attached.lines.push(lexer.peek()!)
        attached.lineNumbers.push(lexer.lineNumber(lexer.pos))
        lexer.consume()
      }
    }
    if ((closedCode || closedColon) && lexer.peek() !== undefined && RE_CAPTION.test(lexer.peek()!)) {
      attached.lines.push(lexer.peek()!)
      attached.lineNumbers.push(lexer.lineNumber(lexer.pos))
      lexer.consume()
    }
    return attached
  }

  private parseList(lexer: Lexer): List {
    return parseListWithHelpers(lexer, this)
  }

  private parseTable(lexer: Lexer): Table | Figure {
    const host = this.tableBlockHost ??= {
      parseInline: this.parseInline.bind(this),
      recordAttachedCaption: this.recordAttachedCaption.bind(this),
      parseCaptionInline: this.parseCaptionInline.bind(this),
    }
    return parseTableBlock(host, lexer)
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
  private parseCaptionInline(lexer: Lexer, firstLine: string): InlineNode[] {
    const capIndex = lexer.pos - 1
    const capLine = lexer.lineAt(capIndex)
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
        this.parseInline(text, lexer.abbrDefs, lexer.linkDefs, undefined, true),
      )
    }
    return this.parseInline(
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

  /**
   * `flattened` marks the MAX_NESTING_DEPTH degradation path (§25): past the cap
   * every opener "becomes literal paragraph text", so NOTHING interrupts here and
   * consecutive flattened openers plus any text after them form ONE paragraph,
   * ending at the first blank line. Grouping them one-per-opener was an artifact
   * of where the degrade path handed back to the block parser, not a rule -
   * "degrades to literal text" is the whole rule, and literal text groups the way
   * the same characters typed by an author would. (carve#547, carve#494)
   */
  private parseParagraph(lexer: Lexer, flattened = false): Paragraph {
    const lines: string[] = []
    let holdsLiteralColonFence = false
    const startLineIndex = lexer.pos
    let secondLineLazy = false
    while (!lexer.eof()) {
      const ln = lexer.peek()!
      if (isBlankLine(ln)) break
      if (lines.length === 1 && startLineIndex === lexer.interruptRefusedSiblingPlusLine &&
          isListMarkerLine(ln)) break
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
        ((((!ln.startsWith(LAZY_FRAME) || (lexer.hostBody === 'list' &&
          !RE_FOOTNOTE_DEF.test(stripLazyFrame(ln)))) && (lexer.consumesHostedLinkDefs === 'all' ||
          (lexer.consumesHostedLinkDefs === 'lazy' &&
            lexer.quoteLazyLines.has(lexer.lineNumber(lexer.pos))))) &&
          this.isLinkDefLine(stripLazyFrame(ln))) ||
          startsInterruptingBlock(lexer) ||
          (lexer.hostedFootnoteLines.has(lexer.lineNumber(lexer.pos)) &&
            !ln.startsWith(LAZY_FRAME) && RE_FOOTNOTE_DEF.test(ln.trimStart()))) &&
        !(RE_ADMONITION_CLOSE.test(ln) && holdsLiteralColonFence)
      )
        break
      if (lines.length === 1 && (ln.startsWith(LAZY_FRAME) || lexer.itemLazyLines.has(lexer.lineNumber(lexer.pos))))
        secondLineLazy = true
      const physical = (lexer.rootLines ?? lexer.lines)[lexer.lineNumber(lexer.pos) - 1] ?? ln
      if (lexer.hostMarkerColumn !== undefined &&
          (sourceColumn(physical) === lexer.hostMarkerColumn ||
            lexer.hostBody === 'list' && markerDecision(lexer, lexer.pos).reason === 'wrong-column') &&
          isContinuationMarker(ln) &&
          (isPhysicalContinuationMarker(physical) || isContinuationMarker(physical.trimStart()))) {
        lexer.reportRefusedContinuationMarker(lexer.pos, lexer.lineStartColumn(lexer.pos) + ln.indexOf('+'),
          lexer.hostBody === 'list' ? 'list item' : 'document', 'wrong-column')
      }
      lexer.consume()
      // The frame did its work in the interruption test above; a paragraph is
      // where a framed line becomes text, so it comes off here.
      const received = stripLazyFrame(ln)
      lines.push(received)
      holdsLiteralColonFence ||= isLiteralColonFenceLine(received)
    }
    // Every paragraph line has its leading whitespace stripped (djot /
    // CommonMark): `a\n   b` renders as `a\nb`, and a leading-indented first
    // line (` c`, or a fresh paragraph after a list closes) renders as `c` —
    // Carve has no indented code blocks, so indentation never survives into a
    // paragraph. The first line's stripped width is folded into the inline
    // base position so source offsets/columns stay accurate.
    const firstLead = lines[0]!.match(/^[ \t]+/)?.[0].length ?? 0
    const text = dropTrailingWhitespace(lines.length === 1
      ? lines[0]!.slice(firstLead)
      : lines.map((ln) => ln.replace(/^[ \t]+/, '')).join('\n'))
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
    const paragraphNode: Paragraph = {
      type: 'paragraph',
      children: this.skipParagraphInlines && !this.inMatcherRequest ? [] : this.parseInline(text, lexer.abbrDefs, lexer.linkDefs, {
        anchored: lexer.hasDocumentOffsets,
        baseOffset: lexer.lineOffset(startLineIndex) + firstLead,
        startLine: lexer.lineNumber(startLineIndex),
        startColumn: lexer.lineStartColumn(startLineIndex) + firstLead,
        ...(anchors ? { lineAnchors: anchors } : {}),
      }),
    }
    // The container prefix is already stripped by the lexer, so a first line with
    // leading whitespace LEFT sat above the container's content column. Recorded
    // here because this is the last place the answer exists: the indentation is
    // thrown away two lines up, and the block-image promotion phase has no way to
    // recover it from the tree (carve-js#1553).
    if (firstLead > 0) markAboveContentColumn(paragraphNode)
    // A caption line below the container's column reaches no host (§10 I7).
    if (secondLineLazy) markSecondLineLazy(paragraphNode)
    return paragraphNode
  }

  private substitutionScans: SubstitutionScanner | undefined

  /**
   * A substitution's pair end and top-level arrow, or null for a forced strike.
   * Escapes, code spans and closed comments hide their contents.
   */
  private substitutionAt(text: string, open: number): { end: number; arrow: number } | null {
    if (text[open + 1] !== '~' || splitBracedOpener(text, open)) return null
    const end = this.bracedPairEnd(text, open, '~}')
    if (end === -1) return null
    if (this.substitutionScans === undefined) {
      const hosts = new Map<number, number>()
      const brackets = text.includes('[') ? buildBracketMap(text, true) : undefined
      for (let at = 0; at < text.length; at++) {
        if (text[at] !== '[') continue
        const close = brackets?.(at)
        if (close !== undefined) hosts.set(at, close + 1)
      }
      for (const [at, close] of linkDestinations(text, newEmphasisMemo())) hosts.set(at, close + 1)
      // An autolink or a cross-reference is atomic (PART 9 E2a): a `~>` ending one is no arrow.
      for (const [at, end] of atomicLinkRegions(text)) if (!hosts.has(at)) hosts.set(at, end)
      for (let at = 0; at < text.length; at++) {
        const marker = text[at + 1]
        if (text[at] !== '{' || marker === undefined || FORCED_TYPE[marker] === undefined || splitBracedOpener(text, at)) continue
        const close = this.bracedPairEnd(text, at, `${marker}}`)
        if (close !== -1) hosts.set(at, close)
      }
      this.substitutionScans = new SubstitutionScanner(text, hosts)
    }
    const arrow = this.substitutionScans.findArrow(open + 2, end - 2)
    return arrow === -1 ? null : { end, arrow }
  }

  private commentCloserPositions: Map<string, number> | undefined

  private delimitedCommentClose(text: string, from: number): number {
    const positions = (this.commentCloserPositions ??= new Map())
    let last = positions.get(text)
    if (last === undefined) {
      last = text.lastIndexOf('%}')
      positions.set(text, last)
    }
    return last < from ? -1 : text.indexOf('%}', from)
  }

  private pairEndText: string | undefined

  private pairEndTable: Array<Int32Array | undefined> = []
  private pairEndOffset = 0

  private pairAttributeTails = new Map<number, number>()
  private bareAttributePairs = new Map<number, { close: number; end: number }>()

  private pairEndCache = new Map<string, { tables: Array<Int32Array | undefined>; bytes: number; attributeTails: Map<number, number>; barePairs: Map<number, { close: number; end: number }> }>()
  private pairEndCacheBytes = 0
  private pairEndCacheBudget = 0
  private inlinePairFrameDepth = 0

  private rememberPairTables(text: string, tables: Array<Int32Array | undefined>, attributeTails = new Map<number, number>(), barePairs = new Map<number, { close: number; end: number }>()): void {
    const bytes = 128 + text.length * 2 + attributeTails.size * 16 + barePairs.size * 24 + tables.reduce((sum, table) => sum + (table?.byteLength ?? 0), 0)
    while (this.pairEndCacheBytes + bytes > this.pairEndCacheBudget && this.pairEndCache.size > 0) {
      const oldest = this.pairEndCache.keys().next().value!
      this.pairEndCacheBytes -= this.pairEndCache.get(oldest)!.bytes
      this.pairEndCache.delete(oldest)
    }
    this.pairEndCache.set(text, { tables, bytes, attributeTails, barePairs })
    this.pairEndCacheBytes += bytes
    this.pairEndText = text
    this.pairEndOffset = 0
    this.pairEndTable = tables
    this.pairAttributeTails = attributeTails
    this.bareAttributePairs = barePairs
  }

  /**
   * For each marker the text opens a pair with, where a scan for its closer
   * starting at each position stops: the closer's index, or -1. Built right to
   * left in one pass, so the end of a nested pair is known before any scan that
   * has to skip it, and a document of nested pairs costs a pass per level rather
   * than a pass per pair.
   */
  private pairEndTables(text: string): Array<Int32Array | undefined> {
    if (text === this.pairEndText) return this.pairEndTable
    const cached = this.pairEndCache.get(text)
    if (cached !== undefined) {
      this.pairEndCache.delete(text)
      this.pairEndCache.set(text, cached)
      this.pairEndText = text
      this.pairEndOffset = 0
      this.pairEndTable = cached.tables
      this.pairAttributeTails = cached.attributeTails
      this.bareAttributePairs = cached.barePairs
      return cached.tables
    }
    const n = text.length
    const markers: number[] = []
    for (let m = 0; m < PAIR_MARKERS.length; m++) {
      if (text.includes(`{${PAIR_MARKERS[m]}`) && text.includes(`${PAIR_MARKERS[m]}}`)) markers.push(m)
    }
    const tables: Array<Int32Array | undefined> = new Array(PAIR_MARKERS.length)
    const raws: Int32Array[] = []
    for (const m of markers) {
      tables[m] = new Int32Array(n + 2).fill(-1)
      raws[m] = new Int32Array(n + 2).fill(-1)
    }
    if (markers.length === 0 && !text.includes('{#')) {
      this.rememberPairTables(text, tables)
      return tables
    }
    const ends = new Int32Array(n + 2).fill(-1)
    const codeEnds = backtickRunEnds(text)
    const brackets = text.includes('[') ? buildBracketMap(text, true) : undefined
    const destinations = linkDestinations(text, newEmphasisMemo())
    const lineComments = new Map<number, number>()
    const attributeTails = new Map<number, number>()
    const barePairs = new Map<number, { close: number; end: number }>()
    const attributes = inlineOpaqueEnds(text, codeEnds, destinations, lineComments, attributeTails, brackets)
    for (const [start, end] of [...attributeTails].reverse()) attributeTails.set(start, attributeTails.get(end) ?? end)
    const bareMarkers = new Set<number>()
    for (const start of attributeTails.keys()) {
      const marker = text[start - 1]
      if (marker !== undefined && '/*_~='.includes(marker)) bareMarkers.add(PAIR_MARKERS.indexOf(marker))
    }
    const bareTables: Array<Int32Array | undefined> = new Array(PAIR_MARKERS.length)
    for (const m of bareMarkers) bareTables[m] = new Int32Array(n + 2).fill(-1)
    const afterAttributes = attributeTails.size === 0 ? (end: number): number => end : (end: number): number => attributeTails.get(end) ?? end
    const bracketEnds = new Set<number>()
    const openerMarks = new Set<number>()
    for (let at = 0; at < n; at++) {
      if (text[at] === '\\') { at++; continue }
      if (text[at] === '[') {
        const close = brackets?.(at)
        if (close !== undefined) bracketEnds.add(close)
      }
      if (text[at] === '{' && PAIR_MARKERS.includes(text[at + 1] ?? '\0') && !splitBracedOpener(text, at)) openerMarks.add(++at)
    }
    for (let j = n - 1; j >= 0; j--) {
      const ch = text[j]!
      const next = text[j + 1]
      const nextId = next === undefined ? -1 : PAIR_MARKERS.indexOf(next)
      // Where the pair opening here ends, if it closes at all.
      if (ch === '{' && nextId !== -1 && tables[nextId] !== undefined && !splitBracedOpener(text, j)) {
        const stop = tables[nextId]![j + 2]!
        ends[j] = stop === -1 ? -1 : stop + 2
      }
      const codeEnd = ch === '`' ? codeEnds![j]! : undefined
      const bracketEnd = ch === '[' ? brackets?.(j) : undefined
      const destinationEnd = destinations.get(j)
      const attributeEnd = attributes.get(j)
      let bareId = -1
      let bareClose = -1
      let bareTail: number | undefined
      if (bareMarkers.size !== 0) {
        for (const m of bareMarkers) {
          const table = bareTables[m]!
          const marker = PAIR_MARKERS[m]!
          const before = text[j - 1]
          let stop: number
          if (ch === '\\') stop = table[j + 2]!
          else if (bracketEnds.has(j)) stop = -1
          else if (lineComments.has(j)) stop = table[lineComments.get(j)!]!
          else if (codeEnd !== undefined) stop = codeEnd === -1 ? -1 : table[afterAttributes(codeEnd)]!
          else if (attributeEnd !== undefined) stop = table[ch === '<' ? afterAttributes(attributeEnd) : attributeEnd]!
          else if (bracketEnd !== undefined) stop = table[afterAttributes((destinations.get(bracketEnd + 1) ?? bracketEnd) + 1)]!
          else if (destinationEnd !== undefined) stop = table[afterAttributes(destinationEnd + 1)]!
          else if (ch === '{' && nextId !== -1 && ends[j] !== -1) stop = table[afterAttributes(ends[j]!)]!
          else if (ch === marker && before !== undefined && !isCarveWhitespace(before) && (!next || !/[A-Za-z0-9]/.test(next)) && !extendsGrapheme(text, j + 1)) stop = j
          else stop = table[j + 1]!
          table[j] = stop
        }
        bareId = PAIR_MARKERS.indexOf(ch)
        const before = text[j - 1]
        const canOpenBare = bareTables[bareId] !== undefined && next !== undefined && !isCarveWhitespace(next)
          && next !== ch && before !== ch && (!before || !/[A-Za-z0-9_]/.test(before))
          && (ch !== '=' || next !== '>') && ((ch !== '/' && ch !== '_') || before !== '/')
          && !extendsGrapheme(text, j + 1)
        bareClose = canOpenBare ? bareTables[bareId]![j + 1]! : -1
        bareTail = bareClose === -1 ? undefined : attributeTails.get(bareClose + 1)
        if (bareTail !== undefined) barePairs.set(j, { close: bareClose, end: bareTail })
      }
      for (const m of markers) {
        const table = tables[m]!
        const raw = raws[m]!
        // AN ESCAPE HIDES THE CHARACTER AFTER IT, so a closer written there
        // closes nothing and the scan resumes past it. Only an escaped backtick
        // was skipped before, which left `{*a\*}` closing on its escaped
        // delimiter and publishing the backslash as a hard break
        // (markup-carve/carve-js#1897). `raw` is the closer an UNCLOSED verbatim
        // run ends at, and a backslash inside one is content rather than an
        // escape, so it keeps counting that closer.
        if (ch === '\\') {
          raw[j] = raw[j + 1]!
          table[j] = table[j + 2]!
          continue
        }
        const isCloser = next === '}' && ch === PAIR_MARKERS[m] && !openerMarks.has(j)
        raw[j] = next === '}' && ch === PAIR_MARKERS[m] ? j : raw[j + 1]!
        let stop: number
        const commentEnd = lineComments.get(j)
        if (bracketEnds.has(j)) stop = -1
        else if (commentEnd !== undefined) stop = raw[j] !== -1 && raw[j]! < commentEnd ? raw[j]! : table[commentEnd]!
        else if (codeEnd !== undefined) {
          // An unclosed run ends at the pair's closer instead of running to the
          // end of the block (markup-carve/carve#2056).
          stop = codeEnd !== -1 ? table[afterAttributes(codeEnd)]! : raw[j]!
        } else if (attributeEnd !== undefined) stop = table[ch === '<' ? afterAttributes(attributeEnd) : attributeEnd]!
        else if (bracketEnd !== undefined) stop = table[afterAttributes(bracketEnd + 1)]!
        else if (destinationEnd !== undefined) stop = table[afterAttributes(destinationEnd + 1)]!
        else if (isCloser) stop = j
        else if (ch === '{' && nextId !== -1 && (nextId !== m || FORCED_TYPE[next!] !== undefined) && ends[j] !== -1) {
          // A matched child owns its closer, including a child of this kind.
          // Unmatched openers leave the following closer visible.
          stop = table[afterAttributes(ends[j]!)]!
        } else {
          stop = table[j + 1]!
          if (bareTail !== undefined && bareId !== m && (stop === -1 || stop >= bareClose)) stop = table[bareTail]!
        }
        table[j] = stop
      }
    }
    this.rememberPairTables(text, tables, attributeTails, barePairs)

    return tables
  }

  private plainInlineWord(text: string, start: number, end: number, source: InlineSource): InlineNode[] | undefined {
    if (this.activeMatchers.length !== 0 || end <= start || end - start > 64) return undefined
    for (let at = start; at < end; at++) {
      const code = text.charCodeAt(at)
      if (!(code >= 48 && code <= 57 || code >= 65 && code <= 90 || code >= 97 && code <= 122)) return undefined
    }
    return [this.withPos({ type: 'text', value: text.slice(start, end) } as Text, source, text, start, end)]
  }

  private plainBracedWordEnd(text: string, open: number, marker: string): number {
    if (this.activeMatchers.length !== 0) return -1
    let at = open + 2
    const limit = Math.min(text.length, at + 65)
    while (at < limit) {
      const code = text.charCodeAt(at)
      if (!(code >= 48 && code <= 57 || code >= 65 && code <= 90 || code >= 97 && code <= 122)) break
      at++
    }
    return at > open + 2 && at - open - 2 <= 64 && text[at] === marker && text[at + 1] === '}' ? at + 2 : -1
  }

  /** Where a braced inline opened at `open` closes (exclusive), or -1. */
  private bracedPairEnd(text: string, open: number, closer: string): number {
    if (splitBracedOpener(text, open)) return -1
    const wordEnd = this.plainBracedWordEnd(text, open, closer[0]!)
    if (wordEnd !== -1) return wordEnd
    const stop = this.pairCloser(text, open + 2, closer[0]!)

    return stop === -1 || stop === open + 2 ? -1 : stop + closer.length
  }

  private pairCloser(text: string, at: number, marker: string): number {
    const table = this.pairEndTables(text)[PAIR_MARKERS.indexOf(marker)]
    const stop = table?.[at + this.pairEndOffset] ?? -1
    return stop < this.pairEndOffset || stop + 2 > this.pairEndOffset + text.length ? -1 : stop - this.pairEndOffset
  }

  private pairAttributeEnd(text: string, end: number): number {
    const tail = this.pairAttributeTails.get(end + this.pairEndOffset)
    return tail === undefined || tail > this.pairEndOffset + text.length ? end : tail - this.pairEndOffset
  }

  private pairBareAttributes(text: string, open: number): { close: number; end: number } | undefined {
    const pair = this.bareAttributePairs.get(open + this.pairEndOffset)
    return pair === undefined || pair.end > this.pairEndOffset + text.length ? undefined
      : { close: pair.close - this.pairEndOffset, end: pair.end - this.pairEndOffset }
  }

  private pairView(offset: number): InlinePairView {
    return { tables: this.pairEndTable, attributeTails: this.pairAttributeTails, barePairs: this.bareAttributePairs, offset: this.pairEndOffset + offset }
  }

  /**
   * Critic insertion/deletion pairs do not close on a delimiter escaped inside
   * an unclosed verbatim run. The forced-emphasis family deliberately does.
   */
  private criticPairEnd(text: string, open: number, closer: '+}' | '-}'): number {
    const end = this.bracedPairEnd(text, open, closer)
    if (end === -1) return -1
    const close = end - 2
    if (text[close - 1] !== '\\') return end

    for (let tick = text.indexOf('`', open + 2); tick !== -1 && tick < close; tick = text.indexOf('`', tick + 1)) {
      if (tick > open + 2 && text[tick - 1] === '\\') continue
      const span = verbatimSpanEnd(text.slice(0, close), tick)
      if (!span.closed) return -1
      tick = span.end - 1
    }
    return end
  }

  private singleQuoteSpan: { node?: SmartPunctuation; demote: boolean } | null = null
  private quoteScopeDepth = 0

  private activeQuoteCharacters: readonly [string, string, string, string] = ['“', '”', '‘', '’']
  private quoteGlyphHasNul = false

  private smartToken(
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
      const open = isQuoteOpenContext(prev) && !closesAfterDash(prev, text[i + 1] ?? '')
      return { out: open ? this.activeQuoteCharacters[0] : this.activeQuoteCharacters[1], len: 1, kind: open ? 'left_double_quote' : 'right_double_quote' }
    }
    if (c === "'") {
      const next = codePointAfter(text, i)
      const open = isQuoteOpenContext(prev) && !closesAfterDash(prev, next)
      let apostrophe = /[0-9]/.test(next) || (!open && isQuoteAlnum(next))
      if (!apostrophe && !open && !isQuoteSpace(prev)) this.singleQuoteSpan = null
      if (open && !apostrophe) {
        if (isQuoteAlnum(next)) {
          QUOTE_LETTER_RUN.lastIndex = i + 1
          const word = QUOTE_LETTER_RUN.exec(text)?.[0] ?? ''
          const end = i + 1 + word.length
          const elision = ELISION_WORDS.has(word.toLowerCase())
            && !(text[end] === "'" && !isQuoteAlnum(codePointAfter(text, end)))
          apostrophe = elision || this.singleQuoteSpan !== null
        }
        if (!apostrophe && this.singleQuoteSpan === null) {
          this.singleQuoteSpan = {
            demote: isQuoteAlnum(next) && !(i === 0 && this.inlinePairFrameDepth === this.quoteScopeDepth) && prev !== '“',
          }
        }
      }
      return {
        out: apostrophe ? '’' : open ? this.activeQuoteCharacters[2] : this.activeQuoteCharacters[3],
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
  parseRefLabelInlines(label: string): InlineNode[] {
    return this.scanInline(label, inlineSource(), false)
  }

  private parseInline(
    text: string,
    abbrDefs: Map<string, string>,
    linkDefs: Map<string, LinkDef> = new Map(),
    source: InlineSource = inlineSource(),
    captionContext = false,
  ): InlineNode[] {
    const nodes = applyAbbreviations(this.scanInline(text, source, false, captionContext), abbrDefs)
    return applyLinkDefs(nodes, linkDefs)
  }

  private openKinds: ReadonlySet<string> = NO_OPEN_KINDS

  /** `openKinds` with `delim` added. */
  private withOpenKind(delim: string): ReadonlySet<string> {
    return new Set([...this.openKinds, delim])
  }

  /** Whether the inline text being scanned is a line block's stanza. */
  private inLineBlock = false

  /**
   * An unclosed run's content with the trailing whitespace its end drops. In a
   * line block a line break is content and is kept (markup-carve/carve#2089); a
   * stanza's own end leaves nothing there to keep.
   */
  /**
   * The `+` joins inside a verbatim payload that starts at `start` in `text`.
   * The scanner skips the payload, so its joins would otherwise vanish; a
   * join consumed as padding has no space left to point at and is dropped.
   */
  private verbatimCellWraps(text: string, source: InlineSource, start: number, payload: string, strippedPadding = false): VerbatimCellWrap[] | undefined {
    if (!source.cellWraps) return undefined
    const shift = source.wrapShift ?? 0
    let wraps: VerbatimCellWrap[] | undefined
    let codepoints = 0
    if (strippedPadding) {
      const wrap = source.cellWraps.get(start - 1 + shift)
      if (wrap) (wraps ??= []).push({ offset: 0, line: wrap.line, ...(wrap.row ? { row: wrap.row } : {}), ...(wrap.col ? { col: wrap.col } : {}) })
    }
    for (let j = start; j < start + payload.length; j++) {
      const code = text.charCodeAt(j)
      if (code === 32) {
        const wrap = source.cellWraps.get(j + shift)
        if (wrap) (wraps ??= []).push({ offset: codepoints, line: wrap.line, ...(wrap.row ? { row: wrap.row } : {}), ...(wrap.col ? { col: wrap.col } : {}) })
      }
      if (code < 0xdc00 || code > 0xdfff || j === start || (text.charCodeAt(j - 1) & 0xfc00) !== 0xd800) codepoints++
    }
    if (strippedPadding) {
      const wrap = source.cellWraps.get(start + payload.length + shift)
      if (wrap) (wraps ??= []).push({ offset: codepoints, line: wrap.line, ...(wrap.row ? { row: wrap.row } : {}), ...(wrap.col ? { col: wrap.col } : {}) })
    }
    return wraps
  }

  private trimUnclosedRun(content: string): string {
    return this.inLineBlock ? content : trimEndNonNbsp(content)
  }

  private scanInline(
    text: string,
    source: InlineSource = inlineSource(),
    inFootnote = false,
    captionContext = false,
    kinds: ReadonlySet<string> = NO_OPEN_KINDS,
    opensHostRun = false,
    separateQuoteScope = false,
    pairs?: InlinePairView,
  ): InlineNode[] {
    if (inlineDepth >= MAX_NESTING_DEPTH) {
      return [this.withPos({ type: 'text', value: text } as Text, source, text, 0, text.length)]
    }
    if (this.activeMatchers.length === 0 && !source.cellWraps && text.length <= 64 && /^[A-Za-z0-9 ]+$/.test(text)) {
      return [this.withPos({ type: 'text', value: text } as Text, source, text, 0, text.length)]
    }
    if (this.inlinePairFrameDepth === 0) {
      this.pairEndCache.clear()
      this.pairEndCacheBytes = 0
      this.pairEndCacheBudget = Math.max(text.length * 64, 65536)
      this.pairEndText = undefined
      this.pairEndTable = []
    }
    const quoteRoot = this.inlinePairFrameDepth === 0 || separateQuoteScope
    const outerQuoteSpan = this.singleQuoteSpan
    const outerQuoteScopeDepth = this.quoteScopeDepth
    if (quoteRoot) this.singleQuoteSpan = null
    inlineDepth++
    this.inlinePairFrameDepth++
    if (quoteRoot) this.quoteScopeDepth = this.inlinePairFrameDepth
    const outerPairText = this.pairEndText
    const outerPair = this.pairView(0)
    const outerSubstitutions = this.substitutionScans
    this.substitutionScans = undefined
    const outer = this.openKinds
    this.openKinds = kinds
    try {
      if (pairs !== undefined) {
        this.pairEndText = text
        this.pairEndTable = pairs.tables
        this.pairEndOffset = pairs.offset
        this.pairAttributeTails = pairs.attributeTails
        this.bareAttributePairs = pairs.barePairs
      }
      return this.scanInlineInner(
        text, source, inFootnote, captionContext, opensHostRun || inlineDepth === 1,
      )
    } finally {
      if (quoteRoot) {
        const span = this.singleQuoteSpan
        if (span?.demote && span.node) {
          span.node.kind = 'right_single_quote'
          span.node.glyph = '’'
        }
        this.singleQuoteSpan = outerQuoteSpan
        this.quoteScopeDepth = outerQuoteScopeDepth
      }
      this.pairEndText = outerPairText
      this.pairEndTable = outerPair.tables
      this.pairEndOffset = outerPair.offset
      this.pairAttributeTails = outerPair.attributeTails
      this.bareAttributePairs = outerPair.barePairs
      this.substitutionScans = outerSubstitutions
      this.openKinds = outer
      inlineDepth--
      this.inlinePairFrameDepth--
    }
  }

  private inlineScannerSession: InlineScannerSession | undefined

  private scanInlineInner(
    text: string,
    source: InlineSource,
    inFootnote: boolean,
    captionContext: boolean,
    atHostRunStart: boolean,
  ): InlineNode[] {
    const parseSession = this
    const session = this.inlineScannerSession ??= {
      get activeMatchers() { return parseSession.activeMatchers },
      set activeMatchers(value: InlineScannerSession['activeMatchers']) { parseSession.activeMatchers = value },
      get inLineBlock() { return parseSession.inLineBlock },
      set inLineBlock(value: InlineScannerSession['inLineBlock']) { parseSession.inLineBlock = value },
      get pairEndText() { return parseSession.pairEndText },
      set pairEndText(value: InlineScannerSession['pairEndText']) { parseSession.pairEndText = value },
      get recordPositions() { return parseSession.recordPositions },
      set recordPositions(value: InlineScannerSession['recordPositions']) { parseSession.recordPositions = value },
      get singleQuoteSpan() { return parseSession.singleQuoteSpan },
      set singleQuoteSpan(value: InlineScannerSession['singleQuoteSpan']) { parseSession.singleQuoteSpan = value },
      bracedPairEnd: this.bracedPairEnd.bind(this),
      criticPairEnd: this.criticPairEnd.bind(this),
      delimitedCommentClose: this.delimitedCommentClose.bind(this),
      extendPosTo: this.extendPosTo.bind(this),
      matchEmphasis: this.matchEmphasis.bind(this),
      pairView: this.pairView.bind(this),
      plainInlineWord: this.plainInlineWord.bind(this),
      positionCitationItems: this.positionCitationItems.bind(this),
      rawSourceSlice: this.rawSourceSlice.bind(this),
      scanInline: this.scanInline.bind(this),
      scanLinkLabel: this.scanLinkLabel.bind(this),
      shiftSource: this.shiftSource.bind(this),
      smartToken: this.smartToken.bind(this),
      substitutionAt: this.substitutionAt.bind(this),
      trimUnclosedRun: this.trimUnclosedRun.bind(this),
      tryInlineMatchers: this.tryInlineMatchers.bind(this),
      verbatimCellWraps: this.verbatimCellWraps.bind(this),
      withPos: this.withPos.bind(this),
    }
    return scanInlineInnerWithHelpers(session, text, source, inFootnote, captionContext, atHostRunStart)
  }

  private matchEmphasis(
    text: string,
    i: number,
    source: InlineSource,
    inFootnote = false,
    noClose: EmphasisMemo = newEmphasisMemo(),
    end = text.length,
  ): EmphasisMatch | null {
    const c = text[i]!

    // Bold-italic /*...*/  (priority over /emphasis/ and *bold*)
    // bare_opener('/'): the outer `/` does not open after a word character
    // or another slash (carve#3217); `a{/*y*/}b` is the intraword spelling.
    if (c === '/' && text[i + 1] === '*' && !/[A-Za-z0-9_/]/.test(text[i - 1] ?? '')) {
      const start = i + 2
      // A bold-italic span requires a non-whitespace char right after `/*`
      // (grammar boldItalic `~spaceOrEnd`). Empty (`/**/`) or space-initial
      // (`/* x*/`) content is not bold-italic and falls through to `/` emphasis,
      // matching carve-php parseBoldItalic.
      // `isCarveWhitespace`, not `\s`: PART 7 makes a vertical tab CONTENT, so
      // `/*<VT>a*/` is bold-italic exactly as `/*<SOH>a*/` already was.
      if (start < text.length && !isCarveWhitespace(text[start]) && !extendsGrapheme(text, start)) {
        const close = combinedSpanCloser(text, start, noClose)
        if (close !== undefined && close + 2 <= end) {
          const inner = text.slice(start, close)
          const children = this.scanInline(inner, this.shiftSource(source, text, start), inFootnote, false, new Set([...this.openKinds, '/', '*']))
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
              children: [this.withPos({ type: 'emphasis', children }, source, text, start, close)],
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
        // Opener must be followed by a non-whitespace character (CARVE-P3-013;
        // a tab counts, PART 7).
        if (!after || isCarveWhitespace(after)) continue
        if (extendsGrapheme(text, i + 1)) continue
        // No same-type nesting (spec §4.2): a bare delimiter adjacent to the
        // same delimiter (before OR after) does not open, so a doubled
        // delimiter is literal text. `**x**`, `~~x~~`, `==x==` stay literal,
        // uniformly with `//x//` and `__x__`. Applies to all five.
        if (after === delim || before === delim) continue
        // E3: a second opener of an open kind is content.
        if (this.openKinds.has(delim)) continue
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
        const close = this.cachedFindEmphasisClose(text, i + 1, delim, noClose, end)
        if (close !== -1) {
          const inner = text.slice(i + 1, close)
          return {
            node: { type, children: this.plainInlineWord(text, i + 1, close, source) ?? this.scanInline(inner, this.shiftSource(source, text, i + 1), inFootnote, false, this.withOpenKind(delim)) },
            end: close + 1,
          }
        }
      }
    }
    return null
  }

  private cachedFindEmphasisClose(
    text: string,
    from: number,
    delim: string,
    memo: EmphasisMemo,
    end: number,
  ): number {
    const failed = memo.failed.get(delim)
    if (failed !== undefined && failed[from] === 1) return -1
    const visited: number[] = []
    const close = this.findEmphasisClose(text, from, delim, memo, failed, visited, end)
    if (close === -1) {
      const marks = failed ?? new Uint8Array(text.length + 1)
      for (const j of visited) marks[j] = 1
      memo.failed.set(delim, marks)
    }
    return close
  }

  private withPos<T extends InlineNode>(
    node: T,
    source: InlineSource,
    text: string,
    start: number,
    end: number,
  ): T {
    if (source.anchored === false || (!this.recordPositions && node.type !== 'soft_break' && node.type !== 'hard_break')) return node
    const pos = this.sourcePos(source, text, start, end)
    if (pos) node.pos = pos
    return node
  }

  /** Give each semicolon-delimited citation item its own authored span. */
  private positionCitationItems(
    node: CitationGroup,
    source: InlineSource,
    text: string,
    groupStart: number,
  ): void {
    if (!this.recordPositions || source.anchored === false) return
    const innerStart = node.mode === 'integral' ? 2 : 1
    const inner = node.raw.slice(innerStart, -1)
    let cursor = 0
    const parts = inner.split(';')
    for (let index = 0; index < node.items.length; index++) {
      const part = parts[index]
      if (part === undefined) return
      const leading = part.length - part.trimStart().length
      const trailing = part.length - part.trimEnd().length
      const start = groupStart + innerStart + cursor + leading
      const end = groupStart + innerStart + cursor + part.length - trailing
      const pos = this.sourcePos(source, text, start, end)
      if (pos) node.items[index]!.pos = pos
      cursor += part.length + 1
    }
  }

  /**
   * Move a node's span end out to `end`, keeping its start where it was.
   *
   * Used when markup that belongs to an already-emitted node is read after it -
   * a trailing attribute block. A node parsed with `anchored: false` carries no
   * `pos` at all, and there is nothing to extend.
   */
  private extendPosTo(node: InlineNode, source: InlineSource, text: string, end: number): void {
    const pos = (node as { pos?: Position }).pos
    if (!pos) return
    const point = this.pointAt(source, text, end)
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

  private sourcePos(
    source: InlineSource,
    text: string,
    start: number,
    end: number,
  ): Position | undefined {
    const startPoint = this.pointAt(source, text, start)
    const endPoint = this.pointAt(source, text, end)
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
   */
  private rawSourceSlice(
    source: InlineSource,
    text: string,
    start: number,
    end: number,
  ): string | undefined {
    // ONLY ANCHORED TEXT CAN BE ASKED. Without `lineAnchors` a span is a single
    // base offset plus a local one, which is the document only when the two never
    // diverge - and a bare `inlineSource()` scanning a detached label has no
    // document behind it at all.
    if (!source.lineAnchors || this.activeDocument === null) return undefined
    const pos = this.sourcePos(source, text, start, end)
    if (pos?.startOffset === undefined || pos.endOffset === undefined) return undefined
    const candidate = normalizeNewlines(this.activeDocument.slice(pos.startOffset, pos.endOffset))
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

  private shiftSource(source: InlineSource, text: string, by: number): InlineSource {
    const point = this.pointAt(source, text, by)
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
    if (source.cellWraps) {
      shifted.cellWraps = source.cellWraps
      shifted.wrapShift = (source.wrapShift ?? 0) + by
    }
    if (source.lineAnchors) {
      // CARRIED INWARD, which is the whole defect: the anchors reached the
      // stanza's top-level nodes and stopped at the first inline container, so a
      // node nested under one was measured from the joined text. Shared, with the
      // starting LINE carried as a delta - the array belongs to the whole stanza,
      // and copying a suffix per nested construct is quadratic in a tall stanza
      // that also carries markup.
      shifted.lineAnchors = source.lineAnchors
      shifted.anchorShift = (source.anchorShift ?? 0) + this.newlinesUpTo(text, by)
    }
    return shifted
  }

  /** How many newlines of `text` sit strictly before `offset`. */
  private newlinesUpTo(text: string, offset: number): number {
    const indices = this.newlineIndices(text)
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
  private newlineIndexCache = new Map<string, number[]>()

  private newlineIndices(text: string): number[] {
    let indices = this.newlineIndexCache.get(text)
    if (indices === undefined) {
      indices = []
      for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) {
        indices.push(i)
      }
      this.newlineIndexCache.set(text, indices)
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
  private pointAt(
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
    const indices = this.newlineIndices(text)
    const newlinesBefore = this.newlinesUpTo(text, offset)
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

  private findEmphasisClose(
    text: string,
    from: number,
    delim: string,
    memo: EmphasisMemo = newEmphasisMemo(),
    failed?: Uint8Array,
    visited?: number[],
    end = text.length,
  ): number {
    // PART 8: a delimiter inside a balanced label cannot pair past its close.
    // Keep the original text so flanking and source offsets use the same run.
    this.pairEndTables(text)
    const attached = this.bareAttributePairs.size === 0 ? undefined : new Map<number, number>()
    for (let j = from; j < end; j++) {
      if (failed !== undefined && failed[j] === 1) return -1
      visited?.push(j)
      const ch = text[j]!
      const child = ch !== delim && !this.openKinds.has(ch) ? this.pairBareAttributes(text, j) : undefined
      if (child) attached?.set(child.close + 1, child.end)
      const attachedEnd = attached?.get(j)
      if (attachedEnd !== undefined) { j = attachedEnd - 1; continue }
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
        j = this.pairAttributeEnd(text, span.end) - 1
        continue
      }
      // An unbounded comment consumes the rest of its line before the delimiter
      // stack can claim a closer there. A later line can still close the span.
      // ONE PREDICATE WITH THE BUILDER: a closer this scan hides and the builder
      // publishes, or the reverse, is a span whose two halves disagree. The scan
      // starts past its own opener, so the run-start arm cannot reach it.
      if (opensInlineComment(text, j)) {
        const newline = text.indexOf('\n', j + 2)
        if (newline === -1) return -1
        j = newline
        continue
      }
      // Comment contents are transparent to the surrounding emphasis structure.
      // Only a closed form is a comment; an unterminated opener remains literal.
      if (ch === '{' && text[j + 1] === '%' && !extendsGrapheme(text, j + 2)) {
        const close = this.delimitedCommentClose(text, j + 2)
        if (close !== -1) {
          j = close + 1
          continue
        }
      }
      // A raw inline's format token is opaque as itself, not as a braced
      // highlight: the main loop builds it together with the code span in front
      // of it, so a closer after it stays reachable (E2a, carve-js#1745).
      if (ch === '{' && text[j - 1] === '`') {
        RE_RAW_INLINE_STICKY.lastIndex = j
        const m = RE_RAW_INLINE_STICKY.exec(text)
        if (m) {
          j = this.pairAttributeEnd(text, j + m[0].length) - 1
          continue
        }
      }
      // Braced inlines are opaque too (E2a, markup-carve/carve#2027).
      if (ch === '{') {
        const end = this.bracedInlineEnd(text, j, memo)
        if (end !== -1) {
          j = this.pairAttributeEnd(text, end + 1) - 1
          continue
        }
      }
      // A BALANCED BRACKET RUN IS OPAQUE, ITS LABEL INCLUDED (PART 8,
      // markup-carve/carve#2577). Links rank 5 and the bare emphasis markers
      // rank 7, so the run resolves first and a marker inside it is label text
      // by the time the delimiter stack reaches it: `/[a/](/u)` is a link whose
      // label ends in a slash, not an emphasis paired across the bracket. An
      // UNBALANCED `[` is no run and hides nothing, which is what keeps `/[a/`
      // emphasizing.
      //
      // Asked of every balanced run, not only of one a link resolves from,
      // because the rank belongs to the RUN: `/[a/]` with no destination at all
      // is literal text too.
      if (ch === '[') {
        const close = emphasisBrackets(text, memo)(j)
        if (close !== undefined) {
          j = this.pairAttributeEnd(text, close + 1) - 1
          continue
        }
      }
      // A link or image destination, title included, and an autolink (E2a,
      // markup-carve/carve#2046).
      if (ch === '(' && text[j - 1] === ']') {
        const end = linkDestinations(text, memo).get(j)
        if (end !== undefined) {
          j = this.pairAttributeEnd(text, end + 1) - 1
          continue
        }
      }
      if (ch === '<') {
        // A cross-reference ranks with autolinks (PART 8 item 3).
        if (text.startsWith('</#', j) && text[j + 3] !== '>') {
          memo.crossref ??= { lastCloser: text.lastIndexOf('>') }
          if (crossrefBodyCanEnd(text, j + 3, memo.crossref)) {
            j = text.indexOf('>', j + 3)
            continue
          }
        }
        RE_AUTOLINK_STICKY.lastIndex = j
        const m = RE_AUTOLINK_STICKY.exec(text)
        if (m) {
          j = this.pairAttributeEnd(text, j + m[0].length) - 1
          continue
        }
      }
      if (ch === delim) {
        // Closer must not be preceded by whitespace (CARVE-P3-013).
        const prev = text[j - 1]
        if (prev === undefined || isCarveWhitespace(prev)) continue
        const next = text[j + 1]
        // Word-boundary closer (spec §9): no bare delimiter closes when followed
        // by an alphanumeric. Applies to every delimiter, not just / and _.
        if (next && /[A-Za-z0-9]/.test(next)) continue
        if (extendsGrapheme(text, j + 1)) continue
        return j
      }
    }
    return -1
  }

  // The last index of the braced inline opening at `open`, or -1.
  private bracedInlineEnd(text: string, open: number, memo: EmphasisMemo): number {
    if (memo.lastBrace === -2) memo.lastBrace = text.lastIndexOf('}')
    if (memo.lastBrace < open) return -1
    // The pairs whose closer the parser searches for across the block are asked
    // the same question here, so the scan hides the region the parser builds.
    const marker = text[open + 1]
    if (marker !== undefined && (FORCED_TYPE[marker] !== undefined || marker === '+' || marker === '-') && !splitBracedOpener(text, open)) {
      const stop = this.pairCloser(text, open + 2, marker)
      if (stop !== -1) return this.pairAttributeEnd(text, stop + 2) - 1
    }
    if (marker === '#' && !extendsGrapheme(text, open + 2)) {
      memo.lastCritic ??= text.lastIndexOf('#}')
      const close = memo.lastCritic >= open + 3 ? text.indexOf('#}', open + 2) : -1
      if (close > open + 2) return close + 1
    }
    return -1
  }
}
