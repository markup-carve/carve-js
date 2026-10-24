import {
  collectLiteralColonFenceBody,
  markerContentColumn,
  markerFreeContent,
  orderedMatch,
  quotedCommentHasCloser,
  quotedFenceHasCloser,
  taskMatch,
  unorderedMatch,
} from './parse-block-scan-core.js'
import { indentColumns, isBlankLine, Lexer, sliceColumns } from '../parse-lexer.js'
import { createListStateTracker } from '../list/parse-list-state.js'
import {
  extractItemAttr,
  isBlockAttributeLine,
  isContinuationMarker,
  isLinkDefLine,
  isListMarkerLine,
  isTableRow,
  LAZY_FRAME,
  leadingWhitespace,
  lineOpensBlock,
  peekBlockAttributes,
  RE_ADMONITION_CLOSE,
  RE_ADMONITION_OPEN,
  RE_BLOCKQUOTE,
  RE_COMMENT_LINE,
  RE_DEFLIST_TERM,
  RE_DIV_OPEN,
  RE_FENCE,
  RE_FOOTNOTE_DEF,
  RE_HARDBREAKS_OPEN,
  RE_HEADING,
  RE_HR,
  RE_LINE_BLOCK_OPEN,
  RE_LINK_DEF,
  RE_ORDERED,
  RE_QUOTE_BLOCK_OPEN,
  RE_RAW_FENCE,
  RE_TABLE_CONT,
  RE_TASK,
  RE_UNORDERED,
  stripLazyFrame,
} from '../parse-prepass-core.js'
import {
  type BlockQuoteLazyState,
  blockQuoteParagraphOpen,
  bottomBlockLeavesParagraphOpen,
  colonBlockOpenerRun,
  colonFenceOpenerLen,
  colonFenceShapeEndsLazyContinuation,
  commentFenceRun,
  demoteQuotedColonCandidates,
  fenceCloseRe,
  hostedAuthoredBlockOpener,
  isBlockImageLine,
  markerLineQuoteState,
  markerLineState,
  markerPrefixLength,
  type OpaqueGroup,
  opaqueGroupCloser,
  opensCodeFence,
  opensWrappedAttributeBlock,
  prefixWalkBound,
  type QuotedFenceCloserMemo,
  quotedLineText,
  RE_CAPTION,
  RE_DEFLIST_DEF,
  RE_FENCE_CLOSER,
  startsInterruptingBlock,
  trackBlockQuoteLazyState,
  trackWrappedAttributeRun,
} from './parse-quote-core.js'
import { createRebasePass } from '../parse-rebase.js'

