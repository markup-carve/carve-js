import type { ItemLazyState, ItemLineFacts, BlockQuoteLazyState } from '../../parse.js'
import { isBlankLine, sliceColumns } from '../parse-lexer.js'
import type { listStateHelpers } from '../../parse.js'

export type FenceCloser = (marker: string, extraColumns?: number) => boolean
export type CommentCloser = (fence: number) => boolean
export type LiteralCommentCloser = (width: number, extraColumns?: number) => boolean

/**
 * One line on its way through the tracker's phases.
 *
 * `content`, `facts` and `hasFenceCloser` are rebased in place by the phases
 * that move the line into an authored container's coordinates; every later
 * phase reads the rebased values. The `was*` fields are what the previous line
 * left behind, captured before this line resets them.
 */
export interface LazyLine {
  content: string
  readonly state: ItemLazyState
  hasFenceCloser: FenceCloser
  readonly atContentColumn: boolean
  readonly hasCommentCloser: CommentCloser
  facts: ItemLineFacts | undefined
  readonly hasLiteralCommentCloser: LiteralCommentCloser | undefined
  readonly authoredFenceColumns: number | undefined
  readonly authoredFenceWhitespace: number | undefined
  readonly authoredQuoteParagraphOpen: boolean
  readonly wasDescendantColumn: boolean
  readonly wasAbsorbing: boolean
  readonly wasInlineFence: boolean
  readonly wasInlineFenceBlock: boolean
  readonly wasClosedColon: boolean
  readonly wasClosedLiteralComment: boolean
  readonly wasInTable: boolean
  readonly wasQuote: BlockQuoteLazyState | null
  readonly quoteOwnerColumn: number
  readonly wasInvisibleAtColumn: boolean
  readonly wasBelowComment: boolean
  readonly wasCommentAtColumn: boolean
  run: number | undefined
  runColumns: number | undefined
  readFlush: boolean
  readDescendant: boolean
}

/** A phase returns true when it has decided the line and the rest are skipped. */
export type LazyPhase = (line: LazyLine) => boolean

export type TrackItemLazyState = (
  content: string,
  state: ItemLazyState,
  hasFenceCloser?: FenceCloser,
  atContentColumn?: boolean,
  hasCommentCloser?: CommentCloser,
  facts?: ItemLineFacts,
  hasLiteralCommentCloser?: LiteralCommentCloser,
  authoredFenceColumns?: number,
  authoredFenceWhitespace?: number,
  authoredQuoteParagraphOpen?: boolean,
) => void

/** Ends the line on a block that leaves no paragraph and no description open. */
export function endsOnBlock(state: ItemLazyState): true {
  state.lazyFoldable = false
  state.inDefList = false
  return true
}

