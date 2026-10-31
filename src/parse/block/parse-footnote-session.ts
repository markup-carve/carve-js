import type { BlockNode, Position } from '../parse-core.js'
import { ContainerBlankBuffer, runIndentationContainer, type ContainerAdmission } from './parse-indentation-container.js'
import { FOOTNOTE_BODY_COLUMN, LAZY_FRAME, Lexer, RE_ADMONITION_CLOSE, RE_CAPTION, RE_COMMENT_LINE, RE_DEFLIST_TERM, RE_FOOTNOTE_DEF, bodyHoldsOpenCommentSpan, commentBlockHasCloser, commentFenceRun, indentColumns, isBlankLine,  isContinuationMarker, isLinkDefLine, isListMarkerLine, isPhysicalContinuationMarker, isRetainableLineComment, leadingWhitespace, lineOpensItemBlock, markerDecision, matchedCommentFenceEnd, nestedSubLexer, newCommentSpanScan, quotePrefixDepth, restoreVerbatimBlanks,  sliceColumns, sourceColumn, sourceColumnAt, sourceQuoteBody, startsInterruptingBlock, trackItemLazyState, trimEndSpaceTab, verbatimOnlyLazyState } from '../parse-core.js'

// A line-block payload run pairs with a later run of the body at any indent;
// a failed search refutes every later opener of that character and width.
const payloadMisses = new WeakMap<Lexer, Map<string, { from: number; maxRun: number }>>()
function payloadCloserInBody(lexer: Lexer, marker: string, bodyColumn: number): boolean {
  let misses = payloadMisses.get(lexer)
  if (misses === undefined) payloadMisses.set(lexer, misses = new Map())
  const key = `${bodyColumn}:${marker[0]}`
  const miss = misses.get(key)
  if (miss !== undefined && lexer.pos >= miss.from && marker.length > miss.maxRun) return false
  let maxRun = 0
  for (let i = lexer.pos + 1; i < lexer.lineCount; i++) {
    const line = lexer.lineAt(i)!
    if (!isBlankLine(line) && indentColumns(line, bodyColumn) < bodyColumn) break
    const run = /^(`{3,}|~{3,})[ \t]*$/.exec(line.replace(/^[ \t]+/, ''))?.[1]
    if (run === undefined || run[0] !== marker[0]) continue
    if (run.length >= marker.length) return true
    maxRun = Math.max(maxRun, run.length)
  }
  misses.set(key, { from: lexer.pos, maxRun })
  return false
}

interface FootnoteHooks {
  collectAttachedBlock: (lexer: Lexer, isBoundary: (line: string) => boolean, contentColumn?: number, endAtFoldedDefinition?: boolean, acceptFirstNonList?: boolean) => { lines: string[]; lineNumbers: number[]; startLineIndex: number }
  parseBlocks: (lexer: Lexer, baseIndent: number) => BlockNode[]
}

function canTakePlainLazyLine(state: ReturnType<typeof verbatimOnlyLazyState>): boolean {
  return state.lazyFoldable && state.deepest?.lazyFoldable !== false && state.opaque === null &&
    state.deepest?.opaque == null && !state.deepest?.divDepth
}

function trackedFootnoteContent(content: string): string {
  return content !== content.trimStart() && lineOpensItemBlock(content.trimStart())
    ? content.trimStart() : content
}

function trackedLiteralLine(content: string, framed: boolean): string {
  return framed ? 'text' : content
}

function priorListContentReached(lexer: Lexer, defLineIndex: number, column: number): boolean {
  const root = lexer.rootLines ?? lexer.lines
  const markerLine = root[lexer.lineNumber(defLineIndex) - 2]
  if (markerLine === undefined) return false
  let offset = markerLine.match(/^(?:> )*/)?.[0].length ?? 0
  while (markerLine[offset] === ' ' || markerLine[offset] === '\t') offset++
  const opener = /^(?:[-*] (?:\[[ xX_>\/!?-]\] )?|\. |(?:[0-9]+|[ivxlcdm]+|[IVXLCDM]+|[a-z]|[A-Z])[.)] )/
  for (let depth = 0; depth < 16; depth++) {
    const match = opener.exec(markerLine.slice(offset))
    if (match === null) return false
    offset += match[0].length
    if (sourceColumnAt(markerLine, offset) === column) return true
    while (markerLine[offset] === ' ') offset++
  }
  return false
}

function itemMarkerLeavesNote(lexer: Lexer, defLineIndex: number, sourceLine: string | undefined, authoredBodyColumn: number | undefined): boolean {
  if (lexer.hostBody !== 'list' || lexer.hostBodyRoot === 'footnote' ||
      sourceLine === undefined || authoredBodyColumn === undefined) return false
  // A note opening a quote in the item answers through the quote's lazy rule.
  const defSource = (lexer.rootLines ?? lexer.lines)[lexer.lineNumber(defLineIndex) - 1]
  if (defLineIndex === 0 && defSource !== undefined && quotePrefixDepth(defSource) > lexer.hostQuoteDepth) return false
  const column = sourceColumn(sourceLine)
  const noteColumn = authoredBodyColumn - FOOTNOTE_BODY_COLUMN
  if (column < noteColumn && priorListContentReached(lexer, defLineIndex, noteColumn) &&
      !priorListContentReached(lexer, defLineIndex, column)) return false
  return column >= lexer.hostContentColumn && column < authoredBodyColumn &&
    isListMarkerLine(sourceQuoteBody(sourceLine).trimStart())
}

function sourceOwnerLeavesNote(
  lexer: Lexer, sourceLine: string | undefined, authoredBodyColumn: number | undefined,
  pendingBlanks: number, line: string, bodyColumn: number, defLineIndex: number,
): boolean {
  if (itemMarkerLeavesNote(lexer, defLineIndex, sourceLine, authoredBodyColumn)) return true
  return lexer.hostBody === 'description' &&
    authoredBodyColumn !== undefined && sourceLine !== undefined && !isBlankLine(sourceLine) &&
    sourceColumn(sourceLine) < authoredBodyColumn &&
    (pendingBlanks > 0 && indentColumns(line, bodyColumn) >= bodyColumn ||
      defLineIndex === 0 && isListMarkerLine(sourceQuoteBody(sourceLine).trimStart()) &&
        sourceColumn(sourceLine) >= authoredBodyColumn - FOOTNOTE_BODY_COLUMN)
}

function reachesAuthoredNoteBody(
  lexer: Lexer, admission: ContainerAdmission, authoredBodyColumn: number | undefined,
  defLineIndex: number,
): boolean {
  // A note on a list marker uses that item's lazy admission instead.
  return admission.kind === 'content' || lexer.hostBody !== 'description' &&
    (lexer.hostBody !== 'list' || defLineIndex > 0) &&
    admission.kind === 'below' && authoredBodyColumn !== undefined &&
    Number.isFinite(admission.sourceColumn) &&
    admission.sourceColumn >= authoredBodyColumn
}

function markerLineCommentContinuesNote(
  lexer: Lexer, defLineIndex: number, sourceLine: string | undefined,
  authoredBodyColumn: number | undefined, line: string,
): boolean {
  return lexer.hostBody === 'list' && defLineIndex === 0 && sourceLine !== undefined &&
    authoredBodyColumn !== undefined && sourceColumn(sourceLine) >= authoredBodyColumn - FOOTNOTE_BODY_COLUMN &&
    isRetainableLineComment(lexer, line)
}

// A caption below a note on an item's marker line is the item's text; anywhere else it is lazy text.
function captionLeavesMarkerLineNote(lexer: Lexer, defLineIndex: number, line: string): boolean {
  return lexer.hostBody === 'list' && defLineIndex === 0 && RE_CAPTION.test(line.trimStart())
}

/** Whether the nested note opened at `defIndex` still ends on an open paragraph. */
function nestedNoteParagraphOpen(bodyLines: readonly string[], defIndex: number): boolean {
  const def = RE_FOOTNOTE_DEF.exec((bodyLines[defIndex] ?? '').trimStart())
  if (def === null) return false
  const column = indentColumns(bodyLines[defIndex]!) + FOOTNOTE_BODY_COLUMN
  const lines = bodyLines.slice(defIndex + 1).map(line => isBlankLine(line) ? '' : sliceColumns(line, column, true))
  const frame = verbatimOnlyLazyState()
  trackItemLazyState(def[2]!, frame)
  lines.forEach(line => trackItemLazyState(line, frame))
  return canTakePlainLazyLine(frame)
}

function nestedSourceBodyLeft(
  lexer: Lexer, defLineIndex: number, nestedSourceBodyColumn: number | undefined,
  sourceLine: string | undefined,
): boolean {
  return lexer.hostBody === 'list' && defLineIndex === 0 && nestedSourceBodyColumn !== undefined &&
    sourceLine !== undefined && !isBlankLine(sourceQuoteBody(sourceLine)) &&
    sourceColumn(sourceLine) < nestedSourceBodyColumn
}

function framesBelowNoteLine(
  admission: ContainerAdmission, sourceLine: string | undefined,
  authoredBodyColumn: number | undefined, content: string,
): boolean {
  // Definitions register at their own columns, including below a note body.
  return admission.kind !== 'blank' && sourceLine !== undefined &&
    authoredBodyColumn !== undefined && admission.sourceColumn < authoredBodyColumn &&
    !RE_COMMENT_LINE.test(content.trimStart()) &&
    !RE_FOOTNOTE_DEF.test(content.trimStart()) && !isLinkDefLine(content.trimStart()) &&
    !isContinuationMarker(content.trimStart())
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
  const authoredLine = (lexer.rootLines ?? lexer.lines)[lexer.lineNumber(defLineIndex) - 1]
  const authoredBodyColumn = authoredLine === undefined ? undefined
    : sourceColumnAt(authoredLine, Math.max(0, authoredLine.lastIndexOf(defLineRaw.trimStart()))) + FOOTNOTE_BODY_COLUMN
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
  let nestedDefBodyIndex = -1
  // A lazy line keeps an open paragraph open, so only lines added another way need a rescan.
  let nestedOpenMemo = { index: -1, length: 0, open: false }
  const nestedParagraphStillOpen = (): boolean => {
    const memo = nestedOpenMemo
    if (memo.index === nestedDefBodyIndex && memo.open) {
      while (memo.length < bodyLines.length && lexer.itemLazyLines.has(bodyLineNumbers[memo.length]!)) memo.length++
      if (memo.length === bodyLines.length) return true
    }
    nestedOpenMemo = { index: nestedDefBodyIndex, length: bodyLines.length, open: nestedNoteParagraphOpen(bodyLines, nestedDefBodyIndex) }
    return nestedOpenMemo.open
  }
  const noteSpanScan = newCommentSpanScan()
  const lazyState = verbatimOnlyLazyState()
  // A fence an attached block left open still holds its payload.
  const trackAttached = (attached: string[]): void => {
    const lastRun = new Map<number, number>()
    attached.forEach((line, k) => { const run = commentFenceRun(line); if (run !== undefined) lastRun.set(run, k) })
    attached.forEach((a, k) => trackItemLazyState(a, lazyState, true,
      (width) => (lastRun.get(width) ?? -1) > k || commentBlockHasCloser(lexer, width)))
  }
  // First-block form (`[^a]: +`, as `- +` and `:  +`): a lone `+` as the whole
  // marker-line content, with a non-blank line at document column 0 below it,
  // is a marker, and that line's block is the body. An invisible line (a
  // definition or a comment) is passed over as under `- +`, so a further
  // footnote definition is no boundary here. Otherwise the `+` stays text.
  let firstBlockAttached = false
  const below = lexer.peek()
  if (/^\+[ \t]*$/.test(m[2]!) && below !== undefined && !isBlankLine(below)) {
    // An attached paragraph ends at an opener that reaches the body column: that line is the body's.
    const attachedParagraph = !lineOpensItemBlock(below.trimStart())
    const noteBodyColumn = markerColumn + FOOTNOTE_BODY_COLUMN
    const { lines: attached, lineNumbers: attachedLineNumbers } = hooks.collectAttachedBlock(
      lexer,
      (a) => isBlankLine(a) || /^\+[ \t]*$/.test(a) ||
        (attachedParagraph && indentColumns(a) >= noteBodyColumn && startsInterruptingBlock(lexer, a.trimStart(), false)),
      0, true, true,
    )
    firstBlockAttached = true
    bodyLines[0] = ''
    bodySourceLines[0] = undefined
    for (const a of attached) {
      bodyLines.push(a)
      bodySourceLines.push(a)
    }
    bodyLineNumbers.push(...attachedLineNumbers)
    trackAttached(attached)
  }
  if (!firstBlockAttached) {
    trackItemLazyState(m[2]!, lazyState)
    const nestedBody = RE_FOOTNOTE_DEF.exec(m[2]!)?.[2]
    if (nestedBody !== undefined) trackItemLazyState(nestedBody, lazyState)
  }
  const nestedMarkerHasText = RE_FOOTNOTE_DEF.exec(m[2]!)?.[2]?.trim() !== '' && RE_FOOTNOTE_DEF.test(m[2]!)
  let termTextContinuation = false
  const belowColumnCommentFence = new Set<number>()
  let commentFenceUntil = 0
  runIndentationContainer(
    lexer, 'footnote', markerColumn, bodyColumn, quotePrefixDepth(authoredLine ?? defLineRaw), (admission) => {
    const ln = admission.line
    const sourceLine = admission.sourceLine
    if (sourceOwnerLeavesNote(lexer, sourceLine, authoredBodyColumn, pendingBlankRun.count, ln, bodyColumn, defLineIndex)) return 'stop'
    // A line leaving a nested note's body is still that note's lazy line (carve#3885),
    // and a line inside a fence this body opened is its payload.
    if (lazyState.opaque === null && nestedSourceBodyLeft(lexer, defLineIndex, nestedSourceBodyColumn, sourceLine) &&
        !(pendingBlankRun.count === 0 && nestedParagraphStillOpen() &&
          !startsInterruptingBlock(lexer, ln, false, false, ln === ln.trimStart()))) return 'stop'
    if (admission.kind === 'blank') {
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
    if (pendingBlankRun.count === 0 && noteMarkerLine &&
        lexer.peek(1) !== undefined && !RE_ADMONITION_CLOSE.test(lexer.peek(1)!) &&
        (isPhysicalContinuationMarker(sourceLine ?? ln) || noteMarker?.owner?.kind === 'footnote')) {
      const plusLineNumber = lexer.lineNumber(lexer.pos)
      lexer.consume()
      pendingBlankRun.clear()
      // The note ends where a comment ends it (markup-carve/carve#1814).
      // Check one line early so this branch does not claim the following line
      // before measuring the attached block's extent.
      const { lines: attached, lineNumbers: attachedLineNumbers } = hooks.collectAttachedBlock(
        lexer,
        (a) => isBlankLine(a) || /^\+[ \t]*$/.test(a) || RE_FOOTNOTE_DEF.test(a),
        0,
        true,
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
        // The attachment is a complete block. Its following line cannot
        // continue the paragraph that preceded the plus marker.
        trackItemLazyState('', lazyState)
        trackAttached(attached)
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
    if (reachesAuthoredNoteBody(lexer, admission, authoredBodyColumn, defLineIndex)) {
      for (let k = 0; k < pendingBlankRun.count; k++) {
        bufferedBlanks.add(bodyLines.length)
        bodyLines.push('')
        bodyLineNumbers.push(pendingBlankRun.lineNumbers[k]!)
        bodySourceLines.push(pendingBlankRun.lines[k])
      }
      pendingBlankRun.clear()
      const content: string = sliceColumns(ln, bodyColumn, true)
      // The line reaches this body's column, so a definition on it registers
      // here even where a nested item takes it as lazy text (CARVE-P0-020).
      if (lazyState.opaque === null && RE_FOOTNOTE_DEF.test(content.trimStart()))
        lexer.hostedFootnoteLines.add(lexer.lineNumber(lexer.pos))
      if (lexer.hostBody === 'list' && defLineIndex === 0 && RE_FOOTNOTE_DEF.test(ln.trimStart()) && sourceLine !== undefined) {
        nestedSourceBodyColumn = sourceColumn(sourceLine) + FOOTNOTE_BODY_COLUMN
        nestedDefBodyIndex = bodyLines.length
      }
      if (content !== content.trimStart() && lazyState.opaque === null && commentFenceUntil <= lexer.pos)
        commentFenceUntil = matchedCommentFenceEnd(lexer) ?? commentFenceUntil
      if (lexer.pos < commentFenceUntil) belowColumnCommentFence.add(bodyLines.length)
      // Past the body column a definition is term text; at it, it registers (CARVE-P0-010).
      const framedBelow = framesBelowNoteLine(admission, sourceLine, authoredBodyColumn, content)
      bodyLines.push(framedBelow
        ? LAZY_FRAME + content.trimStart() : termTextContinuation && RE_DEFLIST_TERM.test(bodyLines[0] ?? '') && content !== content.trimStart() &&
        (RE_FOOTNOTE_DEF.test(content.trimStart()) || isLinkDefLine(content.trimStart()))
        ? LAZY_FRAME + content.trimStart() : content)
      if (RE_DEFLIST_TERM.test(bodyLines[0] ?? '') && /^:[ \t]+/.test(content.trimStart()))
        termTextContinuation = true
      // The tracker reads an overindented opener at its local zero.
      // A line in a body item's frame keeps its indentation, so the item's own blocks open there.
      const tracked = framedBelow ? 'text' : lazyState.ownedColumn >= 0 && indentColumns(content) >= lazyState.ownedColumn
        ? content : trackedFootnoteContent(content)
      trackItemLazyState(tracked, lazyState, true, (run) => commentBlockHasCloser(lexer, run),
        framedBelow ? undefined : { whitespace: leadingWhitespace(tracked), descendantFrames: true, terminatorFree: false,
          payloadFenceCloser: marker => payloadCloserInBody(lexer, marker, bodyColumn) })
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
    } else if (lazyState.opaque === null && RE_COMMENT_LINE.test(ln.trimStart())) {
      // A comment below the body's column closes the body (carve#3885).
      return 'stop'
    } else if (
      pendingBlankRun.count === 0 && !RE_FOOTNOTE_DEF.test(ln) &&
      ((canTakePlainLazyLine(lazyState) && !captionLeavesMarkerLineNote(lexer, defLineIndex, ln)) ||
        markerLineCommentContinuesNote(lexer, defLineIndex, sourceLine, authoredBodyColumn, ln) ||
        ((nestedMarkerHasText && bodyLines.length > 1) && isRetainableLineComment(lexer, ln))) &&
      (isRetainableLineComment(lexer, ln) ||
        (lexer.hostBody === 'list' && sourceLine !== undefined && authoredBodyColumn !== undefined &&
          sourceColumn(sourceLine) < authoredBodyColumn - FOOTNOTE_BODY_COLUMN &&
          isListMarkerLine(sourceQuoteBody(sourceLine).trimStart())) ||
        !startsInterruptingBlock(lexer, ln, false, false, ln === ln.trimStart()))
    ) {
      const content = ln
      // An open definition term takes below-column lines as term text, even
      // when a line would otherwise look like a block opener.
      const framedBelow = framesBelowNoteLine(admission, sourceLine, authoredBodyColumn, content)
      bodyLines.push(lazyState.inDefList === 'term' || framedBelow
        ? LAZY_FRAME + content.trimStart() : content)
      bodyLineNumbers.push(lexer.lineNumber(lexer.pos))
      bodySourceLines.push(ln)
      lexer.itemLazyLines.add(lexer.lineNumber(lexer.pos))
      trackItemLazyState(trackedLiteralLine(content, framedBelow), lazyState, false,
        (run) => commentBlockHasCloser(lexer, run))
      lexer.consume()
    } else {
      return 'stop'
    }
    return 'continue'
    })
  // A losing duplicate is still read: only its own label loses, and a definition
  // nested in its body is collected like any other (PART 9R R2).
  const wins = !lexer.footnoteDefs.has(label)
  {
    // A recognized opener at or beyond the note's minimum column establishes
    // its authored column as a local base (carve#1729). The collector has
    // already removed the fixed two-column body margin.
    // A fence taken below the column keeps that column, as a `%%` line does.
    if (bodyLines.length !== 1 || !/^[A-Za-z][A-Za-z0-9 .]*$/.test(bodyLines[0]!)) {
      restoreVerbatimBlanks(bodyLines, bodySourceLines, bufferedBlanks, (index) =>
        index === 0 ? defContentColumn : indentColumns(bodySourceLines[index] ?? ''),
      )
    }
    const sub = nestedSubLexer(lexer, bodyLines, defLineIndex, bodyLineNumbers)
    sub.sublistsCarryAuthoredBase = true
    sub.inFootnoteBody = true
    sub.hostBody = 'footnote'
    sub.hostBodyRoot = 'footnote'
    const body = bodyLines.length === 1 && trimEndSpaceTab(bodyLines[0] ?? '') === '{empty}' ? [] : hooks.parseBlocks(sub, 0)
    if (!wins) return null
    lexer.footnoteDefs.set(label, body)
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
