import type { createListStateTracker } from './parse-list-state.js'
import type { createRebasePass } from './parse-rebase.js'
import type { BlockNode, List, ListItem, TaskState } from './ast.js'
import { Lexer, indentColumns, isBlankLine, sliceColumns } from './parse-lexer.js'
import { dropPositions } from './source-positions.js'
import type { ParseSession, listHelpers, BlockQuoteLazyState, DescendantOpaque, ItemLazyState, ItemLineFacts, OlKind, PendingAttrCarry, QuotedFenceCloserMemo, RefusedContinuationMarker, StrippedLineOrigin } from './parse.js'

export function createListParser(helpers: typeof listHelpers, trackItemLazyState: ReturnType<typeof createListStateTracker>, rebaseOverindentedBlocks: ReturnType<typeof createRebasePass>) {
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
  } = helpers
  return function parseList(lexer: Lexer, session: ParseSession): List {
    const first = lexer.peek()!
    const firstLineIndex = lexer.pos
    const baseIndent = indentColumns(first)
    // Classify on the marker after stripping any abutting `{...}` attribute block.
    const firstTerminatorFree = lexer.lineTerminatorFree(lexer.pos)
    const firstAttr = extractItemAttr(first, firstTerminatorFree)
    const firstStripped = firstAttr ? (firstAttr.markerLine ?? firstAttr.stripped) : first
    const isTask = taskMatch(firstStripped, firstTerminatorFree) !== null
    const isOrdered = !isTask && orderedMatch(firstStripped, firstTerminatorFree) !== null
    // A change of unordered marker character (`-` vs `*` vs `+`), or of
    // ordered dialect/delimiter (decimal/alpha/roman, `.` vs `)`), starts a
    // new list (grammar PART 9 §11). The first item fixes the ordered
    // dialect; the second item's marker (if a sibling) tie-breaks an
    // ambiguous single roman letter.
    const firstMarkerChar = isOrdered ? '' : unorderedMarkerChar(firstStripped)
    const firstOrdered = isOrdered ? orderedMatch(firstStripped, firstTerminatorFree)! : null
    const orderedDelim = firstOrdered ? firstOrdered[3]! : ''
    let orderedKind: OlKind = 'dec'
    let orderedStart = 1
    if (firstOrdered) {
      // Tie-break the dialect on the next sibling, looking past blank lines
      // and the first item's own continuation/nested lines (indented deeper
      // than the marker) — `x.` / blank or indented body / `xi.` is still one
      // roman list.
      let k = 1
      let blankRun = 0
      let hardBoundary = false
      for (; lexer.peek(k) !== undefined; k++) {
        const ln = lexer.peek(k)!
        if (isBlankLine(ln)) {
          blankRun++
          continue
        }
        if (indentColumns(ln, baseIndent + 1) <= baseIndent) {
          hardBoundary = blankRun >= 3
          break
        }
        blankRun = 0
      }
      const nextLine = hardBoundary ? undefined : lexer.peek(k)
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
    const firstItemAttachBoundary = (a: string): boolean =>
      isItemAttachBoundary(a) && !(baseIndent > 0 && indentColumns(a) === 0 &&
        !isBlankLine(a) && !isContinuationMarker(a))

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
      const terminatorFree = lexer.lineTerminatorFree(lexer.pos)
      const la = extractItemAttr(line, terminatorFree)
      const mline = la ? (la.markerLine ?? la.stripped) : line
      const m = matchListMarker(mline, isTask, isOrdered, terminatorFree)
      if (!m) break
      // §11: a sibling with a different marker character (unordered) or a
      // different delimiter (ordered) is a new list.
      if (!isOrdered && unorderedMarkerChar(mline) !== firstMarkerChar) break
      if (isOrdered && !orderedContinues(mline, orderedKind, orderedDelim, terminatorFree)) break

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
      if (la?.contentOffset !== undefined && la.headWidth !== undefined) {
        content = line.slice(la.contentOffset + mline.length - markerContentLength - la.headWidth)
      }
      const leadOrigin = terminatorFree ? { text: content, parentIndex: itemStartLineIndex, prefix: line.length - content.length } : undefined
      const itemAttrs = la ? la.attrs : undefined

      // A plain lead followed immediately by a compatible sibling has no
      // continuation lines to collect. Parse its one-line body as an ordinary
      // nested block stream, while the next loop iteration owns the sibling.
      const nextLine = lexer.peek(1)
      if ((!session.recordPositions || leadOrigin !== undefined) && session.activeMatchers.length === 0 && !la &&
          content.length > 0 && !RE_FIRST_BLOCK_MARKER.test(content) &&
          nextLine !== undefined && indentColumns(nextLine, baseIndent + 1) === baseIndent &&
          matchListMarker(nextLine, isTask, isOrdered) !== null &&
          (isOrdered ? orderedContinues(nextLine, orderedKind, orderedDelim) : unorderedMarkerChar(nextLine) === firstMarkerChar)) {
        lexer.consume()
        const origins = session.recordPositions && leadOrigin
          ? new Map<number, StrippedLineOrigin>([[0, leadOrigin]]) : undefined
        const sub = nestedSubLexer(lexer, [content], itemStartLineIndex, [lexer.lineNumber(itemStartLineIndex)], origins)
        if (session.recordPositions) {
          sub.markerOpensSublist = true
          sub.hostBody = 'list'
          sub.hostMarkerColumn = sourceColumn((lexer.rootLines ?? lexer.lines)[lexer.lineNumber(itemStartLineIndex) - 1] ?? line)
        }
        const item: ListItem = { type: 'list_item', children: session.parseBlocks(sub, 0) }
        if (session.recordPositions) attachBlockPos(lexer, item, itemStartLineIndex, lexer.pos)
        if (checked !== undefined) item.checked = checked
        if (taskState !== undefined) item.taskState = taskState
        items.push(item)
        continue
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
      const contentCol = isTask
        ? baseIndent + 2
        : baseIndent + (mline.length - leadingWhitespace(mline) - markerContentLength)
      const itemSource = (lexer.rootLines ?? lexer.lines)[lexer.lineNumber(itemStartLineIndex) - 1] ?? line
      const itemMarkerColumn = sourceColumn(itemSource)
      const physicalItemMarkerColumn = Math.max(itemMarkerColumn, lexer.lineStartColumn(itemStartLineIndex) - 1 + baseIndent)
      const itemQuoteDepth = quotePrefixDepth(itemSource)
      lexer.consume()

      const firstBlockMarker = RE_FIRST_BLOCK_MARKER.test(content)
      const firstBlockSource = (lexer.rootLines ?? lexer.lines)[lexer.lineNumber(lexer.pos) - 1]
      const firstBlockColumn = firstBlockSource === undefined ? Infinity : sourceColumn(firstBlockSource, itemQuoteDepth)
      const firstBlockEligible = lexer.peek() !== undefined && firstBlockSource !== undefined && !isBlankLine(firstBlockSource) &&
        (firstBlockColumn === itemMarkerColumn || firstBlockColumn === quoteBodyColumn(itemSource, itemQuoteDepth)) &&
        !isListMarkerLine((lexer.peek() ?? '').trimStart())
      if (firstBlockEligible && (/^(?:(?:[-*] (?:\[[ xX]\] )?|(?:[0-9]+|[ivxlcdm]+|[IVXLCDM]+|[a-z]|[A-Z])[.)] ))+\+[ \t]*$/.test(content) ||
          isStackedFirstBlockQuoteMarker(itemSource)) &&
          !firstItemAttachBoundary(lexer.peek()!)) {
        const attached = session.collectAttachedListBlock(lexer, isItemAttachBoundary, baseIndent, false, firstBlockColumn, itemQuoteDepth)
        const lines = [content, ...attached.lines]
        const numbers = [lexer.lineNumber(itemStartLineIndex), ...attached.lineNumbers]
        const sub = nestedSubLexer(lexer, lines, itemStartLineIndex, numbers)
        const stackedItem: ListItem = { type: 'list_item', children: session.parseBlocks(sub, 0) }
        attachBlockPos(lexer, stackedItem, itemStartLineIndex, lexer.pos)
        if (checked !== undefined) stackedItem.checked = checked
        if (taskState !== undefined) stackedItem.taskState = taskState
        if (itemAttrs) stackedItem.attrs = itemAttrs
        items.push(stackedItem)
        let blanks = 0
        while (isBlankLine(lexer.peek(blanks))) blanks++
        const sibling = lexer.peek(blanks)
        if (blanks > 0 && sibling !== undefined && indentColumns(sibling, baseIndent + 1) === baseIndent &&
            matchListMarker(sibling, isTask, isOrdered) !== null &&
            (isOrdered ? orderedContinues(sibling, orderedKind, orderedDelim) : unorderedMarkerChar(sibling) === firstMarkerChar)) {
          for (let k = 0; k < blanks; k++) lexer.consume()
          if (blanks >= 3) break
          loose = true
        }
        continue
      }
      if (firstBlockMarker &&
        (!firstBlockEligible || firstItemAttachBoundary(lexer.peek()!))) {
        const reason: RefusedContinuationMarker['reason'] = firstBlockSource === undefined ? 'document'
          : isBlankLine(firstBlockSource) ? 'blank'
            : isListMarkerLine((lexer.peek() ?? '').trimStart()) ? 'sibling'
              : firstBlockColumn > itemMarkerColumn ? 'right' : 'left'
        lexer.reportRefusedContinuationMarker(itemStartLineIndex,
          lexer.lineStartColumn(itemStartLineIndex) + line.indexOf('+'), 'list item', reason, true)
        content = ''
      } else if (firstBlockMarker) {
        lexer.reportRefusedContinuationMarker(itemStartLineIndex,
          lexer.lineStartColumn(itemStartLineIndex) + line.indexOf('+'), 'list item', undefined, true)
        // The attached block is a block: a boundary line inside a fence it opened
        // is that fence's body, not a boundary (see the indented loop's note on
        // carve#975 and corpus category 279). Without this the opener came out an
        // EMPTY code block and the closer an inline code span, which is the same
        // damage category 278 pins one level in.
        const {
          lines: attached,
          lineNumbers: attachedLineNumbers,
          startLineIndex: attachedStartLineIndex,
        } = session.collectAttachedListBlock(lexer, isItemAttachBoundary, baseIndent, false, firstBlockColumn, itemQuoteDepth)
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
          lexer.reportRefusedContinuationMarker(plusLineIndex, baseIndent + 1, 'list item')
          const more = session.collectAttachedListBlock(lexer, isItemAttachBoundary, baseIndent, false)
          // An empty result is the column gate's refusal as well as an exhausted
          // boundary set, and a second marker that attaches nothing ends the run
          // either way (markup-carve/carve#1814).
          if (more.lines.length === 0) break
          attached.push('')
          attachedLineNumbers.push(lexer.lineNumber(plusLineIndex))
          attached.push(...more.lines)
          attachedLineNumbers.push(...more.lineNumbers)
        }
        const sub = nestedSubLexer(lexer, attached, attachedStartLineIndex, attachedLineNumbers)
        const fbChildren = session.parseBlocks(sub, 0)
        const fbItem: ListItem = { type: 'list_item', children: fbChildren }
        attachBlockPos(lexer, fbItem, itemStartLineIndex, lexer.pos)
        if (checked !== undefined) fbItem.checked = checked
        if (taskState !== undefined) fbItem.taskState = taskState
        if (itemAttrs) fbItem.attrs = itemAttrs
        items.push(fbItem)
        continue
      }

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
      // rather than a rendering rule, so the two looseness scans below must read
      // the line the way they read `%% x` (carve-js#2337).
      //
      // The tracker's answer is the one to record, not a scan of this item's own
      // lines: an opener whose closer fell OUTSIDE the item opened a real span,
      // whose payload was then republished, and a block is not the line form.
      const degradedOpeners = new Set<number>()
      let hasOverindentedBlockCandidate = false
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
      let descendantFenceMemos: Map<number, QuotedFenceCloserMemo> | undefined
      let nestedOwnerColumn = markerContentColumn(content, terminatorFree)
      let nestedOwnerIsList = false
      let quotedFootnoteColumn: number | undefined
      let quotedFootnoteOffset = 0
      let closedListFence = false
      const markerLineTerm = RE_DEFLIST_TERM.test(content)
      let singleMarkerTerm = markerLineTerm
      let markerDescriptionColumn: number | undefined
      let markerDescriptionCodeBase: number | undefined
      let markerDescriptionInlineFence = false
      let markerDescriptionCodeTracked = false
      let markerDescriptionCodeClosedAtFloor = false
      let markerDescriptionFenceMemos: Map<number, QuotedFenceCloserMemo> | undefined
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
            const closedFence = !markerNoteItem && nestedOwnerIsList && fence !== null && itemFenceHasCloser(
              lexer, RE_FENCE.test(opener) ? fence[2]! : fence[1]!, entry.index,
              contentCol + column, new Map(), itemEndsAt,
            )
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
        lineIndex: number,
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
        const key = `${lexer.lineNumber(lineIndex)}:${marker}`
        // A CONTAINER ABOVE MAY HAVE ANSWERED ALREADY, over lines this item never
        // received. Re-deriving it here asks a narrower question, so three levels
        // lost what two kept.
        const inherited = lexer.descendantFenceAnswers.get(key)
        const sourceBase = contentCol + base
        descendantFenceMemos ??= new Map()
        let memo = descendantFenceMemos.get(sourceBase)
        if (memo === undefined) {
          memo = new Map()
          descendantFenceMemos.set(sourceBase, memo)
        }
        const closerAhead = inherited ?? itemFenceHasCloser(
          lexer,
          marker,
          lineIndex,
          sourceBase,
          memo,
          // BOUNDED BY THE FENCE'S OWN CONTAINER, not by this item. A marker above
          // the fence's column opens a SIBLING of the item holding it, and a
          // closer written inside that sibling closes nothing here.
          (candidate, afterBlank) =>
            (isListMarkerLine(candidate) && indentColumns(candidate) < sourceBase) ||
            (afterBlank && !isBlankLine(candidate) && indentColumns(candidate, sourceBase) < sourceBase),
        )
        // HAND THE CLOSER ANSWER DOWN, and only a YES. The item may end at a run
        // this fence's own parse will never see, so the descendant cannot answer
        // §10's lookahead for itself (markup-carve/carve#1399 one level in). A yes
        // names a closer at the fence's own base inside the fence's container, so
        // it holds however deep that container is. A NO does not: CARVE-P0-004 also
        // lets the closer stand at the container's content column, and the item
        // cannot see how many levels lie between its child and the fence, so a no
        // here would refuse a closer the descendant can see for itself.
        if (closerAhead) lexer.descendantFenceAnswers.set(key, true)
        // A marker-line fence opens a block even without a closer.
        // In an open body paragraph, an unclosed fence stays inline (§10).
        if (opener !== line.trimStart() || followsBlank || !lazyState.lazyFoldable || closerAhead) {
          const laterNoteFence = noteBodyHeldCode && nestedNoteBodyColumn !== undefined && sourceBase === nestedNoteBodyColumn
          descendantNoteBody = laterNoteFence || (nestedNoteBodyColumn !== undefined && sourceBase === nestedNoteBodyColumn &&
            lazyState.lazyFoldable && !followsBlank && !lazyState.ownedAuthored && lazyState.ownedColumn > base)
          openedLaterNoteFence = laterNoteFence
          if (descendantNoteBody) noteBodyHeldCode = true
          descendantNoteParagraphBefore = lazyState.lazyFoldable
          descendantOpaque = { close: fenceCloseRe(marker), base, markerLine: opener !== line.trimStart() }
        }
      }
      // Candidate sublist markers, resolved after authored fence bases are applied.
      const subListMarkers = new Set<number>()
      let belowDescendantComment: { run: number; state: ItemLazyState } | undefined
      let pendingBlanks = 0
      let pendingBlankLineNumbers: number[] = []
      let pendingBlankTexts: string[] = []
      // A comment in a marker-line note changes nothing (CARVE-P9-053, carve#3060):
      // it waits among the pending blanks without counting as one, and the note
      // scans skip it once it is in `nested`.
      let pendingNoteComments = new Set<number>()
      const noteCommentLines = new Set<number>()
      // Indices in `nested` that hold a `+`-injected blank separator. These keep
      // the attached block parsing standalone but never loosen the list (Bug B).
      const plusSeparators = new Set<number>()
      const continuationFenceBreaks = new Set<number>()
      let authoredDescendantFenceBlanks = 0
      const descendantFenceBlankLines = new Set<number>()
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
        ownedColumn: noFollower || RE_BLOCKQUOTE.test(content)
          ? -1
          : walkContainerPrefix(content, session.markerPrefixMemo(lexer, itemStartLineIndex)) || -1,
        ownedAuthored: false,
      }
      // X2: track an authored quote's paragraph without changing the item's block state.
      let authoredQuoteClaim: BlockQuoteLazyState | null = null
      let authoredQuoteParagraphOpen = false
      let authoredQuoteHostColumn = contentCol
      let captionParagraphClaim = false
      // A FENCE OPENED ON THE MARKER LINE IS AN OPEN FENCE (markup-carve/carve#950).
      // The lead line never went through `trackItemLazyState`, so `- ``` ` left
      // the tracker believing the item held an open paragraph, and every line
      // below the content column folded into the code text - body and closer
      // both. Nothing precedes the lead, so no closer lookahead applies: the
      // fence opens unconditionally, exactly as it does at the top of a quote.
      let itemFenceMemos: Map<number, QuotedFenceCloserMemo> | undefined
      const itemQuoteFenceMemos = new Map<string, QuotedFenceCloserMemo>()
      // A sibling or outer marker ends the item, and so does a line below the
      // column after a blank (carve#1379).
      const itemEndsAt = (line: string, afterBlank: boolean): boolean =>
        (isListMarkerLine(line) && indentColumns(line) <= baseIndent) ||
        (afterBlank && !isBlankLine(line) && indentColumns(line, contentCol) < contentCol)
      const descendantLead = content.includes("`") || content.includes('~') || content.includes(':')
        ? markerLineBottomBlock(content, session.markerPrefixMemo(lexer, itemStartLineIndex)) : content
      if (descendantLead !== content && colonFenceOpenerLen(descendantLead) !== null) lazyState.lazyFoldable = false
      const descendantLeadFence = descendantLead !== content
        ? RE_FENCE.exec(descendantLead) ?? RE_RAW_FENCE.exec(descendantLead) : null
      if (descendantLeadFence) {
        lazyState.lazyFoldable = false
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
      const markerNoteFloor = contentCol + FOOTNOTE_BODY_COLUMN
      const noteParagraphMarkers = new Set<number>()
      const markerNoteFenceMemos = new Map<number, QuotedFenceCloserMemo>()
      const itemParagraphFences = new Set<number>()
      let markerNoteParagraph = markerNoteItem && !lineOpensItemBlock(RE_FOOTNOTE_DEF.exec(content)![2]!) &&
        !RE_COMMENT_LINE.test(RE_FOOTNOTE_DEF.exec(content)![2]!)
      let markerNoteClaimChecked = false
      let markerNoteLeft = false
      let noteBodyLast = false
      let markerNoteItemParagraphOpen = false
      let noteInlineFenceOpen = false
      let nestedNoteParagraph = false
      let nestedNoteContainer = false
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
      while (!lexer.eof()) {
        const l = lexer.peek()!
        const currentSource = (lexer.rootLines ?? lexer.lines)[lexer.lineNumber(lexer.pos) - 1]
        const afterCurrent = (lexer.rootLines ?? lexer.lines)[lexer.lineNumber(lexer.pos)]
        if (currentSource !== undefined && endsInPlus(currentSource) &&
            quotePrefixDepth(currentSource) > 0 && quotePrefixDepth(currentSource) < itemQuoteDepth &&
            afterCurrent !== undefined && quotePrefixDepth(afterCurrent) === quotePrefixDepth(currentSource) &&
            markerDecision(lexer, lexer.pos).reason === undefined &&
            (isPhysicalContinuationMarker(currentSource) || isContinuationMarker(currentSource.trimStart()))) break
        const precedingLine = nestedLineNumbers.at(-1)
        const precedingSource = precedingLine === undefined ? undefined :
          (lexer.rootLines ?? lexer.lines)[precedingLine - 1] ?? nestedSourceLines.at(-1)
        let precedingBody = precedingSource ?? ''
        for (let depth = 0; depth < itemQuoteDepth; depth++) precedingBody = quotedLineText(precedingBody, false) ?? ''
        const precedingMarker = precedingSource === undefined ? null :
          taskMatch(precedingBody.trimStart()) ?? unorderedMatch(precedingBody.trimStart()) ?? orderedMatch(precedingBody.trimStart())
        const precedingContent = precedingMarker?.at(-1)
        const physicalFollower = (lexer.rootLines ?? lexer.lines)[lexer.lineNumber(lexer.pos) - 1]
        if (pendingBlanks === 0 && precedingSource !== undefined && precedingContent !== undefined &&
            firstBlockOpenerContent(precedingContent) && physicalFollower !== undefined &&
            sourceColumn(precedingSource) > itemMarkerColumn &&
            sourceColumn(physicalFollower, itemQuoteDepth) > itemMarkerColumn &&
            sourceColumn(physicalFollower, itemQuoteDepth) < itemMarkerColumn + contentCol - baseIndent) break
        if (pendingBlanks === 0 && precedingSource !== undefined && precedingContent !== undefined &&
            firstBlockOpenerContent(precedingContent) && sourceColumn(precedingSource) > itemMarkerColumn &&
            physicalFollower !== undefined && sourceColumn(physicalFollower, itemQuoteDepth) ===
              quoteBodyColumn(precedingSource, itemQuoteDepth) &&
            !isListMarkerLine(l.trimStart()) && !isBlankLine(l)) {
          const pulled = session.collectAttachedListBlock(lexer, isItemAttachBoundary, 0, false,
            quoteBodyColumn(precedingSource, itemQuoteDepth), itemQuoteDepth)
          nested.push(...pulled.lines)
          nestedSourceLines.push(...pulled.lines)
          nestedLineNumbers.push(...pulled.lineNumbers)
          continue
        }
        // An enclosing item already took this line as lazy text: it reached no column.
        const enclosingLazy = lexer.itemLazyLines.has(lexer.lineNumber(lexer.pos))
        // Below the column, under a held description or term, a matched fence
        // answers as its `%%` twin (CARVE-P9-053), so it takes the twin's path.
        if (lazyState.inDefList && pendingBlanks === 0 && lazyState.opaque === null && !isBlankLine(l) &&
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
            trackItemLazyState('%%', lazyState, () => true, false)
            if (lazyState.inDefList === 'description') retainCommentBoundary(lazyState)
            continue
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
          trackItemLazyState(closer, lazyState, () => true)
          retainedFenceOpen = false
          lexer.consume()
          continue
        }
        if (lazyState.opaque === null) retainedFenceOpen = false
        if (hostedNoteBodyColumn !== undefined && lexer.hostBody !== null &&
            !isBlankLine(l) && indentColumns(l, hostedNoteBodyColumn) < hostedNoteBodyColumn) break
        const noteCommentEnd = markerNoteItem && !markerNoteLeft ? coveredNoteComment(lexer, l, markerNoteFloor) : -1
        if (noteCommentEnd >= 0 && lazyState.opaque === null && !insideOpenFence(lazyState)) {
          for (let at = lexer.pos; at <= noteCommentEnd; at++) {
            pendingNoteComments.add(pendingBlankTexts.length)
            pendingBlankLineNumbers.push(lexer.lineNumber(lexer.pos))
            pendingBlankTexts.push(lexer.peek()!)
            lexer.consume()
          }
          // It still closes the note's paragraph, as it does in the note's own parse.
          markerNoteParagraph = false
          continue
        }
        if (markerNoteItem && !isBlankLine(l) && indentColumns(l, markerNoteFloor) < markerNoteFloor) markerNoteLeft = true
        // Keep the observed note-body paragraph permission separate from an
        // item tail after its CODE closer. The next body line consumes it.
        if (consumedNoteCloserBodyColumn !== undefined) {
          if (!isBlankLine(l) && indentColumns(l, consumedNoteCloserBodyColumn) >= consumedNoteCloserBodyColumn) lazyState.lazyFoldable = consumedNoteParagraphBefore
          consumedNoteCloserBodyColumn = undefined
        }
        const noteReach = markerNoteItem && !isBlankLine(l) && indentColumns(l, contentCol) < contentCol
          ? markerNoteFenceReach(nested, noteParagraphMarkers, noteCommentLines) : null
        let lastNoteLine = ''
        for (let index = nested.length - 1; index >= 0; index--) {
          if (!isBlankLine(nested[index]!) && !noteCommentLines.has(index)) { lastNoteLine = nested[index]!.trimStart(); break }
        }
        const afterNoteBody = noteBodyLast || noteReach === 'unclosed' ||
          (markerNoteItem && !isBlankLine(l) && indentColumns(l, contentCol) < contentCol &&
            markerNoteOpenerReach(nested, noteParagraphMarkers, noteCommentLines) === 'open') ||
          (noteReach === 'closed' && lastNoteLine !== '' && !opensCodeFence(lastNoteLine) &&
            !RE_COMMENT_LINE.test(lastNoteLine))
        const fenceBoundaryTail = noteReach === 'boundary'
        const commentFenceTail = markerNoteItem && !isBlankLine(l) && indentColumns(l, contentCol) < contentCol &&
          markerNoteCommentFenceOpeners(nested, noteParagraphMarkers, noteCommentLines, true).length > 0
        const noteParagraphOpen = markerNoteParagraph
        if (!isBlankLine(l)) {
          noteBodyLast = false
          markerNoteParagraph = false
        }
        if (nestedNoteBodyColumn !== undefined && !isBlankLine(l) && indentColumns(l, nestedNoteBodyColumn) < nestedNoteBodyColumn) {
          nestedNoteBodyColumn = undefined
          nestedNoteContainer = false
          noteBodyHeldCode = false
        }
        const leftBlockedNote = blockedNoteClaimFloor !== undefined && !isBlankLine(l) && indentColumns(l, blockedNoteClaimFloor) < blockedNoteClaimFloor
        if (leftBlockedNote)
          blockedNoteClaimFloor = undefined
        if (markerDescriptionColumn !== undefined &&
            (lexer.quoteLazyLines.has(lexer.lineNumber(lexer.pos)) ||
              (!isBlankLine(l) && indentColumns(l, contentCol) < contentCol))) markerDescriptionColumn = undefined
        const resumesMarkerDescriptionParagraph = markerDescriptionCodeClosedAtFloor && pendingBlanks === 0 &&
          opensCodeFence(l.trimStart()) && indentColumns(l) > contentCol + markerDescriptionCodeBase!
        if (resumesMarkerDescriptionParagraph) lazyState.lazyFoldable = true
        if (markerDescriptionCodeClosedAtFloor && !isBlankLine(l)) markerDescriptionCodeClosedAtFloor = false
        if (isBlankLine(l)) {
          markerNoteItemParagraphOpen = false
          let afterBlanks = 1
          while (true) {
            const next = lexer.peek(afterBlanks)
            if (next === undefined) break
            if (isBlankLine(next) || refusedPlus(afterBlanks)) { afterBlanks++; continue }
            break
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
            continue
          }
          pendingBlanks++
          pendingBlankLineNumbers.push(lexer.lineNumber(lexer.pos))
          pendingBlankTexts.push(l)
          lexer.consume()
          continue
        }
        if (markerNoteBodyPending) {
          markerNoteBodyPending = false
          const continuation = sliceColumns(l, contentCol, true)
          markerNoteFirstText = indentColumns(l, contentCol + FOOTNOTE_BODY_COLUMN) >= contentCol + FOOTNOTE_BODY_COLUMN &&
            (isListMarkerLine(continuation) || !lineOpensItemBlock(continuation.trimStart()))
        }
        // List-continuation marker (Carve): a lone `+` at the marker column
        // attaches the FOLLOWING flush-left block to this item without indenting
        // it. A bare `+` is never a bullet (a bullet needs `+ ` + content). It
        // injects a blank separator so the block parses on its own; the
        // compact-list rule above then keeps the item tight.
        const markerSource = (lexer.rootLines ?? lexer.lines)[lexer.lineNumber(lexer.pos) - 1] ?? l
        const classifiedMarker = isContinuationMarker(l.slice(leadingWhitespace(l))) ? markerDecision(lexer, lexer.pos) : undefined
        // A quote prefix may omit its optional space; compare the marker at
        // the open item's quote-body column in either spelling.
        const plusColumn = itemQuoteDepth > 0 && sourceQuoteLocalColumn(markerSource, itemQuoteDepth) === 0
          ? Math.max(sourceColumn(markerSource), physicalItemMarkerColumn)
          : sourceColumn(markerSource)
        const classifiedListOwner = classifiedMarker?.owner?.kind === 'list' &&
          classifiedMarker.owner.column === plusColumn && classifiedMarker.reason === undefined
        const listPlusOwner = isContinuationMarker(l.slice(leadingWhitespace(l))) &&
          isContinuationMarker(sourceQuoteBody(markerSource)) &&
          (baseIndent === 0 && !quoteIndentHasTab(markerSource, itemQuoteDepth) || classifiedListOwner) &&
          quotePrefixDepth(markerSource) === itemQuoteDepth &&
          (plusColumn === physicalItemMarkerColumn || plusColumn === contentCol && classifiedListOwner &&
            RE_FOOTNOTE_DEF.test((nestedSourceLines.at(-1) ?? '').trimStart()) ||
            plusColumn === contentCol + 1 && classifiedListOwner &&
              RE_DEFLIST_DEF.test((nestedSourceLines.at(-1) ?? '').trimStart()))
        const candidate = listPlusOwner ? (lexer.rootLines ?? lexer.lines)[lexer.lineNumber(lexer.pos)] : undefined
        let follower = candidate ?? ''
        for (let depth = 0; depth < itemQuoteDepth; depth++) follower = quotedLineText(follower, false) ?? follower
        const followerColumn = candidate === undefined ? Infinity : sourceColumn(candidate, itemQuoteDepth)
        const listPlusReason: RefusedContinuationMarker['reason'] | null = !listPlusOwner ? null
          : candidate === undefined ? 'document'
            : isBlankLine(follower) ? 'blank'
              : followerColumn < plusColumn ? 'left'
                : followerColumn > plusColumn || itemQuoteDepth > 0 && quotePrefixDepth(candidate) > itemQuoteDepth &&
                  plusColumn === quoteBodyColumn(markerSource, itemQuoteDepth) ? 'right'
                  : classifiedMarker?.reason === 'sibling' || isListMarkerLine(follower.trimStart()) ? 'sibling' : null
        if (listPlusReason === 'blank' && acceptedPlusLine === lexer.lineNumber(lexer.pos) - 1 &&
            lazyState.opaque?.kind === 'code') {
          // The first + ended the fence but attached no block. Keep this
          // refused second + as authored text in the item.
          lexer.reportRefusedContinuationMarker(lexer.pos, baseIndent + 1, 'list item', 'blank')
          nested.push(l)
          nestedSourceLines.push(markerSource)
          nestedLineNumbers.push(lexer.lineNumber(lexer.pos))
          lexer.consume()
          continue
        }
        if (listPlusReason !== null) lexer.reportRefusedContinuationMarker(lexer.pos, baseIndent + 1, 'list item', listPlusReason)
        if (listPlusReason === 'sibling' &&
            (pendingBlanks > 0 || !lazyState.lazyFoldable || lazyState.opaque?.kind === 'code' || descendantOpaque !== null)) break
        if (listPlusOwner && listPlusReason === null) {
          const rootLines = lexer.rootLines ?? lexer.lines
          const rootFollower = rootLines[lexer.lineNumber(lexer.pos)]
          continuationFenceBreaks.add(nested.length)
          if (descendantOpaque !== null || lazyState.opaque?.kind === 'code' ||
              lazyState.deepest?.opaque?.kind === 'code') {
            authoredDescendantFenceBlanks = pendingBlanks
            for (const lineNumber of pendingBlankLineNumbers) descendantFenceBlankLines.add(lineNumber)
          }
          const plusLineNumber = lexer.lineNumber(lexer.pos)
          const plusLineIndex = lexer.pos
          const plusEnd = (lexer.lineAt(plusLineIndex) ?? '').length
          lexer.consume()
          lexer.reportRefusedContinuationMarker(plusLineIndex, baseIndent + 1, 'list item')
          acceptedPlusLine = plusLineNumber
          const detachedFollower = lazyState.opaque?.kind === 'code' &&
            lexer.peek() === undefined && rootFollower !== undefined &&
            !isBlankLine(rootFollower) && indentColumns(rootFollower) === 0 &&
            !lineOpensItemBlock(rootFollower)
          // An accepted marker leaves its buffered blanks in the open fence.
          if (pendingBlanks > 0 && ((lexer.peek() !== undefined && !isBlankLine(lexer.peek()!)) || detachedFollower) &&
              (lazyState.opaque !== null ||
                descendantOpaque !== null)) {
            for (let k = 0; k < pendingBlankTexts.length; k++) {
              if (pendingNoteComments.has(k)) noteCommentLines.add(nested.length)
              else bufferedBlanks.add(nested.length + 1)
              nestedSourceLines.push(pendingBlankTexts[k])
              nested.push(sliceColumns(pendingBlankTexts[k] ?? '', contentCol, true))
              nestedLineNumbers.push(pendingBlankLineNumbers[k]!)
              trackItemLazyState('', lazyState)
            }
          }
          pendingBlanks = 0
          pendingBlankLineNumbers = []
          pendingBlankTexts = []
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
              attachesAtDocumentColumnZero(lexer) &&
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
          if (detachedFollower && attachesAtDocumentColumnZero(lexer, plusColumn, itemQuoteDepth)) {
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
            continue
          }
          if (!attachesAtDocumentColumnZero(lexer, plusColumn, itemQuoteDepth) || lexer.peek() === undefined || isBlankLine(lexer.peek()!)) continue
          lexer.attachmentBoundaries.add(plusLineNumber)
          plusSeparators.add(nested.length)
          nestedOrigins.set(nested.length, { text: '', parentIndex: plusLineIndex, prefix: plusEnd, virtual: true })
          nested.push('')
          nestedSourceLines.push(undefined)
          nestedLineNumbers.push(plusLineNumber)
          trackItemLazyState('', lazyState)
          // A boundary line inside a fence THIS attached block opened is that
          // fence's body, exactly as it is in the indented body (carve#975 for
          // the marker, corpus category 279 for the blank, the dedent and the
          // three fence kinds together). The old loop consulted the tracker for
          // two of the kinds and for no boundary but the marker, so a blank
          // severed a code fence from its opener and a colon fence severed on
          // every boundary there is.
          const { lines: attachedLines, lineNumbers: attachedLineNumbers } = session.collectAttachedListBlock(lexer, isItemAttachBoundary, baseIndent, true, plusColumn, itemQuoteDepth)
          if (descendantOpaque === null && !nested.some(line => isListMarkerLine(line.trimStart())) &&
              attachedLines[0] !== undefined &&
              (RE_FENCE.test(attachedLines[0]) || RE_RAW_FENCE.test(attachedLines[0]))) {
            authoredDescendantFenceBlanks = 0
          }
          for (let k = 0; k < attachedLines.length; k++) {
            const attachedLine = plusColumn > contentCol
              ? sliceColumns(attachedLines[k]!, plusColumn, true) : attachedLines[k]!
            nested.push(attachedLine)
            nestedSourceLines.push(attachedLines[k])
            nestedLineNumbers.push(attachedLineNumbers[k]!)
            // The attached block's lines are the item's, so the item's own
            // tracker sees them: what they leave open decides how a later
            // dedented line folds.
            trackItemLazyState(attachedLine, lazyState)
            if (lazyState.opaque?.kind !== 'code') authoredFenceBase = 0
          }
          if (
            lazyState.opaque === null && lexer.peek() !== undefined &&
            !isBlankLine(lexer.peek()!) && !isItemAttachBoundary(lexer.peek()!)
          ) {
            plusSeparators.add(nested.length)
            nested.push('')
            nestedSourceLines.push(undefined)
            nestedLineNumbers.push(attachedLineNumbers.at(-1) ?? plusLineNumber)
            trackItemLazyState('', lazyState)
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
        // An ancestor's folded text needs an open paragraph in this item.
        // A comment can retain the ancestor's frame after closing this leaf.
        if (l.startsWith(LAZY_FRAME) && !lazyState.lazyFoldable && !lazyState.retainedMarker && !insideOpenFence(lazyState)) break
        const lw = indentColumns(l, contentCol)
        // The note may have ended while this item's paragraph still owns a
        // follower. Check the authored columns: rebasing the note can make the
        // same line appear to reach its body in this local frame.
        const lastItemSource = (lexer.rootLines ?? lexer.lines)[lexer.lineNumber(lexer.pos) - 2]
        const parentNoteSource = (lexer.rootLines ?? lexer.lines)[lexer.lineNumber(itemStartLineIndex) - 2]
        const sourceAfterNestedNote = pendingBlanks === 0 && lazyState.inFootnoteBody &&
          lastItemSource !== undefined && RE_FOOTNOTE_DEF.test(lastItemSource.trimStart()) &&
          parentNoteSource !== undefined && RE_FOOTNOTE_DEF.test(parentNoteSource.trimStart()) &&
          sourceColumn(parentNoteSource) >= itemMarkerColumn - baseIndent &&
          sourceColumn((lexer.rootLines ?? lexer.lines)[lexer.lineNumber(lexer.pos) - 1] ?? l) > itemMarkerColumn &&
          sourceColumn((lexer.rootLines ?? lexer.lines)[lexer.lineNumber(lexer.pos) - 1] ?? l) < sourceColumn(lastItemSource) + FOOTNOTE_BODY_COLUMN &&
          !lineOpensItemBlock(l.trimStart())
        if (!isBlankLine(l) && lw === baseIndent && lexer.hostBody === 'list' &&
            (lineOpensItemBlock(l.trimStart()) || deflistMarkerLine(stripLazyFrame(l))) &&
            sourceColumn((lexer.rootLines ?? lexer.lines)[lexer.lineNumber(lexer.pos) - 1] ?? l) ===
              lexer.lineStartColumn(itemStartLineIndex) - 1 + baseIndent &&
            (lazyState.inDefList === 'term' || lazyState.deepest?.inDefList === 'term') &&
            lazyState.opaque === null && !insideOpenFence(lazyState)) break
        if (lexer.hostBody === 'description' && pendingBlanks === 0 && lw < contentCol &&
            lazyState.opaque === null && RE_DEFLIST_TERM.test(l.trimStart())) break
        if (!/^[ \t]/.test(l) &&
            /^[ \t]+(?:[-*] |[0-9]+[.)] )\+[ \t]*$/.test(nestedSourceLines.at(-1) ?? '')) break
        // A run past an open quote's column is quoted text, not an item-ending break.
        if (!isBlankLine(l) && lw <= baseIndent && lazyState.literalColon === undefined &&
            !insideOpenFence(lazyState) &&
            RE_HR.test((nested.at(-1) ?? '').trimStart()) &&
            !(insideOpenQuoteParagraph(lazyState) &&
              indentColumns(nestedSourceLines.at(-1) ?? '') > contentCol)) break
        // Check the rebased leaf once; collection-only note text stores no continuation claim.
        if (markerNoteItem && lw < contentCol && !markerNoteClaimChecked) {
          markerNoteClaimChecked = true
          const claimLines = nested.slice()
          rebaseOverindentedBlocks(claimLines, authoredBaseEligible, -1, false, false,
            undefined, undefined, takenBelowColumn, false, undefined, undefined,
            { markers: noteParagraphMarkers })
          const claim = verbatimOnlyLazyState()
          const claimClosers = buildCloserIndex(claimLines)
          let definitionClaim = true
          let blank = false
          for (let index = 0; index < claimLines.length; index++) {
            const text = claimLines[index]!
            if (isBlankLine(text)) blank = true
            else {
              if (blank && isListMarkerLine(text.trimStart())) { claim.inFootnoteBody = false; definitionClaim = false }
              blank = false
            }
            const definition = RE_FOOTNOTE_DEF.exec(text.trimStart())
            if (definition) definitionClaim = true
            else if ((index > 0 && noteParagraphMarkers.has(index) &&
                indentColumns(nested[index]!) === FOOTNOTE_BODY_COLUMN) || RE_DEFLIST_DEF.test(text.trimStart())) definitionClaim = false
            if (!definition && leadingWhitespace(text) === 0 && !lineOpensItemBlock(text) && !isBlankLine(text) &&
                !claim.inFootnoteBody && claim.opaque === null) definitionClaim = false
            if (definitionClaim && opensCodeFence(text)) claim.lazyFoldable = false
            trackItemLazyState(text, claim, marker => codeCloserPossible(claimClosers, marker, index), true, () => false,
              { whitespace: leadingWhitespace(text), descendantFrames: true, terminatorFree: true })
            if (leadingWhitespace(text) === 0 && claim.lazyFoldable && !claim.inFootnoteBody &&
                !opensCodeFence(text) && !isListMarkerLine(text) && !definition) definitionClaim = false
          }
          if (definitionClaim && !markerNoteItemParagraphOpen && !commentFenceTail && !fenceBoundaryTail && (!claim.lazyFoldable || claimLines.every(text => isBlankLine(text) ||
              (leadingWhitespace(text) > 0 && !lineOpensItemBlock(text.trimStart()))))) break
        }
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
        const quoteParagraphMarker = pendingBlanks === 0 && lw > baseIndent &&
          !captionParagraphClaim && (insideOpenQuoteParagraph(lazyState) || authoredQuoteParagraphOpen) &&
          isListMarkerLine(l) &&
          !RE_BLOCKQUOTE.test(l.trimStart())
        const captionParagraphMarker = pendingBlanks === 0 && lw > baseIndent && captionParagraphClaim &&
          isListMarkerLine(l)
        const captionParagraphFollower = captionParagraphClaim && pendingBlanks === 0 &&
          indentColumns(l, contentCol + 1) > contentCol &&
          lineOpensItemBlock(l.trimStart())
        const quoteLazyFramed =
          (lexer.quoteLazyLines.has(lexer.lineNumber(lexer.pos)) || quoteParagraphMarker ||
            captionParagraphMarker || captionParagraphFollower) &&
          // Code, comment and established literal bodies keep their placement.
          // Lazy text in an ordinary colon body retains its paragraph frame.
          lazyState.opaque === null && lazyState.literalColon === undefined
        const belowItemComment = lw < contentCol && RE_COMMENT_LINE.test(l.trimStart())
        const heldCommentSpan = belowItemComment && commentFenceRun(l.trimStart()) !== undefined &&
          bodyHoldsOpenCommentSpan(nested, itemSpanScan, degradedOpeners)
        if (belowItemComment && !heldCommentSpan &&
            !(lazyState.lazyFoldable && lazyState.deepest?.lazyFoldable !== false) &&
            !lazyState.commentAtColumn && lazyState.inDefList !== 'description') break
        const sourceLine = (lexer.rootLines ?? lexer.lines)[lexer.lineNumber(lexer.pos) - 1] ?? l
        const sourceDepth = quotePrefixDepth(sourceLine)
        const sourceMarkerColumn = sourceColumn(sourceLine, sourceDepth)
        const sourceEntry = l.trimStart()
        // CARVE-P2-028: text past the term host cannot publish a quote claim.
        const foldedTermText = lazyState.inDefList === 'term' && definitionHostColumn !== undefined &&
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
        if (!quoteLazyFramed && lazyState.opaque === null && RE_DEFLIST_TERM.test(sourceEntry) &&
            lw >= contentCol && (definitionHostColumn === undefined ||
              sourceMarkerColumn <= definitionHostColumn)) {
          definitionHostColumn = sourceMarkerColumn
          definitionAuthored = sourceMarkerColumn > contentCol &&
            !lexer.nonAuthoredDefinitionStarts.has(lexer.lineNumber(lexer.pos))
        }
        const sourceDescription = RE_DEFLIST_DEF.exec(sourceEntry)
        // A term written on the item marker line begins at the item's content
        // column. A separator at the outer marker column leaves that item;
        // one between those columns is only a continuation of the term.
        if (markerLineTerm && sourceDescription !== null && lazyState.inDefList === 'term' &&
            sourceDepth === itemQuoteDepth && sourceMarkerColumn <= physicalItemMarkerColumn) break
        const markerTermText = markerLineTerm && sourceDescription !== null &&
          lazyState.inDefList === 'term' && sourceDepth === itemQuoteDepth &&
          sourceMarkerColumn < contentCol && sourceMarkerColumn > physicalItemMarkerColumn
        if (RE_DEFLIST_DEF.test(sourceQuoteBody(sourceLine).trimStart()) && lazyState.inDefList === 'term' &&
            definitionHostColumn !== undefined && sourceMarkerColumn < definitionHostColumn &&
            sourceMarkerColumn <= physicalItemMarkerColumn && sourceDepth === itemQuoteDepth) break
        if (pendingBlanks > 0) returnedParagraphColumn = undefined
        if (sourceDescription !== null && returnedTermSourceColumn !== undefined &&
            sourceMarkerColumn < returnedTermSourceColumn &&
            definitionHostColumn !== undefined && sourceMarkerColumn > definitionHostColumn)
          returnedParagraphColumn = sourceMarkerColumn
        const belowDescriptionBodyBand =
          definitionHostColumn !== undefined && definitionBodyColumn !== undefined &&
          sourceMarkerColumn > definitionHostColumn &&
          sourceMarkerColumn < definitionBodyColumn
        const pastDefinitionEntry = definitionAuthored && belowDescriptionBodyBand
        const survivingItemParagraph = markerContentColumn(content, terminatorFree) < 0 ||
          lazyState.deepest?.lazyFoldable === true
        const belowDefinitionEntry = lazyState.opaque === null && !lazyState.inFootnoteBody &&
          definitionHostColumn !== undefined &&
          (sourceDescription !== null || RE_DEFLIST_TERM.test(sourceEntry)) &&
          ((!markerLineTerm && sourceMarkerColumn < contentCol) ||
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
        if (belowDefinitionEntry && lw <= baseIndent && !insideOpenQuoteParagraph(lazyState) &&
            !authoredQuoteParagraphOpen) break
        if (!quoteLazyFramed && lazyState.opaque === null && sourceDescription &&
            definitionHostColumn === sourceMarkerColumn)
          definitionBodyColumn = sourceMarkerColumn + deflistContentCol(sourceDescription[1]!)
        if (!quoteLazyFramed && lazyState.opaque === null && sourceDescription &&
            authoredTermColumn === sourceMarkerColumn)
          authoredDescriptionBodyColumn = sourceMarkerColumn + deflistContentCol(sourceDescription[1]!)
        const trackedDescriptionBodyColumn = lazyState.inDefList === 'description' &&
          lazyState.descriptionColumn !== undefined
          ? contentCol + lazyState.descriptionColumn : -1
        const descriptionBodyColumn = Math.max(trackedDescriptionBodyColumn, authoredDescriptionBodyColumn ?? -1)
        const descriptionFollowerColumn = descriptionBodyColumn > 0
          ? indentColumns(l, descriptionBodyColumn) : -1
        const foldedDefinitionInReturnedParagraph = returnedParagraphColumn !== undefined &&
          pendingBlanks === 0 && lazyState.lazyFoldable &&
          sourceMarkerColumn > returnedParagraphColumn &&
          (RE_FOOTNOTE_DEF.test(sourceEntry) || isLinkDefLine(sourceEntry))
        const belowOpenDescription = foldedDefinitionInReturnedParagraph || pendingBlanks === 0 && lazyState.lazyFoldable &&
          descriptionFollowerColumn > contentCol && descriptionFollowerColumn < descriptionBodyColumn &&
          !lineOpensBlock(l.trimStart()) && !isContinuationMarker(l.trimStart()) &&
          !isBlockAttributeLine(l.trimStart()) &&
          !isRetainableLineComment(lexer, l) &&
          !/^:[ \t]+%%/.test((nested.at(-1) ?? '').trimStart())
        if (lw >= contentCol && !belowOpenDescription && !belowDefinitionEntry && !quoteLazyFramed &&
          // markup-carve/carve#1904's exclusion, unchanged and unconditional: a
          // quote-lazy MARKER line never reaches the content-column arm, not even
          // inside an open fence, where the gate above hands the line back.
          !lexer.quoteLazyMarkerLines.has(lexer.lineNumber(lexer.pos))) {
          markerNoteItemParagraphOpen = false
          let strippedPrefix: number | undefined
          const placed = sliceColumns(l, contentCol, true, prefix => { strippedPrefix = prefix })
          if (lazyState.opaque === null && !lazyState.inlineFenceParagraph && descendantOpaque === null && RE_FOOTNOTE_DEF.test(placed.trimStart())) {
            lexer.hostedFootnoteLines.add(lexer.lineNumber(lexer.pos))
            blockedNoteClaimFloor = indentColumns(l) + FOOTNOTE_BODY_COLUMN
            lazyState.lazyFoldable = false
          }
          const followsBlank = pendingBlanks > 0
          for (let k = 0; k < pendingBlankTexts.length; k++) {
            const comment = pendingNoteComments.has(k)
            if (comment) noteCommentLines.add(nested.length)
            // Emptied here, a nested item's own collector would have no residue
            // left to measure its opener against, so the container keeps what it
            // does not own.
            else bufferedBlanks.add(nested.length + 1)
            nestedSourceLines.push(pendingBlankTexts[k])
            nested.push(sliceColumns(pendingBlankTexts[k] ?? '', contentCol, true))
            nestedLineNumbers.push(pendingBlankLineNumbers[k]!)
            if (!comment) trackItemLazyState('', lazyState)
          }
          pendingBlanks = 0
          pendingBlankLineNumbers = []
          pendingBlankTexts = []
          pendingNoteComments = new Set()
          const isMarker =
            !(blockedNoteClaimFloor !== undefined &&
              indentColumns(l, blockedNoteClaimFloor) >= blockedNoteClaimFloor) &&
            !(lazyState.inFootnoteBody && nestedNoteBodyColumn !== undefined &&
              indentColumns(l, nestedNoteBodyColumn) >= nestedNoteBodyColumn) &&
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
          const precedingSource = (lexer.rootLines ?? lexer.lines)[lexer.lineNumber(lexer.pos) - 2]
          const followsOwnedNoteMarker = precedingSource !== undefined &&
            isContinuationMarker(sourceQuoteBody(precedingSource)) &&
            markerDecision(lexer, lexer.pos - 1).owner?.kind === 'footnote' &&
            markerDecision(lexer, lexer.pos - 1).reason === undefined
          if (isMarker && !followsOwnedNoteMarker) subListMarkers.add(nested.length)
          if (isMarker && leftBlockedNote && markerNoteItem &&
              bottomBlockLeavesParagraphOpen(markerFreeContent(l.trimStart())))
            markerNoteItemParagraphOpen = true
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
          let dedented =
            lazyState.opaque?.kind === 'code' && lexer.quoteLazyLines.has(lexer.lineNumber(lexer.pos))
              ? l.startsWith(LAZY_FRAME)
                ? l
                : LAZY_FRAME + l.replace(/^[ \t]+/, '')
              : quoteFootnote
                ? placed.trimStart()
              : placed
          if (markerTermText) dedented = LAZY_FRAME + sourceEntry
          if (pastDefinitionEntry && survivingItemParagraph &&
              definitionHostColumn === lexer.lineStartColumn(itemStartLineIndex) - 1 + contentCol - baseIndent &&
              (startsInterruptingBlock(lexer, placed.trimStart()) ||
                sourceDescription !== null && returnedTermSourceColumn === sourceMarkerColumn))
            dedented = placed.trimStart()
          if (sourceDescription !== null && returnedParagraphColumn === sourceMarkerColumn &&
              survivingItemParagraph) dedented = placed.trimStart()
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
          if (lazyState.opaque?.kind !== 'code' && (lazyState.literalColon === undefined || leadingWhitespace(dedented) === 0)) {
            authoredBaseEligible.add(nested.length)
            if (dedented[0] === ' ' || dedented[0] === '\t') hasOverindentedBlockCandidate = true
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
          const continuesItemParagraph = !followsBlank && lazyState.lazyFoldable && lazyState.opaque === null &&
              lazyState.inDefList === false && !lazyState.inFootnoteBody &&
              lazyState.quoteInner === null && lazyState.deepest == null &&
              lazyState.ownedColumn < 0 && lazyState.literalColon === undefined &&
              lazyState.authoredColon === undefined && lazyState.divDepth === 0 && !markerNoteItem &&
              opensCodeFence(dedented.trimStart())
          // A marker absorbed by the description paragraph cannot split the item into a sublist.
          const descriptionParagraphMarker = markerDescriptionInlineFence && lazyState.inlineFenceParagraph && lazyState.opaque === null &&
            isListMarkerLine(dedented.trimStart())
          if (descriptionParagraphMarker) subListMarkers.delete(nested.length)
          nested.push(descriptionParagraphMarker ? LAZY_FRAME + dedented.trimStart() : dedented)
          nestedSourceLines.push(l)
          nestedLineNumbers.push(lexer.lineNumber(lexer.pos))
          const fenceLineIndex = lexer.pos
          if (markerNoteItem) {
            const bodyText = dedented.trimStart()
            // A comment keeps its own retention reading (CARVE-P9-053).
            const bodyComment = RE_COMMENT_LINE.test(bodyText) || commentFenceRun(bodyText) !== undefined
            // An unclosed run past the note column keeps its paragraph open,
            // so its payload cannot grant the outer item a continuation claim.
            let unclosedNoteFence = false
            if (noteParagraphOpen && !followsBlank && !bodyComment && opensCodeFence(bodyText) &&
                indentColumns(l) >= markerNoteFloor) {
              const fence = RE_FENCE.exec(bodyText) ?? RE_RAW_FENCE.exec(bodyText)
              const marker = RE_FENCE.test(bodyText) ? fence![2]! : fence![1]!
              const closesAt = (column: number): boolean => {
                let memo = markerNoteFenceMemos.get(column)
                if (memo === undefined) markerNoteFenceMemos.set(column, memo = new Map())
                return itemFenceHasCloser(lexer, marker, fenceLineIndex, column, memo,
                  line => !isBlankLine(line) && indentColumns(line, markerNoteFloor) < markerNoteFloor)
              }
              unclosedNoteFence = !closesAt(indentColumns(l)) && !closesAt(markerNoteFloor)
              if (unclosedNoteFence && nestedNoteBodyColumn === undefined) noteInlineFenceOpen = true
            }
            markerNoteParagraph = noteParagraphOpen && !followsBlank && !bodyComment &&
              indentColumns(l, markerNoteFloor) >= markerNoteFloor &&
              (unclosedNoteFence || isListMarkerLine(bodyText) || !lineOpensItemBlock(bodyText))
            if (nestedNoteBodyColumn !== undefined && indentColumns(l, nestedNoteBodyColumn) >= nestedNoteBodyColumn) {
              const marker = isListMarkerLine(bodyText)
              const folds: boolean = marker && nestedNoteParagraph && !followsBlank
              if (!folds && (marker || bodyText.startsWith('>'))) nestedNoteContainer = true
              nestedNoteParagraph = folds || (!bodyComment && !marker && !lineOpensItemBlock(bodyText))
              if (!nestedNoteContainer && !bodyComment) noteBodyLast = true
            }
            if (markerNoteParagraph && !bodyComment) noteBodyLast = true
          }
          const continuedMarkerNoteText = markerNoteItem && !followsBlank && lazyState.lazyFoldable &&
            lazyState.opaque === null && lazyState.quoteInner === null && lazyState.literalColon === undefined &&
            indentColumns(l, contentCol + FOOTNOTE_BODY_COLUMN) >= contentCol + FOOTNOTE_BODY_COLUMN &&
            isListMarkerLine(dedented.trimStart())
          if (noteParagraphOpen && !followsBlank && (markerNoteFirstText || continuedMarkerNoteText) && isListMarkerLine(dedented.trimStart())) noteParagraphMarkers.add(nested.length - 1)
          let trackedContent = markerNoteFirstText || continuedMarkerNoteText ? 'text' : dedented
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
          let tabOpenerColumns: number | undefined
          let tabOpenerText: string | undefined
          let unindented = dedented
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
              (lazyState.quoteInner === null || !blockQuoteParagraphOpen(lazyState.quoteInner)) &&
              (lazyState.unclosedFenceBase === undefined || indentColumns(l) - contentCol === lazyState.unclosedFenceBase) &&
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
              trackDescendantOpaque(dedented, opener, fenceLineIndex, followsBlank)
              if (descriptionLead !== null && descendantOpaque !== null) {
                descriptionFenceAwaitingPayload = true
                if (markerLineTerm && descendantOpaque.markerLine) descriptionMarkerFence = true
              }
            } else if (!indented && !isBlankLine(dedented)) {
              // A block of THIS item, so no descendant is open behind it.
              descendantOpaque = null
            }
          }
          if (leadColonAwaitingBody && /^:{3,}/.test(trackedContent) && colonFenceOpenerLen(trackedContent) === null) {
            lazyState.unrebasedColonBody = { width: leadColon! }
            leadColonAwaitingBody = false
          }
          const confirmsLeadBody = leadColonAwaitingBody && !opensCodeFence(trackedContent)
          if (confirmsLeadBody) {
            lazyState.lazyFoldable = false
            lazyState.divDepth++
            lazyState.authoredColon = { width: leadColon!, column: 0, depth: lazyState.divDepth }
          }
          let descriptionCloserAnswer: boolean | undefined
          const itemHasFenceCloser = (marker: string, extraColumns = 0): boolean => {
            if (descriptionCloserAnswer !== undefined) return descriptionCloserAnswer
            const perColumn = itemFenceMemos ??= new Map()
            let memo = perColumn.get(extraColumns)
            if (memo === undefined) perColumn.set(extraColumns, memo = new Map())
            const answer = itemFenceHasCloser(
              lexer,
              marker,
              fenceLineIndex,
              contentCol + Math.max(0, extraColumns),
              memo,
              itemEndsAt,
              undefined,
              extraColumns < 0,
            )
            if (extraColumns > 0 && nestedOwnerColumn < 0 && answer) {
              lexer.descendantFenceAnswers.set(`${lexer.lineNumber(fenceLineIndex)}:${marker}`, true)
            }
            // Not published for an offset query; see the twin above.
            if (extraColumns === 0) {
              lexer.fenceLookaheadAnswers.set(
                `${lexer.lineNumber(fenceLineIndex)}:${marker}`,
                answer,
              )
            }
            return answer
          }
          if (markerDescriptionColumn !== undefined && !opensCodeFence(dedented.trimStart()) &&
              lineOpensItemBlock(dedented.trimStart())) markerDescriptionColumn = undefined
          const markerDescription = singleMarkerTerm && lazyState.quoteInner === null && !insideOpenFence(lazyState)
            ? RE_DEFLIST_DEF.exec(trackedContent) : null
          if (markerDescriptionColumn !== undefined && markerDescription === null && !isBlankLine(trackedContent) &&
              indentColumns(trackedContent) < markerDescriptionColumn) markerDescriptionColumn = undefined
          if (singleMarkerTerm && !insideOpenFence(lazyState) && RE_DEFLIST_TERM.test(trackedContent)) singleMarkerTerm = false
          if (singleMarkerTerm && lazyState.quoteInner === null && lazyState.inDefList === 'description' &&
              (lazyState.ownedColumn < 0 || lazyState.ownedAuthored) && !insideOpenFence(lazyState) &&
              markerDescriptionColumn !== undefined && indentColumns(trackedContent) >= markerDescriptionColumn) {
            const opener = trackedContent.trimStart()
            const fence = RE_FENCE.exec(opener) ?? RE_RAW_FENCE.exec(opener)
            if (fence !== null) {
              const marker = RE_FENCE.test(opener) ? fence[2]! : fence[1]!
              const hasOwnedCloser = (extraColumns: number): boolean => {
                const memos = markerDescriptionFenceMemos ??= new Map()
                let memo = memos.get(extraColumns)
                if (memo === undefined) memos.set(extraColumns, memo = new Map())
                return itemFenceHasCloser(lexer, marker, fenceLineIndex, contentCol + extraColumns, memo,
                  (line, afterBlank, index) => itemEndsAt(line, afterBlank) ||
                    (!isBlankLine(line) && ((lexer.ownedIndentColumns(index) ?? -1) < contentCol ||
                      lexer.quoteLazyLines.has(lexer.lineNumber(index)))),
                  index => lexer.ownedIndentColumns(index))
              }
              const openerColumn = lexer.ownedIndentColumns(fenceLineIndex)
              const hasOpenerCloser = openerColumn !== undefined && openerColumn >= contentCol + markerDescriptionColumn &&
                hasOwnedCloser(openerColumn - contentCol)
              // The description owns closers at its content column, never at the outer item column.
              descriptionCloserAnswer = hasOpenerCloser || hasOwnedCloser(markerDescriptionColumn)
              const key = `${lexer.lineNumber(fenceLineIndex)}:${marker}`
              lexer.descendantFenceAnswers.set(key, descriptionCloserAnswer)
              if (openerColumn !== undefined && openerColumn >= contentCol + markerDescriptionColumn &&
                  descriptionCloserAnswer) {
                markerDescriptionCodeBase = openerColumn - contentCol
                markerDescriptionCodeTracked = true
                singleMarkerTerm = false
                lazyState.inDefList = false
                lazyState.ownedColumn = -1
                lazyState.deepest = null
              }
              singleMarkerTerm = false
              markerDescriptionColumn = undefined
            }
          }
          const foldedDescription = nestedOwnerColumn < 0 && lazyState.quoteInner === null && lazyState.lazyFoldable &&
            !lazyState.absorbingFence && (lazyState.ownedColumn < 0 || lazyState.ownedAuthored) &&
            lazyState.inDefList === false && RE_DEFLIST_DEF.test(trackedContent)
          // A consumed descendant closer must not reopen a paragraph in the item.
          const skipConsumedCloser = closedDescendantFence || openedLaterNoteFence
          closedDescendantFence = false
          openedLaterNoteFence = false
          const wasMarkerDescriptionCode = markerDescriptionCodeTracked && lazyState.opaque?.kind === 'code'
          const atItemColumn = lw === contentCol && placed[0] !== ' ' && placed[0] !== '\t'
          const captionAtItemColumn = atItemColumn && RE_CAPTION.test(trackedContent)
          const hadQuoteParagraph = captionAtItemColumn &&
            (insideOpenQuoteParagraph(lazyState) || authoredQuoteParagraphOpen)
          const authoredQuoteLead = unindented[0] === '>' && trackedContent === dedented &&
            !RE_BLOCKQUOTE.test(dedented) && RE_BLOCKQUOTE.test(unindented)
          const itemOwnsQuote = authoredQuoteLead && !foldedTermText && !lazyState.inFootnoteBody && nestedNoteBodyColumn === undefined &&
            (authoredQuoteClaim !== null || lazyState.quoteInner === null && lazyState.ownedColumn < 0 && !insideOpenFence(lazyState) &&
              !lazyState.inlineFenceParagraph && descendantOpaque === null)
          const claimHostColumn = itemOwnsQuote && lazyState.inDefList === 'description' && lazyState.descriptionColumn !== undefined
            ? contentCol + lazyState.descriptionColumn : contentCol
          if (lazyState.quoteInner !== null && !insideOpenQuoteParagraph(lazyState) && authoredQuoteClaim === null &&
              !RE_BLOCKQUOTE.test(unindented) &&
              !lexer.quoteLazyLines.has(lexer.lineNumber(lexer.pos)) && !quoteParagraphMarker) {
            lazyState.quoteInner = null
          }
          if (!skipConsumedCloser) trackItemLazyState(
            trackedContent,
            lazyState,
            itemHasFenceCloser,
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
              ...itemFrameFacts(lineFacts(trackedContent, nestedOrigins.get(nested.length - 1))),
              quoteFenceCloser: (marker, depth = 0, column = 0) => {
                const key = `${depth}:${column}`
                let memo = itemQuoteFenceMemos.get(key)
                if (memo === undefined) itemQuoteFenceMemos.set(key, memo = new Map())
                return itemFenceHasCloser(lexer, marker, fenceLineIndex, contentCol, memo, itemEndsAt, undefined, false, depth, column)
              },
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
          )
          if (blockedNoteClaimFloor !== undefined) lazyState.lazyFoldable = false
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
              trackBlockQuoteLazyState(quoted[1] ?? '', authoredQuoteClaim, () => true, () => true)
            } else authoredQuoteClaim = markerLineQuoteState(unindented)
            authoredQuoteParagraphOpen = authoredQuoteClaim !== null && blockQuoteParagraphOpen(authoredQuoteClaim)
            authoredQuoteHostColumn = claimHostColumn
            lazyState.lazyFoldable = authoredQuoteParagraphOpen
          }
          else if (authoredQuoteClaim !== null) {
            const quoted = RE_BLOCKQUOTE.exec(trackedContent)
            if (quoted) {
              trackBlockQuoteLazyState(quoted[1] ?? '', authoredQuoteClaim, () => true, () => true)
              authoredQuoteParagraphOpen = blockQuoteParagraphOpen(authoredQuoteClaim)
            }
            else if (!authoredQuoteParagraphOpen || !lazyState.lazyFoldable || indentColumns(l) === authoredQuoteHostColumn &&
                !isListMarkerLine(l) &&
                (lineOpensBlock(unindented) || RE_COMMENT_LINE.test(unindented))) {
              authoredQuoteClaim = null
              authoredQuoteParagraphOpen = false
            }
          }
          if (captionParagraphClaim && (RE_COMMENT_LINE.test(unindented) ||
              (atItemColumn && !RE_CAPTION.test(trackedContent) && !isListMarkerLine(l) &&
                (lineOpensBlock(unindented) || isBlockAttributeLine(unindented))))) captionParagraphClaim = false
          if (markerNoteItem && indentColumns(l, markerNoteFloor) < markerNoteFloor &&
              RE_CAPTION.test(trackedContent.trimStart()) && lazyState.opaque === null) {
            lazyState.inFootnoteBody = false
            lazyState.lazyFoldable = true
            markerNoteItemParagraphOpen = true
          }
          if (isMarker && lazyState.literalColon === undefined &&
              colonFenceShapeEndsLazyContinuation(markerLineBottomBlock(dedented))) {
            lazyState.lazyFoldable = false
          }
          if (lazyState.opaque === null && !lazyState.inlineFenceParagraph && !markerDescriptionInlineFence &&
              !opensCodeFence((nested.at(-2) ?? '').trimStart()) &&
              lazyState.inDefList === 'description' && indentColumns(l) > contentCol &&
              isBlockAttributeLine(dedented.trimStart())) {
            lazyState.lazyFoldable = false
            if (lazyState.deepest?.inDefList === 'description') lazyState.deepest.lazyFoldable = false
          }
          if (descriptionCloserAnswer === false) {
            markerDescriptionInlineFence = true
            lazyState.inlineFenceParagraph = true
          } else if (!lazyState.inlineFenceParagraph) markerDescriptionInlineFence = false
          if (noteInlineFenceOpen) noteBodyLast = true
          if (continuesItemParagraph && !skipConsumedCloser && lazyState.opaque === null &&
              lazyState.inlineFenceParagraph) itemParagraphFences.add(nested.length - 1)
          if (lazyState.invisibleAtColumn && RE_FOOTNOTE_DEF.test(dedented.trimStart())) {
            nestedNoteBodyColumn = indentColumns(l) + FOOTNOTE_BODY_COLUMN
            nestedNoteParagraph = true
            nestedNoteContainer = false
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
          if (leadColonAwaitingBody && opensCodeFence(trackedContent) && lazyState.inlineFenceParagraph) lazyState.inlineFenceBlock = true
          if (leadColonAwaitingBody && opensCodeFence(trackedContent) && lazyState.opaque === null) leadColonAwaitingBody = false
          if (leadColonAwaitingBody && !RE_ADMONITION_CLOSE.test(trackedContent)) {
            lazyState.divDepth++
            leadColonAwaitingBody = false
          }
          // The item holds no paragraph a below-column line can continue while a
          // descendant holds a fence open. PART 1 S4 asks about the open STACK.
          if (descendantOpaque !== null && !descriptionFenceAwaitingPayload) lazyState.lazyFoldable = false
          if (lazyState.opaque?.kind !== 'code') authoredFenceBase = 0
          if (lazyState.opaque === null && !lazyState.inlineFenceParagraph && descendantOpaque === null &&
              RE_FOOTNOTE_DEF.test(l.trimStart()) && indentColumns(l) < contentCol && !enclosingLazy)
            hostedNoteBodyColumn = indentColumns(l) + FOOTNOTE_BODY_COLUMN
          lexer.consume()
        } else if (
          pendingBlanks === 0 &&
          !(leadState.bottomIsContinuationMarker && nested.length === 0 && leadingWhitespace(l) > 0) &&
          (sourceAfterNestedNote || (((((lazyState.lazyFoldable || captionParagraphClaim ||
            (lazyState.inDefList === 'description' && isBlockAttributeLine(l.trimStart())) ||
            (lazyState.deepest?.inDefList === 'description' &&
              (lazyState.deepest.lazyFoldable || isBlockAttributeLine(l.trimStart()))) ||
            commentFenceTail || fenceBoundaryTail ||
            // An ancestor already admitted this follower after the invisible comment.
            (lazyState.invisibleAtColumn && lexer.itemLazyLines.has(lexer.lineNumber(lexer.pos)) &&
              RE_COMMENT_LINE.test((nested.at(-1) ?? '').trimStart()))) && (!afterNoteBody || markerNoteItemParagraphOpen || (commentFenceTail && noteReach !== null) || fenceBoundaryTail)) || (lazyState.retainedMarker && (quoteLazyFramed || lexer.itemLazyLines.has(lexer.lineNumber(lexer.pos)))) ||
            (lazyState.opaque?.kind === 'comment' && lazyState.opaque.paragraphBefore && !lazyState.opaque.atColumn) ||
            // Only a consumed below-column comment retains a follower (X1).
            (lazyState.commentAtColumn &&
              !lexer.itemLazyLines.has(lexer.lineNumber(lexer.pos)) &&
              (indentColumns(l, contentCol) > 0 || lazyState.inDefList === 'description' ||
                (opensCodeFence(l.trimStart()) && followsBelowColumnComment())))) &&
            (quoteParagraphMarker || captionParagraphMarker || belowOpenDescription || (lw > baseIndent && lw < contentCol &&
              (lazyState.deepest?.lazyFoldable !== false || lazyState.inDefList === 'description' ||
                lazyState.deepest?.inDefList === 'description')) || !lazyContinuationEndsList(l, lexer) || (lazyState.retainedMarker && (quoteLazyFramed || lexer.itemLazyLines.has(lexer.lineNumber(lexer.pos)))) ||
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
        ) {
          const commentState = belowItemComment && lazyState.literalColon === undefined && (lazyState.deepest != null || lazyState.authoredColon?.column === 0) && lazyState.opaque === null ? {...lazyState} : undefined
          const retainedComment = lazyState.commentAtColumn && !lazyState.lazyFoldable &&
            lazyState.opaque === null && lazyState.literalColon === undefined && RE_COMMENT_LINE.test(l.trimStart())
          const termComment = lazyState.inDefList === 'term' && isRetainableLineComment(lexer, l)
          let lazyLine = l
          if (sourceAfterNestedNote) lazyLine = LAZY_FRAME + l.replace(/^[ \t]+/, '')
          // A caption line below the column reaches no host: it folds as text (§10 I7).
          if (indentColumns(l, contentCol) < contentCol && RE_CAPTION.test(l.replace(/^[ \t]+/, '')) &&
              lazyState.opaque === null && !quoteLazyFramed) {
            lazyLine = LAZY_FRAME + l.replace(/^[ \t]+/, '')
            if (markerNoteItem) markerNoteItemParagraphOpen = true
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
              (lineOpensBlock(l.replace(/^[ \t]+/, '')) || isBlockAttributeLine(l.trimStart()))) {
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
          if (indentColumns(l, contentCol) < contentCol) {
            lexer.itemLazyLines.add(lexer.lineNumber(lexer.pos))
          }
          // BELOW THE CONTENT COLUMN, so an invisible line here adds no block: it
          // is the lazy continuation of the paragraph above it, which stays open
          // behind it (corpus 183, 197, 358).
          // A fence at the retained description base ends that authored block's continuation claim.
          const descriptionFenceAtRetainedColumn = markerDescriptionInlineFence && lazyState.inlineFenceParagraph &&
            lazyState.descriptionColumn !== undefined && indentColumns(l) === lazyState.descriptionColumn &&
            opensCodeFence(l.trimStart())
          trackItemLazyState(lazyLine, lazyState, () => true, false,
            lazyState.authoredColon ? (width) => commentBlockHasCloser(lexer, width) : undefined)
          if (descriptionFenceAtRetainedColumn) lazyState.lazyFoldable = false
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
          if (retainedComment || termComment || (lazyState.inDefList === 'description' && isRetainableLineComment(lexer, l))) {
            retainCommentBoundary(lazyState)
          }
          if (lazyState.opaque?.kind !== 'code') authoredFenceBase = 0
          if (lazyState.opaque === null && !lazyState.inlineFenceParagraph && descendantOpaque === null &&
              RE_FOOTNOTE_DEF.test(l.trimStart()) && indentColumns(l) < contentCol && !enclosingLazy)
            hostedNoteBodyColumn = indentColumns(l) + FOOTNOTE_BODY_COLUMN
          lexer.consume()
        } else if (
          lazyState.opaque?.kind === 'code' &&
          pendingBlanks === 0 &&
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
          trackItemLazyState(framed, lazyState, () => true, false)
          if (lazyState.opaque?.kind !== 'code') authoredFenceBase = 0
          lexer.consume()
        } else {
          break
        }
      }

      if (commentPayloadCandidates) {
        const closedComments = commentBlockSpans([content, ...nested])
        const nestedItemColumn = markerContentColumn(content, terminatorFree)
        let scanned = 0
        let opener = -1
        for (const [index, payload] of commentPayloadCandidates) {
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
      // Preserve the existing extent of a fence-shaped descendant body span.
      // The parent tracker can leave its paragraph open after a child marker,
      // even though that child's body has already reached a fence run.
      let trailingDescendantFence = false
      if (pendingBlanks > 0) {
        const markerFenceAt = (
          text: string,
          column: number,
          prefixMemo?: Map<number, number>,
        ): { close: RegExp | null; base: number } => {
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
            if (prefix === 0) break
            base += markerContentColumn(text.slice(at, at + prefix) + 'x')
            at += prefix
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
        const leadFrame = markerFenceAt(content, 0, leadMemo)
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
          if (markerFence === null && isListMarkerLine(bodyLine)) {
            const frame = markerFenceAt(opener, column, lineFacts(bodyLine, nestedOrigins.get(bodyIndex))?.prefixMemo)
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
        trailingDescendantFence = bodyFence !== null || (markerFence !== null && !replacementMarkerFence)
      }

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
      const markerNoteFenceOwnsExtent = markerNoteItem && (markerNoteFenceReach(nested, noteParagraphMarkers, noteCommentLines) !== null ||
        markerNoteOpenerReach(nested, noteParagraphMarkers, noteCommentLines) !== null)
      // Include marker-line containers whose continuation keeps its own extent.
      const leadOwnsExtent = (leadColon !== null && !RE_LINE_BLOCK_OPEN.test(content)) || markerLineTerm || markerNoteFenceOwnsExtent ||
        (hasOverindentedBlockCandidate && RE_BLOCKQUOTE.test(content) &&
          blockQuoteParagraphOpen(markerLineQuoteState(content)!))
      const rebaseLines = leadOwnsExtent ? [content, ...nested] : nested
      const blankBeforeCommentFence: number[] = []
      let nestedNoteSeen = false
      let priorChecked = 0
      const commentFenceOpeners = markerNoteItem ? markerNoteCommentFenceOpeners(nested, noteParagraphMarkers, noteCommentLines) : []
      for (const openerIndex of commentFenceOpeners) {
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
        blankBeforeCommentFence.push(index - 1)
      }
      const rebaseEligible = leadOwnsExtent
        ? new Set([0, ...Array.from(authoredBaseEligible, (index) => index + 1)])
        : authoredBaseEligible
      const rebaseTakenBelowColumn = leadOwnsExtent
        ? new Set(Array.from(takenBelowColumn, (index) => index + 1))
        : takenBelowColumn
      let authoredCodeFenceOpen = false
      // Tightness uses the columns at which the collector admitted the lines.
      // Rebasing a block can move its continuation below a sublist's column.
      let hasBlank = nested.some(isBlankLine)
      const beforeRebase = hasOverindentedBlockCandidate && hasBlank
        ? nested.slice()
        : nested
      let tabRebaseColumns: Map<number, number> | undefined
      if (tabLineFacts !== undefined) {
        for (const [index, entry] of tabLineFacts) {
          if (nested[index] !== entry.text) continue
          const columns = tabRebaseColumns ??= new Map()
          columns.set(leadOwnsExtent ? index + 1 : index, entry.columns)
        }
      }
      const rebasedBlanks = hasOverindentedBlockCandidate
        ? rebaseOverindentedBlocks(
          rebaseLines,
          rebaseEligible,
          leadIsMarker ? markerContentColumn(content, terminatorFree) : -1,
          false,
          false,
          (index) => subListMarkers.delete(leadOwnsExtent ? index - 1 : index),
          () => { authoredCodeFenceOpen = true },
          rebaseTakenBelowColumn,
          leadColon !== null,
          leadOwnsExtent ? [undefined, ...nestedSourceLines] : nestedSourceLines,
          tabRebaseColumns,
          { markers: noteParagraphMarkers },
          leadOwnsExtent ? undefined : itemParagraphFences,
          undefined,
          markerLineTerm,
          false,
          false,
          undefined,
          new Set([
            ...Array.from(continuationFenceBreaks, (index) => index + (leadOwnsExtent ? 2 : 1)),
            ...Array.from(subListMarkers, (index) => index + (leadOwnsExtent ? 1 : 0)),
          ]),
          undefined,
          contentCol,
        )
        : new Set<number>()
      if (leadOwnsExtent) {
        for (let index = 0; index < nested.length; index++) nested[index] = rebaseLines[index + 1]!
      }
      // Rebasing can reveal a fence opened past the item's content column.
      // Its payload markers must not split the collected stream (#2212).
      const firstBlockIdx = subListMarkers.values().next().value ?? -1
      const authoredBlockBlanks = leadOwnsExtent
        ? new Set(Array.from(rebasedBlanks, (index) => index - 1))
        : rebasedBlanks
      for (const index of blankBeforeCommentFence) authoredBlockBlanks.add(index)

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
      let blankBeforeInvisible = false
      // A comment BLOCK renders nothing either, and its payload is not an
      // invisible LINE, so the scan steps over the whole block. Only an item
      // holding a blank can reach the flag, which is what keeps the pass off
      // every other item.
      const hiddenByComment = hasBlank ? commentBlockSpans([content, ...nested]) : []
      for (let k = nested.length - 1; k >= 0; k--) {
        const ln = nested[k]!
        if (hiddenByComment[k + 1] === true || degradedOpeners.has(k)) continue
        if (isBlankLine(ln)) {
          // A `+`-injected separator is not a blank line the author wrote, and
          // never loosens - the same exemption the second-paragraph scan below
          // makes for it. Without this the item went loose through the back door:
          // `- a` / `+` / `%% note` / `- b` came out loose where the identical
          // document without the comment is tight.
          blankBeforeInvisible = k < nested.length - 1 && !plusSeparators.has(k) && k > markerNoteRunEnd
          break
        }
        if (!invisibleNested(k)) break
      }

      // A blank line inside an OPEN verbatim fence is that fence's content, not
      // spacing between blocks. Blanks are buffered in `pendingBlanks` and
      // flushed only when a later line reaches the content column, so a fence
      // running to the end of the item never received them.
      //
      // A descendant's body-line fence keeps its trailing payload blanks.
      // Parent separators do not belong to fences on child marker lines.
      if (pendingBlanks > 0 && (
        lazyState.opaque !== null || authoredCodeFenceOpen || (descendantOpaque !== null && !descendantOpaque.markerLine) ||
        (trailingDescendantFence && (firstBlockIdx >= 0 || leadIsMarker || RE_DEFLIST_TERM.test(content)))
      )) {
        hasBlank = true
        for (let k = 0; k < pendingBlankTexts.length; k++) {
          if (pendingNoteComments.has(k)) noteCommentLines.add(nested.length)
          else bufferedBlanks.add(nested.length + 1)
          nestedSourceLines.push(pendingBlankTexts[k])
          nested.push(sliceColumns(pendingBlankTexts[k] ?? '', contentCol, true))
          nestedLineNumbers.push(pendingBlankLineNumbers[k]!)
        }
        // `pendingBlanks` is NOT cleared. The loose-list test below reads it to
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
      const separatingBlanks = closingNoteComment < 0 ? pendingBlanks
        : pendingBlankTexts.filter((_, index) => index > closingNoteComment && !pendingNoteComments.has(index)).length
      if ((separatingBlanks > 0 || blankBeforeInvisible) && nextIsSibling()) {
        // A run of THREE OR MORE blank lines is a hard boundary (§11 N1): the
        // sibling marker after it opens a new list instead of joining this
        // one. One or two blank lines remain the ordinary loose separator
        // (§17 L1). `blankBeforeInvisible` is deliberately not counted here -
        // a run broken by a comment is not a run of blank lines.
        if (separatingBlanks >= 3) hardBoundary = true
        else loose = true
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
      // fence in a single pass, then skip those blanks in the scan below. The
      // opener may be the item's lead (a marker-line fence, `- ``` `, which is not
      // in `nested`), so the pass prepends `content` and a `nested[k]` corresponds
      // to `fenceLines[k + 1]`. Marking ranges is O(n) total (ranges never
      // overlap), keeping the scan linear.
      //
      // An unterminated code fence absorbed into a paragraph keeps later blanks
      // from loosening the item until it ends (carve-js#2358). Track the fence
      // even when §10's closer lookahead prevents it from opening a code block.
      //
      // ALL THREE FENCE KINDS. This knew only the code fence, which is the same
      // one-kind-of-three defect corpus category 279 pins for the collectors -
      // and it surfaced the moment they were fixed: the blank inside a
      // `+`-attached `::: note` or `%%%` body reaches `nested` now and loosened
      // the item, where the identical code fence kept it tight.
      //
      // STILL ONE STATEFUL PASS, not one scan per line. Asking
      // `fencedBlockEnd` at every index reads the same suffix again for every
      // unterminated opener, which is quadratic. With comment openers of
      // increasing width that cannot close, each opener repeats the suffix scan.
      // The stack below runs `findColonCloser`'s nesting model once, left to right,
      // keeping the whole pass linear (ranges never overlap).

      // The content column of the sub-list item each line sits in. A marker at
      // the item's content column opens a sibling sub-list item or a new sibling
      // sub-list (§24 C3, carve-js#1951), whose own column then applies; one
      // indented below the current column folds into the open paragraph instead.
      // Built on first use: most items never reach the check below.
      let subColAt: number[] | null = null
      const subListColumnAt = (at: number): number => {
        if (subColAt === null) {
          subColAt = new Array(nested.length).fill(-1)
          let col = leadIsMarker ? markerContentColumn(content, terminatorFree) : -1
          for (let k = 0; k < nested.length; k++) {
            // An authored quote at this item's column closes the marker-line
            // child; a later blank belongs to this item's block sequence.
            if (col >= 0 && indentColumns(nested[k]!, col) < col &&
                RE_BLOCKQUOTE.test(nested[k]!.trimStart())) col = -1
            if (subListMarkers.has(k) && (col < 0 || indentColumns(nested[k]!, 1) === 0)) {
              col = markerContentColumn(nested[k]!)
            }
            subColAt[k] = col
          }
        }
        return subColAt[at]!
      }
      // Fence membership is read only for blank lines in the tightness pass.
      // Without a blank, classifying every descendant on the marker line has
      // no consumer and repeats the prefix walk at every nesting level.
      const fenceLines = hasBlank ? [content, ...nested] : []
      const inFence: boolean[] = new Array(fenceLines.length).fill(false)
      const foldedCloserChar = (line: string): string | null => {
        const content = line.startsWith(LAZY_FRAME + '>') ? line.slice(LAZY_FRAME.length + 1) : line.trimStart()
        return RE_FENCE_CLOSER.exec(content)?.[1]?.[0] ?? null
      }
      // Record lazy runs once, so each child opener can ask whether a folded
      // closer follows it without rescanning the rest of the item.
      const lazyClosersAhead: number[] = new Array(fenceLines.length).fill(0)
      let lazyCloserMask = 0
      for (let index = fenceLines.length - 1; index > 0; index--) {
        if (lexer.itemLazyLines.has(nestedLineNumbers[index - 1]!)) {
          const char = foldedCloserChar(fenceLines[index]!)
          if (char === '`') lazyCloserMask |= 1
          else if (char === '~') lazyCloserMask |= 2
        }
        lazyClosersAhead[index - 1] = lazyCloserMask
      }
      // A COMMENT OPENER WITH NO CLOSER AHEAD OPENS NOTHING (PART 9 §28), so it
      // must not latch this pass either: an unterminated `%%%` swallowed every
      // later line and a genuinely CLOSED code fence below it went unmarked, so a
      // blank inside that code loosened the item.
      const closerLines = fenceLines.map((line, index) => {
        if (index === 0) return line
        const childColumn = subListColumnAt(index - 1)
        const lazyFenceLine = lexer.itemLazyLines.has(nestedLineNumbers[index - 1]!) &&
          foldedCloserChar(line) !== null
        if (lazyFenceLine || (RE_FENCE_CLOSER.test(line.trimStart()) &&
            childColumn > 0 && beforeRebase[index - 1] !== undefined &&
            indentColumns(beforeRebase[index - 1]!, childColumn) < childColumn)) return ''
        return line.slice(lineFacts(line, nestedOrigins.get(index - 1))?.whitespace ?? 0)
      })
      const closers = buildCloserIndex(closerLines)
      const open: Array<{
        kind: 'code' | 'comment' | 'colon'
        close: RegExp | null
        len: number
        opaque: boolean
      }> = []
      let openOpaque = 0
      let opaqueIdx = -1
      // Rebasing can make a child paragraph's closing inline run look like an outer fence.
      let foldedChildRun: string | null = null
      let childFenceRun: string | null = null
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
        if (isBlankLine(line)) foldedChildRun = null
        const subCol = k > 0 ? subListColumnAt(k - 1) : -1
        if (!isBlankLine(line) && subCol > 0 && beforeRebase[k - 1] !== undefined &&
            indentColumns(beforeRebase[k - 1]!, subCol) < subCol) childFenceRun = null
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
        const childRun = RE_FENCE.exec(line.trimStart())
        if (childRun && childFenceRun !== null && subCol > 0 &&
            beforeRebase[k - 1] !== undefined &&
            indentColumns(beforeRebase[k - 1]!, subCol) >= subCol &&
            fenceCloseRe(childFenceRun).test(line.trimStart())) {
          foldedChildRun = null
          childFenceRun = null
        }
        else if (childRun && k > 1 && subCol > 0 &&
            beforeRebase[k - 1] !== undefined && beforeRebase[k - 2] !== undefined &&
            indentColumns(beforeRebase[k - 1]!, subCol) >= subCol &&
            !isBlankLine(fenceLines[k - 1]!) &&
            (indentColumns(beforeRebase[k - 2]!, subCol) >= subCol ||
              isListMarkerLine(beforeRebase[k - 2]!.trimStart())))
        {
          foldedChildRun = childRun[2]!
          childFenceRun ??= foldedChildRun
        } else if (childRun && subCol > 0 && beforeRebase[k - 1] !== undefined &&
            indentColumns(beforeRebase[k - 1]!, subCol) >= subCol && childFenceRun === null)
          childFenceRun = childRun[2]!
        const belowChildColumn = k > 0 && subCol > 0 &&
          beforeRebase[k - 1] !== undefined && indentColumns(beforeRebase[k - 1]!, subCol) < subCol
        const candidate = RE_FENCE.exec(line)
        const lazyChildRun: boolean = belowChildColumn && foldedChildRun !== null && candidate !== null &&
          candidate[2]![0] === foldedChildRun[0] && candidate[2]!.length <= foldedChildRun.length
        const fenceCandidate: RegExpExecArray | null = lazyChildRun ? null : candidate
        if (fenceCandidate && foldedChildRun === fenceCandidate[2] && subCol > 0 &&
            beforeRebase[k - 1] !== undefined &&
            indentColumns(beforeRebase[k - 1]!, subCol) < subCol) {
          foldedChildRun = null
          continue
        }
        // A run below a child item's content column cannot open an opaque fence
        // without a closer. It folds into the child's paragraph, so the blank
        // after it remains available to loosen the parent item (carve-js#3403).
        const foldedFence = fenceCandidate !== null && k > 0 &&
          ((itemParagraphFences.has(k - 1) && (subListColumnAt(k - 1) > 0
            ? beforeRebase[k - 1] !== undefined &&
              indentColumns(beforeRebase[k - 1]!, subListColumnAt(k - 1)) < subListColumnAt(k - 1)
            : ((lazyClosersAhead[k] ?? 0) & (fenceCandidate[2]![0] === '`' ? 1 : 2)) !== 0)) ||
            (k === 1 && subListColumnAt(0) > 0 && beforeRebase[0] !== undefined &&
              indentColumns(beforeRebase[0]!, subListColumnAt(0)) < subListColumnAt(0) &&
              bottomBlockLeavesParagraphOpen(markerLineBottomBlock(content))) ||
            (!markerNoteItem && subCol > 0 && belowChildColumn &&
              (isListMarkerLine(fenceLines[k - 1]!.trimStart()) ||
                (RE_FENCE.test(fenceLines[k - 1]!.trimStart()) &&
                  indentColumns(fenceLines[k - 1]!, 1) === indentColumns(line, 1))))) &&
          !codeCloserPossible(closers, fenceCandidate[2]!, k)
        const fence = foldedFence ? null : fenceCandidate
        const rawFence = fence ? null : RE_RAW_FENCE.exec(line)
        const marker = fence ? fence[2]! : rawFence ? rawFence[1]! : null
        let opened: { kind: 'code' | 'comment' | 'colon'; close: RegExp | null; len: number } | null =
          null
        if (marker !== null) {
          opened = { kind: 'code', close: fenceCloseRe(marker), len: marker.length }
        } else {
          const run = commentFenceRun(line)
          if (run !== undefined) {
            if (exactCloserPossible(closers.comment, run, k))
              opened = { kind: 'comment', close: null, len: run }
          } else {
            const colon = colonBlockOpenerRun(line)
            if (colon !== null) opened = { kind: 'colon', close: null, len: colon }
          }
        }
        if (opened === null) continue
        const entry = {
          ...opened,
          opaque: true,
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
          if (isBlankLine(next)) continue
          // The same `FOOTNOTE_BODY_COLUMN` boundary the tracker uses, so the two
          // agree about where the definition's block ends.
          if (indentColumns(next, FOOTNOTE_BODY_COLUMN) < FOOTNOTE_BODY_COLUMN) break
          last = j
        }
        for (let j = k + 1; j <= last; j++) inFootnoteRun[j] = true
        k = last
      }
      for (let j = 0; j <= markerNoteRunEnd; j++) inFootnoteRun[j] = true
      const captionAfterBlankLines: number[] = []
      for (let k = 0; k < nested.length; k++) {
        if (inFence[k + 1]!) continue
        if (inFootnoteRun[k]!) continue
        if (authoredBlockBlanks.has(k)) continue
        if (descendantFenceBlankLines.has(nestedLineNumbers[k]!)) continue
        if (!isBlankLine(nested[k])) continue
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
        // Where the blank's own block sequence resumes, before any invisible line
        // is skipped. The ownership test below is asked of it as well as of `j`.
        let resumesAt = -1
        while (j < nested.length) {
          if (resumesAt < 0 && !isBlankLine(nested[j])) resumesAt = j
          // A definition's body belongs to the note, including visible blocks.
          if (inFootnoteRun[j]) {
            j++
            continue
          }
          if (isBlankLine(nested[j])) {
            j++
            continue
          }
          // AN OPENER THAT CANNOT CLOSE IS ONE `%%` LINE, not a block (PART 9
          // §28, carve#1903), so the scan steps over that one line and reads
          // what follows as the item's own second paragraph. Reading it as a
          // block left `- t` / blank / `  %%%` / `  c` tight where the `%% x`
          // spelling of the same invisible line is loose (carve-js#2337).
          if (degradedOpeners.has(j)) {
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
          if (invisibleNested(j)) {
            j++
            continue
          }
          break
        }
        if (j >= nested.length) continue
        // Delay this decision until the blocks are parsed. A line that looks
        // like a caption host may be paragraph text or an uncapturable block.
        if (j === k + 1 && RE_CAPTION.test(nested[j]!)) {
          captionAfterBlankLines.push(nestedLineNumbers[j]!)
          continue
        }
        // A blank followed by content the item's SUB-LIST consumes does not
        // loosen THIS item: that content belongs to the sub-list, whose looseness
        // is decided by its own recursive parse. Counting it here wrongly
        // propagates a child's looseness up to the parent (carve#322). The
        // threshold is the sub-list's content column: a line at or past it is the
        // sub-list's, a line BELOW it (an above-content-column line, §24 C3, or a
        // dedented column-0 paragraph) is the item's OWN block and still loosens.
        // Matches carve-php / carve-rs, and the sibling-blank invariant where the
        // outer item stays tight. A marker LEAD (`- 1. x`) is that sub-list's
        // first item (carve-js#1938); a later sibling sub-list brings its own
        // column (carve-js#1951).
        const subCol = subListColumnAt(k)
        // A tab is measured from the authored source column. Rebasing the line
        // to the item body resets its tab stop, so its local width can make an
        // outer paragraph appear to reach the sub-list's content column.
        const sourceSubColumn = itemMarkerColumn + contentCol - baseIndent + subCol
        const reachesSubList = (at: number): boolean => {
          const source = nestedSourceLines[at]
          return source?.includes('\t')
            ? sourceColumn(source, itemQuoteDepth) >= sourceSubColumn
            : indentColumns(beforeRebase[at]!, subCol) >= subCol
        }
        if (subCol >= 0 && reachesSubList(j)) continue
        // AN INVISIBLE BLOCK THE SUB-LIST HOLDS MAKES THE BLANK THE SUB-LIST'S
        // TOO (markup-carve/carve-js#2243). The skip above looks past a comment to
        // find the paragraph §17 L1 asks for, and looking past one the CHILD holds
        // walked out of the child: the next visible line is then this item's own
        // block, and the blank in front of the child's comment was credited to this
        // item. `- a` / `  - b` / blank / `    %%%` / `    x` / `%%%` / `  tail`
        // loosened here where the executable spec keeps it tight, and the `%%`
        // line form at the child's column did the same.
        //
        // Asked of the line the blank's own sequence resumes at, which the walk
        // above already visited, so an item without a blank pays nothing.
        if (resumesAt >= 0 && resumesAt !== j && subCol >= 0 &&
          reachesSubList(resumesAt)) continue
        // `j` can no longer be an invisible line (skipped above), so this is the
        // plain "is the next visible thing a paragraph" test it always was.
        //
        // ASKED OF A BAND LINE TOO. A line the item folded below its content
        // column is its own paragraph text, so §17 L1 reads it exactly as the
        // content-column spelling (markup-carve/carve#2548, corpus 517).
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

      const leadOpensColonFence = isColonFenceOpener(content)
      // Parse the lead text together with its continuation/nested lines as one
      // block sequence (lazy continuation merges into the lead paragraph). An
      // indented ordered sub-list, however, is parsed as its own block stream so
      // it nests instead of folding into the lead paragraph.
      const itemLead = content
      const keepStreamWhole =
        firstBlockIdx === -1 || leadIsMarker || RE_FOOTNOTE_DEF.test(content) || leadOpensColonFence
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
              carry,
            ),
          )
        }
      } finally {
        session.captionLineScopes.pop()
      }

      if (authoredDescendantFenceBlanks > 0) {
        let blocks = children
        for (;;) {
          const list = [...blocks].reverse().find(block => block.type === 'list') as List | undefined
          if (!list) break
          blocks = list.items.at(-1)?.children ?? []
        }
        const code = [...blocks].reverse().find(block => block.type === 'code_block')
        if (code?.type === 'code_block') {
          let trailing = 0
          while (code.content[code.content.length - trailing - 1] === '\n') trailing++
          const body = code.content.slice(0, code.content.length - trailing)
          const blanks = trailing - Number(body.length > 0)
          const missing = authoredDescendantFenceBlanks - blanks
          if (missing > 0) code.content += '\n'.repeat(missing)
          else if (missing < 0) code.content = code.content.slice(0, missing)
        }
      }

      // A marker left at the parent's column may have been seen by a child's
      // open fence during collection. The parent's following paragraph owns it.
      const followingParagraph = children[1]
      if (followingParagraph?.type === 'paragraph' && followingParagraph.children[0]?.type === 'text' &&
          followingParagraph.children[0].value === '+') {
        let blocks = children[0]?.type === 'list' ? children[0].items.at(-1)?.children : undefined
        while (blocks?.at(-1)?.type === 'list') blocks = (blocks.at(-1) as List).items.at(-1)?.children
        const code = blocks?.at(-1)
        if (code?.type === 'code_block' && code.content.endsWith('\n+\n')) {
          code.content = code.content.slice(0, -2)
        } else if (code?.type === 'code_block' && code.content.endsWith('\n\n') &&
            (() => {
              let plusIndex = lexer.pos - 1
              while (plusIndex > itemStartLineIndex && !/^[ \t]+\+[ \t]*$/.test(lexer.lines[plusIndex]!)) plusIndex--
              return plusIndex >= itemStartLineIndex + 2 && isBlankLine(lexer.lines[plusIndex - 1]) &&
                isBlankLine(lexer.lines[plusIndex - 2])
            })()) {
          code.content = code.content.slice(0, -1)
        }
      }

      if (captionAfterBlankLines.length > 0) {
        if (captionAfterBlankLines.some(line => !captionLines.has(line))) loose = true
      }

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
      items.push(item)
      if (hardBoundary) break
    }

    const singleItemWithNestedFence = items.length === 1 &&
      items[0]?.children[0]?.type === 'paragraph' &&
      items[0].children[1]?.type === 'list' &&
      items[0].children[2]?.type === 'code_block' && !isBlankLine(lexer.lineAt(firstLineIndex + 1)) &&
      items[0].children.length === 3
    const list: List = { type: 'list', ordered: isOrdered, tight: !loose || singleItemWithNestedFence, items }
    if (isOrdered) {
      if (orderedStart !== 1) list.start = orderedStart
      const t = olTypeOf(orderedKind)
      if (t) list.olType = t
      // Only the non-default spelling is recorded: the schema calls `.` absent,
      // so writing it would give one document two legal trees (carve#2828).
      if (orderedDelim === ')') list.delim = orderedDelim
      // The bare dot is a spelling, not a dialect: `. a` and `1. a` are the same
      // list, so the tree has to carry which one opened it or the writer must
      // normalize one away (PART 11 §6).
      if (firstOrdered && firstOrdered[2] === '') list.bareMarker = true
    } else if (firstMarkerChar === '*') {
      // As above: absence spells the default `-` (carve#2828).
      list.bulletChar = firstMarkerChar
    }
    return list
  }

}
