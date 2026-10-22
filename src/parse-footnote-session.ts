import type { BlockNode, Position } from './parse-core.js'
import { ContainerBlankBuffer, runIndentationContainer } from './parse-indentation-container.js'
import { FOOTNOTE_BODY_COLUMN, LAZY_FRAME, Lexer, RE_COMMENT_LINE, RE_DEFLIST_TERM, RE_FOOTNOTE_DEF, attachesAtDocumentColumnZero, bodyHoldsOpenCommentSpan, firstBlockRefusesList, commentBlockHasCloser, commentFenceRun, indentColumns, isBlankLine, isColonFenceOpener, isContinuationMarker, isLinkDefLine, isPhysicalContinuationMarker, isRetainableLineComment, itemFenceHasCloser, leadingWhitespace, markerDecision, matchedCommentFenceEnd, nestedSubLexer, newCommentSpanScan, quoteBodyColumn, quotePrefixDepth, rebaseOverindentedBlocks, restoreVerbatimBlanks, retainBelowColumnComment, sliceColumns, sourceColumn, startsInterruptingBlock, trackItemLazyState, trimEndSpaceTab, verbatimOnlyLazyState } from './parse-core.js'

interface FootnoteHooks {
  collectAttachedBlock: (lexer: Lexer, isBoundary: (line: string) => boolean, contentColumn?: number, endAtFoldedDefinition?: boolean, markerColumn?: number, quoteLevels?: number, acceptFirstNonList?: boolean) => { lines: string[]; lineNumbers: number[]; startLineIndex: number }
  parseBlocks: (lexer: Lexer, baseIndent: number) => BlockNode[]
}