/** The tracker phases that decide who owns a run written past the item's content column. */
export function createRunPhases(helpers: typeof listStateHelpers, trackItemLazyState: TrackItemLazyState) {
  const {
    FOOTNOTE_BODY_COLUMN,
    RE_BLOCKQUOTE,
    RE_COMMENT_LINE,
    RE_FENCE,
    RE_FOOTNOTE_DEF,
    RE_HEADING,
    RE_HR,
    RE_LINE_BLOCK_OPEN,
    RE_RAW_FENCE,
    blockQuoteParagraphOpen,
    bottomBlockLeavesParagraphOpen,
    colonBlockOpenerRun,
    colonFenceOpenerLen,
    fenceCloseRe,
    hostedAuthoredBlockOpener,
    isBlockAttributeLine,
    isTableRow,
    lineOpensBlock,
    markerLineState,
    markerPrefixLength,
    opensCodeFence,
    opensWrappedAttributeBlock,
    prefixWalkBound,
    verbatimOnlyLazyState,
  } = helpers

  // AN OVER-INDENTED LEAF BLOCK LEAVES NO OPEN PARAGRAPH. The three arms below
  // are column-0 strict (§24 C3), and a block the author wrote PAST the item's
  // content column still carries that run, so it read as prose and left a
  // paragraph the block does not have - `- p` / `    # H` / `x` kept `x` inside
  // the item where the heading had already ended it (carve-js#2542).
  //
  // Only when the run is AUTHORED, which `ownedColumn` decides, in the two
  // senses `rebaseOverindentedBlocks` already holds it: a NESTED MARKER owns
  // every line at or past its content column, because they are the deeper
  // item's; an AUTHORED BASE owns only the lines PAST it, because a line AT the
  // base is more of the same block. Reading either flush erases a level.
  //
  // Every step here is O(1) off the run the lexer already measured, so the
  // ladder stays linear (carve#752's counted bound). A caller that cannot
  // report the run leaves the whole arm shut rather than measuring one.
  function measureRun(line: LazyLine): boolean {
    line.run = line.authoredFenceWhitespace ?? line.facts?.whitespace
    // A tab opener reports its run in characters; ownership compares columns.
    line.runColumns = line.authoredFenceColumns ?? line.run
    return false
  }

  function overIndentedTableRow(line: LazyLine): boolean {
    const { content, state, run, runColumns, wasQuote } = line
    if (!line.atContentColumn || state.opaque !== null || line.authoredQuoteParagraphOpen) return false
    if (wasQuote !== null && blockQuoteParagraphOpen(wasQuote)) return false
    if (run === undefined || runColumns === undefined || runColumns <= 0 || !isTableRow(content.slice(run))) return false
    state.inTable = true
    return endsOnBlock(state)
  }

  /** An over-indented run under an open definition description. */
  function overIndentedDescription(line: LazyLine): boolean {
    const { content, state, run, runColumns } = line
    if (state.inDefList !== 'description') return false
    if (state.descriptionHasTerm && run !== undefined && runColumns !== undefined && runColumns > 0 &&
        RE_HEADING.test(content.slice(run))) return endsOnBlock(state)
    if (state.descriptionColumn !== undefined &&
        runColumns !== undefined && runColumns > 0 && runColumns < state.descriptionColumn &&
        (colonBlockOpenerRun(content.slice(run!)) !== null || RE_BLOCKQUOTE.test(content.slice(run!)))) {
      state.inDefList = false
      return false
    }
    if (run !== undefined && run > 0 && (isTableRow(content.slice(run)) || RE_HR.test(content.slice(run)))) {
      state.lazyFoldable = false
      state.inDefList = false
      state.inTable = isTableRow(content.slice(run))
      return true
    }
    if (!state.descriptionHasTerm || state.descriptionColumn === undefined ||
        run === undefined || runColumns === undefined || runColumns < state.descriptionColumn) return false
    const text = content.slice(run)
    // A deeper authored run can still belong to the description's inline fence paragraph.
    if (!(RE_HEADING.test(text) || RE_HR.test(text) || isTableRow(text) ||
        (isBlockAttributeLine(text) && !(state.ownedAuthored && state.ownedColumn > state.descriptionColumn)) ||
        colonFenceOpenerLen(text) !== null || RE_BLOCKQUOTE.test(text))) return false
    state.ownedColumn = state.descriptionColumn
    state.ownedAuthored = false
    const inner = state.deepest = verbatimOnlyLazyState()
    inner.definitionBody = true
    trackItemLazyState(text, inner)
    state.lazyFoldable = inner.lazyFoldable
    state.inTable = inner.inTable
    state.inDefList = false
    return true
  }

  /** Decides who owns an over-indented run: a descendant frame, this item flush, or neither. */
  function runOwnership(line: LazyLine): boolean {
    const { content, state, run, runColumns, facts } = line
    if (run === undefined || runColumns === undefined) return false
    if (state.ownedColumn >= 0) {
      if (runColumns < state.ownedColumn) {
        if (releaseOwnedColumn(line, run)) return true
      } else if (state.ownedAuthored && (runColumns === state.ownedColumn ||
          (state.authoredColon !== undefined && runColumns > state.authoredColon.column && hostedAuthoredBlockOpener(content.slice(run))) || (state.divDepth === 0 &&
          colonFenceOpenerLen(content.slice(run)) !== null))) line.readFlush = true
      else if (!state.ownedAuthored && (facts?.descendantFrames === true || line.authoredFenceColumns !== undefined)) line.readDescendant = true
    }
    if (state.ownedColumn < 0 && line.atContentColumn && run > 0 &&
        (state.unclosedFenceBase === undefined || runColumns === state.unclosedFenceBase)) {
      state.ownedColumn = runColumns
      state.ownedAuthored = true
      line.readFlush = true
    }
    return false
  }

  /** A run that falls short of the owned column leaves the owner, unless the owner's paragraph takes it. */
  function releaseOwnedColumn(line: LazyLine, run: number): boolean {
    const { content, state, facts } = line
    const text = content.slice(run)
    const marker = markerPrefixLength(text, 0, prefixWalkBound(text)) > 0
    const rebased = facts?.rebasedFrame === true
    if (!state.literalLayout && !rebased && !state.ownedAuthored && (state.deepest?.ownedColumn ?? -1) < 0 &&
        (state.deepest?.commentAtColumn || line.wasCommentAtColumn) && marker) {
      state.retainedMarker = true
      state.lazyFoldable = false
      state.commentAtColumn = false
      return true
    }
    if (!rebased && !state.ownedAuthored && state.deepest?.lazyFoldable && state.lazyFoldable &&
        (marker
          ? state.ownedMarker !== undefined && run > state.ownedMarker
          : bottomBlockLeavesParagraphOpen(text) && !lineOpensBlock(text) && !opensWrappedAttributeBlock(text))) {
      state.absorbingFence = line.wasAbsorbing
      return true
    }
    if (!state.ownedAuthored && RE_COMMENT_LINE.test(text)) {
      state.invisibleAtColumn = true
      state.commentAtColumn = true
      return endsOnBlock(state)
    }
    const closedDescendantMarker = !rebased && !state.ownedAuthored && state.deepest?.invisibleAtColumn === true &&
      !state.deepest.lazyFoldable && marker
    const closedFootnoteMarker = closedDescendantMarker && state.deepest?.inFootnoteBody === true
    state.ownedColumn = -1
    state.deepest = null
    // A new sibling marker replaces the closed descendant's claim with its
    // own marker-line paragraph claim.
    if (!closedDescendantMarker) return false
    if (!closedFootnoteMarker) {
      state.retainedMarker = true
      return endsOnBlock(state)
    }
    state.retainedMarker = false
    state.lazyFoldable = markerLineState(text).leavesParagraphOpen
    return true
  }

  // THE DESCENDANT FRAME ANSWERS. One line, in the deeper item's coordinates,
  // through this same tracker - so a fenced body, a `:::` container and a quote
  // are read there exactly as they are here, rather than enumerated. An
  // enumeration of block kinds is how the three engines drifted apart.
  function descendantFrame(line: LazyLine): boolean {
    const { content, state, facts, hasFenceCloser } = line
    if (!line.readDescendant || state.inDefList !== false) return false
    const run = line.run!
    // A footnote body is measured from the note's column, so its continuation keeps that offset.
    const dedented = state.deepest?.inFootnoteBody === true
      ? sliceColumns(content, state.ownedColumn, true)
      : content.slice(run)
    const inlineFence = RE_FENCE.exec(dedented)
    const inlineMarker = inlineFence?.[2] ?? RE_RAW_FENCE.exec(dedented)?.[1]
    const inner = (state.deepest ??= {
      ...verbatimOnlyLazyState(),
      lazyFoldable: state.lazyFoldable && inlineMarker !== undefined && !hasFenceCloser(inlineMarker, run),
      // The marker line's quote is the sub-item's first block, so its next line continues it.
      quoteInner: RE_BLOCKQUOTE.test(dedented) ? state.ownedQuote?.() ?? null : null,
    })
    trackItemLazyState(
      dedented,
      inner,
      (marker, extra = 0) => hasFenceCloser(marker, extra + run),
      true,
      // NO COMMENT SPAN OPENS IN THE FRAME. The callers that can look ahead ask
      // at THIS container's column, and a `%%%` run at the descendant's is a
      // different question nobody answers here. PART 9 section 28 degrades an
      // opener with no exact-width closer to one `%%` line comment, and that
      // answer - invisible, closes the paragraph, opens nothing - is the same
      // one a terminated span gives for Q1, because what follows the span is
      // what Q1 reads either way.
      () => false,
      { terminatorFree: facts?.terminatorFree ?? false, whitespace: 0, descendantFrames: true, rebasedFrame: true },
      (width, extra = 0) => line.hasLiteralCommentCloser?.(width, run + extra) ?? false,
    )
    if (inner.inFootnoteBody && RE_FOOTNOTE_DEF.test(dedented))
      inner.footnoteBodyColumn = line.runColumns! - state.ownedColumn + FOOTNOTE_BODY_COLUMN
    state.commentAtColumn = inner.commentAtColumn
    state.lazyFoldable = inner.lazyFoldable
    state.inTable = inner.inTable
    state.inDefList = false
    return true
  }

  // An open quote's own paragraph takes the line as lazy text, so its run is
  // not authored either. A quote that ended on a block holds no such paragraph
  // and the run below it is the ITEM's - the shape this ticket was found on
  // (`: - > | a |` with an over-indented table under it). An open colon-fence
  // container and an open description entry hold the run for the same reason:
  // each is the innermost container and reads its body flush.
  function readsFlush(line: LazyLine): boolean {
    const { content, state, wasQuote } = line
    const run = line.run!
    const runColumns = line.runColumns!
    if (!line.readFlush) return false
    const containerHolds = state.divDepth === 0 ||
      (state.divDepth > 0 && state.literalColon === undefined && !state.literalLayout &&
        (opensCodeFence(content.slice(run)) || RE_LINE_BLOCK_OPEN.test(content.slice(run)))) ||
      (state.authoredColon !== undefined && runColumns > state.authoredColon.column && hostedAuthoredBlockOpener(content.slice(run)))
    if (!containerHolds || state.inDefList !== false || state.unrebasedColonBody) return false
    return wasQuote === null || !blockQuoteParagraphOpen(wasQuote) ||
      (state.unclosedFenceBase !== undefined && runColumns === state.unclosedFenceBase) ||
      (state.descriptionHasTerm === true && state.ownedAuthored && runColumns === state.ownedColumn)
  }

  /** An authored over-indented run this item reads flush. */
  function authoredFlush(line: LazyLine): boolean {
    if (!readsFlush(line)) return false
    const { state } = line
    const overIndented = line.content.slice(line.run!)
    if (authoredFlushFence(line, overIndented)) return true
    const colon = colonFenceOpenerLen(overIndented)
    if (colon !== null && !line.wasInlineFence && !line.wasAbsorbing && !line.wasClosedColon) {
      state.divDepth++
      if (RE_LINE_BLOCK_OPEN.test(overIndented)) state.literalColon = { width: colon, column: line.run! }
      else state.authoredColon = { width: colon, column: line.run!, depth: state.divDepth }
      return endsOnBlock(state)
    }
    if (colon === null && /^:{3,}/.test(overIndented)) {
      state.absorbingFence = true
      state.lazyFoldable = true
      state.inDefList = false
      return true
    }
    if (line.wasClosedColon) {
      state.lazyFoldable = true
      state.inDefList = false
      return true
    }
    const authoredQuote = RE_BLOCKQUOTE.exec(overIndented)
    if (authoredQuote && ((state.descriptionHasTerm || (!state.lazyFoldable && state.descriptionColumn !== undefined)) ||
        isBlankLine(authoredQuote[1] ?? ''))) {
      line.content = overIndented
      if (line.facts) line.facts = { ...line.facts, whitespace: 0 }
    }
    if (RE_HEADING.test(overIndented) || isTableRow(overIndented) || RE_HR.test(overIndented) || isBlockAttributeLine(overIndented)) {
      state.inTable = isTableRow(overIndented)
      return endsOnBlock(state)
    }
    return false
  }

  function authoredFlushFence(line: LazyLine, overIndented: string): boolean {
    const { state, hasFenceCloser } = line
    const inlineCode = RE_FENCE.exec(overIndented) ?? RE_RAW_FENCE.exec(overIndented)
    if (!inlineCode) return false
    const marker = RE_FENCE.test(overIndented) ? inlineCode[2]! : inlineCode[1]!
    const column = line.authoredFenceColumns ?? line.run!
    if (state.divDepth > 0 && state.literalColon === undefined && !state.literalLayout &&
        (state.authoredColon === undefined || line.runColumns! > state.authoredColon.column)) {
      state.opaque = { kind: 'code', close: fenceCloseRe(marker), column }
      return endsOnBlock(state)
    }
    if (!state.lazyFoldable) return false
    if (!hasFenceCloser(marker, column) && !hasFenceCloser(marker, 0)) {
      state.inlineFenceParagraph = true
      state.unclosedFenceBase ??= line.runColumns!
      state.inDefList = false
      return true
    }
    if ((line.facts?.descendantFrames === true || line.authoredFenceColumns !== undefined) && !line.wasDescendantColumn) {
      state.opaque = { kind: 'code', close: fenceCloseRe(marker), column }
      return endsOnBlock(state)
    }
    return false
  }

  return { measureRun, overIndentedTableRow, overIndentedDescription, runOwnership, descendantFrame, authoredFlush }
}
