import type { BlockQuoteLazyState, ItemLazyState, ItemLineFacts } from '../../parse.js'
import { indentColumns, isBlankLine, sliceColumns } from '../parse-lexer.js'
import { isListMarkerLine } from '../parse-prepass-core.js'
import { holdsLineBlock, verseStanzaOpen } from '../block/parse-block-boundaries.js'
import type { listStateHelpers } from '../../parse.js'
import { createRunPhases, endsOnBlock, type CommentCloser, type LazyLine, type LazyPhase, type LiteralCommentCloser } from './parse-list-state-runs.js'

export function createListStateTracker(helpers: typeof listStateHelpers) {
  const {
    FOOTNOTE_BODY_COLUMN,
    RE_ABBR_DEF,
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
    extractItemAttr,
    fenceCloseRe,
    isBlockAttributeLine,
    isLinkDefLine,
    isTableRow,
    keepsRefusedRunLine,
    lineOpensBlock,
    leadingWhitespace,
    markerLineQuoteState,
    markerLineState,
    opaqueGroupCloser,
    opensCodeFence,
    orderedMatch,
    taskMatch,
    trackBlockQuoteLazyState,
    trackWrappedAttributeRun,
    unorderedMatch,
    verbatimOnlyLazyState,
    walkMarkerOwnerPrefix,
  } = helpers

  /** The closer pattern of a code or raw fence opener `text`, or null. */
  function fenceCloserOf(text: string): RegExp | null {
    const fence = RE_FENCE.exec(text)
    if (fence) return fenceCloseRe(fence[2]!)
    const raw = RE_RAW_FENCE.exec(text)
    return raw ? fenceCloseRe(raw[1]!) : null
  }

  function beginLine(
    content: string,
    state: ItemLazyState,
    atContentColumn: boolean,
    hasCommentCloser: CommentCloser,
    facts: ItemLineFacts | undefined,
    hasLiteralCommentCloser: LiteralCommentCloser | undefined,
    authoredFenceColumns: number | undefined,
    authoredFenceWhitespace: number | undefined,
    authoredQuoteParagraphOpen: boolean,
  ): LazyLine {
    delete state.retainedMarker
    delete state.keptRunLine
    const wasDescendantColumn = state.ownedColumn >= 0 && !state.ownedAuthored
    const wasClosedColon = state.closedColonBody === true
    const wasClosedLiteralComment = state.closedLiteralComment === true
    delete state.closedColonBody
    delete state.closedLiteralComment
    if (state.unrebasedColonBody && RE_ADMONITION_CLOSE.exec(content)?.[1]?.length === state.unrebasedColonBody.width) delete state.unrebasedColonBody
    // Every other block ends the table, so only the two row branches re-arm it.
    const wasInTable = state.inTable
    state.inTable = false
    // The quote the item ended on is dropped by every line that is not more of
    // it; the quoted branch below re-arms it.
    const wasQuote = state.quoteInner
    // Keep the source owner before the next line changes the claim. A closed
    // quoted definition leaves no quote paragraph for an unquoted follower;
    // a descendant that still owns the line keeps its existing quote frame.
    const quoteOwnerColumn = state.ownedColumn
    state.quoteInner = null
    const wasInvisibleAtColumn = state.invisibleAtColumn
    state.invisibleAtColumn = false
    const wasBelowComment = state.closedBelowComment === true
    delete state.closedBelowComment
    const wasCommentAtColumn = state.commentAtColumn
    state.commentAtColumn = false
    return {
      content, state, atContentColumn, hasCommentCloser, facts, hasLiteralCommentCloser,
      authoredFenceColumns, authoredFenceWhitespace, authoredQuoteParagraphOpen,
      wasDescendantColumn, wasClosedColon,
      wasClosedLiteralComment, wasInTable, wasQuote, quoteOwnerColumn, wasInvisibleAtColumn,
      wasBelowComment, wasCommentAtColumn,
      run: undefined, runColumns: undefined, readFlush: false, readDescendant: false,
    }
  }

  // A retained fence opens a block, including one held by a description.
  function retainedCommentFence(line: LazyLine): boolean {
    const { content, state } = line
    if (!(line.wasCommentAtColumn || state.deepest?.commentAtColumn ||
        (line.wasBelowComment && line.atContentColumn && state.inDefList === false && leadingWhitespace(content) === 0))) return false
    if (state.opaque !== null || !opensCodeFence(content.trimStart())) return false
    const close = fenceCloserOf(content.trimStart())
    if (!close) return false
    state.opaque = { kind: 'code', close }
    state.lazyFoldable = false
    state.inDefList = false
    state.deepest = null
    return true
  }

  // A FOOTNOTE DEFINITION'S BODY RUNS ON. A blank between its lines is inside
  // the body rather than after it, so it does not end the run.
  //
  // AT THE BODY COLUMN, which is the parser's own boundary and not merely
  // "indented". `parseFootnoteDef` takes a continuation line only at
  // `FOOTNOTE_BODY_COLUMN`, so a line one column in is the CONTAINER's prose
  // and leaves an open paragraph behind it. Reading any indent as body made
  // `- a` / `  [^f]: t` / ` more` / `tail` end the item where carve-php folds
  // `tail` into it.
  function footnoteBody(line: LazyLine): boolean {
    const { content, state } = line
    if (state.inFootnoteBody && !isBlankLine(content)) {
      const bodyColumn = Math.max(state.footnoteBodyColumn ?? FOOTNOTE_BODY_COLUMN,
        line.atContentColumn ? (state.authoredColon?.column ?? 0) + FOOTNOTE_BODY_COLUMN : 0)
      if (indentColumns(content, bodyColumn) < bodyColumn) {
        state.inFootnoteBody = false
        // A line that leaves the body but does not interrupt is the note paragraph's lazy line.
        if (state.noteFrame !== undefined && noteFrameParagraphOpen(state.noteFrame) && noteLazyLine(line)) {
          trackItemLazyState(content.trimStart(), state.noteFrame, false, () => false)
          state.inFootnoteBody = true
          state.lazyFoldable = noteFrameParagraphOpen(state.noteFrame)
          state.inDefList = false
          return true
        }
      }
    }
    if (!state.inFootnoteBody) {
      delete state.noteFrame
      return false
    }
    state.invisibleAtColumn = line.wasInvisibleAtColumn
    state.commentAtColumn = line.wasCommentAtColumn
    const frame = state.noteFrame
    if (frame === undefined) return endsOnBlock(state)
    const bodyColumn = state.footnoteBodyColumn ?? FOOTNOTE_BODY_COLUMN
    let noteLine = isBlankLine(content) ? '' : sliceColumns(content, bodyColumn, true)
    // A description in the note reads its body from its own column.
    let descriptionShift = 0
    if (frame.inDefList === 'description' && frame.descriptionColumn !== undefined && noteLine !== '' &&
        !RE_DEFLIST_DEF.test(noteLine) && indentColumns(noteLine, frame.descriptionColumn) >= frame.descriptionColumn) {
      descriptionShift = frame.descriptionColumn
      noteLine = sliceColumns(noteLine, descriptionShift, true)
    }
    // The containing item must see the same paragraph boundary as the note parser.
    const description = RE_DEFLIST_DEF.exec(noteLine)
    const descriptionFence = line.atContentColumn && frame.inDefList === 'term' &&
      description !== null && opensCodeFence(description[2]!)
    // A caller that reads descendant frames reads a list item's in the note's body too.
    trackItemLazyState(noteLine, frame,
      true, () => false,
      line.facts?.descendantFrames === true && (noteFrameOwnsItem(frame) || isListMarkerLine(noteLine.trimStart()))
        ? { terminatorFree: line.facts.terminatorFree, whitespace: leadingWhitespace(noteLine), descendantFrames: true }
        : undefined)
    if (descriptionFence) frame.lazyFoldable = false
    state.lazyFoldable = noteFrameParagraphOpen(frame)
    state.inDefList = false
    return true
  }

  function noteFrameOwnsItem(frame: ItemLazyState): boolean {
    for (let at: ItemLazyState | undefined = frame; at !== undefined; at = at.noteFrame) if (at.ownedColumn >= 0) return true
    return false
  }

  function noteLazyLine(line: LazyLine): boolean {
    const text = line.content.trimStart()
    // A comment below the body is a block of the host, never note text.
    if (RE_COMMENT_LINE.test(line.content.replace(/^[ \t]+/, ''))) return false
    // A fence opener interrupts the note paragraph whether or not it closes.
    if (RE_FENCE.test(text) || RE_RAW_FENCE.test(text)) return false
    return bottomBlockLeavesParagraphOpen(text) && !lineOpensBlock(text)
  }

  function noteFrameParagraphOpen(frame: ItemLazyState): boolean {
    // A line block takes a lazy line while its stanza is open (PART 9 §23).
    if (frame.literalColon !== undefined) return frame.opaque === null && verseStanzaOpen(frame)
    // A div's open paragraph takes one too (PART 0 S4).
    return frame.lazyFoldable && frame.opaque === null &&
      frame.deepest?.lazyFoldable !== false && frame.deepest?.opaque == null
  }

  /** A below-column comment span held by an open colon container closes on its run. */
  function belowColumnCommentClose(line: LazyLine): boolean {
    const { content, state } = line
    const run = commentFenceRun(content.trimStart())
    if (!line.atContentColumn && state.literalColon?.opaque?.belowBaseCloses && run === state.literalColon.opaque.run) {
      delete state.literalColon.opaque
      // A `%%%` span leaves nothing: the stanza it interrupted stays as it was (carve#4956).
      state.lazyFoldable = state.literalColon.spanFoldable === true
      state.inDefList = false
      return true
    }
    if (!line.atContentColumn && run === undefined && content.trim() !== '' && !RE_COMMENT_LINE.test(content)) {
      // Any other non-comment line below the column misses every span owner from here down and ends the span (PART 0 S1, carve#4994).
      for (let frame: ItemLazyState | null | undefined = state; frame; frame = frame.ownedColumn >= 0 && !frame.ownedAuthored ? frame.deepest : null)
        if (frame.literalColon?.opaque?.belowBaseCloses) delete frame.literalColon.opaque
    }
    if (state.authoredColon?.belowComment !== undefined) {
      if (run === state.authoredColon.belowComment) delete state.authoredColon.belowComment
      state.inDefList = false
      return true
    }
    return false
  }

  /** A line inside an open literal (line-block) colon container. */
  function literalColonLine(line: LazyLine): boolean {
    const { content, state, facts, hasCommentCloser } = line
    if (state.literalColon === undefined || !line.atContentColumn) return false
    const open = state.literalColon
    const column = indentColumns(content, open.column + 1)
    const text = content.trimStart()
    // A comment line left of the column stays in an open `%%%` span (PART 0 S1, carve#5021).
    if (column < open.column && !state.lazyFoldable && !(open.opaque?.belowBaseCloses && RE_COMMENT_LINE.test(text))) {
      delete state.literalColon
      state.divDepth = Math.max(0, state.divDepth - 1)
      return false
    }
    if (state.divDepth === 0 && open.opaque === undefined && RE_COMMENT_LINE.test(text)) state.divDepth = 1
    if (open.opaque) {
      const closedPayload = open.opaque.closes(text)
      // A `%%%` span leaves nothing: the stanza it interrupted stays as it was (carve#4956).
      state.lazyFoldable = open.opaque.belowBaseCloses ? open.spanFoldable === true : text !== ''
      if (closedPayload) delete open.opaque
      state.inDefList = false
      return true
    }
    if (open.belowComment !== undefined && commentFenceRun(text) === open.belowComment) {
      delete open.belowComment
      state.inDefList = false
      return true
    }
    // A percent run beyond the verse comment margin is payload, not a span.
    const group = indentColumns(content) <= open.column + 3 || !text.startsWith('%%%')
      ? opaqueGroupCloser(text) : null
    const codeAtBase = opensCodeFence(text) && (column === 0 || column === open.column)
    const spanFoldable = state.lazyFoldable
    if (group && (group.belowBaseCloses ? (line.hasLiteralCommentCloser ?? hasCommentCloser)(group.run) :
      opensCodeFence(text) && (column === 0 || column >= open.column) &&
      (facts?.payloadFenceCloser?.(group.char.repeat(group.run)) ?? true))) {
      open.opaque = group
      if (group.belowBaseCloses) open.spanFoldable = spanFoldable
    }
    if (group && !group.belowBaseCloses && codeAtBase && !state.lazyFoldable && state.divDepth > 0 &&
        (facts?.payloadFenceCloser?.(group.char.repeat(group.run)) ?? true)) open.opaque = group
    const close = RE_ADMONITION_CLOSE.exec(text)
    if (close && close[1]!.length === open.width && (column === 0 || column === open.column)) {
      if (open.rejectedComment) state.closedLiteralComment = true
      delete state.literalColon
      state.divDepth = Math.max(0, state.divDepth - 1)
      state.closedColonBody = true
      state.lazyFoldable = false
    } else {
      // A payload line opens no block, even when it looks like a definition.
      state.lazyFoldable = open.opaque?.belowBaseCloses === true ? spanFoldable : text !== '' &&
        (close === null || close[1]!.length !== open.width ||
          (column > 0 && column !== open.column))
    }
    if (!RE_COMMENT_LINE.test(text)) delete open.awaitingBody
    state.inDefList = false
    return true
  }

  /** A line a descendant marker owns while its frame sits in a literal colon container. */
  function descendantLiteralColon(line: LazyLine): boolean {
    const { content, state, facts } = line
    // A blank ends the descendant line block's stanza, which a later `%%%` span keeps closed (carve#4956).
    if (isBlankLine(content) && holdsLineBlock(state.deepest)) {
      for (let frame = state.deepest; frame; frame = frame.ownedColumn >= 0 && !frame.ownedAuthored ? frame.deepest : null) frame.lazyFoldable = false
      return false
    }
    if (!holdsLineBlock(state.deepest) || state.ownedAuthored || state.ownedColumn < 0 ||
        indentColumns(content, state.ownedColumn) < state.ownedColumn) return false
    const offset = state.ownedColumn
    const inner = state.deepest!
    trackItemLazyState(
      sliceColumns(content, offset, true), inner,
      true, () => false,
      {terminatorFree: facts?.terminatorFree ?? false, whitespace: 0, descendantFrames: true, rebasedFrame: true,
        ...(facts?.payloadFenceCloser ? {payloadFenceCloser: facts.payloadFenceCloser} : {})},
      (width, extra = 0) => line.hasLiteralCommentCloser?.(width, offset + extra) ?? false,
    )
    // A line block's open paragraph takes lazy text at every depth (PART 0 S4).
    const comment = inner.literalColon !== undefined && RE_COMMENT_LINE.test(sliceColumns(content, offset, true).trimStart())
    state.lazyFoldable = inner.lazyFoldable && (inner.literalLayout === true || !comment)
    state.inTable = inner.inTable
    if (comment && inner.literalLayout !== true) state.commentAtColumn = true
    state.inDefList = false
    return true
  }

  /** A comment line left of a descendant whose line block holds an open `%%%` span is that span's (PART 0 S1, carve#5021). */
  function descendantSpanLine(line: LazyLine): boolean {
    const { content, state, facts } = line
    if (!RE_COMMENT_LINE.test(content.trimStart()) || !descendantSpanHolds(state) ||
        line.atContentColumn && indentColumns(content, state.ownedColumn) >= state.ownedColumn) return false
    const inner = state.deepest!
    trackItemLazyState(content, inner, false, line.hasCommentCloser,
      {terminatorFree: facts?.terminatorFree ?? false, whitespace: 0, descendantFrames: true, rebasedFrame: true})
    state.lazyFoldable = inner.lazyFoldable
    state.inDefList = false
    return true
  }

  /**
   * An open authored colon container: its closer, a dedent out of it, or a line
   * inside it, which is rebased to the container's column for the later phases.
   */
  function authoredColonLine(line: LazyLine): boolean {
    const { state } = line
    const authoredColon = state.authoredColon
    if (state.opaque !== null || !authoredColon) return false
    if (state.divDepth === authoredColon.depth) {
      const close = RE_ADMONITION_CLOSE.exec(line.content.trimStart())
      const column = indentColumns(line.content, authoredColon.column + 1)
      if (close && close[1]!.length === authoredColon.width && (column === 0 || column === authoredColon.column)) {
        delete state.authoredColon
        state.divDepth--
        const hadDescendant = state.deepest !== undefined && state.deepest !== null
        state.ownedColumn = -1
        state.deepest = null
        if (hadDescendant) state.closedColonBody = true
        return endsOnBlock(state)
      }
    }
    if (!line.atContentColumn) return false
    if (authoredColon.column > 0 && indentColumns(line.content, authoredColon.column) < authoredColon.column &&
        !RE_COMMENT_LINE.test(line.content.trimStart())) {
      return authoredColonDedent(line)
    }
    if (state.divDepth >= authoredColon.depth) rebaseIntoAuthoredColon(line, authoredColon.column)
    return false
  }

  function authoredColonDedent(line: LazyLine): true {
    const { content, state } = line
    const text = content.trimStart()
    if (state.descriptionHasTerm && state.descriptionColumn !== undefined && !state.lazyFoldable && opensCodeFence(text)) {
      state.opaque = { kind: 'code', close: fenceCloserOf(text)!, column: indentColumns(content) }
      state.inDefList = false
      return true
    }
    state.ownedColumn = -1
    state.deepest = null
    state.lazyFoldable = bottomBlockLeavesParagraphOpen(content) && colonFenceOpenerLen(content) === null &&
      (!opensCodeFence(content) || state.lazyFoldable)
    state.inDefList = false
    return true
  }

  function rebaseIntoAuthoredColon(line: LazyLine, base: number): void {
    const column = indentColumns(line.content, base + 1)
    if (base > 0 && column >= base) {
      line.content = sliceColumns(line.content, base, true)
      const facts = line.facts
      if (facts) line.facts = { ...facts, whitespace: facts.whitespace === undefined ? undefined : Math.max(0, facts.whitespace - base) }
    } else {
      const run = commentFenceRun(line.content.trimStart())
      if (run !== undefined && line.hasCommentCloser(run)) line.content = line.content.trimStart()
    }
  }

  /** A comment line below the column of an open colon container. */
  function belowColumnColonComment(line: LazyLine): boolean {
    const { content, state } = line
    if (line.atContentColumn || state.opaque !== null || !(state.literalColon || state.authoredColon) ||
        !RE_COMMENT_LINE.test(content.trimStart())) return false
    const run = commentFenceRun(content.trimStart())
    // Inside an open `%%%` span a longer run is payload, not a span of its own (carve#5021).
    if (state.literalColon && run !== undefined && !state.literalColon.opaque?.belowBaseCloses && line.hasCommentCloser(run)) state.literalColon.belowComment = run
    if (state.authoredColon && run !== undefined && line.hasCommentCloser(run)) state.authoredColon.belowComment = run
    state.invisibleAtColumn = state.literalColon === undefined
    state.commentAtColumn = state.literalColon === undefined
    return true
  }

  function openCommentSpan(line: LazyLine): boolean {
    const { content, state } = line
    if (state.opaque?.kind !== 'comment') return false
    const comment = state.opaque
    // A CLOSER IS NOT A BARE RUN. This said it was - "so this test stays
    // anchored, unlike the opener below, which may carry an info string" - and
    // PART 9 §28 gives the closer the same insignificant tail as the opener:
    // `%%% end` closes one. It also matches on EXACT length, where this read
    // `>=`.
    const run = commentFenceRun(content)
    // A line left of a nested owner's span misses that owner and ends the span (PART 0 S1).
    if (comment.column !== undefined && run !== comment.length && line.atContentColumn && content.trim() !== '' &&
        !RE_COMMENT_LINE.test(content.trimStart()) &&
        indentColumns(content) < comment.column) {
      state.opaque = null
      return false
    }
    // THE FRAME IS NOT FED THESE LINES, so a span it opened would never close
    // and every later line would read as payload. Dropping it here hands the
    // next descendant-owned line a frame that starts where the span ended.
    state.deepest = null
    if (run === comment.length) {
      state.opaque = null
      // The opener ends its paragraph at the content column. Only a closing
      // boundary consumed below that column retains the indented follower.
      state.lazyFoldable = comment.paragraphBefore && !comment.atColumn
      state.invisibleAtColumn = comment.atColumn
      state.commentAtColumn = false
      state.closedBelowComment = !comment.atColumn && !comment.term && state.inDefList === false
    } else {
      state.lazyFoldable = false
    }
    state.inDefList = comment.term ? 'term' : comment.description ? 'description' : false
    return true
  }

  function openCodeFence(line: LazyLine): boolean {
    const { content, state } = line
    if (state.opaque?.kind !== 'code') return false
    // See the comment twin above.
    state.deepest = null
    const base = state.opaque.column ?? 0
    const column = indentColumns(content, base + 1)
    if (column <= base && state.opaque.close.test(content.replace(/^[ \t]+/, ''))) state.opaque = null
    return endsOnBlock(state)
  }

  /** An indented comment line after a definition term. */
  function termComment(line: LazyLine): boolean {
    const { content, state } = line
    if (state.inDefList !== 'term' || !(state.lazyFoldable || state.termAfterComment) || state.opaque !== null ||
        leadingWhitespace(content) === 0 || !RE_COMMENT_LINE.test(content.trimStart())) return false
    const run = commentFenceRun(content.trimStart())
    if (run !== undefined && line.hasCommentCloser(run)) {
      state.opaque = { kind: 'comment', length: run, paragraphBefore: false, atColumn: false, term: true }
    }
    state.lazyFoldable = false
    state.termAfterComment = true
    return true
  }

  // A WRAPPED block-attribute block is held open the way a fence is (§15 A5).
  // It renders nothing and opens nothing at either width, so the container has
  // no paragraph for a column-0 line to fold into while the run is open or once
  // it closes as attributes. A run that turns out NOT to parse hands its last
  // line back to the classifiers below, where its lines are the prose they look
  // like.
  function attributeRun(line: LazyLine): boolean {
    const { content, state } = line
    // Inline pairing owns every brace line inside an open code span, whether
    // the attribute spelling closes on this line or a later one (carve#5638).
    if (state.attrRun === null && line.inlineCodeOpen !== 0) return false
    const column = line.atContentColumn
      ? line.facts?.whitespace ?? indentColumns(content)
      : Math.max(0, indentColumns(content) - (state.attrOwnerColumn ?? 0))
    // A run indented past the content column is still a run, unless an open code span holds it (CARVE-P2-035, carve#5610).
    const runText = line.atContentColumn && state.attrRun === null && line.inlineCodeOpen === 0 ? content.trimStart() : content
    const opener = state.attrRun === null
    if (trackWrappedAttributeRun(state, runText, column)) return endsOnBlock(state)
    // A run that lazily continues a nested quote's paragraph is that quote's text, not the item's.
    if (opener && state.attrRun !== null) state.attrRunInQuote = line.wasQuote !== null && blockQuoteParagraphOpen(line.wasQuote)
    if (state.refusedBraceRun) {
      state.refusedBraceRun = false
      const ownRun = state.attrRunInQuote !== true
      state.refusedBraceFollower = ownRun
      state.refusedRunKept = ownRun ? null : undefined
      state.lazyFoldable = true
      return true
    }
    if (line.atContentColumn && state.divDepth > 0 && (content[0] === ' ' || content[0] === '\t') &&
        isBlockAttributeLine(content.trimStart())) return endsOnBlock(state)
    return false
  }

  function refusedRunKeptLine(line: LazyLine): boolean {
    if (!keepsRefusedRunLine(line.state, line.content, line.state.lazyFoldable)) return false
    line.state.lazyFoldable = true
    line.state.keptRunLine = true
    return true
  }

  function blankLine(line: LazyLine): boolean {
    const { state } = line
    if (!isBlankLine(line.content)) return false
    state.refusedBraceFollower = false
    delete state.termAfterComment
    if (state.descriptionHasTerm === false) state.inDefList = false
    // A blank is a separator; a `:  def` may follow it (djot allows a blank
    // between a term and its definition), so leave inDefList unchanged.
    state.lazyFoldable = false
    if (state.deepest) delete state.deepest.closedColonBody
    return true
  }

  // A definition-list term or definition marker opens (or continues) a def
  // list in this item, and leaves an open paragraph for its body.
  function definitionMarker(line: LazyLine): boolean {
    const { content, state } = line
    if (!RE_DEFLIST_TERM.test(content) && !RE_DEFLIST_DEF.test(content)) return false
    const isTerm = RE_DEFLIST_TERM.test(content)
    // A marker left of the descendant item's column is not in that item, so its closed frame stops answering.
    if (state.ownedColumn >= 0 && !state.ownedAuthored && indentColumns(content) < state.ownedColumn) {
      state.ownedColumn = -1
      state.deepest = null
    }
    const hasTerm = isTerm || (state.inDefList === 'term' && state.termEnded !== true) ||
      (state.inDefList === 'description' && state.descriptionHasTerm === true)
    state.descriptionHasTerm = hasTerm
    state.inDefList = isTerm ? 'term' : 'description'
    delete state.termEnded
    delete state.termAfterComment
    // A `: ` line with no term above is paragraph text, whatever its body holds (carve#5290).
    // A descendant item's term is not this frame's, so a line that item owns is left to it.
    if (!hasTerm && (state.ownedColumn < 0 || indentColumns(content) < state.ownedColumn)) {
      state.inDefList = false
      state.lazyFoldable = true
      return true
    }
    const description = RE_DEFLIST_DEF.exec(content)
    if (description) {
      state.descriptionColumn = 1 + description[1]!.length
      if (RE_LINE_BLOCK_OPEN.test(description[2]!)) {
        state.divDepth++
        state.literalColon = { width: colonFenceOpenerLen(description[2]!)!, column: state.descriptionColumn }
      }
    }
    delete state.termAfterComment
    // A heading, table, rule, definition or comment on the `: ` marker opens no paragraph (carve#4305).
    // A term is one line and leaves no paragraph (carve#4861).
    state.lazyFoldable = !isTerm &&
      colonBlockOpenerRun(description![2]!) === null && bottomBlockLeavesParagraphOpen(description![2]!)
    // A span on the lead is the body's, and a line that misses it finds no paragraph (carve#4996).
    const run = description && hasTerm ? commentFenceRun(description[2]!) : undefined
    if (run !== undefined && line.hasCommentCloser(run)) {
      state.opaque = { kind: 'comment', length: run, paragraphBefore: false, atColumn: line.atContentColumn, description: true,
        column: indentColumns(content) + 1 + description![1]!.length }
      state.deepest = null
    }
    return true
  }

  // A code or raw fence opens a verbatim block, which holds no open paragraph,
  // whether or not it closes: an unterminated one runs to the end of the item.
  function codeFenceOpener(line: LazyLine): boolean {
    const { content, state } = line
    const fence = RE_FENCE.exec(content)
    const raw = fence ? null : RE_RAW_FENCE.exec(content)
    const fenceMarker = fence ? fence[2]! : raw ? raw[1]! : null
    if (fenceMarker === null) return false
    state.opaque = { kind: 'code', close: fenceCloseRe(fenceMarker) }
    state.deepest = null
    return endsOnBlock(state)
  }

  // An OPENER may carry an info string: `%%% x` is a comment fence, exactly as
  // the block parser reads it via RE_COMMENT_BLOCK_ANY. Requiring a bare run
  // here missed that opener entirely and then matched the CLOSER as an opener,
  // leaving the tracker permanently inside a comment: every later line read as
  // unfoldable, the item ended at the fence, and a following sibling marker
  // started a SECOND list (carve-js#659).
  //
  // AN UNTERMINATED OPENER DOES NOT OPEN A BLOCK (PART 9 §28): it degrades to a
  // `comment_line`, and PART 0's COMMENTS ARE CLASSIFIED BEFORE BLOCK OWNERSHIP
  // says the same from the layout side - "an opener without an exact-width
  // closer is one `%%` line comment; later lines are classified normally". The
  // quote's tracker has asked this all along; this one opened on every fence,
  // so `- x` / `  %%%` / `y` kept `y` inside the item where the `%%` line form
  // at that column ended it (markup-carve/carve-js#1600).
  //
  // THE BELOW-COLUMN BAND IS UNTOUCHED, and it is the two lazy call sites'
  // default callback that keeps it so: no reader applies the substitution
  // there, the reading is open at markup-carve/carve#1903, and degrading it
  // here would take carve-js away from the executable spec, carve-rs and
  // carve-php at once.
  function commentFenceOpener(line: LazyLine): boolean {
    const { state } = line
    const commentRun = commentFenceRun(line.content)
    if (commentRun === undefined || !line.hasCommentCloser(commentRun)) return false
    if (descendantCodeHolds(line.content, state) || descendantSpanHolds(state)) return false
    const column = line.atContentColumn ? indentColumns(line.content) : 0
    state.opaque = { kind: 'comment', length: commentRun, paragraphBefore: state.lazyFoldable, atColumn: line.atContentColumn,
      description: state.inDefList === 'description', ...(column > 0 ? { column } : {}),
      // A span is invisible, so the term's entry is still open after it (carve#5289).
      ...(state.inDefList === 'term' ? { term: true } : {}) }
    state.deepest = null
    return endsOnBlock(state)
  }

  // A run a descendant's open code fence reaches is that fence's payload, not a span of this item.
  function descendantCodeHolds(content: string, state: ItemLazyState): boolean {
    let text = content
    for (let frame = state; frame.deepest && frame.ownedColumn >= 0; frame = frame.deepest) {
      if (indentColumns(text, frame.ownedColumn) < frame.ownedColumn) return false
      text = sliceColumns(text, frame.ownedColumn, true)
      if (frame.deepest.opaque?.kind === 'code') return true
    }
    return false
  }

  // A descendant line block's open `%%%` span takes a comment line at any column (PART 0 S1, carve#5021).
  function descendantSpanHolds(state: ItemLazyState): boolean {
    for (let frame = state; frame.deepest && frame.ownedColumn >= 0; frame = frame.deepest)
      if (frame.deepest.literalColon?.opaque?.belowBaseCloses) return true
    return false
  }

  // A heading is a block and leaves no paragraph open. At the item's content
  // column a following dedented line therefore reaches no container (PART 1
  // S4, carve#1377), just as it does after a table row or thematic break.
  function leafBlock(line: LazyLine): boolean {
    const { content, state } = line
    if (RE_HEADING.test(content)) return endsOnBlock(state)
    if (isTableRow(content) || RE_HR.test(content)) {
      state.inTable = isTableRow(content)
      return endsOnBlock(state)
    }
    // A TABLE IS A TABLE HOWEVER ITS LAST ROW IS SPELLED. The row test above reads
    // a leading pipe and a continuation row carries none, so an item whose table
    // ended on one kept a dedented line where the standard-row spelling of the
    // same table sent it out (markup-carve/carve#1348).
    if (line.wasInTable && RE_TABLE_CONT.test(content)) {
      state.inTable = true
      return endsOnBlock(state)
    }
    return false
  }

  // AN INVISIBLE LINE AT THE CONTENT COLUMN IS A BLOCK. A comment and a
  // reference or footnote definition each render nothing, and what a block
  // renders is not a parameter (markup-carve/carve#1364): the paragraph above it
  // is over, so a column-0 line below reaches no container. The quote's tracker
  // has closed on the definitions all along; this one never did.
  function invisibleLine(line: LazyLine): boolean {
    const { content, state, facts } = line
    const invisibleContent = facts?.whitespace === undefined ? content : content.slice(facts.whitespace)
    if (!line.atContentColumn || !RE_INVISIBLE_BLOCK_LEAD.test(invisibleContent) ||
        !(RE_COMMENT_LINE.test(invisibleContent) || RE_FOOTNOTE_DEF.test(content) || isLinkDefLine(invisibleContent) ||
          RE_ABBR_DEF.test(invisibleContent.trimStart()))) return false
    // ONLY THE FOOTNOTE DEFINITION OPENS A RUN. A comment is one line and a
    // link reference definition has no body at all, so the line after either of
    // them is the container's again.
    const note = RE_FOOTNOTE_DEF.exec(content.trimStart())
    state.inFootnoteBody = note !== null
    delete state.noteFrame
    if (state.inFootnoteBody) state.footnoteBodyColumn = indentColumns(content) + FOOTNOTE_BODY_COLUMN
    else delete state.footnoteBodyColumn
    state.invisibleAtColumn = true
    state.commentAtColumn = false
    if (note === null) {
      // It closes no description: the next visible line picks the owner (CARVE-P9-013).
      const description = state.inDefList === 'description'
      endsOnBlock(state)
      if (description) state.inDefList = 'description'
      return true
    }
    // A note's first block answers like any container's (carve#3885).
    const frame = verbatimOnlyLazyState()
    // A list item that leads the note opens its own frame, as one on a later note line does.
    trackItemLazyState(note[2]!, frame, true, () => false,
      facts?.descendantFrames === true && isListMarkerLine(note[2]!)
        ? { terminatorFree: facts.terminatorFree, whitespace: 0, descendantFrames: true }
        : undefined)
    state.noteFrame = frame
    state.lazyFoldable = noteFrameParagraphOpen(frame)
    state.inDefList = false
    const run = commentFenceRun(note[2]!)
    if (run === undefined) return true
    // The note reads its own body, so its frame holds the span too: payload is no note paragraph (carve#4998).
    frame.opaque = { kind: 'comment', length: run, paragraphBefore: false, atColumn: true }
    frame.lazyFoldable = false
    if (line.hasCommentCloser(run)) {
      state.opaque = { kind: 'comment', length: run, paragraphBefore: false, atColumn: line.atContentColumn,
        column: indentColumns(content) + FOOTNOTE_BODY_COLUMN }
      state.lazyFoldable = false
    }
    return true
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
  // A closed quoted note still owns its indented quoted body line, but open quoted prose reads it literally.
  function quotedLine(line: LazyLine): boolean {
    const { content, state, wasQuote } = line
    const quoted = RE_BLOCKQUOTE.exec(content) ??
      (wasQuote !== null && !blockQuoteParagraphOpen(wasQuote) &&
        wasQuote.hosts?.kinds.at(-1) === 'note' && indentColumns(content) < 4
        ? RE_BLOCKQUOTE.exec(content.trimStart()) : null)
    if (!quoted) return false
    const inner: BlockQuoteLazyState = wasQuote ?? {
      mode: { kind: 'closed' },
      inTable: false,
      colonWidths: [],
      attrRun: null,
    }
    trackBlockQuoteLazyState(
      quoted[1] ?? '',
      inner,
      () => true,
      true, undefined, undefined, true, undefined,
      line.facts?.quotePayloadFenceCloser,
    )
    state.quoteInner = inner
    state.lazyFoldable = blockQuoteParagraphOpen(inner)
    state.inDefList = false
    return true
  }

  // A block at or past an open description's body column is that body's, so a later marker there opens its list (PART 0 S3, carve#4860).
  function inDescriptionBody(state: ItemLazyState, column: number): boolean {
    return state.inDefList === 'description' && state.descriptionColumn !== undefined && column >= state.descriptionColumn
  }

  // A block-attribute line renders nothing and opens nothing: it collects into
  // `pending` and floats forward to the next block (§15 A1/A2). So there is no
  // open paragraph for a following column-0 line to fold into, and PART 1 S4
  // closes the item and re-classifies the line at the top level - the same
  // answer, for the same reason, as the empty quote above.
  function attributeLine(line: LazyLine): boolean {
    return isBlockAttributeLine(line.content) ? endsOnBlock(line.state) : false
  }

  // A div / admonition / line-block OPENER is structural; it opens no paragraph
  // itself, but plain text on a later line inside it does (handled by the
  // fall-through below once the opener line has been seen).
  function colonFenceLine(line: LazyLine): boolean {
    const { content, state } = line
    const bareFence = /^:{3,}[ \t]*$/.test(content)
    // A bare run with a container open is that container's closer.
    const widths = state.divWidths?.length === state.divDepth ? state.divWidths : undefined
    if (bareFence && state.divDepth > 0 && (widths === undefined || widths.at(-1) === content.trim().length) && (state.authoredColon === undefined ||
      state.divDepth !== state.authoredColon.depth || content.trim().length === state.authoredColon.width)) {
      widths?.pop()
      state.divDepth--
      return endsOnBlock(state)
    }
    if (
      RE_DIV_OPEN.test(content) ||
      (RE_ADMONITION_OPEN.test(content) && !RE_ADMONITION_CLOSE.test(content)) ||
      RE_LINE_BLOCK_OPEN.test(content) ||
      RE_HARDBREAKS_OPEN.test(content) ||
      RE_QUOTE_BLOCK_OPEN.test(content)
    ) {
      if (state.divDepth === (state.divWidths?.length ?? 0)) (state.divWidths ??= []).push(colonFenceOpenerLen(content)!)
      state.divDepth++
      if (RE_LINE_BLOCK_OPEN.test(content)) state.literalColon = {width: colonFenceOpenerLen(content)!, column: indentColumns(content)}
      return endsOnBlock(state)
    }
    // A fence-shaped line that is NOT a valid opener is ordinary paragraph text
    // and leaves no state (carve#4863): `:::note` fails §12's opener test because
    // a type word must be separated from the fence by a space.
    if (!/^:{3,}/.test(content) && !(state.divDepth === 0 && /^[ \t]+:{3,}/.test(content))) return false
    // A line folded into a child quote's paragraph is that quote's text, not the item's (carve#4525).
    if (line.wasQuote !== null && blockQuoteParagraphOpen(line.wasQuote)) return false
    state.lazyFoldable = !(line.wasClosedColon && line.wasClosedLiteralComment)
    state.inDefList = false
    return true
  }

  // A NESTED MARKER LINE IS A MARKER LINE. The sub-item it opens is a container
  // whose first block is whatever the marker holds, so S4's question about it is
  // the one `markerLineState` answers - `- a` / `  - # N` leaves a
  // heading open-paragraph-less at the bottom of the stack, and the flush-left
  // line below reaches no container at all (markup-carve/carve#1280). Asked of
  // the MARKER content only: a heading on a line the sub-item COLLECTS is the
  // other half of S4, which the enumeration below decides and corpus
  // 75-list-nesting-and-looseness-4 pins the folding answer for.
  function nestedMarkerLine(line: LazyLine): boolean {
    const { content, state, facts, run } = line
    const nestedAttr = extractItemAttr(content, facts?.terminatorFree)
    const nestedMarker = nestedAttr ? (nestedAttr.markerLine ?? nestedAttr.stripped) : content
    const nestedTask = taskMatch(nestedMarker, facts?.terminatorFree)
    const nestedBullet = nestedTask ? null
      : (orderedMatch(nestedMarker, facts?.terminatorFree) ?? unorderedMatch(nestedMarker, facts?.terminatorFree))
    if (!nestedTask && !nestedBullet) return false
    if (state.authoredColon !== undefined && state.divDepth > state.authoredColon.depth && state.lazyFoldable) return true
    if (!line.atContentColumn && state.deepest != null && state.lazyFoldable) return true
    // `markerContentColumn`'s arithmetic off the match already in hand, since
    // calling it would run the three matchers a second time per nesting level
    // and measure the leading run again - both of which `container-tail-work`
    // and `nested-container-rescan` count.
    const nestedWidth = nestedTask
      ? 2
      : nestedBullet!.length === 0
        ? -1
        : nestedMarker.length - leadingWhitespace(nestedMarker) -
          nestedBullet![nestedBullet!.length - 1]!.length
    state.ownedColumn = run !== undefined && nestedWidth > 0 ? run + nestedWidth : -1
    state.ownedMarker = run ?? -1
    state.ownedAuthored = false
    delete state.ownedTerm
    // The helper unwraps the marker itself, so `- - # H` and `- # H` are one
    // question asked once.
    const nested = markerLineState(content, facts?.prefixMemo)
    state.lazyFoldable = nested.leavesParagraphOpen
    state.inTable = nested.endsOnTableRow
    state.quoteInner = nested.quote
    state.inDefList = inDescriptionBody(state, run ?? leadingWhitespace(content)) ? 'description' : false
    state.deepest = state.ownedColumn >= 0 ? nestedMarkerFrame(state, nested, (nestedTask ?? nestedBullet)!.at(-1)!) : null
    return true
  }

  // THE FRAME THIS MARKER OPENS, seeded with what the marker itself holds.
  // Starting it empty would say no paragraph is open in the sub-item, and
  // that is what decides whether a fence written in it INTERRUPTS (section 10 I4).
  function nestedMarkerFrame(
    state: ItemLazyState,
    nested: ReturnType<typeof markerLineState>,
    nestedContent: string,
  ): ItemLazyState {
    const frame = verbatimOnlyLazyState()
    frame.lazyFoldable = nested.leavesParagraphOpen
    frame.inTable = nested.endsOnTableRow
    // A quote the sub-item holds below its own marker is the frame's first block too.
    frame.quoteInner = nested.quote ?? markerLineQuoteState(nestedContent.slice(walkMarkerOwnerPrefix(nestedContent)))
    if (/^\+[ \t]*$/.test(nestedContent)) frame.firstBlockPlus = true
    const nestedColon = colonFenceOpenerLen(nestedContent)
    if (nestedColon !== null) {
      frame.lazyFoldable = false
      frame.divDepth = 1
      if (RE_LINE_BLOCK_OPEN.test(nestedContent)) {
        frame.literalColon = { width: nestedColon, column: 0 }
        frame.literalLayout = true
      }
    }
    // A fence on the marker line is the sub-item's first block. It interrupts
    // no paragraph, so it opens with or without a closer and leaves none open.
    // In a literal line block the line is payload, and its backticks stay inline.
    const nestedFence = RE_FENCE.exec(nestedContent) ?? RE_RAW_FENCE.exec(nestedContent)
    if (nestedFence !== null && state.literalLayout !== true) {
      frame.opaque = { kind: 'code', close: fenceCloseRe(RE_FENCE.test(nestedContent) ? nestedFence[2]! : nestedFence[1]!) }
      frame.lazyFoldable = false
      state.lazyFoldable = false
    }
    // A chained marker (`- - ::: |`) opens a frame per marker, so the line block
    // reads its columns at its own depth (carve#4661).
    if (RE_LINE_BLOCK_OPEN.test(nestedContent.slice(walkMarkerOwnerPrefix(nestedContent))) && colonFenceOpenerLen(nestedContent) === null) {
      const chained = beginLine(nestedContent, frame, true, () => true, undefined, undefined, undefined, undefined, false)
      chained.run = 0
      nestedMarkerLine(chained)
    }
    return frame
  }

  // Everything else (plain prose, div body text) leaves an open paragraph the
  // dedented line can continue. Prose folds into a def body, so an open def list
  // stays open (inDefList unchanged).
  function prose(line: LazyLine): boolean {
    const { state, wasQuote } = line
    state.lazyFoldable = true
    // A quote's lazy line retains its paragraph claim. A closed quote retains
    // it only while a descendant still owns the line; otherwise a quoted note
    // would lend its claim to prose in the enclosing item (carve-js#3361).
    if (wasQuote !== null && (blockQuoteParagraphOpen(wasQuote) || line.quoteOwnerColumn >= 0)) {
      trackBlockQuoteLazyState(
        line.content,
        wasQuote,
        () => true,
        true,
        undefined, undefined, false,
      )
      state.quoteInner = wasQuote
    }
    return true
  }

  const runPhases = createRunPhases(helpers, trackItemLazyState)

  // Order is the precedence: each phase sees only lines every earlier one passed on.
  const phases: readonly LazyPhase[] = [
    retainedCommentFence,
    footnoteBody,
    belowColumnCommentClose,
    literalColonLine,
    descendantLiteralColon,
    descendantSpanLine,
    authoredColonLine,
    belowColumnColonComment,
    openCommentSpan,
    openCodeFence,
    termComment,
    refusedRunKeptLine,
    attributeRun,
    blankLine,
    definitionMarker,
    codeFenceOpener,
    commentFenceOpener,
    runPhases.measureRun,
    runPhases.overIndentedTableRow,
    runPhases.overIndentedDescription,
    runPhases.runOwnership,
    runPhases.descendantFrame,
    runPhases.authoredFlush,
    leafBlock,
    invisibleLine,
    quotedLine,
    attributeLine,
    colonFenceLine,
    nestedMarkerLine,
    prose,
  ]

  function trackItemLazyState(
    content: string,
    state: ItemLazyState,
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
    /**
     * Does a comment fence of this width have a closer ahead (PART 9 §28)?
     *
     * The default answers "yes": the callers that cannot look ahead - the
     * synthetic blank at a `+` marker and an attached block's own lines - keep
     * the unconditional behavior.
     */
    hasCommentCloser: CommentCloser = () => true,
    facts?: ItemLineFacts,
    hasLiteralCommentCloser?: LiteralCommentCloser,
    authoredFenceColumns?: number,
    authoredFenceWhitespace?: number,
    authoredQuoteParagraphOpen = false,
  ): void {
    const describing = state.inDefList === 'description' && !isBlankLine(content) &&
      inDescriptionBody(state, indentColumns(content))
    const line = beginLine(content, state, atContentColumn, hasCommentCloser, facts,
      hasLiteralCommentCloser, authoredFenceColumns, authoredFenceWhitespace, authoredQuoteParagraphOpen)
    line.inlineCodeOpen = state.lazyFoldable ? state.inlineCodeOpen ?? 0 : 0
    state.inlineCodeOpen = pairInlineCode(content, line.inlineCodeOpen)
    const trimmed = content.trimStart()
    // A comment line or span is invisible, so it leaves the term's entry open.
    const termOpen = state.inDefList === 'term' && trimmed !== '' && !trimmed.startsWith('%%') && state.opaque?.kind !== 'comment'
    for (const phase of phases) {
      if (!phase(line)) continue
      if (termOpen && state.inDefList === 'term' && phase !== definitionMarker && phase !== termComment) state.termEnded = true
      // A block at or past the open description's body column is that body's (PART 0 S3, carve#4860).
      if (describing && state.inDefList === false) state.inDefList = 'description'
      return
    }
  }

  return trackItemLazyState
}

/** The open inline code width after `line`, pairing backtick runs as parseParagraph does. */
function pairInlineCode(line: string, open: number): number {
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '\\' && open === 0) { i++; continue }
    if (line[i] !== '`') continue
    let end = i + 1
    while (line[end] === '`') end++
    const width = end - i
    if (open === 0) open = width
    else if (open === width) open = 0
    i = end - 1
  }
  return open
}