export function parseFootnoteDef(lexer: Lexer, hooks: FootnoteHooks): null {
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
  const pendingBlankRun = new ContainerBlankBuffer()
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
    const { lines: attached, lineNumbers: attachedLineNumbers } = hooks.collectAttachedBlock(
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
  } else if (/^\+[ \t]*$/.test(m[2]!)) {
    const reason = firstBlockRefusesList(lexer) ? 'list' : below === undefined ? 'document'
      : isBlankLine(below) ? 'blank' : leadingWhitespace(below) > 0 ? 'right' : null
    if (reason !== null) lexer.reportRefusedContinuationMarker(defLineIndex, defContentColumn + 1, 'footnote', reason)
  }
  if (!firstBlockAttached) trackItemLazyState(m[2]!, lazyState, () => false)
  let retainedBelowComment = false
  const nestedMarkerHasText = RE_FOOTNOTE_DEF.exec(m[2]!)?.[2]?.trim() !== '' && RE_FOOTNOTE_DEF.test(m[2]!)
  let termTextContinuation = false
  const belowColumnCommentFence = new Set<number>()
  let commentFenceUntil = 0
  runIndentationContainer(
    lexer, 'footnote', markerColumn, bodyColumn, quotePrefixDepth(authoredLine ?? defLineRaw), (admission) => {
    const ln = admission.line
    const sourceLine = lexer.rootLines?.[lexer.lineNumber(lexer.pos) - 1]
    if (lexer.hostBody === 'description' && pendingBlankRun.count > 0 &&
        authoredBodyColumn !== undefined && sourceLine !== undefined && !isBlankLine(sourceLine) &&
        sourceColumn(sourceLine) < authoredBodyColumn && indentColumns(ln, bodyColumn) >= bodyColumn) return 'stop'
    if (lexer.hostBody === 'list' && defLineIndex === 0 && nestedSourceBodyColumn !== undefined &&
        sourceLine !== undefined && !isBlankLine(sourceLine) &&
        indentColumns(sourceLine, nestedSourceBodyColumn) < nestedSourceBodyColumn) return 'stop'
    if (admission.kind === 'blank') {
      retainedBelowComment = false
      termTextContinuation = false
      trackItemLazyState('', lazyState)
      pendingBlankRun.add(ln, lexer.lineNumber(lexer.pos))
      lexer.consume()
      return 'continue'
    }
    // Form B: a lone `+` attaches the FOLLOWING flush-left block to the note
    // with no indentation (the same continuation marker lists and block quotes
    // use); the attached block ends at a blank line, another `+`, or the next
    // footnote definition - unless a fence this block opened is still open, in
    // which case all three are body text (corpus category 279).
    const noteMarkerLine = isContinuationMarker(ln.slice(leadingWhitespace(ln)))
    const noteMarker = noteMarkerLine ? markerDecision(lexer, lexer.pos) : undefined
    if (pendingBlankRun.count === 0 && lazyState.opaque === null &&
        noteMarker?.owner?.kind === 'footnote' && noteMarker.reason !== undefined) {
      // The note still owns this marker even when the next block misses its
      // marker column. The body collector leaves the + as text below.
      lexer.reportRefusedContinuationMarker(lexer.pos, markerColumn + 1,
        'footnote', noteMarker.reason)
    }
    if (pendingBlankRun.count === 0 && noteMarkerLine &&
        (isPhysicalContinuationMarker(sourceLine ?? ln) || noteMarker?.owner?.kind === 'footnote' && noteMarker.reason === undefined) &&
        sourceColumn((lexer.rootLines ?? lexer.lines)[lexer.lineNumber(lexer.pos)] ?? '', quotePrefixDepth(sourceLine ?? ln)) ===
          sourceColumn(sourceLine ?? ln) &&
        !(sourceLine !== undefined && quotePrefixDepth(sourceLine) > 0 &&
          sourceColumn(sourceLine) === quoteBodyColumn(sourceLine, quotePrefixDepth(sourceLine)) &&
          quotePrefixDepth((lexer.rootLines ?? lexer.lines)[lexer.lineNumber(lexer.pos)] ?? '') > quotePrefixDepth(sourceLine)) &&
        !isBlankLine((lexer.rootLines ?? lexer.lines)[lexer.lineNumber(lexer.pos)])) {
      const plusLineNumber = lexer.lineNumber(lexer.pos)
      lexer.consume()
      pendingBlankRun.clear()
      // ...AND THE NOTE ENDS WHERE A COMMENT ENDS IT. The gate below decides
      // whether this `+` is a marker at all; when it is not, the line is an
      // ordinary invisible line at document column 0, and a footnote body ends
      // at one of those exactly as it ends at a comment line there
      // (markup-carve/carve#1814). Asked one line early because this loop's
      // own continuation branch would otherwise claim the following line before
      // any extent is measured. The `+` is consumed either way, so the
      // enclosing parse resumes on the line the marker did not take.
      if (!attachesAtDocumentColumnZero(lexer, sourceColumn(sourceLine ?? ln), quotePrefixDepth(sourceLine ?? ln))) return 'stop'
      const { lines: attached, lineNumbers: attachedLineNumbers } = hooks.collectAttachedBlock(
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
      return 'continue'
    }
    // §16 asks for COLUMNS, not characters, and §24 C1 gives a tab a column
    // value - so a bare tab reaches column 4 and continues the note exactly as
    // two spaces do. Matching characters here accepted `<SPACE><TAB>` and
    // refused a bare tab, while carve-php refused the mixture and took the bare
    // tab: three engines, three readings (carve#796, carve-js#725). A rejected
    // continuation does not indent differently, it LEAVES the note and lands in
    // the document body, so the split moved content between blocks.
    if (admission.kind === 'content') {
      for (let k = 0; k < pendingBlankRun.count; k++) {
        bufferedBlanks.add(bodyLines.length)
        bodyLines.push('')
        bodyLineNumbers.push(pendingBlankRun.lineNumbers[k]!)
        bodySourceLines.push(pendingBlankRun.lines[k])
      }
      pendingBlankRun.clear()
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
      pendingBlankRun.count === 0 &&
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
      pendingBlankRun.count === 0 && indentColumns(ln, bodyColumn) < bodyColumn && ln !== ln.trimStart() &&
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
      pendingBlankRun.count === 0 && !RE_FOOTNOTE_DEF.test(ln) &&
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
      return 'stop'
    }
    return 'continue'
    })
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
    lexer.footnoteDefs.set(label, bodyLines.length === 1 && trimEndSpaceTab(bodyLines[0] ?? '') === '{empty}' ? [] : hooks.parseBlocks(sub, 0))
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