// A footnote body's own column: the indent §16 requires of a continuation line.
// The body is dedented by exactly this much, never by the first continuation
// line's actual indent - see `parseFootnoteDef` (carve-js#677).
export const FOOTNOTE_BODY_COLUMN = 2

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
export function dropTrailingWhitespace(text: string): string {
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

/**
 * Which half of a definition-list entry the item's tracker last saw open: the
 * TERM (a `::` line), its DESCRIPTION body (a `:` line), or neither.
 */
export type DefListOpening = false | 'term' | 'description'

export type ItemOpaqueState =
  | { kind: 'code'; close: RegExp; column?: number }
  | { kind: 'comment'; length: number; paragraphBefore: boolean; atColumn: boolean; term?: boolean }

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
export function insideOpenFence(state: ItemLazyState): boolean {
  return state.opaque !== null || state.divDepth > 0
}

/** An `ItemLazyState` that has seen nothing, for a collector that only reads fences. */
export function verbatimOnlyLazyState(): ItemLazyState {
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
export function sourceQuotePrefixEnd(line: string, start: number): number {
  let end = start
  while (line[end] === ' ' || line[end] === '\t') end++
  if (line[end] !== '>') return -1
  end++
  if (line[end] === ' ') end++
  else if (line[end] !== undefined && line[end] !== '\r' && line[end] !== '\n' &&
    !(line[end] === '\t' && /^[\t ]*$/.test(line.slice(end)))) return -1
  return end
}

export function quotePrefixDepth(line: string): number {
  let depth = 0
  for (let offset = 0, end = sourceQuotePrefixEnd(line, offset); end >= 0; end = sourceQuotePrefixEnd(line, offset)) {
    depth++
    offset = end
  }
  return depth
}

export function sourceColumn(line: string, quoteLevels = Infinity): number {
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
export const RE_INVISIBLE_BLOCK_LEAD = /^[ \t]*[%[]/

/**
 * Is `content` more text of a paragraph that holds an unclosed fence run?
 *
 * A line that opens a block ends that paragraph instead (section 10), and the
 * block may be a closed one that leaves nothing for a below-column line to
 * continue (CARVE-P0-009). `base` is the column the unclosed run was authored
 * at: a line at exactly that column was rebased with it and is read flush.
 */
export function continuesInlineFenceParagraph(content: string, base: number | undefined, terminatorFree: boolean): boolean {
  if (!bottomBlockLeavesParagraphOpen(content)) return false
  const text = content.trimStart()
  if (opensCodeFence(text)) return false
  if (markerPrefixLength(text, 0, prefixWalkBound(text)) > 0 || quotedLineText(text, terminatorFree) !== null) return false
  const atBase = base !== undefined && base > 0 && text !== content && indentColumns(content, base + 1) === base
  return !atBase || bottomBlockLeavesParagraphOpen(text)
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
export function openVerbatimRun(text: string, from = 0): number {
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

export function readCaptionText(
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

export function endsHeadingOrQuote(lexer: Lexer): boolean {
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
 * The next line after `index` holding a comment fence of exactly `width`, or
 * -1. Indexed once, so a closer is found without rescanning per opener.
 */
export function commentCloserLookup(lines: readonly string[], stripQuotes = true): (width: number, index: number) => number {
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

// CARVE-P0-004, CARVE-P0-011: in a list item's colon body a link definition or an
// attribute line past the box's column also opens on its authored base (carve#3087).
export function hostedColonBodyOpener(text: string): boolean {
  return hostedAuthoredBlockOpener(text) || (isLinkDefLine(text) && !RE_FOOTNOTE_DEF.test(text)) || isBlockAttributeLine(text.trimEnd())
}

/** Whether a line starts an authored block outside the body's first sublist. */
export function isParentAuthoredBlock(line: string, firstMarkerColumn: number, followsBlank = false): boolean {
  const column = indentColumns(line, firstMarkerColumn)
  if (column >= firstMarkerColumn) return false
  const opener = sliceColumns(line, column, true)
  return markerContentColumn(opener) < 0 && (column === 0 ? (hostedAuthoredBlockOpener(opener) && !opensCodeFence(opener)) || (followsBlank && !RE_COMMENT_LINE.test(opener)) : lineOpensItemBlock(opener))
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
export const groupLineContent = (line: string, base: number): string =>
  indentColumns(line, base) >= base ? sliceColumns(line, base, true) : line.replace(/^[ \t]+/, '')

/** Does an opaque group opened here find its closer further down? */
export function opaqueGroupCloses(
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
export const closerReachesBase = (index: number, folded: ReadonlySet<number> | undefined): boolean =>
  folded?.has(index) !== true

// Skip a quote's marked lines and lazy paragraph continuation during rebasing.
export function rebasedQuoteEnd(lines: string[], start: number, quote: Lexer): number {
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

export function sourceCodeFenceEnd(
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
export function rebasedCodeFenceEnd(
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

// Mutable state of one rebasedColonGroupEnd scan. `candidate` and
// `authoredColumn` are per-line; the rest lives across the scan.
interface ColonGroupScan {
  lines: string[]
  base: number
  heldFoldedLines: Set<number>
  findCommentCloser: (width: number, index: number) => number
  closerMemo: GroupCloserMemo
  takenBelowColumn: ReadonlySet<number> | undefined
  nestedBodyLines: Set<number> | undefined
  usesHostMinimum: boolean
  emptyHostMinimum: boolean
  preserveNestedNoteColumn: boolean
  holdsFoldedLines: boolean
  stack: { width: number; literal: boolean }[]
  // The opaque group open inside this container, if any. Only the hold below
  // consults it: a folded line inside a verbatim or comment payload is that
  // payload's, and its delimiter has to travel with the dedent.
  opaque: OpaqueGroup | null
  // Colon bodies keep the indentation host's minimum even when their opener
  // has a deeper authored base. Child blocks use that minimum for ownership.
  // Rebase them during the existing scan before the outer body skips them.
  authored: { column: number; paragraph: boolean }[]
  authoredInlineFence: boolean
  authoredCodeClose: RegExp | undefined
  authoredCodeAdjustment: number
  authoredBelowBaseRun: boolean
  authoredChildColumn: number
  authoredChildBlank: boolean
  authoredChildBlockBoundary: boolean
  // CARVE-P0-009: a child that leaves no paragraph open lets a fence below its column leave it.
  authoredChildState: ItemLazyState | undefined
  childCloserMemos: Map<number, GroupCloserMemo>
  candidate: string
  authoredColumn: number | undefined
}

function childFenceCloses(s: ColonGroupScan, j: number): (marker: string, extraColumns?: number) => boolean {
  return (marker, extraColumns = 0) => {
    const group = opaqueGroupCloser(marker)
    if (group === null) return false
    const column = s.authoredChildColumn + extraColumns
    let memo = s.childCloserMemos.get(column)
    if (memo === undefined) s.childCloserMemos.set(column, memo = { verbatim: new Map(), comment: new Map() })
    return opaqueGroupCloses(group, s.lines, j + 1, column, s.takenBelowColumn, memo)
  }
}

// Follow an authored list child opened inside the colon body until a line leaves it.
function trackAuthoredChildLine(s: ColonGroupScan, j: number): void {
  const candidate = s.candidate
  const trimmed = candidate.trimStart()
  if (s.opaque === null && RE_COMMENT_LINE.test(trimmed) &&
      (commentFenceRun(trimmed) === undefined ||
        indentColumns(candidate, s.authoredChildColumn) >= s.authoredChildColumn)) s.authoredChildBlockBoundary = true
  if (isBlankLine(candidate)) {
    s.authoredChildBlank = true
    return
  }
  if (s.opaque !== null || !(s.authoredChildBlank || hostedAuthoredBlockOpener(trimmed) || RE_ADMONITION_CLOSE.test(trimmed))) return
  const column = s.authoredColumn = indentColumns(candidate, s.authoredChildColumn)
  const childState = s.authoredChildState
  const childClosed = childState !== undefined && !childState.lazyFoldable && !insideOpenFence(childState)
  const ownerColumn = s.authored.at(-1)!.column
  if (column < s.authoredChildColumn && (s.authoredChildBlank ||
      ((column === ownerColumn && lineOpensItemBlock(trimmed)) ||
        (column > ownerColumn && (colonFenceOpenerLen(trimmed) !== null ||
          ((s.authoredChildBlockBoundary || childClosed) && opensCodeFence(trimmed))))))) {
    s.authoredChildColumn = -1
    return
  }
  if (column < s.authoredChildColumn || childState === undefined) return
  trackItemLazyState(sliceColumns(candidate, s.authoredChildColumn, true), childState, childFenceCloses(s, j))
  // The line block closer still closes its child when an unmatched code
  // run in that child was read as inline text.
  const closer = RE_ADMONITION_CLOSE.exec(trimmed)
  if (closer && column === s.authoredChildColumn &&
      closer[1]!.length === childState.literalColon?.width) {
    delete childState.literalColon
    childState.divDepth = Math.max(0, childState.divDepth - 1)
    childState.lazyFoldable = false
  }
}

// Shift a line of an authored code fence by the fence's own rebase.
function rebaseAuthoredCodeLine(s: ColonGroupScan, j: number, authoredCodeClose: RegExp): void {
  let candidate = s.candidate
  const adjustment = s.authoredCodeAdjustment
  if (adjustment > 0 && indentColumns(candidate, adjustment) < adjustment &&
      opensCodeFence(candidate.trimStart())) s.authoredBelowBaseRun = true
  if (adjustment !== 0 && !s.takenBelowColumn?.has(j) &&
      !(s.authoredBelowBaseRun && indentColumns(candidate, adjustment) < adjustment)) {
    candidate = adjustment < 0
      ? ' '.repeat(-adjustment) + candidate
      : sliceColumns(candidate, Math.min(adjustment, indentColumns(candidate)), true)
    s.lines[j] = s.candidate = candidate
  }
  if (indentColumns(candidate, s.base + 1) === s.base && authoredCodeClose.test(groupLineContent(candidate, s.base))) {
    s.authoredCodeClose = undefined
    s.authoredBelowBaseRun = false
  }
}

function rebasesAuthoredBody(s: ColonGroupScan): boolean {
  return s.nestedBodyLines !== undefined && s.opaque === null && !s.authoredCodeClose &&
    s.stack.length === s.authored.length && s.authoredChildColumn < 0 &&
    !s.stack.at(-1)!.literal && !s.authoredInlineFence
}

// Open an authored list child at the marker's content column; returns that column or -1.
function openAuthoredChild(s: ColonGroupScan, j: number, column: number, text: string): number {
  const markerColumn = /^[*+\-0-9A-Za-z]/.test(text) ? markerContentColumn(text, false, 0) : -1
  if (markerColumn < 0) return -1
  s.authoredChildColumn = column + markerColumn
  s.authoredChildBlank = false
  s.authoredChildBlockBoundary = false
  s.authoredChildState = verbatimOnlyLazyState()
  trackItemLazyState(text.slice(markerColumn), s.authoredChildState, childFenceCloses(s, j))
  return s.authoredChildColumn
}

// Record an authored code fence: inline text inside an open paragraph, or a rebased fence.
function trackAuthoredBodyFence(
  s: ColonGroupScan,
  j: number,
  column: number,
  text: string,
  owner: { column: number; paragraph: boolean },
): void {
  const code = RE_FENCE.exec(text) ?? RE_RAW_FENCE.exec(text)
  if (!code) return
  if (column === owner.column && owner.paragraph &&
      !opaqueGroupCloses(opaqueGroupCloser(text)!, s.lines, j + 1, column, s.takenBelowColumn, s.closerMemo)) s.authoredInlineFence = true
  if (column >= owner.column && (column > owner.column ||
      opaqueGroupCloses(opaqueGroupCloser(text)!, s.lines, j + 1, column, s.takenBelowColumn, s.closerMemo))) {
    s.authoredCodeClose = fenceCloseRe(RE_FENCE.test(text) ? code[2]! : code[1]!)
    s.authoredCodeAdjustment = column - s.base
    s.authoredBelowBaseRun = false
  }
}

// Rebase a colon-body line from its authored column onto the host minimum.
function rebaseAuthoredBodyLine(s: ColonGroupScan, j: number): void {
  const authored = s.authored
  const base = s.base
  const column = s.authoredColumn ??= indentColumns(s.candidate, hostedColonBodyOpener(s.candidate.trimStart()) ? Infinity : authored.at(-1)!.column + 4)
  while (!isBlankLine(s.candidate) && authored.length > 1 && column < authored.at(-1)!.column) authored.pop()
  const owner = authored.at(-1)!
  const rebasesHere = !s.emptyHostMinimum || !owner.paragraph || column >= base
  const text = sliceColumns(s.candidate, column, true)
  const childColumn = openAuthoredChild(s, j, column, text)
  if (rebasesHere) trackAuthoredBodyFence(s, j, column, text, owner)
  const closeRun = RE_ADMONITION_CLOSE.exec(text)
  const closesOwner = closeRun?.[1]?.length === s.stack.at(-1)!.width
  if (rebasesHere && s.authoredChildColumn < 0 && !closesOwner &&
      (column >= owner.column && (closeRun === null || column === owner.column) && colonBlockOpenerRun(text) !== null)) {
    authored.push({ column, paragraph: false })
  }
  const current = authored.at(-1)!
  const blockColumn = column > current.column && hostedColonBodyOpener(text) && childColumn < 0 ? column : current.column
  if (rebasesHere && blockColumn !== base && column >= blockColumn &&
      !(s.preserveNestedNoteColumn && RE_FOOTNOTE_DEF.test(text.trimStart())) &&
      (blockColumn > base || s.usesHostMinimum && hostedAuthoredBlockOpener(text))) {
    s.candidate = blockColumn < base
      ? ' '.repeat(base - blockColumn) + s.candidate
      : sliceColumns(s.candidate, blockColumn - base, true)
    s.lines[j] = s.candidate
    s.authoredColumn = undefined
  }
  if (closesOwner && column === current.column) {
    if (authored.length > 1) authored.pop()
    authored.at(-1)!.paragraph = false
  } else current.paragraph = !isBlankLine(s.candidate) &&
    !(column === current.column && lineOpensItemBlock(text))
}

// Dedent a literal line block's body from its authored column.
function rebaseLiteralBodyLine(s: ColonGroupScan, j: number): void {
  const current = s.authored.at(-1)!
  const column = indentColumns(s.candidate, current.column + 1)
  if (column < current.column) return
  const text = sliceColumns(s.candidate, current.column, true)
  s.candidate = sliceColumns(s.candidate, current.column - s.base, true)
  s.lines[j] = s.candidate
  s.authoredColumn = undefined
  if (column === current.column && RE_ADMONITION_CLOSE.test(text)) s.authored.pop()
}

// Track opaque payloads and the colon stack for one body line; true once the group closed.
function trackColonGroupLine(s: ColonGroupScan, j: number): boolean {
  const { candidate, base, stack, takenBelowColumn } = s
  const column = s.authoredColumn === undefined ? indentColumns(candidate, base) : Math.min(s.authoredColumn, base)
  // THE OPAQUE GROUP IS TRACKED BEFORE THE COLUMN TEST, because its closing
  // run may be written below the base and this pass still has to know the
  // payload ended there.
  const insideOpaque = s.opaque !== null
  if (
    s.opaque !== null &&
    (s.opaque.belowBaseCloses || closerReachesBase(j, takenBelowColumn)) &&
    s.opaque.closes(groupLineContent(candidate, base))
  ) {
    s.opaque = null
  }
  // A below-base run is payload unless it closes at the container's own column.
  if (column < base) {
    const closesAtColumn =
      column === 0 &&
      RE_ADMONITION_CLOSE.exec(candidate)?.[1]?.length === stack.at(-1)!.width
    if (!closesAtColumn) return false
  }
  const local = column === 0 ? candidate : sliceColumns(candidate, base, true)
  if (insideOpaque) {
    return false
  } else if (s.holdsFoldedLines && takenBelowColumn?.has(j) === true) {
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
    s.heldFoldedLines.add(j)
    return false
  } else if (column >= base) {
    // ONLY A FENCE THAT CLOSES OPENS A PAYLOAD (§10 I4 for the verbatim
    // kinds, §28 for the comment one). Without the lookahead an
    // unterminated run made every line after it payload, which handed a
    // folded heading, rule or quote marker to the dedent again.
    //
    const group = opaqueGroupCloser(local)
    if (group !== null && (group.belowBaseCloses
      ? s.findCommentCloser(group.run, j) > j
      : opaqueGroupCloses(group, s.lines, j + 1, base, takenBelowColumn, s.closerMemo))) {
      s.opaque = group
    }
  }
  const run = RE_ADMONITION_CLOSE.exec(local)
  if (run && stack.at(-1)!.width === run[1]!.length) {
    stack.pop()
    return stack.length === 0
  }
  if (!stack.at(-1)!.literal) {
    const opener = colonBlockOpenerRun(local)
    if (opener !== null) stack.push({ width: opener, literal: RE_LINE_BLOCK_OPEN.test(local) })
  }
  return false
}

// Find a colon group's extent while retaining folded-line ownership.
export function rebasedColonGroupEnd(
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
  const s: ColonGroupScan = {
    lines,
    base,
    heldFoldedLines,
    findCommentCloser,
    closerMemo,
    takenBelowColumn,
    nestedBodyLines,
    usesHostMinimum,
    emptyHostMinimum,
    preserveNestedNoteColumn,
    holdsFoldedLines: base > 0 && takenBelowColumn !== undefined && takenBelowColumn.size > 0,
    stack: [{ width, literal: RE_LINE_BLOCK_OPEN.test(groupLineContent(lines[start]!, base)) }],
    opaque: null,
    authored: [{ column: usesHostMinimum ? 0 : base, paragraph: false }],
    authoredInlineFence: false,
    authoredCodeClose: undefined,
    authoredCodeAdjustment: 0,
    authoredBelowBaseRun: false,
    authoredChildColumn: -1,
    authoredChildBlank: false,
    authoredChildBlockBoundary: false,
    authoredChildState: undefined,
    childCloserMemos: new Map(),
    candidate: '',
    authoredColumn: undefined,
  }
  for (let j = start + 1; j < lines.length; j++) {
    s.candidate = lines[j]!
    s.authoredColumn = undefined
    const insideAuthoredCode = s.authoredCodeClose !== undefined
    if (nestedBodyLines && s.authoredChildColumn >= 0) trackAuthoredChildLine(s, j)
    if (s.authoredCodeClose) rebaseAuthoredCodeLine(s, j, s.authoredCodeClose)
    else if (rebasesAuthoredBody(s)) rebaseAuthoredBodyLine(s, j)
    if (nestedBodyLines && s.stack.at(-1)!.literal && s.authored.at(-1)!.column > base) rebaseLiteralBodyLine(s, j)
    if (s.stack.length > 1) nestedBodyLines?.add(j)
    end = j
    // The container parses its own list markers after paragraph folding.
    // They must not split the host item's collected stream (carve#2474).
    onFenceBodyLine?.(j)
    if (isBlankLine(s.candidate) || insideAuthoredCode) continue
    if (trackColonGroupLine(s, j)) break
  }
  return end
}

export function markerNoteFenceReach(lines: readonly string[], absorbedMarkers: ReadonlySet<number>, comments: ReadonlySet<number>): 'closed' | 'unclosed' | 'boundary' | null {
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

export function markerNoteCommentFenceOpeners(lines: readonly string[], absorbedMarkers: ReadonlySet<number>, comments: ReadonlySet<number>, outerTailOnly = false): number[] {
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
export function coveredNoteComment(lexer: Lexer, line: string, floor: number): number {
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
export function markerNoteOpenerReach(lines: readonly string[], absorbedMarkers: ReadonlySet<number>, comments: ReadonlySet<number>): 'open' | 'closed' | null {
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
export function lineOpensItemBlock(line: string): boolean {
  return lineOpensBlock(line) || isBlockAttributeLine(line) || isBlockImageLine(line)
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

export const trackItemLazyState = createListStateTracker(listStateHelpers)

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

export const rebaseOverindentedBlocks = createRebasePass(rebaseHelpers)
