import type { createListStateTracker } from './parse-list-state.js'
import { classifyList } from './parse-list-marker.js'
import { finishList } from './parse-list-finish.js'
import type { BlockNode, List, ListItem, TaskState } from '../../ast.js'
import { Lexer, indentColumns, isBlankLine, isQuoteBlankLine, sliceColumns } from '../parse-lexer.js'
import { RE_COMMENT_BLOCK } from '../parse-prepass-core.js'
import { sourceColumnAt } from './parse-item-core.js'
import { ContainerBlankBuffer, nextContainerContent, runIndentationContainer, type ContainerAdmission } from '../block/parse-indentation-container.js'
import { dropPositions } from '../../source/source-positions.js'
import type { CommentFenceOpenerScan, FenceReachScan } from '../block/parse-block-boundaries.js'
import type { ParseSession, listHelpers, BlockQuoteLazyState, DescendantOpaque, ItemLazyState, ItemLineFacts, PendingAttrCarry, StrippedLineOrigin } from '../../parse.js'

/** Whether a note body this item tracks holds an open fence: its lines are payload, not openers. */
function noteFenceOpen(state: ItemLazyState): boolean {
  for (let frame = state.noteFrame; frame !== undefined; frame = frame.noteFrame) if (frame.opaque !== null) return true
  return false
}

