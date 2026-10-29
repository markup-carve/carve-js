import {
  extractItemAttr,
  FENCE_TRAILING_WS,
  isBlockAttributeLine,
  isContinuationMarker,
  isLinkDefLine,
  isListMarkerLine,
  isTableRow,
  leadingWhitespace,
  lineOpensBlock,
  parseBlockAttributeRun,
  peekBlockAttributes,
  RE_ABBR_DEF,
  RE_ADMONITION_CLOSE,
  RE_ADMONITION_OPEN,
  RE_BLOCKQUOTE,
  RE_COMMENT_BLOCK,
  RE_COMMENT_LINE,
  RE_DEFLIST_TERM,
  RE_DIV_OPEN,
  RE_FENCE,
  RE_FOOTNOTE_DEF,
  RE_HARDBREAKS_OPEN,
  RE_HEADING,
  RE_HR,
  RE_LINE_BLOCK_OPEN,
  RE_ORDERED,
  RE_QUOTE_BLOCK_OPEN,
  RE_RAW_FENCE,
  RE_TABLE_CONT,
  RE_TASK,
  RE_UNORDERED,
  trimStructural,
} from '../parse-prepass-core.js'
import { indentColumns, isBlankLine, Lexer } from '../parse-lexer.js'
import { buildBracketMap } from '../inline/parse-brackets.js'
import { linkDestinationValue } from '../../link-destination.js'
import { isEmptyAttrs, isValidInlineAttrPayload, parseAttrs } from '../../extension/attribute-parser.js'

export const RE_BACKTICK_FENCE_CLOSE_3 = new RegExp('^`{3,}' + FENCE_TRAILING_WS)

export const RE_TILDE_FENCE_CLOSE_3 = new RegExp('^~{3,}' + FENCE_TRAILING_WS)

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
export function fenceCloseRe(marker: string): RegExp {
  if (marker.length === 3) return marker[0] === '`' ? RE_BACKTICK_FENCE_CLOSE_3 : RE_TILDE_FENCE_CLOSE_3
  return new RegExp(`^${marker[0]}{${marker.length},}${FENCE_TRAILING_WS}`)
}

/** True when `line`, already at its container's content column, opens a code or raw fence. */
export function opensCodeFence(line: string): boolean {
  return RE_FENCE.test(line) || RE_RAW_FENCE.test(line)
}

// MARKER REQUIRES CONTENT ignores TRAILING WHITESPACE, and NO TRAILING
// WHITESPACE spells whitespace `' ' | '\t'` here - so a body of nothing but
// tabs is a trailing run and opens no description. `: <TAB>` folds into the
// term, the way `:` + tab already does without the space, and the way an empty
// term marker `:: ` folds (markup-carve/carve#1836).
//
// The separator run is SPACES ONLY, so a body may still START with a tab:
// `: <TAB>text` opens with the tab as content, and a vertical tab or a no-break
// space is content too.
export const RE_DEFLIST_DEF = /^:( +)(?=.*[^ \t])([^ ].*)$/

// A caption line mirrors a heading's first line (§4/§553): `^` + one-or-more
// literal spaces (the grammar delimiter is a space, not a tab) + content that
// carries at least one non-ASCII-whitespace character. Leading spaces are
// folded into the delimiter; `^ ` alone (or `^\t…`) is not a caption, exactly
// as `# ` / `#\t…` is not a heading. "Content" is tested against ASCII
// whitespace only ([ \t\n\r\f]) -- a non-breaking space (U+00A0) is content
// here, as it is everywhere else in the parser, so `^  ` IS a caption.
export const RE_CAPTION = /^\^ +(.*[^ \t\n\r].*)$/

export const RE_BARE_IMAGE = /^ {0,3}!\[([^\]]*)\]\(([^)\s]*)(?: "((?:[^"\\]|\\[\s\S])*)"| '((?:[^'\\]|\\[\s\S])*)')? *\)(?:\{((?:[^}"'\n]|"(?:[^"\\]|\\[\s\S])*"|'(?:[^'\\]|\\[\s\S])*')+)\})?[ \t]*$/

