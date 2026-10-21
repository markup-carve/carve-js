import type { BlockQuoteLazyState, ItemLazyState, ItemLineFacts } from './parse.js'
import { indentColumns, isBlankLine, sliceColumns } from './parse-lexer.js'
import type { listStateHelpers } from './parse.js'

export function createListStateTracker(helpers: typeof listStateHelpers) {
  const {
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
  } = helpers
return function trackItemLazyState(
  content: string,
  state: ItemLazyState,
  /**
   * Does a fence of this marker have a closer ahead (PART 9 section 10 I4)?
   *
   * `extraColumns` is how far PAST the container's content column the opener is
   * read, which the descendant recursion below needs: a closer at this item's
   * column is not the descendant's closer, and asking without the offset read an
   * unterminated descendant fence as a terminated one (corpus 509 rows 4 and 5).
   */
  hasFenceCloser: (marker: string, extraColumns?: number) => boolean = () => true,
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
   * The default answers "yes" for the same reason `hasFenceCloser`'s does: the
   * callers that cannot look ahead - the synthetic blank at a `+` marker and an
   * attached block's own lines - keep the old unconditional behavior.
   */
  hasCommentCloser: (fence: number) => boolean = () => true,
  facts?: ItemLineFacts,
  hasLiteralCommentCloser?: (width: number, extraColumns?: number) => boolean,
  authoredFenceColumns?: number,
  authoredFenceWhitespace?: number,
): void {
  // Absorption belongs to ONE open paragraph, so it ends wherever that
  // paragraph does. Clearing it here and re-arming it only in the two branches
  // that continue the same paragraph is what keeps a heading, a table or a code
  // fence between the malformed fence and a later bare `:::` from leaving the
  // flag set: at the top level those end the paragraph and the later fence
  // opens a real div, and this tracker has to give the same answer.
  delete state.retainedMarker
  const wasDescendantColumn = state.ownedColumn >= 0 && !state.ownedAuthored
  const wasAbsorbing = state.absorbingFence
  state.absorbingFence = false
  const wasInlineFence = state.inlineFenceParagraph === true
  delete state.inlineFenceParagraph
  const wasInlineFenceBlock = state.inlineFenceBlock === true
  delete state.inlineFenceBlock
  const wasClosedColon = state.closedColonBody === true
  const wasClosedLiteralComment = state.closedLiteralComment === true
  delete state.closedColonBody
  delete state.closedLiteralComment
  if (state.unrebasedColonBody && RE_ADMONITION_CLOSE.exec(content)?.[1]?.length === state.unrebasedColonBody.width) delete state.unrebasedColonBody
  // Carried the same way the absorption is, and for the same reason: every
  // other block ends the table, so only the two row branches re-arm it.
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
  // A retained fence opens a block, including one held by a description.
  if ((wasCommentAtColumn || state.deepest?.commentAtColumn || (wasBelowComment && atContentColumn && state.inDefList === false && leadingWhitespace(content) === 0)) && !wasInlineFence &&
      !(state.unclosedFenceBase !== undefined && indentColumns(content) > state.unclosedFenceBase) &&
      state.opaque === null && opensCodeFence(content.trimStart())) {
    const fence = RE_FENCE.exec(content.trimStart()) ?? RE_RAW_FENCE.exec(content.trimStart())
    if (fence) {
      state.opaque = { kind: 'code', close: fenceCloseRe(RE_FENCE.test(content.trimStart()) ? fence[2]! : fence[1]!) }
      state.lazyFoldable = false
      state.inDefList = false
      state.deepest = null
      return
    }
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
  if (
    state.inFootnoteBody &&
    !isBlankLine(content) &&
    indentColumns(content, Math.max(state.footnoteBodyColumn ?? FOOTNOTE_BODY_COLUMN,
      atContentColumn ? (state.authoredColon?.column ?? 0) + FOOTNOTE_BODY_COLUMN : 0)) <
      Math.max(state.footnoteBodyColumn ?? FOOTNOTE_BODY_COLUMN,
        atContentColumn ? (state.authoredColon?.column ?? 0) + FOOTNOTE_BODY_COLUMN : 0)
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
  if (!atContentColumn && state.literalColon?.opaque?.belowBaseCloses &&
      commentFenceRun(content.trimStart()) === state.literalColon.opaque.run) {
    delete state.literalColon.opaque
    state.lazyFoldable = false
    state.inDefList = false
    return
  }
  if (state.authoredColon?.belowComment !== undefined) {
    if (commentFenceRun(content.trimStart()) === state.authoredColon.belowComment) delete state.authoredColon.belowComment
    state.inDefList = false
    return
  }
  if (state.literalColon !== undefined && atContentColumn) {
    const open = state.literalColon
    const column = indentColumns(content, open.column + 1)
    const text = content.trimStart()
    if (state.definitionBody && column === 0 && opensCodeFence(text) && !open.opaque) {
      delete state.literalColon
      trackItemLazyState(content, state, hasFenceCloser, atContentColumn, hasCommentCloser, facts, hasLiteralCommentCloser)
      return
    }
    if (state.divDepth === 0 && open.opaque === undefined && RE_COMMENT_LINE.test(text)) state.divDepth = 1
    if (open.opaque) {
      const closedPayload = open.opaque.closes(text)
      state.lazyFoldable = !open.opaque.belowBaseCloses && text !== ''
      if (closedPayload) delete open.opaque
      state.inDefList = false
      return
    }
    if (open.belowComment !== undefined && commentFenceRun(text) === open.belowComment) {
      delete open.belowComment
      state.inDefList = false
      return
    }
    const group = opaqueGroupCloser(text)
    const codeAtBase = opensCodeFence(text) && (column === 0 || column === open.column)
    if (group && (group.belowBaseCloses ? (hasLiteralCommentCloser ?? hasCommentCloser)(group.run) :
      opensCodeFence(text) && (column === 0 || column >= open.column) && hasFenceCloser(group.char.repeat(group.run), state.definitionBody ? -2 : -1))) open.opaque = group
    if (group && !group.belowBaseCloses && codeAtBase && !state.lazyFoldable && state.divDepth > 0) open.opaque = group
    const close = RE_ADMONITION_CLOSE.exec(text)
    if (close && close[1]!.length === open.width && (column === 0 || column === open.column)) {
      if (open.rejectedComment) state.closedLiteralComment = true
      delete state.literalColon
      state.divDepth = Math.max(0, state.divDepth - 1)
      state.closedColonBody = true
      state.lazyFoldable = open.absorbing === true
    } else {
      const marked = markerPrefixLength(text, 0, prefixWalkBound(text)) > 0 || quotedLineText(text, facts?.terminatorFree ?? false) !== null
      if (marked) open.absorbing = false
      if ((column === 0 || column === open.column) && /^:{3,}/.test(text) && colonFenceOpenerLen(text) === null) open.absorbing = true
      // Payload shapes open no blocks; span and definition boundaries still apply.
      state.lazyFoldable = !(group?.belowBaseCloses && hasCommentCloser(group.run)) &&
        open.opaque?.belowBaseCloses !== true && text !== '' && !RE_FOOTNOTE_DEF.test(text) &&
        (close === null || (column > 0 && column !== open.column) || open.absorbing === true)
    }
    if (!RE_COMMENT_LINE.test(text)) delete open.awaitingBody
    state.inDefList = false
    return
  }
  // Carry real CODE payload across boundaries without letting an interrupter claim a lazy tail.
  // A definition body's collector reads its own fence groups (carve-js#2819).
  const continuesFenceParagraph = state.definitionBody === true
    ? bottomBlockLeavesParagraphOpen(content)
    : continuesInlineFenceParagraph(content, state.unclosedFenceBase, facts?.terminatorFree ?? false)
  if (wasInlineFence && (wasInlineFenceBlock || continuesFenceParagraph) && !RE_COMMENT_LINE.test(content.trimStart()) && !RE_ADMONITION_CLOSE.test(content.trimStart()) && colonFenceOpenerLen(content) === null) {
    state.lazyFoldable = !isBlankLine(content) &&
      (bottomBlockLeavesParagraphOpen(content) || (wasInlineFenceBlock && leadingWhitespace(content) > 0))
    state.inlineFenceParagraph = true
    if (wasInlineFenceBlock) state.inlineFenceBlock = true
    state.inDefList = false
    return
  }
  if (state.deepest?.literalColon && !state.ownedAuthored && state.ownedColumn >= 0 &&
      indentColumns(content, state.ownedColumn) >= state.ownedColumn) {
    const offset = state.ownedColumn
    const inner = state.deepest
    trackItemLazyState(
      sliceColumns(content, offset, true), inner,
      (marker, extra = 0) => hasFenceCloser(marker, extra < 0 ? extra : offset + extra), true, () => false,
      {terminatorFree: facts?.terminatorFree ?? false, whitespace: 0, descendantFrames: true, rebasedFrame: true},
      (width, extra = 0) => hasLiteralCommentCloser?.(width, offset + extra) ?? false,
    )
    // The checker keeps a descendant line block outside this item's paragraph.
    state.lazyFoldable = inner.literalColon === undefined && inner.lazyFoldable
    state.inTable = inner.inTable
    // An invisible descendant comment ends its paragraph, not the enclosing item.
    if (inner.literalColon && RE_COMMENT_LINE.test(sliceColumns(content, offset, true).trimStart())) {
      state.commentAtColumn = true
    }
    state.inDefList = false
    return
  }
  const authoredColon = state.authoredColon
  if (state.opaque === null && authoredColon && state.divDepth === authoredColon.depth) {
    const close = RE_ADMONITION_CLOSE.exec(content.trimStart())
    const column = indentColumns(content, authoredColon.column + 1)
    if (close && close[1]!.length === authoredColon.width && (column === 0 || column === authoredColon.column)) {
      delete state.authoredColon
      state.divDepth--
      const hadDescendant = state.deepest !== undefined && state.deepest !== null
      state.ownedColumn = -1
      state.deepest = null
      if (hadDescendant) state.closedColonBody = true
      state.lazyFoldable = false
      state.inDefList = false
      return
    }
  }
  if (atContentColumn && state.opaque === null && authoredColon && authoredColon.column > 0 &&
      indentColumns(content, authoredColon.column) < authoredColon.column && !RE_COMMENT_LINE.test(content.trimStart())) {
    const text = content.trimStart()
    if (state.descriptionHasTerm && state.descriptionColumn !== undefined && !state.lazyFoldable && opensCodeFence(text)) {
      const fence = RE_FENCE.exec(text) ?? RE_RAW_FENCE.exec(text)
      const marker = RE_FENCE.test(text) ? fence![2]! : fence![1]!
      state.opaque = { kind: 'code', close: fenceCloseRe(marker), column: indentColumns(content) }
      state.inDefList = false
      return
    }
    state.ownedColumn = -1
    state.deepest = null
    state.lazyFoldable = bottomBlockLeavesParagraphOpen(content) && colonFenceOpenerLen(content) === null &&
      (!opensCodeFence(content) || state.lazyFoldable)
    state.inDefList = false
    return
  }
  if (atContentColumn && state.opaque === null && authoredColon && state.divDepth >= authoredColon.depth) {
    const column = indentColumns(content, authoredColon.column + 1)
    const base = authoredColon.column
    if (base > 0 && column >= base) {
      content = sliceColumns(content, base, true)
      if (facts) facts = { ...facts, whitespace: facts.whitespace === undefined ? undefined : Math.max(0, facts.whitespace - base) }
      const closer = hasFenceCloser
      hasFenceCloser = (marker, extra = 0) => closer(marker, extra < 0 ? extra : extra + base)
    } else {
      const run = commentFenceRun(content.trimStart())
      if (run !== undefined && hasCommentCloser(run)) content = content.trimStart()
    }
  }
  if (!atContentColumn && state.opaque === null && (state.literalColon || state.authoredColon) && RE_COMMENT_LINE.test(content.trimStart())) {
    const run = commentFenceRun(content.trimStart())
    if (state.literalColon && run !== undefined && hasCommentCloser(run)) state.literalColon.belowComment = run
    if (state.authoredColon && run !== undefined && hasCommentCloser(run)) state.authoredColon.belowComment = run
    state.invisibleAtColumn = state.literalColon === undefined
    state.commentAtColumn = state.literalColon === undefined
    return
  }
  const inlineCommentRun = wasInlineFence ? commentFenceRun(content.trimStart()) : undefined
  if (wasInlineFence && RE_COMMENT_LINE.test(content.trimStart()) &&
      (inlineCommentRun === undefined || !hasCommentCloser(inlineCommentRun))) {
    state.inlineFenceParagraph = true
    if (wasInlineFenceBlock) state.inlineFenceBlock = true
  }
  if (state.opaque?.kind === 'comment') {
    const comment = state.opaque
    // A CLOSER IS NOT A BARE RUN. This said it was - "so this test stays
    // anchored, unlike the opener below, which may carry an info string" - and
    // PART 9 §28 gives the closer the same insignificant tail as the opener:
    // `%%% end` closes one. It also matches on EXACT length, where this read
    // `>=`.
    const run = commentFenceRun(content)
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
      state.commentAtColumn = comment.atColumn && !atContentColumn
      state.closedBelowComment = !comment.atColumn && !comment.term && state.inDefList === false
    } else {
      state.lazyFoldable = false
    }
    state.inDefList = comment.term ? 'term' : false
    return
  }
  if (state.opaque?.kind === 'code') {
    // See the comment twin above.
    state.deepest = null
    const base = state.opaque.column ?? 0
    const column = indentColumns(content, base + 1)
    if (column <= base && state.opaque.close.test(content.trimStart())) state.opaque = null
    state.lazyFoldable = false
    state.inDefList = false
    return
  }
  if (state.inDefList === 'term' && (state.lazyFoldable || state.termAfterComment) && state.opaque === null &&
      leadingWhitespace(content) > 0 && RE_COMMENT_LINE.test(content.trimStart())) {
    const run = commentFenceRun(content.trimStart())
    if (run !== undefined && hasCommentCloser(run)) {
      state.opaque = { kind: 'comment', length: run, paragraphBefore: false, atColumn: false, term: true }
    }
    state.lazyFoldable = false
    state.termAfterComment = true
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
  if (atContentColumn && state.divDepth > 0 && (content[0] === ' ' || content[0] === '\t') &&
      isBlockAttributeLine(content.trimStart())) {
    state.lazyFoldable = false
    state.inDefList = false
    return
  }
  if (isBlankLine(content)) {
    delete state.termAfterComment
    if (state.descriptionHasTerm === false) state.inDefList = false
    // A blank is a separator; a `:  def` may follow it (djot allows a blank
    // between a term and its definition), so leave inDefList unchanged.
    state.lazyFoldable = false
    // The paragraph that was absorbing fences ends here, so the next
    // fence-shaped line is an opener again.
    state.absorbingFence = false
    if (state.deepest) delete state.deepest.closedColonBody
    return
  }
  // A definition-list term or definition marker opens (or continues) a def
  // list in this item, and leaves an open paragraph for its body.
  if (RE_DEFLIST_TERM.test(content) || RE_DEFLIST_DEF.test(content)) {
    const isTerm = RE_DEFLIST_TERM.test(content)
    const hasTerm = isTerm || state.inDefList === 'term' ||
      (state.inDefList === 'description' && state.descriptionHasTerm === true)
    state.descriptionHasTerm = hasTerm
    state.inDefList = isTerm ? 'term' : 'description'
    const description = RE_DEFLIST_DEF.exec(content)
    if (description) state.descriptionColumn = 1 + description[1]!.length
    delete state.termAfterComment
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
  // A closed child leaves the following unmatched fence foldable; a blank ends that claim.
  const followsClosedChild = state.divDepth > 0 && state.deepest?.closedColonBody === true
  if (fenceMarker !== null && ((!state.lazyFoldable && !followsClosedChild) || hasFenceCloser(fenceMarker))) {
    state.opaque = { kind: 'code', close: fenceCloseRe(fenceMarker) }
    state.deepest = null
    state.lazyFoldable = false
    state.inDefList = false
    return
  }
  if (fenceMarker !== null) {
    // An unterminated fence mid-paragraph: inline verbatim, and the paragraph
    // it sits in stays open. Fall through to the bottom rather than returning,
    // which is where ordinary paragraph text lands.
    state.lazyFoldable = true
    state.inlineFenceParagraph = true
    state.unclosedFenceBase ??= 0
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
  if (commentRun !== undefined && hasCommentCloser(commentRun)) {
    state.opaque = { kind: 'comment', length: commentRun, paragraphBefore: state.lazyFoldable, atColumn: atContentColumn }
    state.deepest = null
    state.lazyFoldable = false
    state.inDefList = false
    return
  }
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
  const run = authoredFenceWhitespace ?? facts?.whitespace
  // A tab opener reports its run in characters; ownership compares columns.
  const runColumns = authoredFenceColumns ?? run
  if (atContentColumn && state.opaque === null && run !== undefined && runColumns !== undefined &&
      runColumns > 0 && isTableRow(content.slice(run))) {
    state.inTable = true
    state.lazyFoldable = false
    state.inDefList = false
    return
  }
  if (state.inDefList === 'description' && state.descriptionHasTerm &&
      run !== undefined && runColumns !== undefined && runColumns > 0 &&
      RE_HEADING.test(content.slice(run))) {
    state.lazyFoldable = false
    state.inDefList = false
    return
  }
  if (state.inDefList === 'description' && state.descriptionColumn !== undefined &&
      runColumns !== undefined && runColumns > 0 && runColumns < state.descriptionColumn &&
      (colonBlockOpenerRun(content.slice(run!)) !== null || RE_BLOCKQUOTE.test(content.slice(run!)))) state.inDefList = false
  if (state.inDefList === 'description' && run !== undefined && run > 0 &&
      (isTableRow(content.slice(run)) || RE_HR.test(content.slice(run)))) {
    state.lazyFoldable = false
    state.inDefList = false
    state.inTable = isTableRow(content.slice(run))
    return
  }
  if (state.inDefList === 'description' && state.descriptionHasTerm && state.descriptionColumn !== undefined &&
      run !== undefined && runColumns !== undefined && runColumns >= state.descriptionColumn) {
    const text = content.slice(run)
    // A deeper authored run can still belong to the description's inline fence paragraph.
    if (RE_HEADING.test(text) || RE_HR.test(text) || isTableRow(text) || (isBlockAttributeLine(text) && !(state.ownedAuthored && state.ownedColumn > state.descriptionColumn)) || colonFenceOpenerLen(text) !== null || RE_BLOCKQUOTE.test(text)) {
      state.ownedColumn = state.descriptionColumn
      state.ownedAuthored = false
      const inner = state.deepest = verbatimOnlyLazyState()
      inner.definitionBody = true
      trackItemLazyState(text, inner)
      state.lazyFoldable = inner.lazyFoldable
      state.inTable = inner.inTable
      state.inDefList = false
      return
    }
  }
  let readFlush = false
  let readDescendant = false
  if (run !== undefined && runColumns !== undefined) {
    if (state.ownedColumn >= 0) {
      if (runColumns < state.ownedColumn) {
        const text = content.slice(run)
        const marker = markerPrefixLength(text, 0, prefixWalkBound(text)) > 0
        if (!state.literalLayout && facts?.rebasedFrame !== true && !state.ownedAuthored && (state.deepest?.ownedColumn ?? -1) < 0 &&
            (state.deepest?.commentAtColumn || wasCommentAtColumn) && marker) {
          state.retainedMarker = true
          state.lazyFoldable = false
          state.commentAtColumn = false
          return
        }
        if (facts?.rebasedFrame !== true && !state.ownedAuthored && state.deepest?.lazyFoldable && state.lazyFoldable &&
            (marker
              ? state.ownedMarker !== undefined && run > state.ownedMarker
              : bottomBlockLeavesParagraphOpen(text) && !lineOpensBlock(text) && !opensWrappedAttributeBlock(text))) {
          state.absorbingFence = wasAbsorbing
          return
        }
        if (!state.ownedAuthored && RE_COMMENT_LINE.test(text)) {
          state.invisibleAtColumn = true
          state.commentAtColumn = true
          state.lazyFoldable = false
          state.inDefList = false
          return
        }
        const closedDescendantMarker = facts?.rebasedFrame !== true && !state.ownedAuthored && state.deepest?.invisibleAtColumn === true &&
          !state.deepest.lazyFoldable && marker
        state.ownedColumn = -1
        state.deepest = null
        // A new marker after a closed descendant supplies no continuation
        // claim. A line already admitted by an ancestor may still belong here.
        if (closedDescendantMarker) {
          state.retainedMarker = true
          state.lazyFoldable = false
          state.inDefList = false
          return
        }
      } else if (state.ownedAuthored && (runColumns === state.ownedColumn ||
          (state.authoredColon !== undefined && runColumns > state.authoredColon.column && hostedAuthoredBlockOpener(content.slice(run))) || (state.divDepth === 0 &&
          colonFenceOpenerLen(content.slice(run)) !== null))) readFlush = true
      else if (!state.ownedAuthored && (facts?.descendantFrames === true || authoredFenceColumns !== undefined)) readDescendant = true
    }
    if (state.ownedColumn < 0 && atContentColumn && run > 0 &&
        (state.unclosedFenceBase === undefined || runColumns === state.unclosedFenceBase)) {
      state.ownedColumn = runColumns
      state.ownedAuthored = true
      readFlush = true
    }
  }
  // THE DESCENDANT FRAME ANSWERS. One line, in the deeper item's coordinates,
  // through this same tracker - so a fenced body, a `:::` container and a quote
  // are read there exactly as they are here, rather than enumerated. An
  // enumeration of block kinds is how the three engines drifted apart.
  if (readDescendant && state.inDefList === false) {
    // A footnote body is measured from the note's column, so its continuation keeps that offset.
    const dedented = state.deepest?.inFootnoteBody === true
      ? sliceColumns(content, state.ownedColumn, true)
      : content.slice(run!)
    const inlineFence = RE_FENCE.exec(dedented)
    const inlineMarker = inlineFence?.[2] ?? RE_RAW_FENCE.exec(dedented)?.[1]
    const inner = (state.deepest ??= {
      ...verbatimOnlyLazyState(),
      lazyFoldable: state.lazyFoldable && inlineMarker !== undefined && !hasFenceCloser(inlineMarker, run!),
    })
    trackItemLazyState(
      dedented,
      inner,
      (marker, extra = 0) => hasFenceCloser(marker, extra + run!),
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
      (width, extra = 0) => hasLiteralCommentCloser?.(width, run! + extra) ?? false,
    )
    if (inner.inFootnoteBody && RE_FOOTNOTE_DEF.test(dedented))
      inner.footnoteBodyColumn = runColumns! - state.ownedColumn + FOOTNOTE_BODY_COLUMN
    state.commentAtColumn = inner.commentAtColumn
    state.lazyFoldable = inner.lazyFoldable
    state.inTable = inner.inTable
    state.inDefList = false

    return
  }
  // An open quote's own paragraph takes the line as lazy text, so its run is
  // not authored either. A quote that ended on a block holds no such paragraph
  // and the run below it is the ITEM's - the shape this ticket was found on
  // (`: - > | a |` with an over-indented table under it). An open colon-fence
  // container and an open description entry hold the run for the same reason:
  // each is the innermost container and reads its body flush.
  if (
    readFlush && (state.divDepth === 0 || (state.divDepth > 0 && state.literalColon === undefined && !state.literalLayout &&
      (opensCodeFence(content.slice(run!)) || RE_LINE_BLOCK_OPEN.test(content.slice(run!)))) ||
      (state.authoredColon !== undefined && runColumns! > state.authoredColon.column && hostedAuthoredBlockOpener(content.slice(run!)))) &&
    state.inDefList === false && !state.unrebasedColonBody &&
    (wasQuote === null || !blockQuoteParagraphOpen(wasQuote) ||
      (state.unclosedFenceBase !== undefined && runColumns === state.unclosedFenceBase) ||
      (state.descriptionHasTerm && state.ownedAuthored && runColumns === state.ownedColumn))
  ) {
    const overIndented = content.slice(run!)
    const inlineCode = RE_FENCE.exec(overIndented) ?? RE_RAW_FENCE.exec(overIndented)
    if (inlineCode && state.divDepth > 0 && state.literalColon === undefined && !state.literalLayout &&
        (state.authoredColon === undefined || runColumns! > state.authoredColon.column)) {
      const marker = RE_FENCE.test(overIndented) ? inlineCode[2]! : inlineCode[1]!
      state.opaque = { kind: 'code', close: fenceCloseRe(marker), column: authoredFenceColumns ?? run! }
      state.lazyFoldable = false
      state.inDefList = false
      return
    }
    if (inlineCode && state.lazyFoldable) {
      const marker = RE_FENCE.test(overIndented) ? inlineCode[2]! : inlineCode[1]!
      if (!hasFenceCloser(marker, authoredFenceColumns ?? run!) && !hasFenceCloser(marker, 0)) {
        state.inlineFenceParagraph = true
        state.unclosedFenceBase ??= runColumns!
        state.inDefList = false
        return
      }
      if ((facts?.descendantFrames === true || authoredFenceColumns !== undefined) && !wasDescendantColumn) {
        state.opaque = { kind: 'code', close: fenceCloseRe(marker), column: authoredFenceColumns ?? run! }
        state.lazyFoldable = false
        state.inDefList = false
        return
      }
    }
    const colon = colonFenceOpenerLen(overIndented)
    if (colon !== null && !wasInlineFence && !wasAbsorbing && !wasClosedColon) {
      state.divDepth++
      if (RE_LINE_BLOCK_OPEN.test(overIndented)) state.literalColon = { width: colon, column: run! }
      else state.authoredColon = { width: colon, column: run!, depth: state.divDepth }
      state.lazyFoldable = false
      state.inDefList = false
      return
    }
    if (colon === null && /^:{3,}/.test(overIndented)) {
      state.absorbingFence = true
      state.lazyFoldable = true
      state.inDefList = false
      return
    }
    if (wasClosedColon) {
      state.lazyFoldable = true
      state.inDefList = false
      return
    }
    const authoredQuote = RE_BLOCKQUOTE.exec(overIndented)
    if (authoredQuote && ((state.descriptionHasTerm || (!state.lazyFoldable && state.descriptionColumn !== undefined)) ||
        isBlankLine(authoredQuote[1] ?? ''))) {
      content = overIndented
      if (facts) facts = { ...facts, whitespace: 0 }
    }
    if (RE_HEADING.test(overIndented) || isTableRow(overIndented) || RE_HR.test(overIndented) || isBlockAttributeLine(overIndented)) {
      state.inTable = isTableRow(overIndented)
      state.lazyFoldable = false
      state.inDefList = false

      return
    }
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
  const invisibleContent = facts?.whitespace === undefined ? content : content.slice(facts.whitespace)
  if (
    atContentColumn &&
    RE_INVISIBLE_BLOCK_LEAD.test(invisibleContent) &&
    (RE_COMMENT_LINE.test(invisibleContent) || RE_FOOTNOTE_DEF.test(content) || isLinkDefLine(content))
  ) {
    // ONLY THE FOOTNOTE DEFINITION OPENS A RUN. A comment is one line and a
    // link reference definition has no body at all, so the line after either of
    // them is the container's again.
    state.inFootnoteBody = RE_FOOTNOTE_DEF.test(content)
    if (state.inFootnoteBody) state.footnoteBodyColumn = indentColumns(content) + FOOTNOTE_BODY_COLUMN
    else delete state.footnoteBodyColumn
    state.invisibleAtColumn = true
    state.commentAtColumn = false
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
  // A closed quoted note still owns its indented quoted body line, but open quoted prose reads it literally.
  const quotedLine = RE_BLOCKQUOTE.exec(content) ??
    (wasQuote !== null && !blockQuoteParagraphOpen(wasQuote) &&
      wasQuote.hosts?.kinds.at(-1) === 'note' && indentColumns(content) < 4
      ? RE_BLOCKQUOTE.exec(content.trimStart()) : null)
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
      facts?.quoteFenceCloser ?? (() => true),
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
  if (bareFence && state.divDepth > 0 && (state.authoredColon === undefined ||
    state.divDepth !== state.authoredColon.depth || content.trim().length === state.authoredColon.width)) {
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
    if (RE_LINE_BLOCK_OPEN.test(content)) state.literalColon = {width: colonFenceOpenerLen(content)!, column: indentColumns(content)}
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
    state.absorbingFence = state.divDepth === 0 || state.authoredColon !== undefined
    state.lazyFoldable = !(wasClosedColon && wasClosedLiteralComment)
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
  const nestedAttr = extractItemAttr(content, facts?.terminatorFree)
  const nestedMarker = nestedAttr ? (nestedAttr.markerLine ?? nestedAttr.stripped) : content
  const nestedTask = taskMatch(nestedMarker, facts?.terminatorFree)
  const nestedBullet = nestedTask ? null
    : (orderedMatch(nestedMarker, facts?.terminatorFree) ?? unorderedMatch(nestedMarker, facts?.terminatorFree))
  if (nestedTask || nestedBullet) {
    if (state.authoredColon !== undefined && state.divDepth > state.authoredColon.depth && state.lazyFoldable) {
      state.absorbingFence = wasAbsorbing
      return
    }
    if (!atContentColumn && state.deepest != null && state.lazyFoldable) {
      state.absorbingFence = wasAbsorbing
      return
    }
    state.absorbingFence = false
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
    // The helper unwraps the marker itself, so `- - # H` and `- # H` are one
    // question asked once.
    const nested = markerLineState(content, facts?.prefixMemo)
    state.lazyFoldable = nested.leavesParagraphOpen
    state.inTable = nested.endsOnTableRow
    state.quoteInner = nested.quote
    state.inDefList = false
    // THE FRAME THIS MARKER OPENS, seeded with what the marker itself holds.
    // Starting it empty would say no paragraph is open in the sub-item, and
    // that is what decides whether a fence written in it INTERRUPTS or is
    // absorbed (section 10 I4).
    if (state.ownedColumn >= 0) {
      const frame = verbatimOnlyLazyState()
      frame.lazyFoldable = nested.leavesParagraphOpen
      frame.inTable = nested.endsOnTableRow
      frame.quoteInner = nested.quote
      const nestedContent = (nestedTask ?? nestedBullet)!.at(-1)!
      const nestedColon = colonFenceOpenerLen(nestedContent)
      if (nestedColon !== null) {
        frame.lazyFoldable = false
        frame.divDepth = 1
        if (RE_LINE_BLOCK_OPEN.test(nestedContent)) frame.literalColon = { width: nestedColon, column: 0 }
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
      state.deepest = frame
    } else {
      state.deepest = null
    }
    return
  }
  // Everything else (plain prose, div body text) leaves an open paragraph the
  // dedented line can continue. Prose folds into a def body, so an open def list
  // stays open (inDefList unchanged) - and it is the SAME paragraph, so an
  // absorption already under way survives it.
  state.absorbingFence = wasAbsorbing
  state.lazyFoldable = true
  if (wasInlineFence) state.inlineFenceParagraph = true
  if (wasInlineFenceBlock && wasInlineFence) state.inlineFenceBlock = true
  // A quote's lazy line retains its paragraph claim. A closed quote retains
  // it only while a descendant still owns the line; otherwise a quoted note
  // would lend its claim to prose in the enclosing item (carve-js#3361).
  if (wasQuote !== null && (blockQuoteParagraphOpen(wasQuote) || quoteOwnerColumn >= 0)) {
    trackBlockQuoteLazyState(
      content,
      wasQuote,
      () => true,
      () => true,
      undefined, undefined, false,
    )
    state.quoteInner = wasQuote
  }
}

}