export function createListParser(helpers: typeof listHelpers, trackItemLazyState: ReturnType<typeof createListStateTracker>) {
  const {
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
    authoredTaskState,
    blockQuoteParagraphOpen,
    bodyHoldsOpenCommentSpan,
    bottomBlockLeavesParagraphOpen,
    colonFenceOpenerLen,
    colonFenceShapeEndsLazyContinuation,
    commentBlockHasCloser,
    commentBlockSpans,
    commentFenceRun,
    coveredNoteComment,
    deflistContentCol,
    deflistMarkerLine,
    endsInPlus,
    extractItemAttr,
    fenceCloseRe,
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
    isTableRow,
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
    markerPrefixLength,
    matchListMarker,
    matchedCommentFenceEnd,
    nestedSubLexer,
    newCommentSpanScan,
    opensCodeFence,
    orderedContinues,
    orderedMatch,
    prefixWalkBound,
    opensWrappedAttributeBlock,
    trackWrappedAttributeRun,
    quoteIndentHasTab,
    quotePrefixDepth,
    quotePrefixLength,
    quotedLineText,
    restoreVerbatimBlanks,
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
    walkMarkerOwnerPrefix,
  } = helpers
  function classifyItemContinuation({ lexer, line, pendingBlankCount, itemQuoteDepth,
    physicalItemMarkerColumn, contentCol, baseIndent, previousNestedLine }: {
    lexer: Lexer
    line: string
    pendingBlankCount: number
    itemQuoteDepth: number
    physicalItemMarkerColumn: number
    contentCol: number
    baseIndent: number
    previousNestedLine: string | undefined
  }) {
    const markerSource = (lexer.rootLines ?? lexer.lines)[lexer.lineNumber(lexer.pos) - 1] ?? line
    const classifiedMarker = isContinuationMarker(line.slice(leadingWhitespace(line))) ? markerDecision(lexer, lexer.pos) : undefined
    const blankBeforeNestedContinuation = pendingBlankCount > 0 && classifiedMarker?.owner?.kind === 'list' &&
      classifiedMarker.owner.column > physicalItemMarkerColumn
    const plusColumn = itemQuoteDepth > 0 && sourceQuoteLocalColumn(markerSource, itemQuoteDepth) === 0
      ? Math.max(sourceColumn(markerSource), physicalItemMarkerColumn)
      : sourceColumn(markerSource)
    const classifiedListOwner = classifiedMarker?.owner?.kind === 'list' &&
      classifiedMarker.owner.column === plusColumn
    const listPlusOwner = isContinuationMarker(line.slice(leadingWhitespace(line))) &&
      isContinuationMarker(sourceQuoteBody(markerSource)) &&
      (baseIndent === 0 && !quoteIndentHasTab(markerSource, itemQuoteDepth) || classifiedListOwner) &&
      quotePrefixDepth(markerSource) === itemQuoteDepth &&
      (plusColumn === physicalItemMarkerColumn || plusColumn === contentCol && classifiedListOwner &&
        RE_FOOTNOTE_DEF.test((previousNestedLine ?? '').trimStart()) ||
        plusColumn === contentCol + 1 && classifiedListOwner &&
          RE_DEFLIST_DEF.test((previousNestedLine ?? '').trimStart()))
    return { markerSource, plusColumn, listPlusOwner, blankBeforeNestedContinuation }
  }

  type ListShape = ReturnType<typeof classifyList>

  /** The marker line that opens one item, read before any of its body is. */
  interface ItemHead {
    startLineIndex: number
    line: string
    terminatorFree: boolean
    attr: ReturnType<typeof extractItemAttr>
    markerLine: string
    content: string
    markerContentLength: number
    checked: boolean | undefined
    taskState: TaskState | undefined
    leadOrigin: StrippedLineOrigin | undefined
  }

  /** Where an item sits in its source, measured once its marker line is read. */
  interface ItemPlacement {
    contentCol: number
    itemSource: string
    itemMarkerColumn: number
    physicalItemMarkerColumn: number
    itemQuoteDepth: number
  }

  const RE_HOST_MARKER = /^(?::[ \t]+|\[\^[^\]]+\]:[ \t]+)/
  type AttachBoundary = (line: string) => boolean

  type FirstBlockOutcome =
    | { kind: 'none' }
    | { kind: 'item'; item: ListItem; next: 'continue' | 'loose' | 'end' }

  /** What one admitted line tells the item collector. */
  type Decision = 'continue' | 'stop'

  /** List-level facts an item decides while it is collected. */
  interface ListFlags {
    loose: boolean
    // §11 N1 hard boundary: a run of three or more blank lines before a
    // compatible sibling marker ends this list rather than loosening it. Set
    // where the loose decision is made, acted on after the item is pushed.
    hardBoundary: boolean
  }

  /** Is `line` a marker that continues this list at its base column (§11)? */
  function isSiblingMarker(shape: ListShape, line: string): boolean {
    return indentColumns(line, shape.baseIndent + 1) === shape.baseIndent &&
      matchListMarker(line, shape.isTask, shape.isOrdered) !== null &&
      (shape.isOrdered
        ? orderedContinues(line, shape.orderedKind, shape.orderedDelim)
        : unorderedMarkerChar(line) === shape.firstMarkerChar)
  }

  function markItem(item: ListItem, head: ItemHead): ListItem {
    if (head.checked !== undefined) item.checked = head.checked
    if (head.taskState !== undefined) item.taskState = head.taskState
    if (head.attr?.attrs) item.attrs = head.attr.attrs
    return item
  }

  /** Reads the marker line of the next item, or null where the list ends. */
  function readItemHead(lexer: Lexer, shape: ListShape): ItemHead | null {
    const { baseIndent, isTask, isOrdered } = shape
    const startLineIndex = lexer.pos
    const line = lexer.peek()!
    // Blank lines between siblings are handled by the per-item collector
    // below; a stray leading blank just ends the list.
    if (isBlankLine(line)) return null
    if (indentColumns(line, baseIndent + 1) !== baseIndent) return null
    // Strip an abutting `{...}` attribute block off the marker so the bare
    // marker regexes match; remember its attributes to attach to the <li>.
    const terminatorFree = lexer.lineTerminatorFree(lexer.pos)
    const attr = extractItemAttr(line, terminatorFree)
    const markerLine = attr ? (attr.markerLine ?? attr.stripped) : line
    const m = matchListMarker(markerLine, isTask, isOrdered, terminatorFree)
    if (!m) return null
    // §11: a sibling with a different marker character (unordered) or a
    // different delimiter (ordered) is a new list.
    if (!isOrdered && unorderedMarkerChar(markerLine) !== shape.firstMarkerChar) return null
    if (isOrdered && !orderedContinues(markerLine, shape.orderedKind, shape.orderedDelim, terminatorFree)) return null

    let content: string
    let checked: boolean | undefined
    let taskState: TaskState | undefined
    if (isTask) {
      checked = m[2]!.toLowerCase() === 'x'
      taskState = authoredTaskState(m[2]!, checked)
      content = m[3]!
    } else if (isOrdered) {
      content = m[4]!
    } else {
      content = m[2]!
    }
    const markerContentLength = content.length
    if (attr?.contentOffset !== undefined && attr.headWidth !== undefined) {
      content = line.slice(attr.contentOffset + markerLine.length - markerContentLength - attr.headWidth)
    }
    const markerTail = markerLine.slice(leadingWhitespace(markerLine), markerLine.length - markerContentLength)
    if (markerTail.includes('\t') && lineOpensBlock(content)) content = LAZY_FRAME + content
    const leadOrigin = terminatorFree && !content.startsWith(LAZY_FRAME)
      ? { text: content, parentIndex: startLineIndex, prefix: line.length - content.length } : undefined
    return { startLineIndex, line, terminatorFree, attr, markerLine, content, markerContentLength, checked, taskState, leadOrigin }
  }

  // A plain lead followed immediately by a compatible sibling has no
  // continuation lines to collect. Parse its one-line body as an ordinary
  // nested block stream, while the next loop iteration owns the sibling.
  function oneLineItem(lexer: Lexer, session: ParseSession, shape: ListShape, head: ItemHead): ListItem | null {
    const { content, startLineIndex: itemStartLineIndex, leadOrigin } = head
    const nextLine = lexer.peek(1)
    if (!((!session.recordPositions || leadOrigin !== undefined) && session.activeMatchers.length === 0 && !head.attr &&
        content.length > 0 && !RE_FIRST_BLOCK_MARKER.test(content) &&
        nextLine !== undefined && isSiblingMarker(shape, nextLine))) return null
    lexer.consume()
    const simpleParagraph = /^\p{L}/u.test(content) && !lineOpensBlock(content)
    if (!session.recordPositions && simpleParagraph) {
      return markItem({ type: 'list_item', children: [session.parseSimpleListParagraph(content, lexer)] }, head)
    }
    const origins = session.recordPositions && leadOrigin
      ? new Map<number, StrippedLineOrigin>([[0, leadOrigin]]) : undefined
    const sub = nestedSubLexer(lexer, [content], itemStartLineIndex, [lexer.lineNumber(itemStartLineIndex)], origins)
    if (session.recordPositions) {
      sub.markerOpensSublist = true
      sub.hostBody = 'list'
      sub.hostMarkerColumn = sourceColumn((lexer.rootLines ?? lexer.lines)[lexer.lineNumber(itemStartLineIndex) - 1] ?? head.line)
    }
    if (session.recordPositions && simpleParagraph) {
      const paragraph = session.parseSimpleListParagraph(content, sub)
      attachBlockPos(sub, paragraph, 0, 1)
      const item: ListItem = { type: 'list_item', children: [paragraph] }
      attachBlockPos(lexer, item, itemStartLineIndex, lexer.pos)
      return markItem(item, head)
    }
    const item: ListItem = { type: 'list_item', children: session.parseBlocks(sub, 0) }
    if (session.recordPositions) attachBlockPos(lexer, item, itemStartLineIndex, lexer.pos)
    return markItem(item, head)
  }

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
  // CARVE-P2-010: a tab in the run before the content advances to the next stop of the marker's frame.
  function markerEndColumn(start: number, marker: string): number {
    let column = start
    for (const char of marker) column = char === '\t' ? column + 4 - column % 4 : column + 1
    return column
  }

  function placeItem(lexer: Lexer, shape: ListShape, head: ItemHead): ItemPlacement {
    const { baseIndent } = shape
    const contentCol = shape.isTask
      ? baseIndent + 2
      : markerEndColumn(baseIndent, head.markerLine.slice(leadingWhitespace(head.markerLine), head.markerLine.length - head.markerContentLength))
    const itemSource = (lexer.rootLines ?? lexer.lines)[lexer.lineNumber(head.startLineIndex) - 1] ?? head.line
    const itemMarkerColumn = sourceColumn(itemSource)
    const physicalItemMarkerColumn = Math.max(itemMarkerColumn, lexer.rootFrameColumn(head.startLineIndex) + baseIndent)
    const itemQuoteDepth = quotePrefixDepth(itemSource)
    return { contentCol, itemSource, itemMarkerColumn, physicalItemMarkerColumn, itemQuoteDepth }
  }

  // A top-level item with only indented prose before its next sibling has
  // no container decision to make. Parse that body once as a paragraph.
  function wrappedParagraphItem(
    lexer: Lexer, session: ParseSession, shape: ListShape, head: ItemHead, placement: ItemPlacement,
  ): ListItem | null {
    const { content } = head
    const { contentCol } = placement
    if (!(!session.recordPositions && session.activeMatchers.length === 0 && !head.attr && !shape.isTask &&
        shape.baseIndent === 0 && placement.itemQuoteDepth === 0 && content.length > 0 &&
        !RE_FIRST_BLOCK_MARKER.test(content) && /^\p{L}/u.test(content) &&
        !lineOpensBlock(content))) return null
    const wrapped: string[] = []
    let offset = 0
    while (true) {
      const candidate = lexer.peek(offset)
      if (candidate === undefined || isBlankLine(candidate) ||
          indentColumns(candidate, contentCol) < contentCol) break
      const body = sliceColumns(candidate, contentCol, true)
      if (leadingWhitespace(body) !== 0 || !/^\p{L}/u.test(body) ||
          lineOpensBlock(body)) break
      wrapped.push(body)
      offset++
    }
    const follower = lexer.peek(offset)
    if (wrapped.length === 0 || (follower !== undefined && !isSiblingMarker(shape, follower))) return null
    for (let index = 0; index < wrapped.length; index++) lexer.consume()
    return { type: 'list_item', children: [session.parseSimpleListParagraph(
      [content, ...wrapped].join('\n'), lexer,
    )] }
  }

  /** An item whose first block is attached by a `+` on the marker line, or stacked behind a quote marker. */
  function firstBlockItem(
    lexer: Lexer, session: ParseSession, shape: ListShape, head: ItemHead, placement: ItemPlacement,
    isItemAttachBoundary: AttachBoundary, firstItemAttachBoundary: AttachBoundary, flags: ListFlags,
  ): FirstBlockOutcome {
    const { content } = head
    const { itemSource } = placement
    const firstBlockMarker = RE_FIRST_BLOCK_MARKER.test(content)

    let markerEnd = content.length - 1
    while (content[markerEnd] === ' ' || content[markerEnd] === '\t') markerEnd--
    const stackedMarker = content[markerEnd] === '+' &&
      /^(?:(?:[-*] (?:\[[ xX_>\/!?-]\] )?|\. |(?:[0-9]+|[ivxlcdm]+|[IVXLCDM]+|[a-z]|[A-Z])[.)] ))+\+[ \t]*$/.test(content)
    if (lexer.peek() !== undefined && (stackedMarker || isStackedFirstBlockQuoteMarker(itemSource)) &&
        !firstItemAttachBoundary(lexer.peek()!)) {
      return stackedFirstBlockItem(lexer, session, shape, head, itemSource, isItemAttachBoundary)
    }
    if (!firstBlockMarker) return { kind: 'none' }
    if (lexer.peek() === undefined || isBlankLine(lexer.peek()!)) return { kind: 'none' }
    return attachedFirstBlockItem(lexer, session, shape, head, placement, isItemAttachBoundary, flags)
  }

  function stackedFirstBlockItem(
    lexer: Lexer, session: ParseSession, shape: ListShape, head: ItemHead,
    itemSource: string, isItemAttachBoundary: AttachBoundary,
  ): FirstBlockOutcome {
    const itemStartLineIndex = head.startLineIndex
    // The follower is read at the innermost opener's marker column, so a block it opens is not paragraph text
    // here, and a line below that column misses the block: it folds only into an open paragraph (PART 0 S4).
    const followerColumn = indentColumns(lexer.peek()!)
    const followerText = lexer.peek()!.trimStart()
    const followerIsQuote = RE_BLOCKQUOTE.test(followerText)
    const followerOpensBlock = lineOpensBlock(followerText)
    const attached = session.collectAttachedListBlock(lexer, (line) => isItemAttachBoundary(line) || (followerOpensBlock &&
      indentColumns(line, followerColumn) < followerColumn && (!followerIsQuote || lineOpensBlock(line.trimStart()))),
    shape.baseIndent, false, followerColumn)
    const nestedContentOffset = itemSource.lastIndexOf(head.content)
    const ownContentColumn = nestedContentOffset < 0 ? -1 : sourceColumnAt(itemSource, nestedContentOffset)
    // The follower stands at the innermost opener's marker column, which is column 0 of the nested line.
    const followerSlice = indentColumns(attached.lines[0] ?? '')
    const lines = [head.content, ...attached.lines.map(line => sliceColumns(line, Math.min(followerSlice, indentColumns(line)), true))]
    const numbers = [lexer.lineNumber(itemStartLineIndex), ...attached.lineNumbers]
    const emptyQuotedFollower = isStackedFirstBlockQuoteMarker(itemSource) &&
      /^>\s*$/.test(attached.lines[0] ?? '') && /^> \+[ \t]*$/.test(head.content)
    if (emptyQuotedFollower) lines[0] = head.content.replace(/\+[ \t]*$/, '>')
    const sub = nestedSubLexer(lexer, lines, itemStartLineIndex, numbers)
    const children = session.parseBlocks(sub, 0)
    if (emptyQuotedFollower && children[0]?.type === 'block_quote' && children[0].children[0]?.type === 'block_quote') {
      const outer = children[0]
      attachBlockPos(lexer, outer.children[0]!, attached.startLineIndex, attached.startLineIndex + 1)
      attachBlockPos(lexer, outer, itemStartLineIndex, lexer.pos)
      if (outer.pos) {
        const markerOffset = (lexer.lineAt(itemStartLineIndex) ?? '').indexOf('>')
        const marker = lexer.sourceBoundary(itemStartLineIndex, markerOffset)
        outer.pos.startColumn = marker.column
        outer.pos.startOffset = marker.offset
      }
    }
    let loose = false
    if (ownContentColumn >= 0) {
      while (true) {
        let gap = 0
        while (isBlankLine(lexer.peek(gap))) gap++
        const next = lexer.peek(gap)
        // A later `+` at this item's marker column gives the item its next block.
        if (gap === 0 && next !== undefined && isContinuationMarker(next.trimStart()) && indentColumns(next) === shape.baseIndent) {
          lexer.consume()
          const more = session.collectAttachedListBlock(lexer, isItemAttachBoundary, shape.baseIndent, false)
          if (more.lines.length === 0) break
          children.push(...session.parseBlocks(nestedSubLexer(lexer, more.lines, more.startLineIndex, more.lineNumbers), 0))
          continue
        }
        if (next === undefined || indentColumns(next) < ownContentColumn ||
            isSiblingMarker(shape, next)) break
        for (let index = 0; index < gap; index++) lexer.consume()
        const reached = session.collectAttachedListBlock(lexer, isItemAttachBoundary,
          shape.baseIndent, false)
        if (reached.lines.length === 0) break
        const body = reached.lines.map(line => sliceColumns(line, ownContentColumn, true))
        const bodyLexer = nestedSubLexer(lexer, body, reached.startLineIndex, reached.lineNumbers)
        const laterBlocks = session.parseBlocks(bodyLexer, 0)
        children.push(...laterBlocks)
        if (gap > 0 && laterBlocks.some(block => block.type === 'paragraph')) loose = true
      }
    }
    const stackedItem: ListItem = { type: 'list_item', children }
    attachBlockPos(lexer, stackedItem, itemStartLineIndex, lexer.pos)
    markItem(stackedItem, head)
    let blanks = 0
    while (isBlankLine(lexer.peek(blanks))) blanks++
    const sibling = lexer.peek(blanks)
    if (blanks === 0 || sibling === undefined || !isSiblingMarker(shape, sibling)) {
      return { kind: 'item', item: stackedItem, next: loose ? 'loose' : 'continue' }
    }
    for (let k = 0; k < blanks; k++) lexer.consume()
    return { kind: 'item', item: stackedItem, next: blanks >= 3 ? 'end' : 'loose' }
  }

  // The attached block is a block: a boundary line inside a fence it opened
  // is that fence's body, not a boundary (see the indented loop's note on
  // carve#975 and corpus category 279). Without this the opener came out an
  // EMPTY code block and the closer an inline code span, which is the same
  // damage category 278 pins one level in.
  function attachedFirstBlockItem(
    lexer: Lexer, session: ParseSession, shape: ListShape, head: ItemHead, placement: ItemPlacement,
    isItemAttachBoundary: AttachBoundary, flags: ListFlags,
  ): FirstBlockOutcome {
    const { baseIndent } = shape
    // The follower stands at the marker column; this lexer's lines start at the item's frame.
    const localBlockColumn = indentColumns(lexer.peek() ?? '')
    const {
      lines: attached,
      lineNumbers: attachedLineNumbers,
      startLineIndex: attachedStartLineIndex,
    } = session.collectAttachedListBlock(lexer, isItemAttachBoundary, baseIndent, false, localBlockColumn)
    // The selected block starts at its own column inside the item. Keep later
    // blocks pulled by a separate + at their own source columns.
    // A marker at the item's content column opens a sublist under an attached paragraph (§24 C3).
    if (attached.length > 1 && !lineOpensBlock(sliceColumns(attached[0]!, localBlockColumn, true))) {
      const cut = attached.findIndex((line, index) => index > 0 &&
        indentColumns(line) === placement.contentCol && isListMarkerLine(line.trimStart()))
      if (cut > 0) {
        lexer.pos -= attached.length - cut
        attached.length = cut
        attachedLineNumbers.length = cut
      }
    }
    for (let index = 0; index < attached.length; index++) {
      attached[index] = sliceColumns(attached[index]!, localBlockColumn, true)
    }
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
      const more = session.collectAttachedListBlock(lexer, isItemAttachBoundary, baseIndent, false)
      // An empty result is the column gate's refusal as well as an exhausted
      // boundary set, and a second marker that attaches nothing ends the run
      // either way (markup-carve/carve#1814).
      if (more.lines.length === 0) break
      // A marker at its host column ends an open fence (§17 L4, carve#4354).
      const opener = attached.find(line => line.trim() !== '' && !isBlockAttributeLine(line.trimStart()))?.trimStart()
      const run = opener !== undefined && opensCodeFence(opener) ? /^(`{3,}|~{3,})/.exec(opener)?.[1] : undefined
      if (run !== undefined && !attached.slice(attached.findIndex(line => line.trimStart() === opener) + 1).some(line => fenceCloseRe(run).test(line.trimStart()))) {
        attached.push(run)
        attachedLineNumbers.push(lexer.lineNumber(plusLineIndex))
      }
      attached.push('')
      attachedLineNumbers.push(lexer.lineNumber(plusLineIndex))
      attached.push(...more.lines)
      attachedLineNumbers.push(...more.lineNumbers)
    }
    const sub = nestedSubLexer(lexer, attached, attachedStartLineIndex, attachedLineNumbers)
    const fbChildren = session.parseBlocks(sub, 0)
    const fbItem: ListItem = { type: 'list_item', children: fbChildren }
    // The item ends at the attached block's boundary; its body goes on only at its content column (§17 L4).
    let gap = 0
    while (isBlankLine(lexer.peek(gap))) gap++
    const bodyLine = lexer.peek(gap)
    if (bodyLine !== undefined && indentColumns(bodyLine) >= placement.contentCol && !isSiblingMarker(shape, bodyLine)) {
      const rest = collectItem(lexer, session, shape, head, placement, '', isItemAttachBoundary, flags)
      fbChildren.push(...rest.children)
      attachBlockPos(lexer, fbItem, head.startLineIndex, lexer.pos)
      markItem(fbItem, head)
      return { kind: 'item', item: fbItem, next: flags.hardBoundary ? 'end' : 'continue' }
    }
    attachBlockPos(lexer, fbItem, head.startLineIndex, lexer.pos)
    markItem(fbItem, head)
    let blanks = 0
    while (isBlankLine(lexer.peek(blanks))) blanks++
    const sibling = lexer.peek(blanks)
    if (blanks === 0 || sibling === undefined || !isSiblingMarker(shape, sibling)) {
      return { kind: 'item', item: fbItem, next: 'continue' }
    }
    for (let index = 0; index < blanks; index++) lexer.consume()
    return { kind: 'item', item: fbItem, next: blanks >= 3 ? 'end' : 'loose' }
  }

  // A sub-item on a task item's marker line stands past the box, at its own column.
  function taskBoxLeadShift(head: ItemHead, content: string, terminatorFree: boolean): number {
    if (unorderedMatch(content, terminatorFree) === null && orderedMatch(content, terminatorFree) === null &&
      taskMatch(content, terminatorFree) === null) return 0
    return Math.max(0, head.markerLine.length - leadingWhitespace(head.markerLine) - head.markerContentLength - 2)
  }

  // So the lines below it are read from that sub-item's column. A line short of
  // it lowers the shift for the rest, which keeps a later fence's payload indent.
  function dedentTaskLead(nested: string[], shift: number): void {
    for (let k = 0; k < nested.length; k++) {
      const text = nested[k]!
      if (isBlankLine(text)) continue
      const indent = indentColumns(text)
      if (indent === 0) continue
      if (indent < shift) {
        nested[k] = sliceColumns(text, indent - 1, true)
        continue
      }
      shift = Math.min(shift, indent)
      if (shift > 0) nested[k] = sliceColumns(text, shift, true)
    }
  }

  function leadLazyState(
    lexer: Lexer, session: ParseSession, content: string, itemStartLineIndex: number, markerLineTerm: boolean,
  ): { leadState: ReturnType<typeof markerLineState>; lazyState: ItemLazyState } {
    // Track whether the item's collected content currently ends in an open
    // paragraph (family-D lazy continuation). The lead text opens one.
    // ONE WALK for the three questions the lead line answers.
    // At EOF no following line can consult the item's continuation state.
    // Descendants parse the marker content themselves; walking their prefixes
    // here repeats the same classification once per enclosing item.
    const noFollower = lexer.eof() || (lexer.peek() === '' && lexer.peek(1) === undefined)
    const leadState = noFollower ? {
      leavesParagraphOpen: false,
      endsOnTableRow: false,
      bottomIsContinuationMarker: false,
      wrappedAttributeRun: null,
      quote: null,
    } : markerLineState(content, session.markerPrefixMemo(lexer, itemStartLineIndex))
    const memo = session.markerPrefixMemo(lexer, itemStartLineIndex)
    const ownedColumn = noFollower || RE_BLOCKQUOTE.test(content) ? -1 : walkMarkerOwnerPrefix(content, memo) || -1
    const lazyState: ItemLazyState = {
      opaque: null,
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
      inDefList: markerLineTerm
        ? 'term'
        : RE_DEFLIST_DEF.test(content)
          ? 'description'
          : false,
      attrRun: leadState.wrappedAttributeRun,
      // A container may open on the marker line itself, which never reaches
      // `trackItemLazyState`, so the first line collected below it has to be
      // read in that container's coordinate system. Off the memoized prefix
      // walk `markerLineState` already made, never a second marker match.
      // A QUOTE OWNS BY ITS MARKER, NOT BY INDENT, so a run that starts with
      // one seeds nothing: a bare indented line below it is not the quote's
      // content, and whether it is the quote's lazy text is the question
      // `quoteInner` answers.
      ownedColumn,
      ownedAuthored: false,
      ownedQuote: () => ownedColumn > 0 ? markerLineQuoteState(content.slice(ownedColumn), memo) : null,
    }
    return { leadState, lazyState }
  }

  /** The column of the outermost marker holding a fence opened on a nested marker line, memoized per document line. */
  function commentHoldsAPlace(content: string, nested: readonly string[], children: readonly BlockNode[]): boolean {
    return RE_COMMENT_LINE.test(content) && commentFenceRun(content) === undefined && nested.length > 1 && isBlankLine(nested[0]!) &&
      children[0]?.type === 'comment' && children[1]?.type === 'paragraph'
  }

  // A block below the body has left the note, and so has every line after it. Text folds into an open paragraph.
  function rebaseTaskNote(nested: string[], shift: number): void {
    let noteParagraph = true
    for (let k = 0; k < nested.length; k++) {
      const text = nested[k]!
      if (isBlankLine(text)) continue
      if (indentColumns(text) < shift + FOOTNOTE_BODY_COLUMN) {
        if (noteParagraph && !lineOpensItemBlock(text.trimStart()) && !isListMarkerLine(text.trimStart())) continue
        break
      }
      noteParagraph = noteParagraph && !lineOpensItemBlock(text.trimStart())
      nested[k] = sliceColumns(text, shift, true)
    }
  }

  function markerFenceHolderColumn(
    lexer: Lexer, session: ParseSession, content: string, contentCol: number, itemStartLineIndex: number,
  ): number {
    const root = lexer.rootLines ?? lexer.lines
    const lineNumber = lexer.lineNumber(itemStartLineIndex)
    const cache = lexer.hasDocumentOffsets && lexer.prefixMemoAllowed(itemStartLineIndex)
      ? session.markerFenceHolderColumns.get(root) : undefined
    let holderColumn = cache?.get(lineNumber)
    if (holderColumn === undefined) {
      let at = 0
      let holder = 0
      const bound = prefixWalkBound(content)
      while (at < bound) {
        const quote = quotePrefixLength(content, at, bound)
        if (quote > 0) { at += quote; continue }
        const marker = markerPrefixLength(content, at, bound)
        if (marker === 0) break
        holder = at
        at += marker
      }
      holderColumn = contentCol
      for (const char of content.slice(0, holder)) holderColumn = char === '\t' ? holderColumn + 4 - holderColumn % 4 : holderColumn + 1
      if (lexer.hasDocumentOffsets && lexer.prefixMemoAllowed(itemStartLineIndex)) {
        const columns = cache ?? new Map<number, number>()
        columns.set(lineNumber, holderColumn)
        if (!cache) session.markerFenceHolderColumns.set(root, columns)
      }
    }
    return holderColumn
  }

  /** Frames comment payload lines inside a closed span unless a nested item or description hides the opener. */
  function frameCommentPayloads(content: string, nested: string[], terminatorFree: boolean, candidates: Map<number, string>): void {
    const closedComments = commentBlockSpans([content, ...nested])
    const nestedItemColumn = markerContentColumn(content, terminatorFree)
    let scanned = 0
    let opener = -1
    for (const [index, payload] of candidates) {
      if (!closedComments[index + 1]) continue
      while (scanned < index) {
        if (commentFenceRun(nested[scanned]!)) opener = scanned
        scanned++
      }
      // A nested item or description hides a fence at its own body column.
      const openerColumn = opener >= 0 ? indentColumns(nested[opener]!) : -1
      let descriptionColumn: number | undefined
      if (opener >= 0 && RE_DEFLIST_TERM.test(content)) {
        for (let at = opener - 1; at >= 0; at--) {
          const description = RE_DEFLIST_DEF.exec(nested[at]!)
          if (description) {
            descriptionColumn = deflistContentCol(description[1]!)
            break
          }
        }
      }
      if (openerColumn === nestedItemColumn || openerColumn === descriptionColumn) continue
      nested[index] = LAZY_FRAME + stripLazyFrame(payload)
    }
  }

  /** The fence a marker line opens at its bottom block, and that block's column, memoized per prefix walk. */
  function markerFenceAt(
    session: ParseSession,
    text: string,
    column: number,
    prefixMemo?: Map<number, number>,
  ): { close: RegExp | null; base: number } {
    let memo = prefixMemo ? session.markerFenceMemos.get(prefixMemo) : undefined
    if (prefixMemo && !memo) {
      memo = new Map()
      session.markerFenceMemos.set(prefixMemo, memo)
    }
    const bound = prefixWalkBound(text)
    let at = 0
    let base = column
    let close: RegExp | null = null
    let reused = false
    const path: Array<{ length: number; offset: number; column: number }> = []
    for (;;) {
      const cached = memo?.get(text.length - at)
      if (cached) {
        at += cached.offset
        base += cached.column
        close = cached.close
        reused = true
        break
      }
      if (memo) path.push({ length: text.length - at, offset: at, column: base })
      const quoted = quotePrefixLength(text, at, bound)
      if (quoted > 0) {
        base += quoted
        at += quoted
        continue
      }
      const prefix = markerPrefixLength(text, at, bound)
      if (prefix > 0) {
        base += markerContentColumn(text.slice(at, at + prefix) + 'x')
        at += prefix
        continue
      }
      // A description or note holding the fence on its marker line owns it from its body column (carve#4047).
      const host = RE_HOST_MARKER.exec(text.slice(at))
      if (host === null) break
      base += FOOTNOTE_BODY_COLUMN
      at += host[0].length
    }
    if (!reused) {
      const bottom = text.slice(at)
      const fence = RE_FENCE.exec(bottom) ?? RE_RAW_FENCE.exec(bottom)
      if (fence !== null) {
        const marker = RE_FENCE.test(bottom) ? fence[2]! : fence[1]!
        close = fenceCloseRe(marker)
      }
    }
    for (const entry of path) {
      memo!.set(entry.length, { offset: at - entry.offset, column: base - entry.column, close })
    }
    return { close, base }
  }

  // Preserve the existing extent of a fence-shaped descendant body span.
  // The parent tracker can leave its paragraph open after a child marker,
  // even though that child's body has already reached a fence run.
  function descendantFenceTrails(
    lexer: Lexer, session: ParseSession, itemStartLineIndex: number, content: string, nested: string[],
    nestedOrigins: Map<number, StrippedLineOrigin>, continuationFenceBreaks: Set<number>,
    lineFacts: (text: string, origin?: StrippedLineOrigin) => ItemLineFacts | undefined,
  ): boolean {
    const commentRuns: Array<number | undefined> = []
    const commentClosers = new Map<number, number>()
    for (let index = 0; index < nested.length; index++) {
      const line = nested[index]!
      const facts = lineFacts(line, nestedOrigins.get(index))
      const text = line.slice(facts?.whitespace ?? 0).trimStart()
      const run = commentFenceRun(markerLineBottomBlock(text, facts?.prefixMemo))
      commentRuns.push(run)
      if (run !== undefined) commentClosers.set(run, index)
    }
    const leadMemo = session.markerPrefixMemo(lexer, itemStartLineIndex)
    const leadFrame = markerFenceAt(session, content, 0, leadMemo)
    let frameBase: number | null = leadFrame.base
    let markerFence: DescendantOpaque | null = leadFrame.close === null ? null : { close: leadFrame.close, base: leadFrame.base }
    let replacementMarkerFence = false
    let bodyFence: (DescendantOpaque & { owner: number | null }) | null = null
    let commentOpen = commentFenceRun(markerLineBottomBlock(content, leadMemo))
    const leadHasNoQuote = !content.slice(0, content.length - markerLineBottomBlock(content, leadMemo).length).includes('>')
    if (commentOpen !== undefined && !commentClosers.has(commentOpen)) commentOpen = undefined
    for (let bodyIndex = 0; bodyIndex < nested.length; bodyIndex++) {
      if (continuationFenceBreaks.has(bodyIndex)) {
        frameBase = null
        markerFence = null
        replacementMarkerFence = false
        bodyFence = null
      }
      const bodyLine = nested[bodyIndex]!
      if (isBlankLine(bodyLine)) continue
      const column = indentColumns(bodyLine)
      const opener = bodyLine.trimStart()
      const commentRun = commentRuns[bodyIndex]
      if (commentOpen !== undefined) {
        if (commentRun === commentOpen) commentOpen = undefined
        continue
      }
      // A shallower line loses evidence of which descendant still owns the block.
      if (frameBase !== null && column < frameBase) frameBase = null
      let markerCloser = false
      let endedMarkerFenceOnMarker = false
      if (markerFence !== null) {
        if (column < markerFence.base) {
          endedMarkerFenceOnMarker = isListMarkerLine(bodyLine) &&
            leadHasNoQuote
          markerFence = null
        }
        else if (column === markerFence.base && markerFence.close.test(opener)) {
          markerFence = null
          markerCloser = true
        }
      }
      if (bodyFence !== null) {
        if (bodyFence.owner !== null && column === bodyFence.owner && bodyFence.close.test(opener)) {
          bodyFence = null
          continue
        }
        if (column < bodyFence.base) bodyFence = null
        else {
          if (column === bodyFence.base && bodyFence.close.test(opener)) bodyFence = null
          continue
        }
      }
      if (markerCloser) continue
      if (markerFence === null && commentRun !== undefined &&
        (commentClosers.get(commentRun) ?? -1) > bodyIndex) {
        commentOpen = commentRun
        continue
      }
      if (markerFence === null && (isListMarkerLine(bodyLine) || RE_HOST_MARKER.test(opener))) {
        const frame = markerFenceAt(session, opener, column, lineFacts(bodyLine, nestedOrigins.get(bodyIndex))?.prefixMemo)
        frameBase = frame.base
        markerFence = frame.close === null ? null : { close: frame.close, base: frame.base }
        replacementMarkerFence = endedMarkerFenceOnMarker
      }
      const fence = RE_FENCE.exec(opener) ?? RE_RAW_FENCE.exec(opener)
      if (fence !== null) {
        const marker: string = RE_FENCE.test(opener) ? fence[2]! : fence[1]!
        bodyFence = { close: fenceCloseRe(marker), base: column, owner: frameBase !== null && frameBase > 0 && frameBase <= column ? frameBase : null }
      }
    }
    if (continuationFenceBreaks.has(nested.length)) {
      markerFence = null
      bodyFence = null
    }
    return bodyFence !== null || (markerFence !== null && !replacementMarkerFence)
  }

  /** Frames a marker-line note's code fence after a blank, before any nested note, so the item parse reads it as text. */
  function frameNoteCommentFences(nested: string[], openers: readonly number[], noteParagraphMarkers: Set<number>): void {
    let nestedNoteSeen = false
    let priorChecked = 0
    for (const openerIndex of openers) {
      const index = openerIndex - 1
      if (index < 1) continue
      for (; priorChecked < index; priorChecked++) {
          const text = nested[priorChecked]!.trimStart()
          if (RE_FOOTNOTE_DEF.test(text) ||
              (isListMarkerLine(text) && !noteParagraphMarkers.has(priorChecked))) nestedNoteSeen = true
      }
      if (!isBlankLine(nested[index - 1]!)) continue
      if (nestedNoteSeen) continue
      const opener = nested[openerIndex]!.trimStart()
      const fence = RE_FENCE.exec(opener) ?? RE_RAW_FENCE.exec(opener)
      if (fence === null) continue
      const marker = RE_FENCE.test(opener) ? fence[2]! : fence[1]!
      const closer = fenceCloseRe(marker)
      const openerColumn = indentColumns(nested[openerIndex]!)
      for (let end = openerIndex + 1; end < nested.length; end++) {
        if (indentColumns(nested[end]!) === openerColumn && closer.test(nested[end]!.trimStart())) {
          nested[end] = LAZY_FRAME + nested[end]!.trimStart()
          break
        }
      }
      nested[openerIndex] = LAZY_FRAME + opener
    }
  }

  /** Gives the deepest trailing code block the blank lines its author wrote inside the fence. */
  function restoreDescendantFenceBlanks(lexer: Lexer, children: BlockNode[], blankCount: number): void {
    let blocks = children
    const owners: Array<List | ListItem> = []
    for (;;) {
      const list = [...blocks].reverse().find(block => block.type === 'list') as List | undefined
      if (!list) break
      const item = list.items.at(-1)
      if (item) owners.push(list, item)
      blocks = item?.children ?? []
    }
    const code = [...blocks].reverse().find(block => block.type === 'code_block')
    if (code?.type === 'code_block') {
      let trailing = 0
      while (code.content[code.content.length - trailing - 1] === '\n') trailing++
      const body = code.content.slice(0, code.content.length - trailing)
      const blanks = trailing - Number(body.length > 0)
      const missing = blankCount - blanks
      if (missing > 0) code.content += '\n'.repeat(missing)
      else if (missing < 0) {
        code.content = code.content.slice(0, missing)
        if (code.pos?.endOffset !== undefined) {
          const oldEndOffset = code.pos.endOffset
          code.pos.endLine = code.pos.startLine + code.content.split('\n').length
          code.pos.endOffset = (lexer.documentRoot ?? lexer).lineOffset(code.pos.endLine - 1)
          code.pos.endColumn = 1
          for (const owner of owners) {
            if (owner.pos?.endOffset === oldEndOffset) {
              owner.pos.endLine = code.pos.endLine
              owner.pos.endOffset = code.pos.endOffset
              owner.pos.endColumn = code.pos.endColumn
            }
          }
        }
      }
    }
  }

  function trimStrayPlusFence(lexer: Lexer, children: BlockNode[], itemStartLineIndex: number): void {
    // A marker left at the parent's column may have been seen by a child's
    // open fence during collection. The parent's following paragraph owns it.
    const followingParagraph = children[1]
    if (followingParagraph?.type === 'paragraph' && followingParagraph.children[0]?.type === 'text' &&
        followingParagraph.children[0].value === '+') {
      const owners: Array<List | ListItem> = []
      let nestedList = children[0]?.type === 'list' ? children[0] : undefined
      let blocks: BlockNode[] | undefined
      while (nestedList) {
        const item = nestedList.items.at(-1)
        owners.push(nestedList)
        if (item) owners.push(item)
        blocks = item?.children
        nestedList = blocks?.at(-1)?.type === 'list' ? blocks.at(-1) as List : undefined
      }
      const code = blocks?.at(-1)
      let trimmed = false
      if (code?.type === 'code_block' && code.content.endsWith('\n+\n')) {
        code.content = code.content.slice(0, -2)
        trimmed = true
      } else if (code?.type === 'code_block' && code.content.endsWith('\n\n') &&
          (() => {
            let plusIndex = lexer.pos - 1
            while (plusIndex > itemStartLineIndex && !/^[ \t]+\+[ \t]*$/.test(lexer.lines[plusIndex]!)) plusIndex--
            return plusIndex >= itemStartLineIndex + 2 && isBlankLine(lexer.lines[plusIndex - 1]) &&
              isBlankLine(lexer.lines[plusIndex - 2])
          })()) {
        code.content = code.content.slice(0, -1)
        trimmed = true
      }
      if (trimmed && code?.type === 'code_block' && code.pos?.endOffset !== undefined &&
          code.content.endsWith('\n') && owners.length > 0) {
        const endLine = code.pos.startLine + code.content.split('\n').length
        const endOffset = (lexer.documentRoot ?? lexer).lineOffset(endLine - 1)
        code.pos.endLine = endLine
        code.pos.endColumn = 1
        code.pos.endOffset = endOffset
        for (const owner of owners) {
          if (!owner.pos) continue
          owner.pos.endLine = endLine
          owner.pos.endColumn = 1
          owner.pos.endOffset = endOffset
        }
      }
    }
  }

  /** Collects the body below an item's marker line and parses the item it forms. */
  function collectItem(
    lexer: Lexer, session: ParseSession, shape: ListShape, head: ItemHead, placement: ItemPlacement,
    content: string, isItemAttachBoundary: AttachBoundary, flags: ListFlags,
  ): ListItem {
    const { baseIndent, isTask, isOrdered, firstMarkerChar, orderedDelim, orderedKind } = shape
    const { startLineIndex: itemStartLineIndex, line, terminatorFree, checked, taskState, leadOrigin } = head
    const itemAttrs = head.attr ? head.attr.attrs : undefined
    const { contentCol, itemSource, itemMarkerColumn, physicalItemMarkerColumn, itemQuoteDepth } = placement
    const taskLeadShift = isTask ? taskBoxLeadShift(head, content, terminatorFree) : 0
    const nested: string[] = []
    let commentPayloadCandidates: Map<number, string> | undefined
    const nestedLineNumbers: number[] = []
    // Collection can later rebase or frame a line; consumers check its text before reuse.
    const nestedOrigins = new Map<number, StrippedLineOrigin>()
    let tabLineFacts: Map<number, { text: string; columns: number }> | undefined
    let tabFenceSourceColumn: number | undefined
    let tabFenceOpenerIndex: number | undefined
    const lineFacts = (text: string, origin?: StrippedLineOrigin): ItemLineFacts | undefined => {
      if (!origin || origin.text !== text) return undefined
      const remaining = lexer.lineLeadingWhitespace(origin.parentIndex) - origin.prefix
      return {
        terminatorFree: lexer.lineTerminatorFree(origin.parentIndex),
        whitespace: remaining >= 0 ? remaining : undefined,
        prefixMemo: session.markerPrefixMemo(lexer, origin.parentIndex),
      }
    }
    const itemFrameFacts = (facts: ItemLineFacts | undefined): ItemLineFacts | undefined =>
      facts === undefined ? undefined : { ...facts, descendantFrames: true }
    // The line opening a wrapped attribute block that `end` closes, or -1.
    const wrappedAttributeOpener = (end: number): number => {
      if (!/\}[ \t]*$/.test(nested[end]!)) return -1
      for (let start = end - 1; start >= 0; start--) {
        const line = nested[start]!
        if (isBlankLine(line)) return -1
        if (!line.startsWith('{')) continue
        const joined = nested.slice(start, end + 1).map((part) => part.trim()).join(' ')
        return isInvisibleLine(joined) ? start : -1
      }
      return -1
    }
    const invisibleNested = (index: number): boolean => {
      const text = nested[index]!
      const origin = nestedOrigins.get(index)
      const remaining = origin && origin.text === text
        ? lexer.lineLeadingWhitespace(origin.parentIndex) - origin.prefix : -1
      return isInvisibleLine(text, remaining >= 0 ? remaining : undefined)
    }
    const nestedSourceLines: (string | undefined)[] = []
    const bufferedBlanks = new Set<number>()
    // Lines admitted by reaching this item's content column. A below-column
    // lazy line can retain a positive residual indent for recursive safety,
    // but that must never be mistaken for #1705 over-indentation.
    const authoredBaseEligible = new Set<number>()
    let authoredTermColumn: number | undefined
    let returnedTermSourceColumn: number | undefined
    let returnedTermOwnerColumn: number | undefined
    let returnedParagraphColumn: number | undefined
    let nestedTermOwnsSeparator = false
    let definitionHostColumn: number | undefined
    let definitionAuthored = false
    let definitionBodyColumn: number | undefined
    let authoredDescriptionBodyColumn: number | undefined
    const itemSpanScan = newCommentSpanScan()
    // Lines the item took from BELOW its content column, a narrower fact than
    // `authoredBaseEligible`'s complement: that set also excludes a fence
    // body, which reached the column and carries authored indentation.
    const takenBelowColumn = new Set<number>()
    let retainedFenceOpen = false
    let retainedFenceItemColumn = 0
    const followsBelowColumnComment = (): boolean => {
      for (let k = nested.length - 1; k >= 0; k--) {
        if (isBlankLine(nested[k]!)) continue
        return takenBelowColumn.has(k) && RE_COMMENT_LINE.test(nested[k]!.trimStart())
      }
      return false
    }
    // `nested` indices holding a `%%%` opener the tracker refused, because no
    // run of its width follows in the DOCUMENT. §28 substitutes one `%%` line
    // comment for it, and carve#1903 makes that substitution a classification
    // rather than a rendering rule. The invisible-tail check reads the line
    // the way it reads `%% x` (carve-js#2337).
    //
    // The tracker's answer is the one to record, not a scan of this item's own
    // lines: an opener whose closer fell OUTSIDE the item opened a real span,
    // whose payload was then republished, and a block is not the line form.
    const degradedOpeners = new Set<number>()
    let authoredFenceBase = 0
    // A verbatim fence a DESCENDANT opened, while it is open.
    //
    // The item's tracker reads each collected line at its own dedent and its
    // opener test is anchored, so a fence written at a CHILD's column reached
    // no branch of it and the item recorded the open paragraph that line looks
    // like. A below-column run then folded into a paragraph the deepest
    // structure did not hold (markup-carve/carve#2509, carve-js#2261).
    let descendantOpaque: DescendantOpaque | null = null
    let descriptionFenceAwaitingPayload = false
    let descriptionMarkerFence = false
    let closedDescendantFence = false
    let descendantNoteBody = false
    // A later fence in the same nested note body is its code as well.
    let noteBodyHeldCode = false
    let openedLaterNoteFence = false
    let descendantNoteParagraphBefore = false
    let nestedNoteBodyColumn: number | undefined
    let consumedNoteCloserBodyColumn: number | undefined
    let consumedNoteParagraphBefore = false
    let nestedOwnerColumn = markerContentColumn(content, terminatorFree)
    const leadNestedContentColumn = nestedOwnerColumn < 0 ? Infinity : contentCol + nestedOwnerColumn
    const leadNestedSourceOffset = nestedOwnerColumn < 0 ? -1 : itemSource.lastIndexOf(stripLazyFrame(content))
    const leadNestedMarkerColumn = leadNestedSourceOffset < 0 ? Infinity : sourceColumnAt(itemSource, leadNestedSourceOffset)
    const leadNestedTermColumn = leadNestedMarkerColumn + nestedOwnerColumn
    const leadHasDeeperItem = nestedOwnerColumn >= 0 &&
      markerContentColumn(content.slice(nestedOwnerColumn), terminatorFree) >= 0
    const leadBottomIsTerm = nestedOwnerColumn >= 0 && content.includes(':: ') && RE_DEFLIST_TERM.test(
      markerLineBottomBlock(content, session.markerPrefixMemo(lexer, itemStartLineIndex)),
    )
    const leadNestedTerm = nestedOwnerColumn >= 0 && leadBottomIsTerm
    let nestedOwnerIsList = false
    let quotedFootnoteColumn: number | undefined
    let quotedFootnoteOffset = 0
    let closedListFence = false
    const markerLineTerm = RE_DEFLIST_TERM.test(content)
    let singleMarkerTerm = markerLineTerm
    let markerDescriptionColumn: number | undefined
    let markerDescriptionCodeBase: number | undefined
    let markerDescriptionCodeTracked = false
    let markerDescriptionCodeOwner: number | undefined
    let markerDescriptionCodeClosedAtFloor = false
    let firstBodyMarkerColumn: number | undefined = markerLineTerm ? -1 : undefined
    let hasParentAuthoredBlock = false
    // Lines that could open a parent-owned block, tested only where the answer
    // is read: isParentAuthoredBlock() walks an indentation run per line and a
    // fence below the child column is rare (markup-carve/carve#752).
    const parentBlockCandidates: string[] = []
    let parentBlockCandidateIndex = 0
    const parentAuthoredBlock = (): boolean => {
      const markerColumn = firstBodyMarkerColumn ?? -1
      if (markerColumn < 0) return false
      while (!hasParentAuthoredBlock && parentBlockCandidateIndex < parentBlockCandidates.length) {
        const line = parentBlockCandidates[parentBlockCandidateIndex++]!
        if (isParentAuthoredBlock(line, markerColumn)) hasParentAuthoredBlock = true
      }
      return hasParentAuthoredBlock
    }
    // Which child a collected line belongs to, walked only when a code fence
    // opens below that child's column - the one place the answer is read. Both
    // reads it needs walk an indentation run, so a body with no such fence pays
    // nothing for the tracking (markup-carve/carve#752).
    const ownerPending: {line: string, index: number, followsBlank: boolean, foldable: boolean, framed: boolean}[] = []
    const walkOwnership = (): boolean => {
      let opensFence = false
      for (const entry of ownerPending) {
        opensFence = false
        const column = nestedOwnerColumn >= 0 ? indentColumns(entry.line, nestedOwnerColumn) : 0
        // A line below a child's column can continue its paragraph. A blank or a
        // block boundary returns ownership to this item.
        if (nestedOwnerColumn < 0 || column < nestedOwnerColumn) {
          const markerColumn = markerContentColumn(entry.line)
          const opener = entry.line.trimStart()
          const fence = RE_FENCE.exec(opener) ?? RE_RAW_FENCE.exec(opener)
          const closedFence = !markerNoteItem && nestedOwnerIsList && fence !== null
          if (nestedOwnerColumn < 0 || entry.followsBlank || markerColumn >= 0 ||
            lineOpensItemBlock(entry.line) || closedFence) {
            nestedOwnerColumn = markerColumn
            nestedOwnerIsList = isListMarkerLine(entry.line)
            if (closedFence) closedListFence = true
            // Track a new fence at its authored base so a later dedent cannot
            // fold into its body as paragraph text. Deeper items track their own
            // fences when their collected content is parsed.
            if (markerColumn < 0 && !entry.foldable && !entry.framed &&
              ((firstBodyMarkerColumn ?? -1) < 0 || parentAuthoredBlock())) {
              const opener = entry.line.trimStart()
              if (opener !== entry.line && opensCodeFence(opener)) {
                authoredFenceBase = indentColumns(entry.line)
                opensFence = true
                closedListFence = false
              }
            }
          }
        }
      }
      ownerPending.length = 0
      return opensFence
    }
    /**
     * Open or close `descendantOpaque` on a line the item took at its column.
     *
     * Reached only from a line that is INDENTED inside the item's body and is
     * fence-shaped or already inside a descendant's fence, so a body with no
     * such fence walks no indentation run for it.
     */
    let childLeadComment = false
    const trackDescendantOpaque = (
      line: string,
      opener: string,
      followsBlank: boolean,
    ): void => {
      if (descriptionFenceAwaitingPayload && descendantOpaque !== null) {
        descriptionFenceAwaitingPayload = false
        if (indentColumns(line, descendantOpaque.base) < descendantOpaque.base) descendantOpaque = null
      }
      const child = nestedOwnerColumn
      if (child < 0 && opener === line.replace(/^[ \t]+/, '') && !closedListFence) return
      // BELOW A CHILD'S COLUMN THE CHILD IS OVER, and so is any fence it held:
      // the base is at or past that column, so such a line is never payload.
      // What a later below-column line reads is whether an ANCESTOR is left
      // holding an open paragraph, and the item's own tracker cannot say for a
      // line that keeps residual indentation, because its block tests are
      // anchored - an indented heading reads there as prose. So the state stands
      // in for it where the line opens a block of its own, and is dropped where
      // the line leaves a paragraph open. `walkOwnership` is drained only at a
      // fence-shaped line, so without this a plain paragraph left the state
      // standing and the item stopped continuing.
      if (child >= 0 && indentColumns(line, child) < child) {
        const bottom = markerLineBottomBlock(opener)
        if (
          bottomBlockLeavesParagraphOpen(bottom) &&
          !opensCodeFence(bottom) &&
          !RE_COLON_RUN.test(bottom)
        ) {
          descendantOpaque = null
        }
        return
      }
      if (descendantOpaque !== null) {
        const base = descendantOpaque.base
        const column = indentColumns(line, base + 1)
        // A closer stands at its fence's base or at its container's content
        // column (CARVE-P0-004), never past the base.
        if (column <= base && descendantOpaque.close.test(opener)) {
          closedDescendantFence = descendantNoteBody || descendantOpaque.markerLine === true || closedListFence
          if (closedListFence) lazyState.lazyFoldable = false
          if (descendantOpaque.markerLine) lazyState.lazyFoldable = false
          if (descendantNoteBody) {
            consumedNoteCloserBodyColumn = contentCol + FOOTNOTE_BODY_COLUMN
            consumedNoteParagraphBefore = descendantNoteParagraphBefore
          }
          descendantOpaque = null
          closedListFence = false
          return
        }
        // At the column of the marker a chain's fence sits behind, the fence is over (corpus 626).
        const written = (lexer.rootLines ?? lexer.lines)[lexer.lineNumber(lexer.pos) - 1] ?? line
        if (descendantOpaque.markerLine && descendantOpaque.holder !== undefined && descendantOpaque.holder > contentCol &&
            indentColumns(written, descendantOpaque.holder + 1) === descendantOpaque.holder) {
          descendantOpaque = null
          return
        }
        // A line between the child's column and the base is payload that loses
        // its prefix (carve#3133); only a line below the child ends the fence,
        // and that case returned above.
        if (column < base && !descendantOpaque.markerLine && (child < 0 || childLeadComment)) descendantOpaque = null
        return
      }
      const fence = RE_FENCE.exec(opener) ?? RE_RAW_FENCE.exec(opener)
      if (fence === null) return
      // The child's own frame already holds a fence, so this line is its payload or closer.
      if (lazyState.deepest?.opaque?.kind === 'code') return
      const marker = RE_FENCE.test(opener) ? fence[2]! : fence[1]!
      const base = opener === line.trimStart()
        ? indentColumns(line)
        : indentColumns(line) + line.length - leadingWhitespace(line) - opener.length
      const sourceBase = contentCol + base
      const laterNoteFence = noteBodyHeldCode && nestedNoteBodyColumn !== undefined && sourceBase === nestedNoteBodyColumn
      descendantNoteBody = laterNoteFence || (nestedNoteBodyColumn !== undefined && sourceBase === nestedNoteBodyColumn &&
        lazyState.lazyFoldable && !followsBlank && !lazyState.ownedAuthored && lazyState.ownedColumn > base)
      openedLaterNoteFence = laterNoteFence
      if (descendantNoteBody) noteBodyHeldCode = true
      descendantNoteParagraphBefore = lazyState.lazyFoldable
      descendantOpaque = { close: fenceCloseRe(marker), base, markerLine: opener !== line.trimStart() }
    }
    // Candidate sublist markers, resolved after authored fence bases are applied.
    const subListMarkers = new Set<number>()
    let belowDescendantComment: { run: number; state: ItemLazyState } | undefined
    const pendingBlankRun = new ContainerBlankBuffer()
    // A comment in a marker-line note changes nothing (CARVE-P9-053, carve#3060):
    // it waits among the pending blanks without counting as one, and the note
    // scans skip it once it is in `nested`.
    let pendingNoteComments = new Set<number>()
    const noteCommentLines = new Set<number>()
    // Indices in `nested` that hold a `+`-injected blank separator. These keep
    // the attached block parsing standalone but never loosen the list (Bug B).
    const plusSeparators = new Set<number>()
    const opaqueBlankLines = new Set<number>()
    const commentBoundaryBlanks: Array<{ openerIndex: number; lines: number[] }> = []
    let inlineFenceScanned = 0
    let inlineFenceColumn = -1
    let lastNonBlankPhysicalSource: string | undefined
    let lastNonBlankColumn = -1
    let blankBeforeNestedContinuation = false
    const continuationFenceBreaks = new Set<number>()
    let authoredDescendantFenceBlanks = 0
    const { leadState, lazyState } = leadLazyState(lexer, session, content, itemStartLineIndex, markerLineTerm)
    // X2: track an authored quote's paragraph without changing the item's block state.
    let authoredQuoteClaim: BlockQuoteLazyState | null = null
    let authoredQuoteParagraphOpen = false
    let authoredQuoteHostColumn = contentCol
    let captionParagraphClaim = false
    // A FENCE OPENED ON THE MARKER LINE IS AN OPEN FENCE (markup-carve/carve#950).
    // The lead line never went through `trackItemLazyState`, so `- ``` ` left
    // the tracker believing the item held an open paragraph, and every line
    // below the content column folded into the code text - body and closer
    // both.
    const descendantLead = content.includes("`") || content.includes('~') || content.includes(':')
      ? markerLineBottomBlock(content, session.markerPrefixMemo(lexer, itemStartLineIndex)) : content
    if (descendantLead !== content && colonFenceOpenerLen(descendantLead) !== null) lazyState.lazyFoldable = false
    const descendantLeadFence = descendantLead !== content
      ? RE_FENCE.exec(descendantLead) ?? RE_RAW_FENCE.exec(descendantLead) : null
    if (descendantLeadFence) {
      lazyState.lazyFoldable = false
      const holderColumn = markerFenceHolderColumn(lexer, session, content, contentCol, itemStartLineIndex)
      descendantOpaque = {
        close: fenceCloseRe(RE_FENCE.test(descendantLead) ? descendantLeadFence[2]! : descendantLeadFence[1]!),
        base: lazyState.ownedColumn,
        markerLine: true,
        holder: holderColumn,
      }
    }
    const leadFence = RE_FENCE.exec(content) ?? RE_RAW_FENCE.exec(content)
    if (leadFence) {
      lazyState.opaque = { kind: 'code', close: fenceCloseRe(RE_FENCE.test(content) ? leadFence[2]! : leadFence[1]!) }
      lazyState.lazyFoldable = false
    }
    // A COMMENT FENCE OPENED ON THE MARKER LINE IS AN OPEN COMMENT, for the
    // reason carve#950 gives for the code fence one line up: the lead line
    // never goes through `trackItemLazyState`, so `- %%%` left the tracker
    // believing the item held an open paragraph and nothing below the marker
    // line was comment body to it. PART 9 §28 makes that body VERBATIM, so the
    // tracker has to know the comment is open before it reads the next line.
    const leadCommentRun = leadFence ? undefined : commentFenceRun(content)
    const leadComment = leadCommentRun !== undefined && (commentFenceRun(lexer.peek() ?? '') === leadCommentRun || commentBlockHasCloser(lexer, leadCommentRun))
      ? leadCommentRun : undefined
    if (leadComment !== undefined) {
      lazyState.opaque = { kind: 'comment', length: leadComment, paragraphBefore: lazyState.lazyFoldable, atColumn: false }
      lazyState.lazyFoldable = false
      // THE MARKER LINE IS A COLLECTED LINE TO THE SPAN SCAN TOO. The scan walks
      // `nested`, which the lead line never enters, so a span opened here was
      // invisible where the below-column test asks who holds one - and §28's
      // closer, written at any column, ended the item instead of closing the
      // span. The item's own parse then read an opener with no closer, which §28
      // degrades to one `%%` line, and the payload reached the page
      // (markup-carve/carve#2527, corpus 512-11 and 512-12). Seeded as state
      // rather than by walking `[content]`, so the resumable cursor still starts
      // at `nested[0]`.
      itemSpanScan.opaque = { comment: true, char: '%', run: leadComment }
      itemSpanScan.atBlockStart = false
    }
    // The item's tracker cannot see a comment opened on a CHILD's marker line,
    // `- - %%%`, so a fence-shaped line in that body may look like a descendant
    // fence. Such a fence keeps ending at a below-base line, as before carve#3133.
    if (!leadFence && leadComment === undefined && content.includes('%')) {
      const bottom = markerLineBottomBlock(content, session.markerPrefixMemo(lexer, itemStartLineIndex))
      childLeadComment = bottom !== content && commentFenceRun(bottom) !== undefined
    }
    const leadColon = colonFenceOpenerLen(content)
    if (leadColon !== null && RE_LINE_BLOCK_OPEN.test(content)) lazyState.literalColon = {width: leadColon, column: 0, sourceLine: lexer.lineNumber(itemStartLineIndex), awaitingBody: true}
    let leadColonAwaitingBody = leadColon !== null && !RE_LINE_BLOCK_OPEN.test(content)
    // A just-opened container leaves no paragraph for lazy text (CARVE-P0-016).
    if (leadColon !== null) lazyState.lazyFoldable = false
    if (leadColonAwaitingBody) lazyState.markerColonBody = true
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
    // The marker-line definition did not pass through the body tracker.
    // Track its first paragraph continuation without opening a child list.
    let markerNoteBodyPending = RE_FOOTNOTE_DEF.test(content)
    let markerNoteFirstText = false
    const markerNoteItem = markerNoteBodyPending
    // A note is an invisible definition: a below-column line after its text
    // or code finds no open paragraph (CARVE-P0-009). A container the note
    // opens is read by its own leaf instead, as before.
    // After a task box the note reads its body from its own source column.
    const markerNoteFloor = (isTask ? baseIndent + head.markerLine.length - leadingWhitespace(head.markerLine) - content.length
      : contentCol) + FOOTNOTE_BODY_COLUMN
    // The note's own frame answers the lazy question for the lines below it (carve#3885).
    if (markerNoteItem) {
      trackItemLazyState(content, lazyState)
      lazyState.footnoteBodyColumn = markerNoteFloor - contentCol
    }
    const noteParagraphMarkers = new Set<number>()
    // Filled by the first scan, which resets any state it cannot resume.
    const commentFenceTailScan = {} as CommentFenceOpenerScan
    const fenceReachScan = {} as FenceReachScan
    let markerNoteParagraph = markerNoteItem && !lineOpensItemBlock(RE_FOOTNOTE_DEF.exec(content)![2]!) &&
      !RE_COMMENT_LINE.test(RE_FOOTNOTE_DEF.exec(content)![2]!)
    let markerNoteClaimChecked = false
    let markerNoteLeft = false
    let nestedNoteParagraph = false
    // A definition body cannot preserve its enclosing item's paragraph claim (CARVE-P0-006).
    let blockedNoteClaimFloor: number | undefined
    let hostedNoteBodyColumn: number | undefined
    let acceptedPlusLine = -1
    const refusedPlus = (offset: number): boolean => {
      const line = lexer.peek(offset)
      if (lexer.lineNumber(lexer.pos + offset) === acceptedPlusLine + 1 ||
          line === undefined || !isContinuationMarker(line)) return false
      const held = indentColumns(line) === 0 &&
        (baseIndent === 0 && lazyState.opaque?.kind === 'code' ||
          descendantOpaque?.markerLine === true && descendantOpaque.holder === 0)
      if (!held) return false
      const rootLines = lexer.rootLines ?? lexer.lines
      const candidate = rootLines[lexer.lineNumber(lexer.pos + offset)] ?? lexer.peek(offset + 1)
      return candidate === undefined || isBlankLine(candidate) || indentColumns(candidate) !== 0
    }
    let deepAttributeClosed = false
    const wrappedAttribute = { attrRun: null as string | null }
    let wrappedAttributeFence: string | null = null
    // Facts about the line being admitted. The phases below set each one before
    // any later phase reads it, so none carries over from the previous line.
    let enclosingLazy = false
    let noteReach: ReturnType<typeof markerNoteFenceReach> | null = null
    let fenceBoundaryTail = false
    let commentFenceTail = false
    let noteParagraphOpen = false
    let leftBlockedNote = false
    let resumesMarkerDescriptionParagraph = false
    let lw = 0
    let sourceAfterNestedNote = false
    let quoteParagraphMarker = false
    let captionParagraphMarker = false
    let captionParagraphFollower = false
    let quoteLazyFramed = false
    let belowItemComment = false
    let sourceDepth = 0
    let sourceMarkerColumn = 0
    let sourceEntry = ''
    let foldedTermText = false
    let ancestorTermBand = false
    let sourceDescription: RegExpExecArray | null = null
    let markerTermText = false
    let pastDefinitionEntry = false
    let survivingItemParagraph = false
    let belowDefinitionEntry = false
    let trackedDescriptionBodyColumn = -1
    let descriptionBodyColumn = -1
    let descriptionFollowerColumn = -1
    let belowOpenDescription = false
    // ...and about one taken at the content column.
    let strippedPrefix: number | undefined
    let placed = ''
    let followsBlank = false
    let isMarker = false
    let dedented = ''
    let fenceLineIndex = 0
    let trackedContent = ''
    let tabOpenerColumns: number | undefined
    let tabOpenerText: string | undefined
    let unindented = ''
    let confirmsLeadBody = false
    let markerDescription: RegExpExecArray | null = null
    let foldedDescription = false
    let skipConsumedCloser = false
    let wasMarkerDescriptionCode = false
    let atItemColumn = false
    let captionAtItemColumn = false
    let hadQuoteParagraph = false
    let itemOwnsQuote = false
    let claimHostColumn = 0
    // A line that continues a block attached by the item's first `+`, or ends the item there.
    const admitAttachedLead = (admission: ContainerAdmission): Decision | undefined => {
      const l = admission.line
      // A descendant's wrapped attribute block is one construct, closed below its column too
      // (carve#3421 ruling 1): once it closes, no paragraph is left for a lazy line.
      if (deepAttributeClosed) {
        deepAttributeClosed = false
        lazyState.lazyFoldable = false
        if (lazyState.deepest) lazyState.deepest.lazyFoldable = false
      }
      const deepAttr = lazyState.deepest
      // Below the descendant's content column, which may still be at or past this item's.
      // The open-run test comes first, so a deep ladder pays nothing per level.
      if (deepAttr?.attrRun != null && (admission.kind !== 'content' ||
          lazyState.ownedColumn >= 0 && indentColumns(l) < contentCol + lazyState.ownedColumn) &&
          trackWrappedAttributeRun(deepAttr, stripLazyFrame(l).trimStart())) deepAttributeClosed = true
      // A nested item's run can be below this item's content column, leaving
      // no deepest tracker. Keep the complete run as a separate source fact.
      const sourceFence = /^(`{3,}|~{3,})/.exec(stripLazyFrame(l).trimStart())?.[1]
      if (sourceFence !== undefined) {
        if (wrappedAttributeFence === null) wrappedAttributeFence = sourceFence
        else if (sourceFence[0] === wrappedAttributeFence[0] && sourceFence.length >= wrappedAttributeFence.length)
          wrappedAttributeFence = null
      }
      const physicalAttributeLine = (lexer.rootLines ?? lexer.lines)[lexer.lineNumber(lexer.pos) - 1] ?? l
      // An opener indented below this item's content column, or one an enclosing item
      // admitted as lazy, is paragraph text, so its closer ends no paragraph (PART 0 O2, O3).
      const lazyAttributeOpener = wrappedAttribute.attrRun === null &&
        opensWrappedAttributeBlock(stripLazyFrame(l).trimStart()) && (l.startsWith(LAZY_FRAME) ||
          indentColumns(l) > 0 && (admission.kind === 'below' || admission.kind === 'outside' ||
            lexer.itemLazyLines.has(lexer.lineNumber(lexer.pos))))
      if (quotePrefixDepth(physicalAttributeLine) < itemQuoteDepth) wrappedAttribute.attrRun = null
      else if (lazyAttributeOpener) {
        // Not a run: the line reads as text.
      } else if (wrappedAttributeFence === null && lazyState.opaque === null && descendantOpaque === null &&
          trackWrappedAttributeRun(wrappedAttribute, stripLazyFrame(l).trimStart())) deepAttributeClosed = true
      const currentSource = (lexer.rootLines ?? lexer.lines)[lexer.lineNumber(lexer.pos) - 1]
      const afterCurrent = (lexer.rootLines ?? lexer.lines)[lexer.lineNumber(lexer.pos)]
      if (currentSource !== undefined && endsInPlus(currentSource) &&
          quotePrefixDepth(currentSource) > 0 && quotePrefixDepth(currentSource) < itemQuoteDepth &&
          afterCurrent !== undefined && quotePrefixDepth(afterCurrent) === quotePrefixDepth(currentSource) &&
          (isPhysicalContinuationMarker(currentSource) || isContinuationMarker(currentSource.trimStart()))) return 'stop'
      const precedingLine = nestedLineNumbers.at(-1)
      const precedingSource = precedingLine === undefined ? undefined :
        (lexer.rootLines ?? lexer.lines)[precedingLine - 1] ?? nestedSourceLines.at(-1)
      let precedingBody = precedingSource ?? ''
      for (let depth = 0; depth < itemQuoteDepth; depth++) precedingBody = quotedLineText(precedingBody, false) ?? ''
      return undefined
    }
    // Constructs the item already holds open take a line before any column rule.
    const admitHeldConstruct = (l: string): Decision | undefined => {
      // Below the column, under a held description or term, a matched fence
      // answers as its `%%` twin (CARVE-P9-053), so it takes the twin's path.
      if (lazyState.inDefList && pendingBlankRun.count === 0 && lazyState.opaque === null && !isBlankLine(l) &&
          indentColumns(l, contentCol) < contentCol && indentColumns(l) > baseIndent) {
        // A sibling marker ends this item before any closer it could reach.
        const end = matchedCommentFenceEnd(lexer, lexer.pos, (line) =>
          indentColumns(line) <= baseIndent && isListMarkerLine(line))
        if (end !== undefined) {
          const before = { ...lazyState }
          const indent = indentColumns(l)
          const opener = lexer.pos
          while (lexer.pos < end) {
            const line = lexer.peek()!
            takenBelowColumn.add(nested.length)
            const stripped = sliceColumns(line, Math.min(indent, indentColumns(line)), true)
            nested.push(lazyState.inDefList === 'term' && lexer.pos === opener
              ? ' ' + stripped : stripped)
            nestedSourceLines.push(line)
            nestedLineNumbers.push(lexer.lineNumber(lexer.pos))
            lexer.itemLazyLines.add(lexer.lineNumber(lexer.pos))
            lexer.consume()
          }
          Object.assign(lazyState, before)
          trackItemLazyState('%%', lazyState, false)
          return 'continue'
        }
      }
      // A retained fence's closer anywhere in the item closes it (R3285).
      // The column is read from the source, since an enclosing body may hand
      // the line over flush.
      if (retainedFenceOpen && lazyState.opaque?.kind === 'code' && !isBlankLine(l) &&
          sourceColumn(lexer.rootLines?.[lexer.lineNumber(lexer.pos) - 1] ?? l) >= retainedFenceItemColumn &&
          lazyState.opaque.close.test(l.replace(/^[ \t]+/, ''))) {
        const closer = l.replace(/^[ \t]+/, '')
        nested.push(closer)
        nestedSourceLines.push(l)
        nestedLineNumbers.push(lexer.lineNumber(lexer.pos))
        trackItemLazyState(closer, lazyState)
        retainedFenceOpen = false
        lexer.consume()
        return 'continue'
      }
      if (lazyState.opaque === null) retainedFenceOpen = false
      if (hostedNoteBodyColumn !== undefined && lexer.hostBody !== null &&
          !isBlankLine(l) && indentColumns(l, hostedNoteBodyColumn) < hostedNoteBodyColumn) return 'stop'
      const noteCommentEnd = markerNoteItem && !markerNoteLeft ? coveredNoteComment(lexer, l, markerNoteFloor) : -1
      if (noteCommentEnd >= 0 && lazyState.opaque === null && !insideOpenFence(lazyState)) {
        for (let at = lexer.pos; at <= noteCommentEnd; at++) {
          pendingNoteComments.add(pendingBlankRun.lines.length)
          pendingBlankRun.lineNumbers.push(lexer.lineNumber(lexer.pos))
          pendingBlankRun.lines.push(lexer.peek()!)
          lexer.consume()
        }
        // It still closes the note's paragraph, as it does in the note's own parse.
        markerNoteParagraph = false
        return 'continue'
      }
      return undefined
    }
    const readNoteFacts = (l: string): void => {
      if (markerNoteItem && !isBlankLine(l) && indentColumns(l, markerNoteFloor) < markerNoteFloor) markerNoteLeft = true
      // Keep the observed note-body paragraph permission separate from an
      // item tail after its CODE closer. The next body line consumes it.
      if (consumedNoteCloserBodyColumn !== undefined) {
        if (!isBlankLine(l) && indentColumns(l, consumedNoteCloserBodyColumn) >= consumedNoteCloserBodyColumn) lazyState.lazyFoldable = consumedNoteParagraphBefore
        consumedNoteCloserBodyColumn = undefined
      }
      noteReach = markerNoteItem && !isBlankLine(l) && indentColumns(l, contentCol) < contentCol
        ? markerNoteFenceReach(nested, noteParagraphMarkers, noteCommentLines, fenceReachScan) : null
      fenceBoundaryTail = noteReach === 'boundary'
      commentFenceTail = markerNoteItem && !isBlankLine(l) && indentColumns(l, contentCol) < contentCol &&
        markerNoteCommentFenceOpeners(nested, noteParagraphMarkers, noteCommentLines, true, commentFenceTailScan).length > 0
      noteParagraphOpen = markerNoteParagraph
      if (!isBlankLine(l)) {
        markerNoteParagraph = false
      }
      if (nestedNoteBodyColumn !== undefined && !isBlankLine(l) && indentColumns(l, nestedNoteBodyColumn) < nestedNoteBodyColumn) {
        nestedNoteBodyColumn = undefined
        noteBodyHeldCode = false
      }
      leftBlockedNote = blockedNoteClaimFloor !== undefined && !isBlankLine(l) && indentColumns(l, blockedNoteClaimFloor) < blockedNoteClaimFloor
      if (leftBlockedNote)
        blockedNoteClaimFloor = undefined
      if (markerDescriptionColumn !== undefined &&
          (lexer.quoteLazyLines.has(lexer.lineNumber(lexer.pos)) ||
            (!isBlankLine(l) && indentColumns(l, contentCol) < contentCol))) markerDescriptionColumn = undefined
      resumesMarkerDescriptionParagraph = markerDescriptionCodeClosedAtFloor && pendingBlankRun.count === 0 &&
        opensCodeFence(l.trimStart()) && indentColumns(l) > contentCol + markerDescriptionCodeBase!
      if (resumesMarkerDescriptionParagraph) lazyState.lazyFoldable = true
      if (markerDescriptionCodeClosedAtFloor && !isBlankLine(l)) markerDescriptionCodeClosedAtFloor = false
    }
    const admitBlank = (l: string): Decision => {
      if (lazyState.opaque?.kind === 'comment')
        opaqueBlankLines.add(lexer.lineNumber(lexer.pos))
      const { offset: afterBlanks } = nextContainerContent(lexer, refusedPlus)
      for (; inlineFenceScanned < nestedSourceLines.length; inlineFenceScanned++) {
        const source = nestedSourceLines[inlineFenceScanned]
        if (source === undefined || isBlankLine(source)) continue
        const sourceLineNumber = nestedLineNumbers[inlineFenceScanned]
        const physicalSource = sourceLineNumber === undefined ? source :
          (lexer.rootLines ?? lexer.lines)[sourceLineNumber - 1] ?? source
        lastNonBlankPhysicalSource = physicalSource
        lastNonBlankColumn = sourceColumn(physicalSource, itemQuoteDepth)
        if (opensCodeFence(source.trimStart()))
          inlineFenceColumn = lastNonBlankColumn
      }
      if (!markerNoteItem && inlineFenceColumn >= 0) {
        const nextLineNumber = lexer.lineNumber(lexer.pos + afterBlanks)
        const nextSource = (lexer.rootLines ?? lexer.lines)[nextLineNumber - 1]
        const nextInContainer = lexer.peek(afterBlanks)?.trimStart() ?? ''
        const foldedRunBelowBase = lastNonBlankPhysicalSource !== undefined &&
          (RE_FENCE.test(sourceQuoteBody(lastNonBlankPhysicalSource).trimStart()) &&
            lastNonBlankColumn < inlineFenceColumn ||
            // A glued `>``` is paragraph text admitted lazily into the
            // quote. It can close an inline fence below its opener, while
            // sourceColumn(line, itemQuoteDepth) has no quote column for it.
            itemQuoteDepth > 0 && /^(?:> )*>[`~]{3,}[ \t]*$/.test(lastNonBlankPhysicalSource.trimStart()) &&
            sourceColumn(lastNonBlankPhysicalSource) < inlineFenceColumn)
        // A line below the inline opener remains in its paragraph's
        // authored band. A line at the opener's own column starts a second
        // paragraph after the blank.
        const followingAdmittedBlock = lazyState.inDefList !== 'description' &&
          lastNonBlankPhysicalSource !== undefined &&
          !(markerLineTerm && /^#{1,6}(?:[ \t]|$)/.test(sourceQuoteBody(lastNonBlankPhysicalSource))) &&
          (lineOpensBlock(sourceQuoteBody(lastNonBlankPhysicalSource).trimStart()) ||
            RE_BLOCKQUOTE.test(lastNonBlankPhysicalSource.trimStart())) &&
          (lastNonBlankColumn < inlineFenceColumn ||
            lineOpensBlock(nextInContainer))
        if (nextSource !== undefined && inlineFenceColumn >= 0 && !foldedRunBelowBase && followingAdmittedBlock)
          opaqueBlankLines.add(lexer.lineNumber(lexer.pos))
      }
      const rootLines = lexer.rootLines ?? lexer.lines
      const markerLineNumber = lexer.lineNumber(lexer.pos + afterBlanks)
      const sourceMarker = rootLines[markerLineNumber - 1]
      const follower = rootLines[markerLineNumber]
      if (lazyState.opaque?.kind === 'code' &&
          sourceMarker !== undefined && indentColumns(sourceMarker) === 0 &&
          isContinuationMarker(sourceMarker) && follower !== undefined &&
          !isBlankLine(follower) && indentColumns(follower) === 0 && !isListMarkerLine(follower)) {
        if (lexer.peek(afterBlanks) === undefined) lexer.consumedContinuationLines.add(markerLineNumber)
        nested.push(sliceColumns(l, contentCol, true))
        nestedSourceLines.push(l)
        nestedLineNumbers.push(lexer.lineNumber(lexer.pos))
        bufferedBlanks.add(nested.length)
        lexer.consume()
        return 'continue'
      }
      pendingBlankRun.add(l, lexer.lineNumber(lexer.pos))
      lexer.consume()
      return 'continue'
    }
    const attachAfterPlus = (plusColumn: number): Decision => {
      for (const lineNumber of pendingBlankRun.lineNumbers) opaqueBlankLines.add(lineNumber)
      const rootLines = lexer.rootLines ?? lexer.lines
      const rootFollower = rootLines[lexer.lineNumber(lexer.pos)]
      continuationFenceBreaks.add(nested.length)
      if (descendantOpaque !== null || lazyState.opaque?.kind === 'code' ||
          lazyState.deepest?.opaque?.kind === 'code') {
        authoredDescendantFenceBlanks = pendingBlankRun.count
      }
      const plusLineNumber = lexer.lineNumber(lexer.pos)
      const plusLineIndex = lexer.pos
      const plusEnd = (lexer.lineAt(plusLineIndex) ?? '').length
      lexer.consume()
      acceptedPlusLine = plusLineNumber
      const detachedFollower = lazyState.opaque?.kind === 'code' &&
        lexer.peek() === undefined && rootFollower !== undefined &&
        !isBlankLine(rootFollower) && indentColumns(rootFollower) === 0 &&
        !lineOpensItemBlock(rootFollower)
      // An accepted marker leaves its buffered blanks in the open fence.
      if (pendingBlankRun.count > 0 && ((lexer.peek() !== undefined && !isBlankLine(lexer.peek()!)) || detachedFollower) &&
          (lazyState.opaque !== null ||
            descendantOpaque !== null)) {
        for (let k = 0; k < pendingBlankRun.lines.length; k++) {
          if (pendingNoteComments.has(k)) noteCommentLines.add(nested.length)
          else bufferedBlanks.add(nested.length + 1)
          nestedSourceLines.push(pendingBlankRun.lines[k])
          nested.push(sliceColumns(pendingBlankRun.lines[k] ?? '', contentCol, true))
          nestedLineNumbers.push(pendingBlankRun.lineNumbers[k]!)
          trackItemLazyState('', lazyState)
        }
      }
      pendingBlankRun.clear()
      pendingNoteComments = new Set()
      // Mark this blank as a `+`-injected separator: it lets the attached
      // block parse on its own but must NOT loosen the list (Bug B). A real
      // internal blank before a plain paragraph still loosens; a `+` one
      // never does, matching carve-php.
      // ONLY A FLUSH-LEFT BLOCK (§17 L3, markup-carve/carve#1436) - see the
      // first-block form above. Nothing is attached from another column, and
      // the marker line itself is still consumed, so the candidate falls
      // through to the ordinary rules on the next turn of this loop.
      const closesMarkerColon = leadColon !== null && (RE_DIV_OPEN.test(content) || RE_ADMONITION_OPEN.test(content)) &&
          (leadColonAwaitingBody || lazyState.divDepth > 0) &&
          ((lexer.peek() !== undefined && !isBlankLine(lexer.peek()!)) || detachedFollower)
      if (closesMarkerColon) {
        const closer = ':'.repeat(leadColon)
        nestedOrigins.set(nested.length, { text: closer, parentIndex: plusLineIndex, prefix: plusEnd, virtual: true })
        nested.push(closer)
        nestedSourceLines.push(undefined)
        nestedLineNumbers.push(plusLineNumber)
        trackItemLazyState(closer, lazyState)
        if (detachedFollower) {
          nestedOrigins.set(nested.length, { text: '', parentIndex: plusLineIndex, prefix: plusEnd, virtual: true })
          nested.push('')
          nestedSourceLines.push(undefined)
          nestedLineNumbers.push(plusLineNumber)
        }
      }
      if (detachedFollower) {
        const rootLines = lexer.rootLines ?? lexer.lines
        let limit = rootLines.length - plusLineNumber
        for (let k = 1; k < limit; k++) {
          if (isItemAttachBoundary(rootLines[plusLineNumber + k]!)) { limit = k; break }
        }
        const followerLexer = subLexer(rootLines.slice(plusLineNumber, plusLineNumber + limit), lexer.parseOptions, 0)
        followerLexer.depth = lexer.depth
        const extent = session.attachedBlockExtent(followerLexer, limit)
        lexer.attachmentBoundaries.add(plusLineNumber + 1)
        for (let k = 0; k < extent; k++) {
          const number = plusLineNumber + k + 1
          const followerLine = rootLines[plusLineNumber + k]!
          lexer.consumedContinuationLines.add(number)
          nested.push(followerLine)
          nestedSourceLines.push(followerLine)
          nestedLineNumbers.push(number)
        }
        return 'continue'
      }
      if (lexer.peek() === undefined || isBlankLine(lexer.peek()!)) {
        const refused = lexer.lineAt(plusLineIndex) ?? '+'
        const text = sliceColumns(refused, Math.min(plusColumn, contentCol), true)
        nested.push(text)
        nestedSourceLines.push(refused)
        nestedLineNumbers.push(plusLineNumber)
        trackItemLazyState(text, lazyState)
        return 'continue'
      }
      lexer.attachmentBoundaries.add(plusLineNumber)
      // A boundary line inside a fence THIS attached block opened is that
      // fence's body, exactly as it is in the indented body (carve#975 for
      // the marker, corpus category 279 for the blank, the dedent and the
      // three fence kinds together). The old loop consulted the tracker for
      // two of the kinds and for no boundary but the marker, so a blank
      // severed a code fence from its opener and a colon fence severed on
      // every boundary there is.
      const { lines: attachedLines, lineNumbers: attachedLineNumbers } = session.collectAttachedListBlock(lexer, isItemAttachBoundary, baseIndent, true)
      if (attachedLines.length === 0) {
        // The next `+` is itself the block the first marker reaches; its own
        // refusal remains text. Do not publish the first marker as a second
        // literal line (§17 L3, successive markers).
        if (isContinuationMarker(lexer.peek() ?? '')) {
          plusSeparators.add(nested.length)
          nestedOrigins.set(nested.length, { text: '', parentIndex: plusLineIndex, prefix: plusEnd, virtual: true })
          nested.push('')
          nestedSourceLines.push(undefined)
          nestedLineNumbers.push(plusLineNumber)
          trackItemLazyState('', lazyState)
          return 'continue'
        }
        const refused = lexer.lineAt(plusLineIndex) ?? '+'
        nested.push(sliceColumns(refused, Math.min(plusColumn, contentCol), true))
        nestedSourceLines.push(refused)
        nestedLineNumbers.push(plusLineNumber)
        trackItemLazyState(refused, lazyState)
        return 'continue'
      }
      plusSeparators.add(nested.length)
      nestedOrigins.set(nested.length, { text: '', parentIndex: plusLineIndex, prefix: plusEnd, virtual: true })
      nested.push('')
      nestedSourceLines.push(undefined)
      nestedLineNumbers.push(plusLineNumber)
      trackItemLazyState('', lazyState)
      if (descendantOpaque === null && !nested.some(line => isListMarkerLine(line.trimStart())) &&
          attachedLines[0] !== undefined &&
          (RE_FENCE.test(attachedLines[0]) || RE_RAW_FENCE.test(attachedLines[0]))) {
        authoredDescendantFenceBlanks = 0
      }
      // `plusColumn` is a source column; the attached lines are this lexer's.
      const localPlusColumn = plusColumn - physicalItemMarkerColumn + baseIndent
      let ownBlock = false
      for (let k = 0; k < attachedLines.length; k++) {
        // An opener at the item's content column is the item's own, past the attached paragraph or attribute run.
        const ownOpener = k > 0 && lazyState.opaque === null && indentColumns(attachedLines[k]!) === contentCol &&
          (lineOpensItemBlock(attachedLines[k]!.trimStart()) || isListMarkerLine(attachedLines[k]!.trimStart()) || isLinkDefLine(attachedLines[k]!.trimStart()))
        // The lines of that block are measured from the same column.
        ownBlock ||= ownOpener
        const attachedLine = ownBlock && indentColumns(attachedLines[k]!, contentCol) >= contentCol ? sliceColumns(attachedLines[k]!, contentCol, true)
          : localPlusColumn > contentCol ? sliceColumns(attachedLines[k]!, localPlusColumn, true) : attachedLines[k]!
        nested.push(attachedLine)
        nestedSourceLines.push(attachedLines[k])
        nestedLineNumbers.push(attachedLineNumbers[k]!)
        // The attached block's lines are the item's, so the item's own
        // tracker sees them: what they leave open decides how a later
        // dedented line folds.
        trackItemLazyState(attachedLine, lazyState)
        if (lazyState.opaque?.kind !== 'code') authoredFenceBase = 0
      }
      // The `+` takes one block: the blank after an unclosed fence is the host's separator, not payload (carve#4048).
      if (lazyState.opaque?.kind === 'code' && (lexer.peek() === undefined || isBlankLine(lexer.peek()!))) {
        const opener = attachedLines.map(line => line.trimStart()).find(line => opensCodeFence(line))
        const run = opener === undefined ? undefined : /^(`{3,}|~{3,})/.exec(opener)?.[1]
        if (run !== undefined) {
          nestedOrigins.set(nested.length, { text: run, parentIndex: plusLineIndex, prefix: plusEnd, virtual: true })
          nested.push(run)
          nestedSourceLines.push(undefined)
          nestedLineNumbers.push(attachedLineNumbers.at(-1) ?? plusLineNumber)
          lazyState.opaque = null
          lazyState.lazyFoldable = false
        }
      }
      if (
        lazyState.opaque === null && lexer.peek() !== undefined &&
        !isBlankLine(lexer.peek()!) && !isItemAttachBoundary(lexer.peek()!) &&
        true
      ) {
        plusSeparators.add(nested.length)
        nested.push('')
        nestedSourceLines.push(undefined)
        nestedLineNumbers.push(attachedLineNumbers.at(-1) ?? plusLineNumber)
        trackItemLazyState('', lazyState)
      }
      return 'continue'
    }
    const admitContinuationMarker = (l: string): Decision | undefined => {
      if (markerNoteBodyPending) {
        markerNoteBodyPending = false
        const continuation = sliceColumns(l, contentCol, true)
        markerNoteFirstText = indentColumns(l, contentCol + FOOTNOTE_BODY_COLUMN) >= contentCol + FOOTNOTE_BODY_COLUMN &&
          (isListMarkerLine(continuation) || !lineOpensItemBlock(continuation.trimStart()))
      }
      if (markerNoteItem && pendingBlankRun.count > 0 && (noteCommentLines.size > 0 || pendingNoteComments.size > 0) &&
          indentColumns(l, markerNoteFloor) >= markerNoteFloor && !lineOpensBlock(l.trimStart()))
        flags.loose = true
      // List-continuation marker (Carve): a lone `+` at the marker column
      // attaches the FOLLOWING flush-left block to this item without indenting
      // it. A bare `+` is never a bullet (a bullet needs `+ ` + content). It
      // injects a blank separator so the block parses on its own; the
      // compact-list rule above then keeps the item tight.
      const { plusColumn, listPlusOwner, blankBeforeNestedContinuation: plusAfterBlank } =
        classifyItemContinuation({ lexer, line: l, pendingBlankCount: pendingBlankRun.count,
          itemQuoteDepth, physicalItemMarkerColumn, contentCol, baseIndent,
          previousNestedLine: nestedSourceLines.at(-1) })
      if (plusAfterBlank) blankBeforeNestedContinuation = true
      if (listPlusOwner) return attachAfterPlus(plusColumn)
      return undefined
    }
    // Check the rebased leaf once; collection-only note text stores no continuation claim.
    // At the first line past a marker-line note, the note's last block answers (carve#3885).
    const noteClaimEnds = (): boolean => {
      markerNoteClaimChecked = true
      // A comment the note covered closed its paragraph.
      if (pendingNoteComments.size > 0) return true
      const claim = verbatimOnlyLazyState()
      trackItemLazyState(content, claim, true, () => false,
        { whitespace: 0, descendantFrames: true, terminatorFree: true })
      for (const text of nested) {
        trackItemLazyState(text, claim, true, () => false,
          { whitespace: leadingWhitespace(text), descendantFrames: true, terminatorFree: true })
      }
      return !(claim.lazyFoldable && claim.opaque === null && claim.divDepth === 0)
    }
    const stopsBeforeBody = (l: string): Decision | undefined => {
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
      // An ancestor's folded text needs an open paragraph in this item.
      // A comment can retain the ancestor's frame after closing this leaf.
      if (l.startsWith(LAZY_FRAME) && !lazyState.lazyFoldable && !lazyState.retainedMarker && !insideOpenFence(lazyState)) return 'stop'
      lw = indentColumns(l, contentCol)
      // The note may have ended while this item's paragraph still owns a
      // follower. Check the authored columns: rebasing the note can make the
      // same line appear to reach its body in this local frame.
      const lastItemSource = (lexer.rootLines ?? lexer.lines)[lexer.lineNumber(lexer.pos) - 2]
      const parentNoteSource = (lexer.rootLines ?? lexer.lines)[lexer.lineNumber(itemStartLineIndex) - 2]
      sourceAfterNestedNote = pendingBlankRun.count === 0 && lazyState.inFootnoteBody &&
        lastItemSource !== undefined && RE_FOOTNOTE_DEF.test(lastItemSource.trimStart()) &&
        parentNoteSource !== undefined && RE_FOOTNOTE_DEF.test(parentNoteSource.trimStart()) &&
        sourceColumn(parentNoteSource) >= itemMarkerColumn - baseIndent &&
        sourceColumn((lexer.rootLines ?? lexer.lines)[lexer.lineNumber(lexer.pos) - 1] ?? l) > itemMarkerColumn &&
        sourceColumn((lexer.rootLines ?? lexer.lines)[lexer.lineNumber(lexer.pos) - 1] ?? l) < sourceColumn(lastItemSource) + FOOTNOTE_BODY_COLUMN &&
        !lineOpensItemBlock(l.trimStart())
      if (!isBlankLine(l) && lw === baseIndent && lexer.hostBody === 'list' &&
          !(markerLineTerm && RE_DEFLIST_DEF.test(l.trimStart())) &&
          (lineOpensItemBlock(l.trimStart()) || deflistMarkerLine(stripLazyFrame(l))) &&
          sourceColumn((lexer.rootLines ?? lexer.lines)[lexer.lineNumber(lexer.pos) - 1] ?? l) ===
            lexer.rootFrameColumn(itemStartLineIndex) + baseIndent &&
          (lazyState.inDefList === 'term' || lazyState.deepest?.inDefList === 'term') &&
          lazyState.opaque === null && !insideOpenFence(lazyState)) return 'stop'
      if (lexer.hostBody === 'description' && pendingBlankRun.count === 0 && lw < contentCol &&
          lazyState.opaque === null && RE_DEFLIST_TERM.test(l.trimStart())) return 'stop'
      if (!/^[ \t]/.test(l) &&
          /^[ \t]+(?:[-*] |[0-9]+[.)] )\+[ \t]*$/.test(nestedSourceLines.at(-1) ?? '')) return 'stop'
      // A run past an open quote's column is quoted text, not an item-ending break.
      if (!isBlankLine(l) && lw <= baseIndent && lazyState.literalColon === undefined &&
          !insideOpenFence(lazyState) &&
          RE_HR.test((nested.at(-1) ?? '').trimStart()) &&
          !(insideOpenQuoteParagraph(lazyState) &&
            indentColumns(nestedSourceLines.at(-1) ?? '') > contentCol)) return 'stop'
      if (markerNoteItem && lw < contentCol && !markerNoteClaimChecked && noteClaimEnds()) return 'stop'
      return undefined
    }
    const readQuoteFacts = (l: string): Decision | undefined => {
      // A MARKER THE QUOTE TOOK AS LAZY TEXT REACHES NO CONTENT COLUMN HERE
      // (markup-carve/carve#1904). It carried no `>`, so it is not inside the
      // quote as a block at any column - it folds into the innermost open
      // paragraph, which is this item's. Sending it down the content-column arm
      // dedents it to the body's column 0, where §24 C3 opens a SUBLIST; the
      // lazy arm below keeps its indent and the fold holds.
      // A DESCRIPTION MARKER THE QUOTE TOOK AS LAZY TEXT REACHES NO CONTENT
      // COLUMN EITHER (markup-carve/carve-js#1606). Same fact as the marker
      // above, asked of the other line the item re-classifies by column: the
      // content-column arm dedents by the item's own column and leaves
      // everything past it as residual indent, and an indented `:` is no longer
      // a marker - so `> - :: t` over a column-4 `:  a` folded the description
      // into the term while the unquoted spelling of the same document read the
      // body. The lazy arm below strips the indent instead, which is PART 9
      // §24 C3's LENIENT def-list entry: a `:` attaches a fresh description to
      // an open term from at or below column 0.
      //
      // UNLESS A DESCRIPTION BODY IS ALREADY OPEN, where the same line is that
      // body's own lazy continuation rather than a second entry. That is where
      // the oracle's two collectors differ - the term's fold tests for an entry
      // AFTER unframing a lazy line and the description body's fold tests
      // before it - and it is the only state that has to be excluded: with no
      // def list open at all there is no body to continue, and holding the arm
      // back there too left 20 documents on the old answer for no reason the
      // clause states.
      //
      // ONE SHAPE, DELIBERATELY. Every quote-lazy line has this much in common,
      // but sending them all down the lazy arm moves fence-shaped lines off the
      // oracle's answer as well - the general port is its own measurement.
      // EVERY quote-lazy line, not the three shapes ported one at a time (a
      // link definition, a list marker at markup-carve/carve#1904, a description
      // marker at markup-carve/carve-js#1606). They shared one fact and it is
      // general: the line carries no `>`, so PART 0 makes it the innermost open
      // paragraph's text wherever it landed, and it reaches no content column
      // inside the item at all.
      //
      // #1606'S DESCRIPTION-OPEN GATE IS GONE, and the frame is why. That gate
      // held a `:` line back from the lazy arm while a description body was
      // open, so the body would read it as its own continuation rather than a
      // second entry. The frame gets the same answer structurally, because it is
      // the ORDER of the oracle's two collectors: the body's fold tests a lazy
      // line BEFORE anything unframes it and so sees plain text, while the
      // term's fold tests for an entry AFTER. Measured dead over 5880 documents
      // written to exercise exactly that state, so it is not carried here as a
      // condition that cannot fire.
      if (nested.length === 0 && lexer.quoteLazyLines.has(lexer.lineNumber(lexer.pos))) delete lazyState.literalColon
      quoteParagraphMarker = pendingBlankRun.count === 0 && lw > baseIndent &&
        !captionParagraphClaim && (insideOpenQuoteParagraph(lazyState) || authoredQuoteParagraphOpen) &&
        isListMarkerLine(l) &&
        !RE_BLOCKQUOTE.test(l.trimStart())
      // At or past the content column a marker ends the caption as it ends a paragraph (CARVE-P2-021, §24 C3).
      captionParagraphMarker = pendingBlankRun.count === 0 && lw > baseIndent && lw < contentCol && captionParagraphClaim &&
        isListMarkerLine(l)
      captionParagraphFollower = captionParagraphClaim && pendingBlankRun.count === 0 &&
        indentColumns(l, contentCol + 1) > contentCol &&
        lineOpensItemBlock(l.trimStart())
      quoteLazyFramed =
        (lexer.quoteLazyLines.has(lexer.lineNumber(lexer.pos)) || quoteParagraphMarker ||
          captionParagraphMarker || captionParagraphFollower) &&
        // Code, comment and established literal bodies keep their placement.
        // Lazy text in an ordinary colon body retains its paragraph frame.
        lazyState.opaque === null && lazyState.literalColon === undefined
      belowItemComment = lw < contentCol && RE_COMMENT_LINE.test(l.trimStart())
      const heldCommentSpan = belowItemComment && commentFenceRun(l.trimStart()) !== undefined &&
        bodyHoldsOpenCommentSpan(nested, itemSpanScan, degradedOpeners)
      if (belowItemComment && !heldCommentSpan) return 'stop'
      return undefined
    }
    const readDefinitionSource = (l: string): Decision | undefined => {
      const sourceLine = (lexer.rootLines ?? lexer.lines)[lexer.lineNumber(lexer.pos) - 1] ?? l
      sourceDepth = quotePrefixDepth(sourceLine)
      sourceMarkerColumn = sourceColumn(sourceLine, sourceDepth)
      sourceEntry = l.trimStart()
      ancestorTermBand = markerLineTerm && lazyState.inDefList === 'term' &&
        sourceMarkerColumn > lexer.hostContentColumn && sourceMarkerColumn < physicalItemMarkerColumn &&
        !isListMarkerLine(sourceEntry)
      if (markerLineTerm && lazyState.inDefList === 'term' && definitionHostColumn === undefined)
        definitionHostColumn = physicalItemMarkerColumn + contentCol - baseIndent
      // CARVE-P2-028: text past the term host cannot publish a quote claim.
      foldedTermText = pendingBlankRun.count === 0 && !insideOpenQuoteParagraph(lazyState) &&
        !authoredQuoteParagraphOpen && lazyState.inDefList === 'term' && definitionHostColumn !== undefined &&
        sourceMarkerColumn > definitionHostColumn
      if (RE_DEFLIST_TERM.test(sourceEntry) && nested.at(-1) !== undefined &&
          (nested.at(-1)!.startsWith(LAZY_FRAME) ||
            !lineOpensItemBlock(nested.at(-1)!.trimStart()) && !isBlankLine(nested.at(-1)!)))
        lexer.nonAuthoredDefinitionStarts.add(lexer.lineNumber(lexer.pos))
      if (definitionHostColumn !== undefined && !RE_DEFLIST_TERM.test(sourceEntry) &&
          !RE_DEFLIST_DEF.test(sourceEntry) && lineOpensItemBlock(sourceEntry) &&
          sourceMarkerColumn >= contentCol) {
        definitionHostColumn = undefined
        definitionAuthored = false
        definitionBodyColumn = undefined
      }
      if (!quoteLazyFramed && lazyState.opaque === null &&
          lazyState.inDefList === 'description' && RE_DEFLIST_TERM.test(sourceEntry))
        authoredTermColumn = sourceMarkerColumn
      if (!ancestorTermBand && !quoteLazyFramed && lazyState.opaque === null && RE_DEFLIST_TERM.test(sourceEntry) &&
          lw >= contentCol && (definitionHostColumn === undefined ||
            sourceMarkerColumn <= definitionHostColumn)) {
        definitionHostColumn = sourceMarkerColumn
        definitionAuthored = sourceMarkerColumn > contentCol &&
          !lexer.nonAuthoredDefinitionStarts.has(lexer.lineNumber(lexer.pos))
      }
      sourceDescription = RE_DEFLIST_DEF.exec(sourceEntry)
      // A nested item's authored marker column is its boundary even when its
      // marker is wider than the parent's. The next column is still inside it.
      const termOwnerColumn = physicalItemMarkerColumn
      // A separator at the item's marker column or its ancestor's content
      // column releases a marker-line term. A line in the band between them
      // keeps the deepest open term's paragraph claim.
      if (markerLineTerm && sourceDescription !== null && lazyState.inDefList === 'term' &&
          sourceDepth === itemQuoteDepth &&
          (sourceMarkerColumn <= lexer.hostContentColumn || sourceMarkerColumn === termOwnerColumn) &&
          !enclosingLazy) return 'stop'
      markerTermText = markerLineTerm && sourceDescription !== null &&
        lazyState.inDefList === 'term' && sourceDepth === itemQuoteDepth &&
        sourceMarkerColumn < physicalItemMarkerColumn + contentCol - baseIndent &&
        sourceMarkerColumn > termOwnerColumn
      if (!enclosingLazy && RE_DEFLIST_DEF.test(sourceQuoteBody(sourceLine).trimStart()) && lazyState.inDefList === 'term' &&
          definitionHostColumn !== undefined && sourceMarkerColumn < definitionHostColumn &&
          (sourceMarkerColumn <= lexer.hostContentColumn || sourceMarkerColumn === physicalItemMarkerColumn) &&
          sourceDepth === itemQuoteDepth) return 'stop'
      if (pendingBlankRun.count > 0) {
        returnedParagraphColumn = undefined
        nestedTermOwnsSeparator = false
      }
      return undefined
    }
    const readDefinitionBand = (l: string): Decision | undefined => {
      if (sourceDescription !== null && lw === contentCol && leadHasDeeperItem &&
          leadBottomIsTerm && lazyState.inDefList === false && pendingBlankRun.count === 0)
        nestedTermOwnsSeparator = true
      if (sourceDescription !== null && lw === contentCol && sourceMarkerColumn === leadNestedMarkerColumn &&
          leadNestedTerm && !leadHasDeeperItem &&
          lazyState.inDefList === false && lazyState.deepest?.inDefList !== 'term' &&
          pendingBlankRun.count === 0)
        returnedParagraphColumn = sourceMarkerColumn
      if (sourceDescription !== null && returnedTermSourceColumn !== undefined &&
          sourceMarkerColumn < returnedTermSourceColumn &&
          definitionHostColumn !== undefined && sourceMarkerColumn > definitionHostColumn)
        returnedParagraphColumn = sourceMarkerColumn
      const belowDescriptionBodyBand =
        definitionHostColumn !== undefined && definitionBodyColumn !== undefined &&
        sourceMarkerColumn > definitionHostColumn &&
        sourceMarkerColumn < definitionBodyColumn
      pastDefinitionEntry = definitionAuthored && belowDescriptionBodyBand
      survivingItemParagraph = markerContentColumn(content, terminatorFree) < 0 ||
        lazyState.deepest?.lazyFoldable === true
      // A marker-line note's body takes a description at its own column below a deeper term.
      const atMarkerNoteBody = markerNoteItem && sourceDescription !== null && sourceDepth === itemQuoteDepth &&
        sourceMarkerColumn >= lexer.rootFrameColumn(itemStartLineIndex) + contentCol - baseIndent + FOOTNOTE_BODY_COLUMN
      belowDefinitionEntry = lazyState.opaque === null && !lazyState.inFootnoteBody && !atMarkerNoteBody &&
        definitionHostColumn !== undefined &&
        (sourceDescription !== null || RE_DEFLIST_TERM.test(sourceEntry)) &&
        ((!markerLineTerm && sourceMarkerColumn < contentCol) ||
          (markerLineTerm && lazyState.inDefList === 'description' &&
            sourceMarkerColumn < physicalItemMarkerColumn + contentCol - baseIndent) ||
          definitionAuthored && definitionHostColumn !== undefined &&
            (sourceMarkerColumn < definitionHostColumn ||
              pastDefinitionEntry && !RE_DEFLIST_TERM.test(sourceEntry) &&
                !(survivingItemParagraph && startsInterruptingBlock(lexer, sourceEntry)) &&
                !(sourceDescription !== null && returnedTermSourceColumn === sourceMarkerColumn)))
      if (belowDescriptionBodyBand && definitionHostColumn !== undefined &&
          (RE_DEFLIST_TERM.test(sourceEntry) || survivingItemParagraph && startsInterruptingBlock(lexer, sourceEntry) ||
            sourceDescription !== null && returnedTermSourceColumn === sourceMarkerColumn)) {
        const owner = sourceDescription !== null ? returnedTermOwnerColumn ?? definitionHostColumn : definitionHostColumn
        lexer.returnedDescriptionOwnerColumns.set(lexer.lineNumber(lexer.pos), owner)
        if (RE_DEFLIST_TERM.test(sourceEntry)) {
          returnedTermSourceColumn = sourceMarkerColumn
          returnedTermOwnerColumn = owner
        }
      }
      if (belowDefinitionEntry && !enclosingLazy && !ancestorTermBand && lw <= baseIndent && !insideOpenQuoteParagraph(lazyState) &&
          !authoredQuoteParagraphOpen) return 'stop'
      if (!quoteLazyFramed && lazyState.opaque === null && sourceDescription &&
          definitionHostColumn === sourceMarkerColumn)
        definitionBodyColumn = sourceMarkerColumn + deflistContentCol(sourceDescription[1]!)
      if (!quoteLazyFramed && lazyState.opaque === null && sourceDescription &&
          authoredTermColumn === sourceMarkerColumn)
        authoredDescriptionBodyColumn = sourceMarkerColumn + deflistContentCol(sourceDescription[1]!)
      trackedDescriptionBodyColumn = lazyState.inDefList === 'description' &&
        lazyState.descriptionColumn !== undefined
        ? contentCol + lazyState.descriptionColumn : -1
      descriptionBodyColumn = Math.max(trackedDescriptionBodyColumn, authoredDescriptionBodyColumn ?? -1)
      descriptionFollowerColumn = descriptionBodyColumn > 0
        ? indentColumns(l, descriptionBodyColumn) : -1
      const foldedDefinitionInReturnedParagraph = returnedParagraphColumn !== undefined &&
        pendingBlankRun.count === 0 && lazyState.lazyFoldable &&
        sourceMarkerColumn > returnedParagraphColumn &&
        (RE_FOOTNOTE_DEF.test(sourceEntry) || isLinkDefLine(sourceEntry))
      belowOpenDescription = foldedDefinitionInReturnedParagraph || pendingBlankRun.count === 0 && lazyState.lazyFoldable &&
        descriptionFollowerColumn > contentCol && descriptionFollowerColumn < descriptionBodyColumn &&
        !lineOpensBlock(l.trimStart()) && !isContinuationMarker(l.trimStart()) &&
        !isBlockAttributeLine(l.trimStart()) &&
        !isRetainableLineComment(lexer, l) &&
        !/^:[ \t]+%%/.test((nested.at(-1) ?? '').trimStart())
      return undefined
    }

    // A line at the content column, in the order the item reads it.
    const placeContentLine = (l: string): void => {
      strippedPrefix = undefined
      placed = sliceColumns(l, contentCol, true, prefix => { strippedPrefix = prefix })
      if (blockedNoteClaimFloor !== undefined && indentColumns(l, blockedNoteClaimFloor) < blockedNoteClaimFloor &&
          isListMarkerLine(placed.trimStart())) blockedNoteClaimFloor = undefined
      if (lazyState.opaque === null && descendantOpaque === null && RE_FOOTNOTE_DEF.test(placed.trimStart())) {
        lexer.hostedFootnoteLines.add(lexer.lineNumber(lexer.pos))
        blockedNoteClaimFloor = indentColumns(l) + FOOTNOTE_BODY_COLUMN
      }
      followsBlank = pendingBlankRun.count > 0
      const commentRun = commentFenceRun(placed.trimStart())
      if (commentRun !== undefined && commentBlockHasCloser(lexer, commentRun))
        commentBoundaryBlanks.push({openerIndex:nested.length+pendingBlankRun.lineNumbers.length,lines:[...pendingBlankRun.lineNumbers]})
      for (let k = 0; k < pendingBlankRun.lines.length; k++) {
        const comment = pendingNoteComments.has(k)
        if (comment) noteCommentLines.add(nested.length)
        // Emptied here, a nested item's own collector would have no residue
        // left to measure its opener against, so the container keeps what it
        // does not own.
        else bufferedBlanks.add(nested.length + 1)
        nestedSourceLines.push(pendingBlankRun.lines[k])
        nested.push(sliceColumns(pendingBlankRun.lines[k] ?? '', contentCol, true))
        nestedLineNumbers.push(pendingBlankRun.lineNumbers[k]!)
        if (!comment) trackItemLazyState('', lazyState)
      }
      pendingBlankRun.clear()
      pendingNoteComments = new Set()
      isMarker =
        !(blockedNoteClaimFloor !== undefined &&
          indentColumns(l, blockedNoteClaimFloor) >= blockedNoteClaimFloor) &&
        !(lazyState.inFootnoteBody && nestedNoteBodyColumn !== undefined &&
          indentColumns(l, nestedNoteBodyColumn) >= nestedNoteBodyColumn) &&
        !insideOpenFence(lazyState) &&
        !insideOpenQuoteParagraph(lazyState) &&
        // A marker at an open description's body column is the description's block.
        !(lazyState.inDefList === 'description' && lazyState.descriptionColumn !== undefined &&
          indentColumns(placed, lazyState.descriptionColumn) >= lazyState.descriptionColumn) &&
        (RE_ORDERED.test(l) ||
          RE_UNORDERED.test(l) ||
          RE_TASK.test(l) ||
          // An abutting-attr bullet (`-{.x} item`) is a marker too. It no
          // longer reaches here via §10 interruption (bullets do not
          // interrupt), so the sub-list nesting path must recognize it
          // directly to keep nesting.
          extractItemAttr(l) !== null)
      const precedingSource = (lexer.rootLines ?? lexer.lines)[lexer.lineNumber(lexer.pos) - 2]
      // A marker below an accepted `+` of a note or description is that body's first block.
      const followsOwnedMarker = precedingSource !== undefined && (
        isContinuationMarker(sourceQuoteBody(precedingSource)) && markerDecision(lexer, lexer.pos - 1).owner?.kind === 'footnote' ||
        /^(?::|\[\^[^\]]+\]:)[ \t]+\+[ \t]*$/.test(sourceQuoteBody(precedingSource).trimStart()))
      if (isMarker && !followsOwnedMarker) subListMarkers.add(nested.length)
    }
    const dedentContentLine = (l: string): void => {
      // A QUOTE-LAZY LINE INSIDE AN OPEN FENCE IS FRAMED, NOT DEDENTED BY THE
      // CONTENT COLUMN (markup-carve/carve-js#1645). It carries no `>`, so its
      // leading whitespace is alignment under the quoted item, not source the
      // author put inside the fence body; the executable spec and carve-php
      // strip it whole. `sliceColumns` removed only the item's content column
      // and left the rest, so a body aligned under `> - ` kept two columns of
      // indent on every line. The frame is what the #1630 arm below already
      // uses for the below-column case: its first character is not whitespace,
      // so a closing run among these lines matches no closer and stays body,
      // the fence running to the end of its container - which is the answer
      // both references give at every closer offset. A MARKED line (`>  code`)
      // is not quote-lazy and keeps the content-column dedent that preserves
      // its authored indentation.
      const quoteFootnote = RE_BLOCKQUOTE.test(content) && RE_FOOTNOTE_DEF.test(placed.trimStart()) && leadingWhitespace(placed) >= FOOTNOTE_BODY_COLUMN
      dedented =
        lazyState.opaque?.kind === 'code' && lexer.quoteLazyLines.has(lexer.lineNumber(lexer.pos))
          ? l.startsWith(LAZY_FRAME)
            ? l
            : LAZY_FRAME + l.replace(/^[ \t]+/, '')
          : quoteFootnote
            ? placed.trimStart()
          : placed
      if (markerTermText) dedented = LAZY_FRAME + sourceEntry
      if (pastDefinitionEntry && survivingItemParagraph &&
          definitionHostColumn === lexer.rootFrameColumn(itemStartLineIndex) + contentCol - baseIndent &&
          (startsInterruptingBlock(lexer, placed.trimStart()) ||
            sourceDescription !== null && returnedTermSourceColumn === sourceMarkerColumn))
        dedented = placed.trimStart()
      if (sourceDescription !== null && returnedParagraphColumn === sourceMarkerColumn &&
          survivingItemParagraph) dedented = placed.trimStart()
      if (returnedParagraphColumn !== undefined && sourceMarkerColumn >= returnedParagraphColumn &&
          lazyState.inDefList !== 'term' &&
          startsInterruptingBlock(lexer, placed.trimStart())) dedented = placed.trimStart()
      if (leadNestedTerm && !nestedTermOwnsSeparator && sourceMarkerColumn >= leadNestedMarkerColumn &&
          sourceMarkerColumn < leadNestedTermColumn && startsInterruptingBlock(lexer, placed.trimStart()))
        dedented = placed.trimStart()
      if (leadNestedTerm && !leadHasDeeperItem && returnedParagraphColumn !== undefined &&
          lazyState.descriptionHasTerm === false &&
          isListMarkerLine(placed.trimStart()) &&
          sourceMarkerColumn >= contentCol) dedented = placed.trimStart()
      // Lists and invisible definitions keep their authored bases for extent checks.
      if (authoredDescriptionBodyColumn !== undefined &&
          authoredDescriptionBodyColumn > trackedDescriptionBodyColumn &&
          descriptionBodyColumn > contentCol && descriptionFollowerColumn < descriptionBodyColumn &&
          descriptionFollowerColumn >= contentCol && lazyState.opaque === null &&
          lineOpensItemBlock(placed.trimStart()) && !RE_DEFLIST_TERM.test(placed.trimStart()) &&
          !RE_DEFLIST_DEF.test(placed.trimStart()) && !RE_FOOTNOTE_DEF.test(placed.trimStart()) &&
          !isLinkDefLine(placed.trimStart()) && !isListMarkerLine(placed.trimStart()) &&
          !quoteLazyFramed)
        dedented = placed.trimStart()
      if (quoteFootnote) {
        // Keep the authored gap to the note's body when lifting it out of the quote.
        quotedFootnoteColumn = indentColumns(l)
        quotedFootnoteOffset = indentColumns(placed)
      } else if (quotedFootnoteColumn !== undefined && dedented === placed) {
        if (indentColumns(l) < quotedFootnoteColumn) {
          dedented = placed.trimStart()
          quotedFootnoteColumn = undefined
        } else {
          dedented = sliceColumns(placed, quotedFootnoteOffset, true)
        }
      }
      // A line collected INSIDE AN OPEN FENCE is verbatim body, never an
      // authored base. Without this guard the rebase saw an over-indented
      // fence CLOSER - one written past its opener, which is body text, not a
      // closer - as a fresh opener (the real opener is the item's lead line
      // and is not in `nested`), dedented it to column 0, and parseFence then
      // closed the fence there, losing the rest of its body
      // (markup-carve/carve-js#1636). carve-rs keeps it as body already.
      if (lazyState.opaque?.kind !== 'code' &&
          !(foldedTermText && (RE_DEFLIST_TERM.test(sourceEntry) || /^#{1,6}(?:[ \t]|$)/.test(sourceEntry))) &&
          (lazyState.literalColon === undefined || leadingWhitespace(dedented) === 0) &&
          !(nestedTermOwnsSeparator && indentColumns(l) >= leadNestedContentColumn &&
            RE_DEFLIST_TERM.test(dedented.trimStart()))) {
        authoredBaseEligible.add(nested.length)
        if (firstBodyMarkerColumn === undefined) {
          firstBodyMarkerColumn = markerContentColumn(nested.find((line) => !isBlankLine(line)) ?? dedented)
        }
        if (firstBodyMarkerColumn >= 0 && !hasParentAuthoredBlock) {
          if (followsBlank && isParentAuthoredBlock(dedented, firstBodyMarkerColumn, true)) hasParentAuthoredBlock = true
          else parentBlockCandidates.push(dedented)
        }
      }
      if (strippedPrefix !== undefined && dedented === placed) {
        nestedOrigins.set(nested.length, { text: dedented, parentIndex: lexer.pos, prefix: strippedPrefix })
      }
      nested.push(dedented)
      nestedSourceLines.push(l)
      nestedLineNumbers.push(lexer.lineNumber(lexer.pos))
      fenceLineIndex = lexer.pos
    }
    const trackNoteBody = (l: string): void => {
      if (markerNoteItem) {
        const bodyText = dedented.trimStart()
        // A comment keeps its own retention reading (CARVE-P9-053).
        const bodyComment = RE_COMMENT_LINE.test(bodyText) || commentFenceRun(bodyText) !== undefined
        markerNoteParagraph = noteParagraphOpen && !followsBlank && !bodyComment &&
          indentColumns(l, markerNoteFloor) >= markerNoteFloor &&
          (isListMarkerLine(bodyText) || !lineOpensItemBlock(bodyText))
        if (nestedNoteBodyColumn !== undefined && indentColumns(l, nestedNoteBodyColumn) >= nestedNoteBodyColumn) {
          const marker = isListMarkerLine(bodyText)
          const folds: boolean = marker && nestedNoteParagraph && !followsBlank
          nestedNoteParagraph = folds || (!bodyComment && !marker && !lineOpensItemBlock(bodyText))
        }
      }
      const continuedMarkerNoteText = markerNoteItem && !followsBlank && lazyState.lazyFoldable &&
        lazyState.opaque === null && lazyState.quoteInner === null && lazyState.literalColon === undefined &&
        indentColumns(l, contentCol + FOOTNOTE_BODY_COLUMN) >= contentCol + FOOTNOTE_BODY_COLUMN &&
        isListMarkerLine(dedented.trimStart())
      if (noteParagraphOpen && !followsBlank && (markerNoteFirstText || continuedMarkerNoteText) && isListMarkerLine(dedented.trimStart())) noteParagraphMarkers.add(nested.length - 1)
      // An absorbed colon run keeps its spelling so the run below it stays text (CARVE-P9-016).
      trackedContent = (markerNoteFirstText || continuedMarkerNoteText) && !RE_COLON_RUN.test(dedented.trimStart())
        ? 'text' : dedented
      markerNoteFirstText = false
      if (isMarker && lazyState.opaque === null) {
        const markerContent = markerFreeContent(dedented)
        const run = commentFenceRun(markerContent)
        if (run !== undefined && commentBlockHasCloser(lexer, run)) {
          const hostColumn = contentCol + markerContentColumn(dedented)
          for (let at = lexer.pos + 1; at < lexer.lineCount; at++) {
            const line = lexer.lineAt(at)!
            if (commentFenceRun(line) === run) {
              trackedContent = markerContent
              break
            }
            if (!isBlankLine(line) && indentColumns(line, hostColumn) < hostColumn) break
          }
        }
      }
    }
    const trackFenceOwnership = (l: string): void => {
      tabOpenerColumns = undefined
      tabOpenerText = undefined
      unindented = dedented
      if (lazyState.opaque?.kind === 'code') {
        if (tabFenceSourceColumn !== undefined && tabFenceOpenerIndex !== undefined &&
            dedented.includes('\t') && dedented.slice(0, leadingWhitespace(dedented)).includes('\t')) {
          const facts = tabLineFacts ??= new Map()
          if (!facts.has(tabFenceOpenerIndex)) {
            facts.set(tabFenceOpenerIndex, { text: nested[tabFenceOpenerIndex]!, columns: tabFenceSourceColumn - contentCol })
          }
        }
        if (tabFenceSourceColumn === undefined || tabLineFacts?.has(tabFenceOpenerIndex!) !== true) {
          if (authoredFenceBase > 0 && indentColumns(dedented, authoredFenceBase) >= authoredFenceBase) {
            trackedContent = sliceColumns(dedented, authoredFenceBase, true)
          } else if (authoredFenceBase > 0) {
            // Below the authored base the whole indent is available prefix, so a closer run still closes.
            trackedContent = dedented.trimStart()
          }
        } else {
          if (indentColumns(l) >= contentCol && indentColumns(l) <= tabFenceSourceColumn &&
              lazyState.opaque.close.test(l.slice(leadingWhitespace(l)))) {
            lazyState.opaque = null
            tabFenceSourceColumn = undefined
            trackedContent = ''
          } else trackedContent = 'text'
        }
      } else {
        const trimmed = dedented.trimStart()
        unindented = trimmed
        const descriptionLead = RE_DEFLIST_DEF.exec(trimmed)
        const bottom = descendantOpaque === null && lazyState.deepest?.opaque?.kind !== 'code' &&
          (trimmed.includes('`') || trimmed.includes('~')) &&
          (isListMarkerLine(trimmed) || RE_DEFLIST_DEF.test(trimmed))
          ? descriptionLead !== null
            ? markerLineBottomBlock(descriptionLead[2]!)
            : markerLineBottomBlock(trimmed, session.markerPrefixMemo(lexer, fenceLineIndex))
          : trimmed
        const opener = opensCodeFence(bottom) ? bottom : trimmed
        const indented = opener !== dedented
        const mayOpenFence = indented && !(lazyState.inDefList === 'term' && lazyState.termAfterComment) && lazyState.literalColon === undefined &&
          !noteFenceOpen(lazyState) &&
          (lazyState.quoteInner === null || !blockQuoteParagraphOpen(lazyState.quoteInner)) &&
          opensCodeFence(opener)
        if (mayOpenFence && l.slice(0, lexer.lineLeadingWhitespace(lexer.pos)).includes('\t')) {
          tabFenceSourceColumn = indentColumns(l)
          tabFenceOpenerIndex = nested.length - 1
          tabOpenerText = dedented
          tabOpenerColumns = tabFenceSourceColumn - contentCol
          if (dedented.slice(0, leadingWhitespace(dedented)).includes('\t')) {
            const facts = tabLineFacts ??= new Map()
            facts.set(nested.length - 1, { text: dedented, columns: tabOpenerColumns })
          }
        }
        ownerPending.push({
          line: dedented,
          index: fenceLineIndex,
          followsBlank,
          foldable: lazyState.lazyFoldable,
          framed: insideOpenFence(lazyState),
        })
        if (mayOpenFence && descendantOpaque === null && (leftBlockedNote || walkOwnership())) {
          trackedContent = opener
          if (leftBlockedNote) authoredFenceBase = indentColumns(dedented)
        }
        // A COMMENT THE ITEM ALREADY HOLDS OWNS ITS PAYLOAD. §28 makes that
        // body verbatim, so a fence-shaped line inside it OPENS nothing. It
        // does not stop an open descendant fence CLOSING, though: the item's
        // tracker reads a `%%%` inside that fence's body as a comment opener,
        // and holding the walk back there left the state standing past the real
        // closer.
        else if (indented &&
          (descendantOpaque !== null || (lazyState.opaque === null && mayOpenFence))) {
          trackDescendantOpaque(dedented, opener, followsBlank)
          if (descriptionLead !== null && descendantOpaque !== null) {
            descriptionFenceAwaitingPayload = true
            if (markerLineTerm && descendantOpaque.markerLine) descriptionMarkerFence = true
          }
        } else if (!indented && !isBlankLine(dedented)) {
          // A block of THIS item, so no descendant is open behind it.
          descendantOpaque = null
        }
      }
    }
    const readDescriptionLine = (): void => {
      // The description's fence ends with the description, at the first line below its column.
      if (markerDescriptionCodeTracked && lazyState.opaque?.kind === 'code' && markerDescriptionCodeOwner !== undefined &&
          !isBlankLine(trackedContent) && indentColumns(trackedContent) < markerDescriptionCodeOwner) {
        lazyState.opaque = null
        markerDescriptionCodeTracked = false
      }
      if (leadColonAwaitingBody && /^:{3,}/.test(trackedContent) && colonFenceOpenerLen(trackedContent) === null) {
        lazyState.unrebasedColonBody = { width: leadColon! }
        leadColonAwaitingBody = false
        // The div is open all the same, so its bare run is a closer, not absorbed text (carve#4397).
        if (RE_DIV_OPEN.test(content)) {
          lazyState.divDepth++
          lazyState.authoredColon = { width: leadColon!, column: 0, depth: lazyState.divDepth }
        }
      }
      confirmsLeadBody = leadColonAwaitingBody && !opensCodeFence(trackedContent)
      if (confirmsLeadBody) {
        lazyState.lazyFoldable = false
        lazyState.divDepth++
        lazyState.authoredColon = { width: leadColon!, column: 0, depth: lazyState.divDepth }
      }
      if (markerDescriptionColumn !== undefined && !opensCodeFence(dedented.trimStart()) &&
          lineOpensItemBlock(dedented.trimStart())) markerDescriptionColumn = undefined
      markerDescription = singleMarkerTerm && lazyState.quoteInner === null && !insideOpenFence(lazyState)
        ? RE_DEFLIST_DEF.exec(trackedContent) : null
      if (markerDescriptionColumn !== undefined && markerDescription === null && !isBlankLine(trackedContent) &&
          indentColumns(trackedContent) < markerDescriptionColumn) markerDescriptionColumn = undefined
      if (singleMarkerTerm && !insideOpenFence(lazyState) && RE_DEFLIST_TERM.test(trackedContent)) singleMarkerTerm = false
      if (singleMarkerTerm && lazyState.quoteInner === null && lazyState.inDefList === 'description' &&
          (lazyState.ownedColumn < 0 || lazyState.ownedAuthored) && !insideOpenFence(lazyState) &&
          markerDescriptionColumn !== undefined && indentColumns(trackedContent) >= markerDescriptionColumn) {
        const opener = trackedContent.trimStart()
        if (opensCodeFence(opener)) {
          const openerColumn = lexer.ownedIndentColumns(fenceLineIndex)
          if (openerColumn !== undefined && openerColumn >= contentCol + markerDescriptionColumn) {
            markerDescriptionCodeBase = openerColumn - contentCol
            markerDescriptionCodeTracked = true
            markerDescriptionCodeOwner = markerDescriptionColumn
            singleMarkerTerm = false
            lazyState.inDefList = false
            lazyState.ownedColumn = -1
            lazyState.deepest = null
          }
          singleMarkerTerm = false
          markerDescriptionColumn = undefined
        }
      }
      foldedDescription = nestedOwnerColumn < 0 && lazyState.quoteInner === null && lazyState.lazyFoldable &&
        !lazyState.absorbingFence && (lazyState.ownedColumn < 0 || lazyState.ownedAuthored) &&
        lazyState.inDefList === false && RE_DEFLIST_DEF.test(trackedContent)
      // A consumed descendant closer must not reopen a paragraph in the item.
      skipConsumedCloser = closedDescendantFence || openedLaterNoteFence
      closedDescendantFence = false
      openedLaterNoteFence = false
      wasMarkerDescriptionCode = markerDescriptionCodeTracked && lazyState.opaque?.kind === 'code'
      atItemColumn = lw === contentCol && placed[0] !== ' ' && placed[0] !== '\t'
      captionAtItemColumn = atItemColumn && RE_CAPTION.test(trackedContent)
      hadQuoteParagraph = captionAtItemColumn &&
        (insideOpenQuoteParagraph(lazyState) || authoredQuoteParagraphOpen)
      const authoredQuoteLead = unindented[0] === '>' && trackedContent === dedented &&
        !RE_BLOCKQUOTE.test(dedented) && RE_BLOCKQUOTE.test(unindented)
      itemOwnsQuote = authoredQuoteLead && !foldedTermText && !lazyState.inFootnoteBody && nestedNoteBodyColumn === undefined &&
        (authoredQuoteClaim !== null || lazyState.quoteInner === null && lazyState.ownedColumn < 0 && !insideOpenFence(lazyState) &&
          descendantOpaque === null)
      claimHostColumn = itemOwnsQuote && lazyState.inDefList === 'description' && lazyState.descriptionColumn !== undefined
        ? contentCol + lazyState.descriptionColumn : contentCol
    }
    const trackContentState = (l: string): void => {
      if (lazyState.quoteInner !== null && !insideOpenQuoteParagraph(lazyState) && authoredQuoteClaim === null &&
          !RE_BLOCKQUOTE.test(unindented) &&
          !lexer.quoteLazyLines.has(lexer.lineNumber(lexer.pos)) && !quoteParagraphMarker) {
        lazyState.quoteInner = null
      }
      if (!skipConsumedCloser) trackItemLazyState(
        trackedContent,
        lazyState,
        true,
        // Classify the span before applying the item's column boundary.
        // A below-column payload line still ends the item; its own parse
        // then sees an unclosed opener and publishes the former payload.
        (fence) => {
          const closes = commentBlockHasCloser(lexer, fence, fenceLineIndex)
          if (!closes) degradedOpeners.add(nested.length - 1)
          return closes
        },
        // THE LIST ITEM HOST OPTS IN to classifying a descendant-owned line
        // in the descendant's own frame (carve#2884). The flag rides on the
        // facts, and the arm needs the measured run anyway, so a line with
        // no facts opts in to nothing. A tab fence carries source-column facts
        // when a split tab prevents reuse of its stripped origin.
        {
          terminatorFree: false,
          payloadFenceCloser: marker => payloadFenceCloserInItem(marker, fenceLineIndex),
          ...itemFrameFacts(lineFacts(trackedContent, nestedOrigins.get(nested.length - 1))),
          // A tab split at the item column leaves generated spaces with no
          // matching source origin. Measure that residual run in its new text.
          ...(l.slice(0, leadingWhitespace(l)).includes('\t') && /^ +[^ \t]/.test(trackedContent)
            ? { whitespace: leadingWhitespace(trackedContent) }
            : {}),
        },
        (width, extra = 0) => {
          const closes = literalCommentHasCloser(lexer, width, fenceLineIndex, -1, contentCol + extra)
          const owner = lazyState.literalColon?.sourceLine
          if (extra === 0 && owner !== undefined) {
            const key = `${owner}:${lexer.lineNumber(fenceLineIndex)}`
            if (closes) lexer.literalCommentLineOpeners.delete(key)
            else {
              if (commentBlockHasCloser(lexer, width, fenceLineIndex)) lazyState.literalColon!.rejectedComment = true
              lexer.literalCommentLineOpeners.add(key)
            }
          }
          return closes
        },
        tabOpenerText === trackedContent ? tabOpenerColumns : undefined,
        tabOpenerText === trackedContent ? leadingWhitespace(trackedContent) : undefined,
        authoredQuoteParagraphOpen,
      )
      if (captionAtItemColumn) {
        captionParagraphClaim = hadQuoteParagraph
        lazyState.quoteInner = null
        authoredQuoteClaim = null
        authoredQuoteParagraphOpen = false
      }
      if (followsBlank) {
        captionParagraphClaim = false
        authoredQuoteClaim = null
        authoredQuoteParagraphOpen = false
      }
      const authoredQuote = itemOwnsQuote
      if (authoredQuote) {
        captionParagraphClaim = false
        if (authoredQuoteClaim !== null && authoredQuoteHostColumn === claimHostColumn) {
          const quoted = RE_BLOCKQUOTE.exec(unindented)!
          trackBlockQuoteLazyState(quoted[1] ?? '', authoredQuoteClaim, () => true)
        } else authoredQuoteClaim = markerLineQuoteState(unindented)
        authoredQuoteParagraphOpen = authoredQuoteClaim !== null && blockQuoteParagraphOpen(authoredQuoteClaim)
        authoredQuoteHostColumn = claimHostColumn
        lazyState.lazyFoldable = authoredQuoteParagraphOpen
      }
      else if (authoredQuoteClaim !== null) {
        const quoted = RE_BLOCKQUOTE.exec(trackedContent)
        if (quoted) {
          trackBlockQuoteLazyState(quoted[1] ?? '', authoredQuoteClaim, () => true)
          authoredQuoteParagraphOpen = blockQuoteParagraphOpen(authoredQuoteClaim)
        }
        else if (!authoredQuoteParagraphOpen || !lazyState.lazyFoldable || indentColumns(l) === authoredQuoteHostColumn &&
            !isListMarkerLine(l) &&
            (lineOpensBlock(unindented) || RE_COMMENT_LINE.test(unindented))) {
          authoredQuoteClaim = null
          authoredQuoteParagraphOpen = false
        }
      }
    }
    const settleContentLine = (l: string): void => {
      if (captionParagraphClaim && (RE_COMMENT_LINE.test(unindented) ||
          (atItemColumn && !RE_CAPTION.test(trackedContent) && !isListMarkerLine(l) &&
            (lineOpensBlock(unindented) || isBlockAttributeLine(unindented))))) captionParagraphClaim = false
      if (markerNoteItem && indentColumns(l, markerNoteFloor) < markerNoteFloor &&
          RE_CAPTION.test(trackedContent.trimStart()) && lazyState.opaque === null) {
        lazyState.inFootnoteBody = false
        lazyState.lazyFoldable = true
      }
      if (isMarker && lazyState.literalColon === undefined &&
          colonFenceShapeEndsLazyContinuation(markerLineBottomBlock(dedented))) {
        lazyState.lazyFoldable = false
      }
      if (lazyState.opaque === null &&
          !opensCodeFence((nested.at(-2) ?? '').trimStart()) &&
          lazyState.inDefList === 'description' && indentColumns(l) > contentCol &&
          isBlockAttributeLine(dedented.trimStart())) {
        lazyState.lazyFoldable = false
        if (lazyState.deepest?.inDefList === 'description') lazyState.deepest.lazyFoldable = false
      }
      if (lazyState.invisibleAtColumn && RE_FOOTNOTE_DEF.test(dedented.trimStart())) {
        nestedNoteBodyColumn = indentColumns(l) + FOOTNOTE_BODY_COLUMN
        nestedNoteParagraph = true
      }
      if (belowDescendantComment && commentFenceRun(l.trimStart()) === belowDescendantComment.run) {
        Object.assign(lazyState, belowDescendantComment.state)
        belowDescendantComment = undefined
      }
      if (resumesMarkerDescriptionParagraph && lazyState.opaque === null) authoredBaseEligible.delete(nested.length - 1)
      if (wasMarkerDescriptionCode && lazyState.opaque === null && opensCodeFence(dedented.trimStart())) {
        markerDescriptionCodeClosedAtFloor = indentColumns(l) === contentCol
        markerDescriptionCodeTracked = false
      }
      if (opensCodeFence(dedented.trimStart())) singleMarkerTerm = false
      if (markerDescription !== null && lazyState.inDefList === 'description' &&
          !lineOpensItemBlock(markerDescription[2]!.trimStart()) &&
          !opensCodeFence(markerDescription[2]!.trimStart())) {
        markerDescriptionColumn = 1 + markerDescription[1]!.length
      }
      if (foldedDescription && lazyState.inDefList === 'description') {
        lazyState.inDefList = false
      }
      if (tabFenceSourceColumn !== undefined && lazyState.opaque?.kind !== 'code') {
        tabFenceSourceColumn = undefined
        tabFenceOpenerIndex = undefined
      }
      if (RE_COMMENT_LINE.test(trackedContent.trimStart()) && lazyState.opaque === null && !lazyState.closedBelowComment) lazyState.commentAtColumn = false
      if (confirmsLeadBody) leadColonAwaitingBody = false
      if (leadColonAwaitingBody && opensCodeFence(trackedContent) && lazyState.opaque === null) leadColonAwaitingBody = false
      if (leadColonAwaitingBody && !RE_ADMONITION_CLOSE.test(trackedContent)) {
        lazyState.divDepth++
        leadColonAwaitingBody = false
      }
      // The item holds no paragraph a below-column line can continue while a
      // descendant holds a fence open. PART 1 S4 asks about the open STACK.
      if (descendantOpaque !== null && !descriptionFenceAwaitingPayload) lazyState.lazyFoldable = false
      // A quoted invisible definition ends the descendant quote paragraph.
      // Its body may follow, but neither can keep this item's paragraph open.
      const quotedInvisible = lazyState.opaque === null && descendantOpaque === null
        ? RE_BLOCKQUOTE.exec(unindented)?.[1] : undefined
      // A quoted footnote answers through the quote tracker (carve#3885); a link definition holds no paragraph.
      if (quotedInvisible !== undefined && quotedInvisible === quotedInvisible.trimStart() &&
          isLinkDefLine(quotedInvisible) && !RE_FOOTNOTE_DEF.test(quotedInvisible))
        lazyState.lazyFoldable = false
      if (lazyState.opaque?.kind !== 'code') authoredFenceBase = 0
      if (lazyState.opaque === null && descendantOpaque === null &&
          RE_FOOTNOTE_DEF.test(l.trimStart()) && indentColumns(l) < contentCol && !enclosingLazy)
        hostedNoteBodyColumn = indentColumns(l) + FOOTNOTE_BODY_COLUMN
      lexer.consume()
    }
    // A line-block payload run pairs with a later run of the item at any indent;
    // a failed search refutes every later opener of that character and width.
    const payloadMisses = new Map<string, { from: number; maxRun: number }>()
    const payloadFenceCloserInItem = (marker: string, from: number): boolean => {
      const char = marker[0]!
      const miss = payloadMisses.get(char)
      if (miss !== undefined && from >= miss.from && marker.length > miss.maxRun) return false
      const close = fenceCloseRe(marker)
      let maxRun = 0
      let afterBlank = false
      for (let i = from + 1; i < lexer.lineCount; i++) {
        const line = lexer.lineAt(i)!
        if ((isListMarkerLine(line) && indentColumns(line) <= baseIndent) ||
            (afterBlank && !isBlankLine(line) && indentColumns(line, contentCol) < contentCol)) break
        afterBlank = isBlankLine(line)
        const text = line.replace(/^[ \t]+/, '')
        if (close.test(text)) return true
        const run = /^(`{3,}|~{3,})[ \t]*$/.exec(text)?.[1]
        if (run !== undefined && run[0] === char) maxRun = Math.max(maxRun, run.length)
      }
      payloadMisses.set(char, { from, maxRun })
      return false
    }
    const admitContentLine = (l: string): void => {
      placeContentLine(l)
      dedentContentLine(l)
      trackNoteBody(l)
      trackFenceOwnership(l)
      readDescriptionLine()
      trackContentState(l)
      settleContentLine(l)
    }

    // A line below the content column that the item keeps as lazy text.
    const continuesLazily = (l: string): boolean =>
      pendingBlankRun.count === 0 &&
      (lw !== baseIndent || !isTableRow(l.trimStart())) &&
      !(leadState.bottomIsContinuationMarker && nested.length === 0 && leadingWhitespace(l) > 0) &&
      (sourceAfterNestedNote || (((((lazyState.lazyFoldable || captionParagraphClaim ||
        (lazyState.inDefList === 'description' && isBlockAttributeLine(l.trimStart())) ||
        (lazyState.deepest?.inDefList === 'description' &&
          (lazyState.deepest.lazyFoldable || isBlockAttributeLine(l.trimStart()))) ||
        commentFenceTail || fenceBoundaryTail ||
        // An ancestor already admitted this follower after the invisible comment.
        (lazyState.invisibleAtColumn && lexer.itemLazyLines.has(lexer.lineNumber(lexer.pos)) &&
          RE_COMMENT_LINE.test((nested.at(-1) ?? '').trimStart())))) || (lazyState.retainedMarker && (quoteLazyFramed || lexer.itemLazyLines.has(lexer.lineNumber(lexer.pos)))) ||
        (lazyState.opaque?.kind === 'comment' && lazyState.opaque.paragraphBefore && !lazyState.opaque.atColumn) ||
        // Only a consumed below-column comment retains a follower (X1).
        (lazyState.commentAtColumn &&
          !lexer.itemLazyLines.has(lexer.lineNumber(lexer.pos)) &&
          (indentColumns(l, contentCol) > 0 || lazyState.inDefList === 'description' ||
            (opensCodeFence(l.trimStart()) && followsBelowColumnComment())))) &&
        (quoteParagraphMarker || captionParagraphMarker || belowOpenDescription || (lw > baseIndent && lw < contentCol &&
          (lazyState.deepest?.lazyFoldable !== false || lazyState.inDefList === 'description' ||
            lazyState.deepest?.inDefList === 'description')) || !lazyContinuationEndsList(l, lexer) ||
          (leadBottomIsTerm && lexer.itemLazyLines.has(lexer.lineNumber(lexer.pos)) &&
            takenBelowColumn.has(nested.length - 1)) ||
          (lazyState.retainedMarker && (quoteLazyFramed || lexer.itemLazyLines.has(lexer.lineNumber(lexer.pos)))) ||
          // A list marker indented past the base column but BELOW the content
          // column folds into what the item is still holding open, rather than
          // ending the list. Under symmetric §10 no list marker interrupts a
          // paragraph, so on the recursive reparse it stays folded:
          // `1. a`/`  1. b`, `- a`/` - b`, and the abutting-attr form
          // `- a`/` -{.x} b` all fold. (At or past the content column the
          // marker nests; at the base column it can start a sibling list,
          // §11 -- so only a below-content indented one folds.)
          //
          // AN EXEMPTION FROM `lazyContinuationEndsList`, NOT A REASON OF ITS
          // OWN (markup-carve/carve-js#2338). Written as a third alternative
          // it collected the marker with nothing left to fold it into: after
          // an attribute line, a reference definition, a heading or a closed
          // fence the item's paragraph is over, and the band marker then
          // opened a NESTED list where the oracle ends the container and
          // starts a sibling one. The band followers that are not markers
          // already read that way, which is what left the two spellings of
          // one band apart.
          (indentColumns(l, baseIndent + 1) > baseIndent &&
            (RE_TASK.test(l) ||
              RE_UNORDERED.test(l) ||
              RE_ORDERED.test(l) ||
              extractItemAttr(l) !== null)))) ||
        // A COMMENT INSIDE A SPAN THIS ITEM ALREADY HOLDS IS NOT A COMMENT THAT
        // ENDS IT (markup-carve/carve-js#2255, markup-carve/carve#2488). §28
        // pairs the delimiters and indentation is part of neither, so ending the
        // item on the closer split the span: the item's own parse then read an
        // opener with no closer, which §28 makes one `%%` line, and the payload
        // reached the page while both delimiters did not.
        //
        // Asked of the COLLECTED LINES rather than of the tracker's opaque flag,
        // because the tracker reads each line at the item's dedent and its
        // opener test refuses an indented run - so a span a descendant holds is
        // invisible to it (`bodyHoldsOpenCommentSpan`).
        (commentFenceRun(l.replace(/^[ \t]+/, '')) !== undefined &&
          bodyHoldsOpenCommentSpan(nested, itemSpanScan, degradedOpeners)) ||
        (((lazyState.literalColon !== undefined && lazyState.literalColon.opaque === undefined) || (lazyState.authoredColon !== undefined && lazyState.opaque === null)) &&
          indentColumns(l, contentCol) > 0 && RE_COMMENT_LINE.test(l.trimStart()))))
    const lazyLineFor = (l: string): string => {
      if ((enclosingLazy || ancestorTermBand) && (lazyState.inDefList === 'term' || lazyState.deepest?.inDefList === 'term'))
        return LAZY_FRAME + l.trimStart()
      if (markerTermText && !shape.isTask) return LAZY_FRAME + l.trimStart()
      if (leadNestedTerm && !leadHasDeeperItem && returnedParagraphColumn !== undefined &&
          lazyState.descriptionHasTerm === false &&
          indentColumns(l, contentCol) < contentCol &&
          RE_DEFLIST_TERM.test(l.trimStart())) return LAZY_FRAME + l.trimStart()
      let lazyLine = l
      if (sourceAfterNestedNote) lazyLine = LAZY_FRAME + l.replace(/^[ \t]+/, '')
      // A caption line below the column reaches no host: it folds as text (§10 I7).
      if (indentColumns(l, contentCol) < contentCol && RE_CAPTION.test(l.replace(/^[ \t]+/, '')) &&
          lazyState.opaque === null && !quoteLazyFramed) {
        lazyLine = LAZY_FRAME + l.replace(/^[ \t]+/, '')
      } else if (indentColumns(l, contentCol) < contentCol && lazyState.opaque === null &&
          opensCodeFence(l.replace(/^[ \t]+/, '')) && followsBelowColumnComment()) {
        // R3285: a comment below the column retains the item, and a valid
        // fence after it opens a code block there (X1, CARVE-P0-013).
        lazyLine = l.replace(/^[ \t]+/, '')
        retainedFenceOpen = true
        retainedFenceItemColumn = sourceColumn(lexer.rootLines?.[lexer.lineNumber(lexer.pos) - 1] ?? l) +
          contentCol - indentColumns(l)
      } else if (lazyState.quoteInner === null && RE_FOOTNOTE_DEF.test(l.trimStart()) &&
          !lexer.quoteLazyLines.has(lexer.lineNumber(lexer.pos))) {
        lazyLine = enclosingLazy || lexer.atDocumentLevel ? LAZY_FRAME + l.replace(/^[ \t]+/, '') : l
      } else if (lexer.literalLazyLinkDefLines.has(lexer.lineNumber(lexer.pos))) {
        lazyLine = l.replace(/^[ \t]+/, '')
      } else if (captionParagraphFollower) {
        lazyLine = LAZY_FRAME + sliceColumns(l, contentCol, true)
      } else if (quoteLazyFramed) {
        // Stripped WHOLE and framed. Its indentation inside the quote body
        // means nothing, and the frame - not a leftover column of indent - is
        // what now keeps it from re-classifying, so there is no reason to keep
        // any of it. That residue is what put two columns of indent inside a
        // `dt`.
        lazyLine = l.startsWith(LAZY_FRAME)
          ? l
          : LAZY_FRAME + l.replace(/^[ \t]+/, '')
      } else if (belowOpenDescription || belowDefinitionEntry) {
        lazyLine = LAZY_FRAME + l.replace(/^[ \t]+/, '')
      } else if (lazyState.deepest?.inDefList === 'term' &&
          indentColumns(l, baseIndent + 1) > baseIndent && isListMarkerLine(l)) {
        // A band marker folds into the descendant's open term.
        lazyLine = LAZY_FRAME + l.replace(/^[ \t]+/, '')
      } else if (
        lazyState.inDefList &&
        indentColumns(l, contentCol) < contentCol &&
        // A LINE THAT WOULD OPEN A BLOCK KEEPS THE CLAMP BELOW. The full
        // flush exists so an under-indented `:  def` or `:: term` attaches to
        // the def list this item already holds (carve-js#384), and a wrapped
        // term continuation reaches the `dt` without its indent (corpus 156).
        // Neither reason covers a line that opens something at column 0: the
        // flush handed a definition-shaped one exactly that, so `* : |` over
        // ` [^f]: t` split the item's paragraph where the same pair under
        // `* x` folds (carve-js#2311). The clamp below exists for that hazard,
        // and it answers for every definition kind rather than the one whose
        // decline the prepass records.
        //
        // A DEFINITION MARKER STILL FLUSHES, since re-aligning it is the
        // point and `:: term` is an opener. The pair is the tracker's own -
        // `trackItemLazyState` opens `inDefList` on exactly these two - so one
        // spelling answers both.
        ((lazyState.inDefList === 'term' &&
          (!isListMarkerLine(l) || (indentColumns(l, baseIndent + 1) > baseIndent &&
            !lexer.itemLazyLines.has(lexer.lineNumber(lexer.pos))))) ||
          deflistMarkerLine(l) || !lineOpensBlock(l.replace(/^[ \t]+/, '')) ||
          // An unclosed `%%%` is a `%%` line (CARVE-P9-053).
          isRetainableLineComment(lexer, l))
      ) {
        lazyLine = l.replace(/^[ \t]+/, '')
        if (lazyState.inDefList === 'term' && isRetainableLineComment(lexer, l)) lazyLine = ' ' + lazyLine
        // A retained marker under an open term stays text on reparse.
        if ((lazyState.inDefList === 'term' && !deflistMarkerLine(l) && lineOpensBlock(lazyLine)) ||
            (lazyState.inDefList === 'description' && isBlockAttributeLine(lazyLine))) lazyLine = LAZY_FRAME + lazyLine
      } else if (lazyState.opaque === null && lazyState.literalColon === undefined && indentColumns(l, contentCol) < contentCol &&
          (lazyState.commentAtColumn || RE_COMMENT_LINE.test((nested.at(-1) ?? '').trimStart()) ||
            lazyState.authoredColon?.depth === lazyState.divDepth) &&
          (RE_TASK.test(l) || RE_UNORDERED.test(l) || RE_ORDERED.test(l) || extractItemAttr(l) !== null)) {
        // Retained markers below the content column stay text on reparse.
        lazyLine = LAZY_FRAME + l.replace(/^[ \t]+/, '')
      } else if (lazyState.commentAtColumn && lazyState.inDefList !== 'description' && lazyState.opaque === null && lazyState.literalColon === undefined &&
          indentColumns(l, contentCol) < contentCol && !RE_COMMENT_LINE.test(l)) {
        lazyLine = LAZY_FRAME + l.replace(/^[ \t]+/, '')
      } else if (indentColumns(l, contentCol) < contentCol &&
          (lineOpensBlock(l.replace(/^[ \t]+/, '')) || isBlockAttributeLine(l.trimStart()) ||
            opensWrappedAttributeBlock(l.trimStart()) && indentColumns(l) > 0)) {
        // A below-column opener stays text; comments keep their source column.
        const flushed = l.replace(/^[ \t]+/, '')
        // After a retaining comment the body owns the opener (carve#3285).
        lazyLine = lazyState.commentAtColumn && lazyState.inDefList === 'description'
          ? (flushed === l && RE_COMMENT_LINE.test(flushed) ? l : ' ' + flushed)
          : RE_COMMENT_LINE.test(flushed)
            ? lazyState.literalColon !== undefined && flushed !== l ? ' ' + flushed : l
            : opensCodeFence(flushed) ? ' ' + flushed : LAZY_FRAME + flushed
      } else if (lazyState.commentAtColumn && lazyState.inDefList !== 'description' && !RE_COMMENT_LINE.test(l)) {
        // The comment retained this item's frame, but closed its paragraph.
        // Keep the fold explicit so a closed descendant cannot claim it.
        lazyLine = LAZY_FRAME + l.replace(/^[ \t]+/, '')
      }
      return lazyLine
    }
    const admitLazyLine = (l: string): void => {
      const commentState = belowItemComment && lazyState.literalColon === undefined && (lazyState.deepest != null || lazyState.authoredColon?.column === 0) && lazyState.opaque === null ? {...lazyState} : undefined
      const lazyLine = lazyLineFor(l)
      if (leadNestedTerm && sourceDescription !== null && lazyState.inDefList === false &&
          pendingBlankRun.count === 0) nestedTermOwnsSeparator = true
      if (lazyState.opaque?.kind === 'comment' &&
          commentFenceRun(l) !== lazyState.opaque.length &&
          commentBlockHasCloser(lexer, lazyState.opaque.length)) {
        (commentPayloadCandidates ??= new Map()).set(nested.length, sliceColumns(l, Math.min(indentColumns(l), contentCol), true))
      }
      takenBelowColumn.add(nested.length)
      nested.push(lazyLine)
      nestedSourceLines.push(l)
      nestedLineNumbers.push(lexer.lineNumber(lexer.pos))
      // The item's own reparse cannot see this from the column alone - the
      // clamp above rewrote it - so record the FACT for the arm below.
      if (indentColumns(l, contentCol) < contentCol || ancestorTermBand) {
        lexer.itemLazyLines.add(lexer.lineNumber(lexer.pos))
      }
      // BELOW THE CONTENT COLUMN, so an invisible line here adds no block: it
      // is the lazy continuation of the paragraph above it, which stays open
      // behind it (corpus 183, 197, 358).
      // A `:` line below the column with no term open is the paragraph's text, not a description.
      const termlessLazyDescription = lazyState.inDefList === false && !lazyState.deepest?.inDefList &&
        indentColumns(l, contentCol) < contentCol && RE_DEFLIST_DEF.test(lazyLine)
      trackItemLazyState(lazyLine, lazyState, false,
        (width) => commentBlockHasCloser(lexer, width))
      if (termlessLazyDescription) lazyState.inDefList = false
      if (commentState) {
        const opaque = lazyState.opaque
        Object.assign(lazyState, commentState, {lazyFoldable: commentState.lazyFoldable && commentState.deepest?.lazyFoldable !== false})
        if (opaque?.kind === 'comment') {
          belowDescendantComment = { run: opaque.length, state: commentState }
          lazyState.opaque = opaque
        }
      }
      if (belowDescendantComment && commentFenceRun(l.trimStart()) === belowDescendantComment.run && !commentState) {
        Object.assign(lazyState, belowDescendantComment.state)
        belowDescendantComment = undefined
      }
      if (lazyState.opaque?.kind !== 'code') authoredFenceBase = 0
      if (lazyState.opaque === null && descendantOpaque === null &&
          RE_FOOTNOTE_DEF.test(l.trimStart()) && indentColumns(l) < contentCol && !enclosingLazy)
        hostedNoteBodyColumn = indentColumns(l) + FOOTNOTE_BODY_COLUMN
      lexer.consume()
    }

    const admitLine = (admission: ContainerAdmission): Decision => {
      const l = admission.line
      const attached = admitAttachedLead(admission)
      if (attached !== undefined) return attached
      // An enclosing item already took this line as lazy text: it reached no column.
      enclosingLazy = lexer.itemLazyLines.has(lexer.lineNumber(lexer.pos))
      const held = admitHeldConstruct(l)
      if (held !== undefined) return held
      readNoteFacts(l)
      if (admission.kind === 'blank') return admitBlank(l)
      const decision = admitContinuationMarker(l) ?? stopsBeforeBody(l) ?? readQuoteFacts(l) ??
        readDefinitionSource(l) ?? readDefinitionBand(l)
      if (decision !== undefined) return decision
      if (lw >= contentCol && !ancestorTermBand &&
        !(enclosingLazy && (lazyState.inDefList === 'term' || lazyState.deepest?.inDefList === 'term')) &&
        !belowOpenDescription && !belowDefinitionEntry && !quoteLazyFramed &&
        // markup-carve/carve#1904's exclusion, unchanged and unconditional: a
        // quote-lazy MARKER line never reaches the content-column arm, not even
        // inside an open fence, where the gate above hands the line back.
        !lexer.quoteLazyMarkerLines.has(lexer.lineNumber(lexer.pos))) {
        admitContentLine(l)
      } else if (continuesLazily(l)) {
        admitLazyLine(l)
      } else if (
        lazyState.opaque?.kind === 'code' &&
        pendingBlankRun.count === 0 &&
        indentColumns(l, contentCol) < contentCol &&
        // A prior nested marker fence grants no claim to a later fence in this item.
        ((descriptionMarkerFence && leadFence === null && descendantOpaque === null) ||
          lexer.itemLazyLines.has(lexer.lineNumber(lexer.pos)) ||
          lexer.quoteLazyLines.has(lexer.lineNumber(lexer.pos)))
      ) {
        // An open fence owns lines an enclosing container already admitted
        // as lazy text (#1630, #2216). Those lines are inside its container
        // even when they reach neither the item column nor the authored fence
        // base. A closing run among them stays payload.
        //
        // The `itemLazyLines` test is the whole rule. Without it this arm would
        // also take a line the AUTHOR wrote below the column, and the outermost
        // spelling of the document - `- ``` x` with a flush-left body, where no
        // container folded anything - must keep ending the item and leaking the
        // body to the document, which is what the executable spec does there
        // and what every engine already agreed on.
        //
        // WHERE THE FENCE OPENED IS NOT PART OF THAT RULE. This also demanded
        // the fence be on the marker line or past the item's column, so a fence
        // opened AT the content column ended the item on the folded line
        // instead: the run leaked out and reached the page as an empty inline
        // verbatim span (markup-carve/carve-js#2243).
        //
        // The leading whitespace goes: it is the enclosing item's one-column
        // clamp, not the author's indentation, and the fence's body is measured
        // from its own column.
        // FRAMED, not merely dedented. The frame's first character is not
        // whitespace and matches no block opener, which is what keeps a closing
        // run among these lines from CLOSING the fence: it is content, and a
        // fence's content is not re-scanned for structure. A dedent alone left
        // the run closing the block it was written inside.
        const framed = l.startsWith(LAZY_FRAME) ? l : LAZY_FRAME + l.replace(/^[ \t]+/, '')
        nested.push(framed)
        nestedSourceLines.push(l)
        nestedLineNumbers.push(lexer.lineNumber(lexer.pos))
        trackItemLazyState(framed, lazyState, false)
        if (lazyState.opaque?.kind !== 'code') authoredFenceBase = 0
        lexer.consume()
      } else {
        return 'stop'
      }
      return 'continue'
    }
    runIndentationContainer(lexer, 'list', itemMarkerColumn, contentCol, itemQuoteDepth, admitLine)

    if (commentPayloadCandidates) frameCommentPayloads(content, nested, terminatorFree, commentPayloadCandidates)
    const trailingDescendantFence = pendingBlankRun.count > 0 && descendantFenceTrails(
      lexer, session, itemStartLineIndex, content, nested, nestedOrigins, continuationFenceBreaks, lineFacts)

    // A block opener may be authored past the canonical item-body column.  The
    // collector above deliberately keeps the whole physical run; rebase each
    // recognized block group now, before tightness and block parsing inspect
    // it.  This is #1705's authored `block_base`: only structural indentation
    // is removed, while indentation beyond the opener's base remains payload.
    const leadIsMarker =
      unorderedMatch(content, terminatorFree) !== null ||
      orderedMatch(content, terminatorFree) !== null ||
      taskMatch(content, terminatorFree) !== null ||
      extractItemAttr(content, terminatorFree) !== null
    // Tightness uses the columns at which the collector admitted the lines.
    // Rebasing a block can move its continuation below a sublist's column.
    let hasBlank = nested.some(isBlankLine)
    const commentFenceOpeners = markerNoteItem ? markerNoteCommentFenceOpeners(nested, noteParagraphMarkers, noteCommentLines) : []
    frameNoteCommentFences(nested, commentFenceOpeners, noteParagraphMarkers)
    // Rebasing can reveal a fence opened past the item's content column.
    // Its payload markers must not split the collected stream (#2212).
    // A task item's marker-line note rebases the lines reaching its body at its own source column.
    const taskNoteShift = isTask && markerNoteItem ? markerNoteFloor - FOOTNOTE_BODY_COLUMN - contentCol : 0
    if (taskNoteShift > 0) {
      rebaseTaskNote(nested, taskNoteShift)
    }
    if (taskLeadShift > 0) dedentTaskLead(nested, taskLeadShift)
    const firstBlockIdx = subListMarkers.values().next().value ?? -1
    // THE BLANK IS STILL REMEMBERED (§17 L1, carve#621). An invisible line does
    // not loosen the item on its own - it is not a second paragraph - but it
    // does not FILL the gap either. So when the item's tail after its last
    // blank is nothing but invisible lines, the item is still "followed by a
    // blank line before the next marker" and L1's other clause applies. Without
    // this, attaching the comment consumed the signal and `- a` / blank /
    // `  %% n` / `- b` came out tight, where the same document without the
    // comment is loose.
    // A marker-line note's body runs like a nested definition's, opened by the
    // lead line; its blanks are the note's. A comment closes the note's
    // paragraph, so the run ends with it.
    // A tail at a sub-item's content column is that sub-item's, and so is the blank before it (§17).
    const tailInDescendant = (blank: number): boolean => {
      const tail = nested[blank + 1]
      if (tail === undefined) return false
      const column = indentColumns(tail)
      for (let k = blank - 1; k >= 0; k--) {
        const ln = nested[k]!
        if (isBlankLine(ln)) continue
        const head = /^[ \t]*(?:[-*]|[0-9A-Za-z]+[.)]|\.) +/.exec(ln)
        if (head && indentColumns(ln) < column) return column >= head[0].length
        if (indentColumns(ln) === 0) return false
      }
      return false
    }
    const endsOnInvisibleTail = (): boolean => {
      let markerNoteRunEnd = -1
      if (markerNoteItem) {
        for (let j = 0; j < nested.length; j++) {
          const next = nested[j]!
          if (isBlankLine(next)) continue
          if (indentColumns(next, FOOTNOTE_BODY_COLUMN) < FOOTNOTE_BODY_COLUMN) break
          markerNoteRunEnd = j
          if (RE_COMMENT_LINE.test(next.trimStart())) break
        }
      }
      // A comment BLOCK renders nothing either, and its payload is not an
      // invisible LINE, so the scan steps over the whole block. Only an item
      // holding a blank can reach the flag, which is what keeps the pass off
      // every other item.
      const hiddenByComment = hasBlank ? commentBlockSpans([content, ...nested]) : []
      for (const boundary of commentBoundaryBlanks) {
        if (hiddenByComment[boundary.openerIndex + 1] === true) continue
        for (const lineNumber of boundary.lines) opaqueBlankLines.add(lineNumber)
      }
      for (let k = nested.length - 1; k >= 0; k--) {
        const ln = nested[k]!
        if (hiddenByComment[k + 1] === true || degradedOpeners.has(k)) continue
        if (isBlankLine(ln)) {
          // A `+`-injected separator is not a blank line the author wrote, and
          // never loosens. Without this the item went loose through the back door:
          // `- a` / `+` / `%% note` / `- b` came out loose where the identical
          // document without the comment is tight.
          return k < nested.length - 1 && !plusSeparators.has(k) && k > markerNoteRunEnd && !tailInDescendant(k)
        }
        if (invisibleNested(k)) continue
        // A wrapped attribute block is one construct, as invisible as its one-line form (carve#3421).
        const opener = wrappedAttributeOpener(k)
        if (opener < 0) break
        k = opener
      }
      return false
    }
    const blankBeforeInvisible = endsOnInvisibleTail()

    // A blank line inside an OPEN verbatim fence is that fence's content, not
    // spacing between blocks. Blanks are buffered in `pendingBlankRun.count` and
    // flushed only when a later line reaches the content column, so a fence
    // running to the end of the item never received them.
    //
    // A descendant's body-line fence keeps its trailing payload blanks.
    // Parent separators do not belong to fences on child marker lines.
    if (pendingBlankRun.count > 0 && (
      lazyState.opaque !== null || (descendantOpaque !== null && !descendantOpaque.markerLine) ||
      trailingDescendantFence
    )) {
      hasBlank = true
      for (let k = 0; k < pendingBlankRun.lines.length; k++) {
        if (pendingNoteComments.has(k)) noteCommentLines.add(nested.length)
        else bufferedBlanks.add(nested.length + 1)
        nestedSourceLines.push(pendingBlankRun.lines[k])
        nested.push(sliceColumns(pendingBlankRun.lines[k] ?? '', contentCol, true))
        nestedLineNumbers.push(pendingBlankRun.lineNumbers[k]!)
      }
      // `pendingBlankRun.count` is NOT cleared. The loose-list test below reads it to
      // decide whether a blank separated this item from its sibling, and a
      // blank is both at once: the fence's content AND the separator that
      // loosens the list. Clearing it made `- a\n  %%% x\n b\n\n- c\n` tight.
    }

    const restoredLines = [content, ...nested]
    const sourceLines = [line, ...nestedSourceLines]
    restoreVerbatimBlanks(restoredLines, sourceLines, bufferedBlanks, (index) =>
      index === 0 ? contentCol : indentColumns(sourceLines[index] ?? ''),
      (index) => lineFacts(restoredLines[index]!, index === 0 ? leadOrigin : nestedOrigins.get(index - 1)),
    )
    for (let index = 0; index < nested.length; index++) nested[index] = restoredLines[index + 1]!

    // Blank line(s) before the next sibling marker make the list loose.
    // The next marker must be a real sibling of THIS list: same kind and
    // (for unordered) same marker character. A blank line before a
    // different marker (`- a\n\n+ b`) separates two distinct lists
    // (§11), so it must not loosen this one.
    const nextIsSibling = (): boolean => {
      const nextLine = lexer.peek()
      if (nextLine === undefined) return false
      const nextStripped = extractItemAttr(nextLine)?.stripped ?? nextLine
      return indentColumns(nextLine, baseIndent + 1) === baseIndent &&
        matchListMarker(nextStripped, isTask, isOrdered) !== null &&
        (isOrdered
          ? orderedContinues(nextStripped, orderedKind, orderedDelim)
          : unorderedMarkerChar(nextStripped) === firstMarkerChar)
    }
    // Blanks before the comment that closes the note are the note's.
    const closingNoteComment = noteCommentLines.size === 0 && pendingNoteComments.size > 0 ? Math.min(...pendingNoteComments) : -1
    const separatingBlanks = closingNoteComment < 0 ? pendingBlankRun.count
      : pendingBlankRun.lines.filter((_, index) => index > closingNoteComment && !pendingNoteComments.has(index)).length
    if ((separatingBlanks > 0 || blankBeforeInvisible) && nextIsSibling()) {
      // A run of THREE OR MORE blank lines is a hard boundary (§11 N1): the
      // sibling marker after it opens a new list instead of joining this
      // one. One or two blank lines remain the ordinary loose separator
      // (§17 L1). `blankBeforeInvisible` is deliberately not counted here -
      // a run broken by a comment is not a run of blank lines.
      if (separatingBlanks >= 3) flags.hardBoundary = true
      else flags.loose = true
    }

    // Child spans identify which authored blank lines separate blocks.
    // Blanks within a fence or nested item remain inside that child's span.

    const leadOpensColonFence = isColonFenceOpener(content)
    // Parse the lead text together with its continuation/nested lines as one
    // block sequence (lazy continuation merges into the lead paragraph). An
    // indented ordered sub-list, however, is parsed as its own block stream so
    // it nests instead of folding into the lead paragraph.
    const itemLead = content
    // A note in the lead stream must see the next opener before the item
    // splits its blocks. That opener may be lazy text below the note column.
    const keepStreamWhole =
      firstBlockIdx === -1 || leadIsMarker || RE_FOOTNOTE_DEF.test(content) || leadOpensColonFence ||
      nested.slice(0, firstBlockIdx).some(line => RE_FOOTNOTE_DEF.test(line.trimStart()))
    const leadLines = keepStreamWhole ? nested : nested.slice(0, firstBlockIdx)
    const blockLines = keepStreamWhole ? [] : nested.slice(firstBlockIdx)
    const mkSub = (
      lines: readonly string[],
      startLineIndex: number,
      sourceLineMap?: number[],
      nestedOffset = -1,
    ): Lexer => {
      const origins = new Map<number, StrippedLineOrigin>()
      if (nestedOffset === -1 && leadOrigin) origins.set(0, leadOrigin)
      for (let i = Math.max(0, -nestedOffset); i < lines.length; i++) {
        const origin = nestedOrigins.get(i + nestedOffset)
        if (origin) origins.set(i, origin)
      }
      const sub = nestedSubLexer(lexer, lines, startLineIndex, sourceLineMap, origins)
      // THIS BODY'S COLUMN 0 IS THE ITEM'S CONTENT COLUMN, so a marker reaching
      // it opens a sublist rather than folding into an open paragraph (§24 C3,
      // markup-carve/carve#1517). Set here rather than in `nestedSubLexer`
      // because it must NOT travel: a quote, a div or a definition body inside
      // the item gets its own lexer without it, and a marker there folds as §10
      // I2 says.
      sub.markerOpensSublist = true
      sub.hostBody = 'list'
      sub.hostQuoteDepth = itemQuoteDepth
      sub.hostMarkerColumn = itemMarkerColumn
      sub.hostContentColumn = itemMarkerColumn + contentCol - baseIndent
      sub.definitionLeadFromItemMarker = nestedOffset === -1 && markerLineTerm
      sub.hostTaskMarker = shape.isTask
      return sub
    }
    const carry: PendingAttrCarry = { attrs: null }
    const captionLines = new Set<number>()
    session.captionLineScopes.push(captionLines)
    let children: BlockNode[] = []
    try {
      children = session.parseBlocks(
        mkSub([itemLead, ...leadLines], itemStartLineIndex, [
          lexer.lineNumber(itemStartLineIndex),
          ...nestedLineNumbers.slice(0, leadLines.length),
        ]),
        0,
        blockLines.length > 0 ? carry : undefined,
      )
      if (blockLines.length > 0) {
        children.push(
          ...session.parseBlocks(
            mkSub(
              blockLines,
              itemStartLineIndex + 1 + firstBlockIdx,
              nestedLineNumbers.slice(firstBlockIdx),
              firstBlockIdx,
            ),
            0,
            { attrs: carry.attrs, last: true },
          ),
        )
      }
    } finally {
      session.captionLineScopes.pop()
    }


    if (authoredDescendantFenceBlanks > 0) restoreDescendantFenceBlanks(lexer, children, authoredDescendantFenceBlanks)
    trimStrayPlusFence(lexer, children, itemStartLineIndex)

    // Authored blanks between the item's children loosen the list.
    const childSpacingLoosens = (): boolean => {
      // A note's body is the note's paragraph, never the item's own (L1).
      let loose = false
      let previousVisibleSpan: { start: number; end: number; startColumn: number } | undefined
      let previousVisibleType: BlockNode['type'] | undefined
      let previousVisibleBlock: BlockNode | undefined
      let nestedListContentColumn: number | undefined
      const nestedIndexByLine = new Map<number, number>()
      for (let index = 0; index < nestedLineNumbers.length; index++) {
        const lineNumber = nestedLineNumbers[index]!
        if (!nestedIndexByLine.has(lineNumber)) nestedIndexByLine.set(lineNumber, index)
      }
      if (blankBeforeNestedContinuation) loose = true
      for (const child of children) {
        if (child.type === 'comment' || child.type === 'abbreviation_def') {
          // A comment below the nested list's column has ended that list.
          const commentSpan = session.blockLineSpan(child)
          const commentLine = commentSpan && (lexer.rootLines ?? lexer.lines)[commentSpan.start - 1]
          if (nestedListContentColumn !== undefined && commentLine !== undefined && commentLine !== '' &&
              sourceColumn(commentLine) < nestedListContentColumn) nestedListContentColumn = undefined
          continue
        }
        const span = session.blockLineSpan(child)
        if (span === undefined) continue
        if (previousVisibleSpan === undefined && child.type === 'paragraph' &&
            /\+[ \t]*$/.test(itemSource) &&
            session.hasAuthoredBlankBetween(lexer, lexer.lineNumber(itemStartLineIndex), span.start, opaqueBlankLines))
          loose = true
        const rootLine = (lexer.rootLines ?? lexer.lines)[span.start - 1]
        const nestedIndex = nestedIndexByLine.get(span.start) ?? -1
        if (child.type === 'list' && rootLine !== undefined) {
          const markerColumn = span.startColumn - 1
          let markerIndex = 0
          let column = 0
          while (markerIndex < rootLine.length && column < markerColumn) {
            const char = rootLine[markerIndex++]!
            column += char === '\t' ? 4 - column % 4 : 1
          }
          const markerText = rootLine.slice(markerIndex)
          let width = markerContentColumn(markerText.slice(0, 8))
          if (width < 0) {
            const attributeEnd = markerText.indexOf('}')
            const boundedEnd = attributeEnd < 0 ? 32 : attributeEnd + 3
            width = markerContentColumn(markerText.slice(0, boundedEnd))
          }
          if (width < 0) width = markerContentColumn(markerText)
          nestedListContentColumn = width < 0 ? undefined : markerColumn + width
        } else if ((child.type === 'block_quote' || child.type === 'admonition') &&
            nestedListContentColumn !== undefined && rootLine !== undefined &&
            sourceColumn(rootLine) < nestedListContentColumn) {
          // A later block below the child's column returns ownership to this
          // item. The following paragraph cannot inherit that child's column.
          nestedListContentColumn = undefined
        }
        // An attribute line below the child's column has ended that list too.
        let attributeLine = span.start - 1
        const rootSource = lexer.rootLines ?? lexer.lines
        while (nestedListContentColumn !== undefined && /^[ \t>]*\{/.test(rootSource[attributeLine - 1] ?? '')) {
          if (sourceColumn(rootSource[attributeLine - 1]!) < nestedListContentColumn) nestedListContentColumn = undefined
          attributeLine--
        }
        const reachesNestedList = nestedListContentColumn !== undefined && rootLine !== undefined &&
          sourceColumn(rootLine) >= nestedListContentColumn
        const belowInlineAdmonition = inlineFenceColumn >= 0 && previousVisibleType === 'admonition' &&
          previousVisibleSpan !== undefined && rootLine !== undefined &&
          sourceColumn(rootLine, itemQuoteDepth) < previousVisibleSpan.startColumn - 1
        const authoredBlockParagraph = child.type === 'paragraph' && nestedIndex >= 0 &&
          authoredBaseEligible.has(nestedIndex) && lineOpensBlock(nested[nestedIndex]!)
        if (previousVisibleSpan === undefined && child.type === 'paragraph' && markerNoteItem) {
          let noteEndLine = lexer.lineNumber(itemStartLineIndex)
          for (let index = nestedLineNumbers.length - 1; index >= 0; index--) {
            const source = nestedSourceLines[index] ?? ''
            if (nestedLineNumbers[index]! >= span.start || isBlankLine(nested[index] ?? '') ||
                isBlankLine(source) || isQuoteBlankLine(source)) continue
            noteEndLine = nestedLineNumbers[index]!
            break
          }
          if (session.hasAuthoredBlankBetween(lexer, noteEndLine, span.start, opaqueBlankLines)) loose = true
        }
        let previousVisibleEnd = previousVisibleSpan?.end
        const priorDivInlineCode = previousVisibleBlock?.type === 'div' &&
          previousVisibleBlock.children.some(block => block.type === 'paragraph' &&
            block.children.some(inline => inline.type === 'code'))
        if (previousVisibleSpan !== undefined && previousVisibleType === 'list') {
          previousVisibleEnd = Math.max(previousVisibleSpan.start, Math.min(previousVisibleSpan.end, span.start - 1))
          const rootLines = lexer.rootLines ?? lexer.lines
          while (previousVisibleEnd > previousVisibleSpan.start &&
              (isBlankLine(rootLines[previousVisibleEnd - 1] ?? '') ||
                isQuoteBlankLine(rootLines[previousVisibleEnd - 1] ?? ''))) {
            previousVisibleEnd--
          }
        }
        if ((child.type === 'paragraph' || child.type === 'image' ||
            child.type === 'figure' && (child.target.type === 'image' || child.target.type === 'paragraph')) &&
            previousVisibleEnd !== undefined && !priorDivInlineCode &&
            !reachesNestedList && !authoredBlockParagraph && !belowInlineAdmonition &&
            (session.hasAuthoredBlankBetween(lexer, previousVisibleEnd, span.start,
              previousVisibleType === 'list' ? undefined : opaqueBlankLines) ||
              previousVisibleType === 'list' &&
                session.hasAuthoredBlankBetween(lexer, span.start - 2, span.start))) loose = true
        previousVisibleSpan = span
        previousVisibleType = child.type
        previousVisibleBlock = child
      }
      return loose
    }
    if (childSpacingLoosens()) flags.loose = true
    // A comment on the marker line holds a block's place: the blank below it sets a paragraph apart (§17 L1, carve-js#4035).
    if (commentHoldsAPlace(content, nested, children)) flags.loose = true

    if (children[0]?.type === 'admonition' && children[0].pos === undefined) {
      children[0] = dropPositions({ type: 'document', children: [children[0]] }).children[0]!
    }

    const item: ListItem = { type: 'list_item', children }
    let itemEnd = lexer.pos
    while (itemEnd > itemStartLineIndex + 1 && isBlankLine(lexer.lineAt(itemEnd - 1)!)) itemEnd--
    // The end-at-the-last-placed-child fixup that used to sit here moved into
    // `attachBlockPos`, which now applies it to every closerless container
    // rather than to items alone (markup-carve/carve#1522).
    attachBlockPos(lexer, item, itemStartLineIndex, itemEnd)
    if (checked !== undefined) item.checked = checked
    if (taskState !== undefined) item.taskState = taskState
    if (itemAttrs) item.attrs = itemAttrs
    return item
  }

  // A description body rebases only its marker line, so a refused `+` follower
  // below the item's source content column is the body's, not the item's (corpus 750).
  // Siblings group by their container and a comment is invisible, so a comment
  // that closed the item above does not end the list (carve#3885).
  function commentsBeforeSibling(lexer: Lexer, session: ParseSession, shape: ListShape, last: ListItem, flags: ListFlags): void {
    const line = lexer.peek()
    if (line === undefined || !RE_COMMENT_LINE.test(line)) return
    // Three consecutive blanks end the list; a comment line breaks the run.
    let run = 0
    for (let k = -1; lexer.pos + k >= 0 && isBlankLine(lexer.peek(k) ?? 'x'); k--) run++
    let blanks = run
    let longest = run
    let k = lexer.pos
    for (let at = lexer.peek(k - lexer.pos); at !== undefined && (isBlankLine(at) || RE_COMMENT_LINE.test(at)); at = lexer.peek(k - lexer.pos)) {
      if (isBlankLine(at)) {
        blanks++
        longest = Math.max(longest, ++run)
        k++
        continue
      }
      run = 0
      const fence = RE_COMMENT_BLOCK.exec(at.trimStart())?.[1]
      let end = k
      if (fence) {
        for (let j = k + 1; lexer.peek(j - lexer.pos) !== undefined; j++) {
          if (RE_COMMENT_BLOCK.exec(lexer.peek(j - lexer.pos)!.trimStart())?.[1] === fence) {
            end = j
            break
          }
        }
      }
      k = end + 1
    }
    if (k >= lexer.lineCount || longest >= 3) return
    const start = lexer.pos
    lexer.pos = k
    const sibling = readItemHead(lexer, shape) !== null
    lexer.pos = start
    if (!sibling) return
    if (blanks > 0) flags.loose = true
    last.children.push(...session.parseInvisibleRun(lexer, k))
  }

  return function parseList(lexer: Lexer, session: ParseSession): List {
    const shape = classifyList(lexer, helpers)
    const { firstLineIndex, baseIndent, isTask, isOrdered, firstMarkerChar, firstOrdered, orderedDelim, orderedKind, orderedStart } = shape
    const items: ListItem[] = []
    const flags: ListFlags = { loose: false, hardBoundary: false }

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
      // At end of input a second bare plus has no block to attach. It is the
      // first marker's paragraph, not a boundary that refuses the first marker.
      if (isContinuationMarker(a) && (lexer.peek(1) === undefined || isBlankLine(lexer.peek(1)))) return false
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
    const firstItemAttachBoundary = (a: string): boolean =>
      isItemAttachBoundary(a) && !(baseIndent > 0 && indentColumns(a) === 0 &&
        !isBlankLine(a) && !isContinuationMarker(a))

    while (!lexer.eof()) {
      if (items.length) commentsBeforeSibling(lexer, session, shape, items.at(-1)!, flags)
      const head = readItemHead(lexer, shape)
      if (!head) break
      const oneLine = oneLineItem(lexer, session, shape, head)
      if (oneLine) {
        items.push(oneLine)
        continue
      }
      const placement = placeItem(lexer, shape, head)
      lexer.consume()

      const wrappedItem = wrappedParagraphItem(lexer, session, shape, head, placement)
      if (wrappedItem) {
        items.push(wrappedItem)
        continue
      }
      const firstBlock = firstBlockItem(lexer, session, shape, head, placement, isItemAttachBoundary, firstItemAttachBoundary, flags)
      if (firstBlock.kind === 'item') {
        items.push(firstBlock.item)
        if (firstBlock.next === 'end') break
        if (firstBlock.next === 'loose') flags.loose = true
        continue
      }
      items.push(collectItem(lexer, session, shape, head, placement, head.content, isItemAttachBoundary, flags))
      if (flags.hardBoundary) break
    }

    return finishList(lexer, items, flags.loose, { firstLineIndex, isOrdered, orderedStart, orderedKind, orderedDelim, firstOrdered, firstMarkerChar }, helpers)
  }

}