// The same fence seen from a position that CONSUMES it. A comment is recognized
// at any column (carve#624), but where a line ENDS an item or opens a block the
// strict form above still decides, so an indented fence does not close the item
// it sits in.
export const RE_COMMENT_BLOCK_ANY = /^[ \t]*(%{3,})(.*)$/

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
export const commentFenceRun = (line: string): number | undefined => {
  const m = RE_COMMENT_BLOCK_ANY.exec(line)
  return m ? m[1]!.length : undefined
}

// A bare uniform fence closer, shared by native and prepass lookahead.
export const RE_FENCE_CLOSER = new RegExp('^(`{3,}|~{3,})' + FENCE_TRAILING_WS)

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
export interface FenceCloserMemoEntry {
  from: number
  end?: number
  maxRun: number
}

export type QuotedFenceCloserMemo = Map<string, FenceCloserMemoEntry>

/** Whether the memo already proves no closer for `len` of `char` from `start`. */
export function fenceCloserMemoRefutes(
  memo: QuotedFenceCloserMemo,
  char: string,
  len: number,
  start: number,
): boolean {
  const cached = memo.get(char)

  return cached !== undefined && start >= cached.from &&
    (cached.end === undefined || start <= cached.end) && len > cached.maxRun
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

export type BlockQuoteLazyMode =
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

export interface QuoteFenceHosts {
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

// One line of trackQuoteHostFence. Every phase below returns the function's
// verdict, or `undefined` to hand the line to the next phase.
interface QuoteHostLine {
  content: string
  state: BlockQuoteLazyState
  host: QuoteFenceHosts
  hasCloser: (marker: string, column?: number) => boolean
  terminatorFree: boolean
  hasCommentCloser: (width: number, floor: number) => boolean
  wasInTable: boolean
  rejectedItemComment: boolean
  afterComment: boolean
  afterCommentBelow: boolean
  column: number
  text: string
}

// The line after the host markers it opened: `inner` sits at column `at`.
interface QuoteHostBody {
  inner: string
  at: number
  blockStart: boolean
  paragraph: boolean
  insideItem: boolean
  colons: NonNullable<QuoteFenceHosts['colons']>
  floor: number
  pendingColonBody: boolean
}

type QuoteHostVerdict = boolean | undefined

function popQuoteHost(host: QuoteFenceHosts): void {
  host.columns.pop(); host.markers.pop(); host.kinds.pop(); host.terms.pop()
}

// Index past the last entry whose key is at most `limit`; entries are sorted by key.
function upperBound<T>(entries: readonly T[], limit: number, key: (entry: T) => number): number {
  let low = 0
  let high = entries.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (key(entries[middle]!) <= limit) low = middle + 1
    else high = middle
  }
  return low
}

function trackHeldHostFence(q: QuoteHostLine): QuoteHostVerdict {
  const { host, column, text } = q
  const open = host.fence
  if (!open) return undefined
  if (text !== '' && column < open.floor) {
    host.fence = null
    return undefined
  }
  if (
    (column === open.floor || column === open.column) &&
    fenceCloseRe(open.marker).test(text)
  ) host.fence = null
  closeBlockQuoteParagraph(q.state)
  return true
}

function trackHeldColonComment(q: QuoteHostLine): QuoteHostVerdict {
  const { host, state, column, text } = q
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
    if (commentRun !== undefined && q.hasCommentCloser(commentRun, column)) return false
  }
  return undefined
}

function trackLineBlockPayload(q: QuoteHostLine): QuoteHostVerdict {
  const { host, state, column, text } = q
  const literal = host.colons?.at(-1)
  if (!literal?.literal || column < literal.floor) return undefined
  if (literal.opaque) {
    const closedPayload = literal.opaque.closes(text)
    if (text !== '') {
      state.mode = { kind: 'paragraph', absorbingFence: false }
    } else closeBlockQuoteParagraph(state)
    if (closedPayload) delete literal.opaque
    return true
  }
  const group = opaqueGroupCloser(text)
  if (group && (group.belowBaseCloses ? q.hasCommentCloser(group.run, literal.floor) :
    column >= literal.floor &&
    q.hasCloser(group.char.repeat(group.run), literal.floor === 0 ? -2 : -1))) literal.opaque = group
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

function trackHostCommentLine(q: QuoteHostLine): boolean {
  const { host, state, column, text } = q
  if (!blockQuoteParagraphOpen(state) && host.markers.length > 0 && column < host.columns.at(-1)!) {
    while (host.markers.length > 0 && host.markers.at(-1)! >= column) popQuoteHost(host)
    if (host.colons) host.colons = host.colons.filter(open => open.floor <= host.columns.at(-1)!)
    if (host.markers.length === 0) { host.rejectedItemComment = true; closeBlockQuoteParagraph(state); return true }
  }
  const level = Math.max(0, upperBound(host.columns, column, entry => entry) - 1)
  const floor = host.columns[level]!
  const colons = host.colons ?? []
  const open = colons[upperBound(colons, floor, entry => entry.floor) - 1]
  if ((commentFenceRun(text) !== undefined && column < host.columns.at(-1)!) ||
      !(host.kinds[level - 1] === 'item' && open && floor === open.floor && column > open.column)) {
    host.commentBoundary = true
    host.commentBoundaryBelow = commentFenceRun(text) !== undefined && column < host.columns.at(-1)!
  }
  return false
}

// Blank lines, comments and quote markers reset or skip the host stack.
function trackHostResetLine(q: QuoteHostLine): QuoteHostVerdict {
  const { host, text } = q
  if (RE_COMMENT_LINE.test(text)) return trackHostCommentLine(q)
  if (text === '') { if (host.markers.length === 0) host.initialMarkerColumn = undefined; return false }
  if (quotedLineText(q.content, q.terminatorFree) !== null) {
    host.columns = [0]; host.markers = []; host.kinds = []; host.terms = []
    host.colons = []
    host.initialMarkerColumn = undefined
    host.definitionList = undefined
    return false
  }
  return undefined
}

function continuesAfterComment(q: QuoteHostLine): boolean {
  const { host, column, text } = q
  return q.afterComment && host.kinds.at(-1) === 'item' && column > 0 &&
    column < host.columns.at(-1)! &&
    !(!q.afterCommentBelow && opensCodeFence(text) && host.colons?.some(open => open.floor <= column && open.column < column)) &&
    (!lineOpensBlock(text) || isListMarkerLine(text) || column < host.columns[1]! ||
      ((host.colons?.length ?? 0) > 0 && (RE_FENCE.test(text) || RE_RAW_FENCE.test(text))))
}

// Pop hosts the line has left, then push the item, note or description markers it opens.
function openQuoteHosts(q: QuoteHostLine, paragraph: boolean): QuoteHostBody {
  const { host, column, text } = q
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
  while (!lazyItem && host.columns.length > 1 && host.columns.at(-1)! > column) popQuoteHost(host)
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
  return {
    inner, at, blockStart, paragraph, insideItem, colons,
    floor: host.columns.at(-1)!,
    pendingColonBody: colons.at(-1)?.awaitingBody === true,
  }
}

// Track definition terms and lists opened by the line's body.
function trackHostDefinitions(q: QuoteHostLine, b: QuoteHostBody): QuoteHostVerdict {
  const { host, state, column } = q
  const { inner, at, blockStart } = b
  if (blockStart && RE_DEFLIST_TERM.test(inner)) host.terms[host.terms.length - 1] = true
  if (blockStart && host.kinds.at(-1) === 'item' && host.kinds.includes('note') &&
      !opensCodeFence(inner) && colonFenceOpenerLen(inner) === null && !RE_DEFLIST_TERM.test(inner)) {
    closeBlockQuoteParagraph(state)
    return true
  }
  if (RE_DEFLIST_TERM.test(inner)) host.definitionList = at
  else if (host.definitionList !== undefined && column <= host.definitionList &&
    host.kinds.at(-1) !== 'description') host.definitionList = undefined
  return undefined
}

// Colon fences inside a host: close, absorb as paragraph text, or open one.
function trackHostColonFence(q: QuoteHostLine, b: QuoteHostBody): QuoteHostVerdict {
  const { host, state } = q
  const { inner, at, blockStart, colons, floor } = b
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
  if (b.insideItem && open && floor === open.floor && at > open.column && !(q.afterComment && opensCodeFence(inner)) &&
      !hostedAuthoredBlockOpener(inner)) {
    if (q.afterComment && width !== null) {
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
  return undefined
}

function trackHostCodeFence(q: QuoteHostLine, b: QuoteHostBody): QuoteHostVerdict {
  const { host, state, hasCloser } = q
  const { inner, at, blockStart, paragraph, colons, floor } = b
  const code = RE_FENCE.exec(inner)
  const raw = code ? null : RE_RAW_FENCE.exec(inner)
  const marker = code?.[2] ?? raw?.[1] ?? null
  if (!marker || !(floor > 0 || (q.rejectedItemComment && at > 0 && !paragraph))) return undefined
  const colon = colons.at(-1)
  // AN OVER-INDENTED OPENER IS STILL THE HOST'S FENCE. §24 C3 asks a processor
  // to NAME a block opener past the item's canonical content column, not to
  // refuse it, so the host holds its payload exactly as it holds a canonical
  // one - and a flush-left line then reaches no open paragraph. Read as a
  // continuation instead, it put a document-level line inside the fence
  // (carve-js#2350). Its closer may sit at its own column or at the host's.
  const overIndented = at !== floor
  if (blockStart || !paragraph || (b.pendingColonBody && colon && (at === colon.floor || at === colon.column)) ||
    hasCloser(marker, floor) || (overIndented && hasCloser(marker, at))) {
    host.fence = { marker, column: at, floor }
    closeBlockQuoteParagraph(state)
    return true
  }
  return undefined
}

// A block-level line at the host's column ends the quote's open paragraph.
function closesHostParagraph(q: QuoteHostLine, b: QuoteHostBody): boolean {
  const { host, state } = q
  const { inner, at, blockStart, paragraph, floor } = b
  if (!blockStart && at === floor && host.terms.length > 0 &&
      (!paragraph || lineOpensBlock(inner) || RE_DEFLIST_DEF.test(inner) || isBlockAttributeLine(inner)))
    host.terms[host.terms.length - 1] = false
  if (floor <= 0 || at < floor || blockStart || host.terms.at(-1)) return false
  if (RE_BLOCKQUOTE.test(inner) && !markerLineState(inner).leavesParagraphOpen) {
    closeBlockQuoteParagraph(state)
    return true
  }
  const row = isTableRow(inner) || (q.wasInTable && RE_TABLE_CONT.test(inner))
  if (row || RE_HEADING.test(inner) || RE_HR.test(inner) || isLinkDefLine(inner) ||
      (host.kinds.at(-1) === 'item' && RE_DEFLIST_TERM.test(inner)) ||
      (host.kinds.at(-1) !== 'note' && isBlockAttributeLine(inner))) {
    state.inTable = row
    closeBlockQuoteParagraph(state)
    return true
  }
  return false
}

// A line block at the quote's own column holds its payload as inline text.
function openRootLineBlock(b: QuoteHostBody): void {
  if (b.floor === 0 && b.at === 0 && RE_LINE_BLOCK_OPEN.test(b.inner)) {
    b.colons.push({ width: colonFenceOpenerLen(b.inner)!, column: b.at, floor: b.floor, awaitingBody: false, literal: true })
  }
}

export function trackQuoteHostFence(
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
  const q: QuoteHostLine = {
    content, state, host, hasCloser, terminatorFree, hasCommentCloser, wasInTable,
    rejectedItemComment, afterComment, afterCommentBelow,
    column: indentColumns(content),
    text: content.replace(/^[ \t]*/, ''),
  }
  const held = trackHeldHostFence(q) ?? trackHeldColonComment(q) ?? trackLineBlockPayload(q) ?? trackHostResetLine(q)
  if (held !== undefined) return held
  const paragraph = blockQuoteParagraphOpen(state)
  if (continuesAfterComment(q)) {
    state.mode = { kind: 'paragraph', absorbingFence: false }
    return true
  }
  const b = openQuoteHosts(q, paragraph)
  if (state.attrRun !== null || (b.floor > 0 && b.at >= b.floor && opensWrappedAttributeBlock(b.inner))) {
    const closed = trackWrappedAttributeRun(state, b.inner)
    if (closed) {
      closeBlockQuoteParagraph(state)
      return true
    }
    state.hostAttrTracked = true
  }
  const defined = trackHostDefinitions(q, b)
  if (defined !== undefined) return defined
  if (b.blockStart && state.mode.kind === 'paragraph') state.mode.absorbingFence = false
  const colonFence = b.floor > 0 ? trackHostColonFence(q, b) : undefined
  if (colonFence !== undefined) return colonFence
  openRootLineBlock(b)
  const codeFence = trackHostCodeFence(q, b)
  if (codeFence !== undefined) return codeFence
  return closesHostParagraph(q, b)
}

export interface BlockQuoteLazyState {
  hostAttrTracked?: boolean
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

export function demoteQuotedColonCandidates(state: BlockQuoteLazyState): void {
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
export const blockQuoteParagraphOpen = (state: BlockQuoteLazyState): boolean => {
  let level = state
  while (level.mode.kind === 'quote') level = level.mode.inner

  return level.mode.kind === 'paragraph'
}

export const blockQuoteParagraphClaimOpen = blockQuoteParagraphOpen

/** How many quotes are open below the one `state` tracks. */
export const openQuoteDepth = (state: BlockQuoteLazyState): number => {
  let depth = 0
  for (let mode = state.mode; mode.kind === 'quote'; mode = mode.inner.mode) depth++
  return depth
}

export const closeBlockQuoteParagraph = (state: BlockQuoteLazyState): void => {
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
export function trackBlockQuoteLazyState(
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
    level.hostAttrTracked = false
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
export function endsInPlus(text: string): boolean {
  let end = text.length - 1
  while (end >= 0 && (text[end] === ' ' || text[end] === '\t' || text[end] === '\n' || text[end] === '\r')) end--
  return end >= 0 && text[end] === '+'
}

export function quotedLineText(content: string, terminatorFree: boolean): string | null {
  if (!terminatorFree) {
    const quoted = RE_BLOCKQUOTE.exec(content)
    return quoted ? (quoted[1] ?? '') : null
  }
  if (content === '>' || (content.startsWith('>\t') && isBlankLine(content.slice(1)))) return ''

  return content.startsWith('> ') ? content.slice(2) : null
}

/** What one `trackBlockQuoteLazyState` call did below the level it was given. */
export interface QuoteDescent {
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

export function classifyQuotedLine(
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
  if (!state.hostAttrTracked && trackWrappedAttributeRun(state, content)) {
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
  // A footnote body's first block answers, as for every container (carve#3885).
  const note = RE_FOOTNOTE_DEF.exec(content)
  if (note) {
    closeBlockQuoteParagraph(state)
    return classifyQuotedLine(note[2]!, state, hasCommentCloser, hasFenceCloser, () => false, terminatorFree, descent,
      prefixMemo, false, hasLiteralCommentCloser)
  }
  if (leadingWhitespace(content) === 0 && isLinkDefLine(content)) {
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
  // A sibling item that opens a block or holds only a list `+` leaves no paragraph for a lazy line.
  if (wasItemParagraph && isListMarkerLine(content) &&
      (!bottomBlockLeavesParagraphOpen(markerLineBottomBlock(content, prefixMemo)) ||
        markerLineState(content, prefixMemo).bottomIsContinuationMarker)) {
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
export function isBlockImageLine(line: string): boolean {
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
    // A nonempty untitled source ends immediately at `)`. Empty destinations
    // have their own padding slot, while a title permits trailing spaces.
    (m[2] === '' || m[3] !== undefined || m[4] !== undefined ||
      line[line.indexOf('](') + 2 + m[2]!.length] === ')') &&
    // Check the whole line because opaque spans can extend beyond the label.
    buildBracketMap(line)(line.indexOf('[')) === line.indexOf('[') + 1 + m[1]!.length &&
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
export function imageIsBlock(lexer: Lexer): boolean {
  const next = lexer.peek(1)
  if (/^ {1,3}!\[/.test(lexer.peek() ?? '')) {
    return RE_CAPTION.test(next ?? '') ||
      (next !== undefined && isBlankLine(next) && RE_CAPTION.test(lexer.peek(2) ?? ''))
  }
  if (next === undefined || isBlankLine(next) || RE_CAPTION.test(next)) return true
  // Peek-1 interruption: advance past the image line, reuse the paragraph
  // interruption test, then rewind.
  const saved = lexer.pos
  lexer.pos++
  const interrupts = startsInterruptingBlock(lexer)
  lexer.pos = saved
  return interrupts
}

export function colonFenceShapeEndsLazyContinuation(line: string): boolean {
  return (
    (RE_ADMONITION_OPEN.test(line) && !RE_ADMONITION_CLOSE.test(line)) ||
    RE_DIV_OPEN.test(line) ||
    RE_LINE_BLOCK_OPEN.test(line) ||
    RE_HARDBREAKS_OPEN.test(line) ||
    RE_QUOTE_BLOCK_OPEN.test(line)
  )
}

/** The `:` run length of a line that OPENS a colon-fence block, else null. */
export function colonBlockOpenerRun(line: string): number | null {
  const m =
    (RE_ADMONITION_CLOSE.test(line) ? null : RE_ADMONITION_OPEN.exec(line)) ??
    RE_LINE_BLOCK_OPEN.exec(line) ??
    RE_HARDBREAKS_OPEN.exec(line) ??
    RE_QUOTE_BLOCK_OPEN.exec(line) ??
    RE_DIV_OPEN.exec(line)

  return m ? m[1]!.length : null
}

/**
 * How much of the line each prefix step reads before it widens.
 *
 * Large enough that an ordinary marker - indent, marker, task box, space run -
 * is decided in one window, small enough that the per-step copy is a constant
 * rather than the tail it replaced.
 */
export const PREFIX_WINDOW = 32

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
export function prefixWalkBound(content: string): number {
  const nl = content.indexOf('\n')

  return nl === -1 ? content.length : nl + 1
}

// Read the quote prefix without mistaking a partial window for the end of the line.
export function quotePrefixLength(content: string, from: number, bound: number): number {
  if (content[from] !== '>') return 0
  if (from + 1 === bound) return 1
  if (content[from + 1] === ' ') return 2
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
export function markerPrefixLength(content: string, from: number, bound: number): number {
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
export function walkContainerPrefix(content: string, memo?: Map<number, number>): number {
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
export function markerLineQuoteState(content: string, memo?: Map<number, number>): BlockQuoteLazyState | null {
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
export function markerLineBottomBlock(content: string, memo?: Map<number, number>): string {
  // `> > # H` is the quote's question twice over, and `- - # H` is the
  // sub-item's, whose first block is the heading exactly as a bare `- # H`'s
  // is - so the strip runs to the bottom of the stack. It is a WALK BY OFFSET:
  // every regex it consults is anchored with `$`, so re-slicing the remainder
  // per marker cost O(N * line length) on a line of N markers (carve-js#1190).
  const walked = walkContainerPrefix(content, memo)

  return walked === 0 ? content : content.slice(walked)
}

export function markerLineState(content: string, memo?: Map<number, number>): {
  leavesParagraphOpen: boolean
  endsOnTableRow: boolean
  bottomIsContinuationMarker: boolean
  wrappedAttributeRun: string | null
  quote: BlockQuoteLazyState | null
} {
  const bottom = markerLineBottomBlock(content, memo)
  // A footnote body's first block answers, as for every container (carve#3885).
  const note = RE_FOOTNOTE_DEF.exec(bottom)
  if (note) return markerLineState(note[2]!)
  const quote = markerLineQuoteState(content, memo)
  const fenceShaped = RE_FENCE.test(bottom) || RE_RAW_FENCE.test(bottom) ||
    colonFenceShapeEndsLazyContinuation(bottom)
  let hasNestedQuote = false
  if ((fenceShaped || isContinuationMarker(bottom)) && quote === null) {
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

  const bottomIsContinuationMarker = quote === null && !hasNestedQuote && isContinuationMarker(bottom)
  return {
    leavesParagraphOpen: bottomIsContinuationMarker || (quote !== null || hasNestedQuote) && fenceShaped
      ? false : bottomBlockLeavesParagraphOpen(bottom),
    endsOnTableRow: quote === null && isTableRow(bottom),
    // A bare `+` at the bottom of the marker line is the CONTINUATION MARKER
    // (§17 L3), and what it names is a document-column-0 block. It is not
    // prose, so it opens no paragraph an INDENTED line could fold into - see
    // the fold branch that reads this (markup-carve/carve#1436).
    // A stacked quote's `+` (`- - > +`) is quote text when refused, which a lazy line continues.
    bottomIsContinuationMarker,
    wrappedAttributeRun: opensWrappedAttributeBlock(bottom) ? bottom : null,
    quote,
  }
}

export function bottomBlockLeavesParagraphOpen(rest: string): boolean {
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
  const note = RE_FOOTNOTE_DEF.exec(rest)
  if (note) return bottomBlockLeavesParagraphOpen(note[2]!)
  if (isLinkDefLine(rest)) return false
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
export function opensWrappedAttributeBlock(content: string): boolean {
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
export function continueWrappedAttributeBlock(
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
export function trackWrappedAttributeRun(
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

/**
 * From a fence opener (` ``` ` / `~~~` / raw) at peek(0), is there a matching
 * closing fence ahead? Used by startsInterruptingBlock so an UNTERMINATED
 * fence does NOT interrupt a paragraph (§10 CLOSER LOOKAHEAD): a stray ``` in
 * prose stays paragraph text instead of swallowing the rest of the block. The
 * negative cache (noFenceCloserFrom) keeps "many unclosed fences" input linear.
 */
export function fenceHasCloser(lexer: Lexer, marker: string, literalPayload = false): boolean {
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
export function startsInterruptingBlock(
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
export function opensSublistHere(lexer: Lexer, ln: string, i: number, enabled: boolean): boolean {
  if (!enabled || !lexer.markerOpensSublist || i !== 0) return false
  return (
    RE_TASK.test(ln) || RE_UNORDERED.test(ln) || RE_ORDERED.test(ln) || extractItemAttr(ln) !== null
  )
}

export function hostedAuthoredBlockOpener(text: string): boolean {
  return RE_FENCE.test(text) || RE_RAW_FENCE.test(text) || RE_HEADING.test(text) ||
    RE_BLOCKQUOTE.test(text) || RE_HR.test(text) || isTableRow(text) ||
    (!RE_ADMONITION_CLOSE.test(text) && colonBlockOpenerRun(text) !== null)
}

/**
 * The closer test for the opaque group this line opens, or null for a line that
 * opens none. A code or raw fence closes on a run of at least its own length, a
 * comment fence on one of exactly its own (PART 9 §28).
 */
export interface OpaqueGroup {
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

export function opaqueGroupCloser(line: string): OpaqueGroup | null {
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
