import type { BlockNode, Position } from '../parse-core.js'
import { normalizeRefLabel } from '../../label-key.js'
import { attachedBlankClosers, attachedStartsWithLineBlock, attachedStartsWithVerbatimBlock, bodyEndsInOpenCodeFence, verseStanzaOpen } from './parse-block-boundaries.js'
import type { StrippedLineOrigin } from './parse-block-scan-core.js'
import { attachedQuoteEnd, quotedPayloadCloserAhead, type PayloadMisses } from './parse-quote-core.js'
import { pulledParagraphBlockCut } from './pulled-paragraph.js'
import { wrappedAttributeLinesAt } from './leading-attribute-run.js'
import { commentOnlyParagraphEnd } from '../parse-prepass-core.js'
import { ContainerBlankBuffer, runIndentationContainer, type ContainerAdmission } from './parse-indentation-container.js'
import { probeBlockAttributes, subLexer } from '../parse-core.js'
import { FOOTNOTE_BODY_COLUMN, sourceQuoteLocalColumn, isBlockAttributeLine, LAZY_FRAME, markerContentColumn, markerFreeContent, opensCodeFence, opensWrappedAttributeBlock, Lexer, RE_ABBR_DEF, RE_ADMONITION_CLOSE, RE_CAPTION, RE_COMMENT_LINE, RE_DEFLIST_DEF, RE_DEFLIST_TERM, RE_FOOTNOTE_DEF, bodyHoldsClosableCommentSpan, commentBlockHasCloser, commentCloserAhead, commentFenceRun, fenceCloseRe, indentColumns, isBlankLine,  isContinuationMarker, isLinkDefLine, isListMarkerLine, isPhysicalContinuationMarker, isRetainableLineComment, leadingWhitespace, lineOpensItemBlock, markerDecision, matchedCommentFenceEnd, nestedSubLexer, newCommentSpanScan, openFenceScanner, quotePrefixDepth, restoreVerbatimBlanks,  sliceColumns, sourceColumn, sourceColumnAt, sourceQuoteBody, startsInterruptingBlock, trackItemLazyState, trimEndSpaceTab, verbatimOnlyLazyState } from '../parse-core.js'

// A line-block payload run pairs with a later run of the body at any indent;
// a failed search refutes every later opener of that character and width.
function wrappedAttributeRunAt(lexer: Lexer): number {
  const opener = authoredSourceLine(lexer, lexer.lineNumber(lexer.pos)) ?? lexer.peek()
  if (opener === undefined || !opensWrappedAttributeBlock(sourceQuoteBody(opener).trimStart())) return 0
  const quoteDepth = quotePrefixDepth(opener)
  const column = sourceColumn(opener, quoteDepth)
  const lines: string[] = []
  for (let offset = 0; ; offset++) {
    const line = lexer.peek(offset)
    const authored = line === undefined ? undefined : authoredSourceLine(lexer, lexer.lineNumber(lexer.pos + offset)) ?? line
    if (authored === undefined || quotePrefixDepth(authored) !== quoteDepth || isBlankLine(line!) ||
        offset > 0 && sourceColumn(authored, quoteDepth) <= column) return 0
    lines.push(' '.repeat(sourceColumn(authored, quoteDepth) - column) + sourceQuoteBody(authored))
    if (authored.includes('}')) break
  }
  return probeBlockAttributes(subLexer(lines, lexer.parseOptions, 0))?.count === lines.length ? lines.length : 0
}

/** The column `lexer`'s line `index` was written at, before the ownership walk moved it. */
function authoredColumnAt(lexer: Lexer, index: number): number | undefined {
  const root = lexer.documentRoot ?? lexer
  const source = (root.authoredRootLines ?? root.rootLines ?? root.authoredLines ?? root.lines)[lexer.lineNumber(index) - 1]
  return source === undefined ? undefined : sourceQuoteLocalColumn(source, quotePrefixDepth(source))
}

/** A continuation the authored columns refuse is paragraph text, so its moved indentation is dropped. */
function rebasedRunContent(lexer: Lexer, state: { attrRun?: string | null }, attrSource: { column: number },
  content: string, sourceColumn: number, authoredBodyColumn: number | undefined): string {
  const column = state.attrRun == null || attrSource.column < 0 ? undefined : authoredColumnAt(lexer, lexer.pos)
  if (column !== undefined && column <= attrSource.column) return content.trimStart()
  return rebasedFootnoteContent(lexer, content, sourceColumn, authoredBodyColumn)
}

/** Tracks a body line, recording where a run it opens was written. */
function trackAuthoredAttributeRun(lexer: Lexer, state: { attrRun?: string | null; attrShallow?: boolean },
  attrSource: { column: number }, track: () => void): void {
  const open = authoredAttributeShallow(lexer, state, attrSource)
  track()
  if (!open && state.attrRun != null) attrSource.column = authoredColumnAt(lexer, lexer.pos) ?? -1
}

// A run's continuation must sit past its `{` where the author wrote it (CARVE-P2-035); the walk
// can move an opener to the body column without its lines. Returns whether a run was open.
function authoredAttributeShallow(lexer: Lexer, state: { attrRun?: string | null; attrShallow?: boolean },
  attrSource: { column: number }): boolean {
  if (state.attrRun == null) return false
  const column = authoredColumnAt(lexer, lexer.pos)
  if (column !== undefined && attrSource.column >= 0 && column <= attrSource.column) state.attrShallow = true
  return true
}

function wrappedAttributeLeavesNote(
  lexer: Lexer, admission: ContainerAdmission, sourceLine: string | undefined,
  authoredBodyColumn: number | undefined, state: ReturnType<typeof verbatimOnlyLazyState>, seen: { value: boolean; until: number },
): boolean {
  const authored = authoredSourceLine(lexer, lexer.lineNumber(lexer.pos)) ?? sourceLine
  if (admission.kind !== 'blank' && authored !== undefined && authoredBodyColumn !== undefined &&
      sourceColumn(authored) < authoredBodyColumn && (seen.value || wrappedAttributeRunAt(lexer) > 0)) return true
  const run = admission.kind === 'content' && state.opaque === null ? wrappedAttributeRunAt(lexer) : 0
  if (run > 0) {
    seen.value = true
    seen.until = lexer.pos + run - 1
    state.lazyFoldable = false
  } else if (admission.kind === 'content' && lexer.pos > seen.until && state.attrRun === null &&
      !isBlockAttributeLine(admission.line.trimStart()) &&
      // A nested note opens a paragraph its lazy lines continue (CARVE-P9-067).
      (!lineOpensItemBlock(admission.line.trimStart()) || RE_FOOTNOTE_DEF.test(admission.line.trimStart()))) {
    seen.value = false
  }
  return false
}

const payloadMisses = new WeakMap<Lexer, Map<string, { from: number; maxRun: number }>>()
const quotePayloadMisses = new WeakMap<Lexer, PayloadMisses>()
// Whether the first visible line a `+` attaches, past attribute, definition and comment lines, is a list marker.
export function attachedLeadIsList(lexer: Lexer): boolean {
  let k = 0
  // A paragraph of only braced comments is skipped as a `%%` line is; a marker ends it (carve#4799, carve#4890).
  const skipCommentParagraph = (): void => {
    const end = commentOnlyParagraphEnd((index) => lexer.peek(index), k, true)
    if (end !== -1) k = end
  }
  skipCommentParagraph()
  // A note's body is part of it, so a lead after two lazy lines is still measured (carve#5034).
  let inNoteBody = false
  for (let ln = lexer.peek(k); ln !== undefined && !isBlankLine(ln); ln = lexer.peek(k)) {
    // A wrapped attribute run is one attribute line (PART 9 §15 A5).
    const attrs = wrappedAttributeLinesAt((offset) => lexer.peek(k + offset), lexer.parseOptions)
    if (attrs > 0) {
      inNoteBody = false
      k += attrs
      skipCommentParagraph()
      continue
    }
    if (!(isBlockAttributeLine(ln.trimStart()) ||
      isLinkDefLine(ln.trimStart()) || RE_FOOTNOTE_DEF.test(ln.trimStart()) || RE_ABBR_DEF.test(ln.trimStart()) ||
      RE_COMMENT_LINE.test(ln.trimStart()) || (inNoteBody && skippedNoteBodyLine(ln)))) break
    inNoteBody = RE_FOOTNOTE_DEF.test(ln.trimStart()) || (inNoteBody && skippedNoteBodyLine(ln))
    k++
    skipCommentParagraph()
  }
  const lead = lexer.peek(k)
  return lead === undefined || isListMarkerLine(lead.trimStart())
}

/** A line a skipped note definition takes along: up to a blank, a comment line or a block opener (CARVE-P9-067). */
function skippedNoteBodyLine(line: string): boolean {
  const lead = line.trimStart()
  return !isBlankLine(line) && !/^::? /.test(lead) && !RE_COMMENT_LINE.test(lead) && !lineOpensItemBlock(lead)
}

function authoredPayloadAt(lexer: Lexer, index: number, fallback: string): { line: string; column: number } {
  const line = authoredSourceLine(lexer, lexer.lineNumber(index)) ?? fallback
  const payload = sourceQuoteBody(line).trimStart()
  return { line, column: sourceColumnAt(line, Math.max(0, line.lastIndexOf(payload))) }
}

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

function quoteMissesOf(lexer: Lexer): PayloadMisses {
  let misses = quotePayloadMisses.get(lexer)
  if (misses === undefined) quotePayloadMisses.set(lexer, misses = new Map())
  return misses
}

interface FootnoteHooks {
  collectAttachedBlock: (lexer: Lexer, isBoundary: (line: string) => boolean, contentColumn?: number, endAtFoldedDefinition?: boolean, acceptFirstNonList?: boolean, viewSlice?: number, itemHost?: boolean, closerFloor?: number, hostCloserColumn?: number, codeCloserColumn?: number) => { lines: string[]; lineNumbers: number[]; startLineIndex: number; firstVisible: string | undefined }
  parseBlocks: (lexer: Lexer, baseIndent: number) => BlockNode[]
  isConsumedMarker: (line: number) => boolean
  isClaimedMarker: (line: number) => boolean
}

interface PassedNote {
  label: string
  column: number
  lines: string[]
  numbers: number[]
}

function passedNotesInAttachment(lexer: Lexer, attached: string[], lineNumbers: number[], label: string): PassedNote[] {
  const passed: PassedNote[] = []
  for (let index = 0; index < attached.length; index++) {
    const lead = attached[index]!.trimStart()
    if (!RE_FOOTNOTE_DEF.test(lead) && !RE_COMMENT_LINE.test(lead)) break
    const source = authoredSourceLine(lexer, lineNumbers[index]!) ??
      (lexer.rootLines ?? lexer.lines)[lineNumbers[index]! - 1] ?? attached[index]!
    const note = RE_FOOTNOTE_DEF.exec(sourceQuoteBody(source).trimStart())
    if (note !== null && normalizeRefLabel(note[1]!) !== normalizeRefLabel(label) && /^\+[ \t]*$/.test(note[2]!)) {
      passed.push({ label: note[1]!, column: sourceColumn(source) + FOOTNOTE_BODY_COLUMN, lines: [], numbers: [] })
    }
  }
  return passed
}

function collectPassedNoteLine(
  lexer: Lexer, admission: ContainerAdmission, notes: PassedNote[],
  state: { body: PassedNote | undefined; blanks: number[]; nextNonblank: number }, bodyColumn: number,
): boolean {
  if (notes.length === 0) return false
  const ln = admission.line
  const passedColumn = sourceColumn(authoredSourceLine(lexer, lexer.lineNumber(lexer.pos)) ?? admission.sourceLine)
  if (admission.kind === 'blank') {
    let nextIndex = state.nextNonblank > lexer.pos ? state.nextNonblank : lexer.pos + 1
    while (lexer.lineAt(nextIndex) !== undefined && isBlankLine(lexer.lineAt(nextIndex)!)) nextIndex++
    state.nextNonblank = nextIndex
    const next = lexer.lineAt(nextIndex)
    const owner = state.body ?? notes.at(-1)!
    const source = next === undefined ? undefined : authoredSourceLine(lexer, lexer.lineNumber(nextIndex)) ??
      (lexer.rootLines ?? lexer.lines)[lexer.lineNumber(nextIndex) - 1] ?? next
    if (source !== undefined && sourceColumn(source) >= owner.column) {
      state.body = owner
      state.blanks.push(lexer.lineNumber(lexer.pos))
      lexer.consume()
      return true
    }
    state.body = undefined
    state.blanks.length = 0
    return false
  }
  state.nextNonblank = -1
  if (state.body !== undefined && (passedColumn >= state.body.column ||
      state.blanks.length === 0 && state.body.lines.length > 0 &&
      !startsInterruptingBlock(lexer, ln.trimStart(), false))) {
    if (state.body.lines.length > 0) for (const number of state.blanks) {
      state.body.lines.push('')
      state.body.numbers.push(number)
    }
    state.blanks.length = 0
    state.body.lines.push(passedColumn >= state.body.column
      ? sliceColumns(ln, bodyColumn, true) : LAZY_FRAME + ln.trimStart())
    state.body.numbers.push(lexer.lineNumber(lexer.pos))
    lexer.consume()
    return true
  }
  state.body = undefined
  state.blanks.length = 0
  return false
}

function registerPassedNoteBodies(lexer: Lexer, notes: PassedNote[], defLineIndex: number, hooks: FootnoteHooks): void {
  for (const passed of notes) {
    const existing = lexer.footnoteDefs.get(passed.label)
    if (passed.lines.length === 0 || existing === undefined || existing.some(node => node.type !== 'comment')) continue
    const sub = nestedSubLexer(lexer, passed.lines, defLineIndex, passed.numbers)
    sub.inFootnoteBody = true
    sub.hostBody = 'footnote'
    sub.hostBodyRoot = 'footnote'
    const parsed = hooks.parseBlocks(sub, 0)
    lexer.footnoteDefs.set(passed.label, parsed)
    lexer.footnoteDefLines.set(passed.label, [...(lexer.footnoteDefLines.get(passed.label) ?? []), ...passed.numbers])
    const pos = lexer.footnoteDefPos.get(passed.label)
    const end = parsed.at(-1)?.pos
    if (pos !== undefined && end !== undefined) {
      pos.endLine = end.endLine
      if (end.endColumn !== undefined) pos.endColumn = end.endColumn
      if (end.endOffset !== undefined) pos.endOffset = end.endOffset
    }
  }
}

function canTakePlainLazyLine(state: ReturnType<typeof verbatimOnlyLazyState>): boolean {
  return state.lazyFoldable && state.deepest?.lazyFoldable !== false && state.opaque === null &&
    state.deepest?.opaque == null && (!state.deepest?.divDepth || state.deepest.literalLayout === true)
}

/** A marker-line span hides its payload, so it cannot reopen the note's paragraph. */
function clearParagraphAfterMarkerSpan(
  scan: ReturnType<typeof newCommentSpanScan>,
  lines: readonly string[],
  state: ReturnType<typeof verbatimOnlyLazyState>,
): void {
  const spanRun = scan.opaque?.run
  const openerIndex = scan.opaque?.start
  if (openerIndex === undefined ||
      !isListMarkerLine((lines[openerIndex] ?? '').trimStart()) ||
      commentFenceRun(markerFreeContent(lines[openerIndex]!)) !== spanRun) return
  state.lazyFoldable = false
  if (state.deepest) state.deepest.lazyFoldable = false
}

function captionParagraphOpen(lines: string[], state: ReturnType<typeof verbatimOnlyLazyState>, follower: string): boolean {
  const prior = (lines.at(-2) ?? '').trimStart()
  const fenceClosed = state.opaque?.kind === 'code' && state.opaque.close.test(prior)
  return RE_CAPTION.test((lines.at(-1) ?? '').trimStart()) && !isListMarkerLine(follower.trimStart()) &&
    /^(`{3,}|~{3,})\s*$/.test(prior) &&
    lines.slice(0, -2).some(line => /^(?:(?::|-|\d+[.)])\s*)*(`{3,}|~{3,})/.test(line.trimStart())) &&
    (state.opaque === null || fenceClosed)
}

const attachedCaptionStates = new WeakMap<string[], { length: number; open: boolean }>()
function hasOpenAttachedCaption(lines: string[]): boolean {
  const state = attachedCaptionStates.get(lines) ?? { length: 0, open: false }
  for (let i = state.length; i < lines.length; i++) {
    const line = lines[i]!.trimStart()
    if (line === '' || lineOpensItemBlock(line)) state.open = false
    if (RE_CAPTION.test(line)) state.open = true
  }
  state.length = lines.length
  attachedCaptionStates.set(lines, state)
  return state.open
}

function attachedCaptionKeepsIndent(lexer: Lexer, lines: string[], firstBlockAttached: boolean, line: string): boolean {
  return firstBlockAttached && hasOpenAttachedCaption(lines) &&
    !startsInterruptingBlock(lexer, line.trimStart()) && !isListMarkerLine(line.trimStart())
}

function attachedCaptionTakesHostBlock(
  lexer: Lexer, lines: string[], firstBlockAttached: boolean, admission: ContainerAdmission,
  authoredBodyColumn: number | undefined,
): boolean {
  return firstBlockAttached && admission.kind === 'below' && authoredBodyColumn !== undefined &&
    hasOpenAttachedCaption(lines) &&
    lexer.lineStartColumn(lexer.pos) - 1 >= authoredBodyColumn &&
    (lineOpensItemBlock(admission.line.trimStart()) || isListMarkerLine(admission.line.trimStart()))
}

function abbreviationLeavesNote(
  lexer: Lexer, state: ReturnType<typeof verbatimOnlyLazyState>, sourceLine: string | undefined,
  authoredBodyColumn: number | undefined, line: string,
): boolean {
  return lexer.atDocumentLevel && state.opaque === null && sourceLine !== undefined && authoredBodyColumn !== undefined &&
    sourceColumn(sourceLine) < authoredBodyColumn && RE_ABBR_DEF.test(line.trimStart())
}

function isLiteralLineBlockListMarker(state: ReturnType<typeof verbatimOnlyLazyState>, line: string): boolean {
  return state.deepest?.literalLayout === true && isListMarkerLine(line.trimStart())
}

function trackedFootnoteContent(content: string): string {
  const trimmed = content.trimStart()
  // A wrapped attribute opener counts too, so its run takes a closer at any column (§15 A5).
  return content !== trimmed && (lineOpensItemBlock(trimmed) || opensWrappedAttributeBlock(trimmed))
    ? trimmed : content
}

function rebasedFootnoteContent(
  lexer: Lexer, content: string, sourceColumnValue: number, authoredBodyColumn: number | undefined,
): string {
  if (!lexer.inFootnoteBody || authoredBodyColumn === undefined || !Number.isFinite(sourceColumnValue)) return content
  // The parent note has already removed its own margin. Remove the rest of
  // the nested note's authored margin, retaining any indentation beyond it.
  const retained = Math.max(0, sourceColumnValue - authoredBodyColumn)
  return sliceColumns(content, Math.max(0, indentColumns(content) - retained), true)
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

// CARVE-P9-083: an item on the marker line is measured from its own source column, so
// a line at or past that item's content column is read in the item's coordinates.
function measureLeadItemFromSource(bodyLines: string[], leadShift: number): void {
  const width = leadShift > 0 ? markerContentColumn(bodyLines[0]!) : -1
  if (width < 0) return
  for (let k = 1; k < bodyLines.length; k++) {
    const line = bodyLines[k]!
    if (!isBlankLine(line) && indentColumns(line) >= leadShift + width) bodyLines[k] = sliceColumns(line, leadShift, true)
  }
}

function alignFirstFenceAtItsBase(bodyLines: string[], authoredLines: readonly string[] | undefined, lineNumber: number): void {
  const authoredMarker = authoredLines?.[lineNumber - 1]
  if (authoredMarker === undefined || !/\]:[ \t]+\+[ \t]*$/.test(authoredMarker) ||
      bodyLines[0]?.trim() !== '%%') return
  const opener = bodyLines[1] ?? ''
  const marker = /^(`{3,}|~{3,})/.exec(opener.trimStart())?.[1]
  const margin = indentColumns(opener)
  if (marker === undefined || margin === 0) return
  const closes = fenceCloseRe(marker)
  for (let index = 1; index < bodyLines.length; index++) {
    const line = bodyLines[index]!
    bodyLines[index] = sliceColumns(line, margin, true)
    if (index > 1 && indentColumns(line) === margin && closes.test(line.trimStart())) break
  }
}

function rewrittenPlusStartsFence(authoredLines: readonly string[] | undefined, lineNumber: number, body: string): boolean {
  return body.trim() === '%%' && /\]:[ \t]+\+[ \t]*$/.test(authoredLines?.[lineNumber - 1] ?? '')
}

/** A fence nested in an attached container stays open past the block: its blank is payload (carve#5539). */
function nestedAttachedFenceOpen(attached: readonly string[], bodyLines: readonly string[]): boolean {
  return !attachedStartsWithVerbatimBlock(attached) && bodyEndsInOpenCodeFence(bodyLines)
}

/** The closers written at the first blank after a marker-line `+` block that is itself a fence (PART 0 S1). */
function plusBlockClosers(
  lexer: Lexer, attached: readonly string[], bodyLines: readonly string[],
  scanner: (lines: readonly string[]) => string[], bodyColumn: number,
): string[] {
  if (!attachedStartsWithVerbatimBlock(attached)) return []
  const lineBlock = attachedStartsWithLineBlock(attached)
  const closers = scanner(bodyLines).filter(run => !lineBlock || run[0] === ':')
  return attachedBlankClosers(lexer, closers, bodyColumn, lineBlock,
    indentColumns(attached.find(line => opensCodeFence(line.trimStart())) ?? ''))
}

/** Whether a line below an open item fence still belongs to the attached list: item text or a sibling marker. */
function continuesAttachedList(line: string, listColumn: number): boolean {
  const column = indentColumns(line)
  return column > listColumn || (column === listColumn && isListMarkerLine(line.trimStart()))
}

/**
 * The `+` attaches a list, not its child fence (carve#5539): while that fence or comment span is open a
 * blank is its payload, and a line still in the list ends the fence there (PART 0 S1, §11 N1).
 * Returns whether the line ends the attached block, or undefined to leave it to the host's boundary.
 */
export function attachedListFenceBoundary(listColumn: number): (line: string) => boolean | undefined {
  let fenceCloser: RegExp | undefined
  let fenceColumn = 0
  let commentRun: number | undefined
  let commentColumn = 0
  return (a) => {
    if (commentRun !== undefined) {
      // Only a fence holds a blank as payload; at a blank the host decides (PART 0 S1).
      if (isBlankLine(a)) {
        commentRun = undefined
        return undefined
      }
      if (indentColumns(a) >= commentColumn) {
        if (commentFenceRun(a.trimStart()) === commentRun) commentRun = undefined
        return false
      }
      if (!continuesAttachedList(a, listColumn)) return true
      commentRun = undefined
    }
    if (fenceCloser !== undefined) {
      if (isBlankLine(a) || indentColumns(a) >= fenceColumn) {
        if (fenceCloser.test(a.trimStart())) fenceCloser = undefined
        return false
      }
      if (!continuesAttachedList(a, listColumn)) return true
      fenceCloser = undefined
    }
    const run = commentFenceRun(a.trimStart())
    if (run !== undefined) {
      commentRun = run
      commentColumn = indentColumns(a)
    }
    // A fence on an item's marker line opens at the item's content column, the width of what precedes it.
    const fenceText = opensCodeFence(a.trimStart()) ? a.trimStart() : markerFreeContent(a)
    const marker = opensCodeFence(fenceText) ? /^(`{3,}|~{3,})/.exec(fenceText)?.[1] : undefined
    if (marker !== undefined) {
      fenceCloser = fenceCloseRe(marker)
      fenceColumn = indentColumns(a.slice(0, a.length - fenceText.length).replace(/[^\t]/g, ' '))
    }
    return undefined
  }
}

function rebaseAttachedCodeCloser(attached: readonly string[], bodyLines: string[]): void {
  const opener = attached[0]
  if (attached.length < 2 || opener === undefined || !opensCodeFence(opener.trimStart())) return
  const run = /^(`{3,}|~{3,})/.exec(opener.trimStart())?.[1]
  if (run === undefined) return
  const last = bodyLines.length - 1
  const closer = bodyLines[last]!
  // The note host accepts a closer one column right of the opener. Its body
  // parser reads the attached block at the opener's column.
  if (indentColumns(closer) === indentColumns(opener) + 1 && fenceCloseRe(run).test(closer.trimStart()))
    bodyLines[last] = closer.trimStart()
}

function noteBodyContent(
  lexer: Lexer, admission: ContainerAdmission, bodyColumn: number, authoredBodyColumn: number | undefined,
  captionHostBlock: boolean, firstFenceEligible: boolean, firstFenceRun: string | undefined, firstBodyLine: boolean,
): { content: string; fenceRun: string | undefined } {
  const line = admission.line
  const sourceLine = admission.sourceLine
  const authoredFollower = authoredSourceLine(lexer, lexer.lineNumber(lexer.pos))
  const fenceActive = firstFenceRun !== undefined || firstFenceEligible && firstBodyLine &&
    /^(`{3,}|~{3,})/.test(line.trimStart())
  const syntheticMargin = fenceActive && authoredFollower !== undefined && sourceLine !== undefined
    ? Math.max(0, sourceColumn(sourceLine) - sourceColumn(authoredFollower)) : 0
  const normalizedLine = syntheticMargin > 0 ? sliceColumns(line, syntheticMargin, true) : line
  const contentBase = captionHostBlock ? normalizedLine : sliceColumns(normalizedLine, bodyColumn, true)
  let fenceRun = firstFenceRun
  if (firstFenceEligible && firstBodyLine) fenceRun = /^(`{3,}|~{3,})/.exec(contentBase.trimStart())?.[1]
  const authoredIndent = fenceRun !== undefined && authoredFollower !== undefined && authoredBodyColumn !== undefined &&
    sourceLine !== undefined && quotePrefixDepth(sourceLine) > 0
    ? Math.max(0, sourceColumn(authoredFollower) - authoredBodyColumn) : 0
  const content = authoredIndent > indentColumns(contentBase)
    ? ' '.repeat(authoredIndent - indentColumns(contentBase)) + contentBase : contentBase
  if (fenceRun !== undefined && !firstBodyLine && fenceCloseRe(fenceRun).test(content.trimStart())) fenceRun = undefined
  return { content, fenceRun }
}

/** The authored text of source line `number`; erased comment lines keep the original numbering. */
function authoredSourceLine(lexer: Lexer, number: number): string | undefined {
  const root = lexer.documentRoot ?? lexer
  return (root.authoredRootLines ?? root.authoredLines)?.[number - 1]
}

/** Claimed lines are measured on the authored source, so their note's marker column is measured there too. */
function authoredLabelColumn(lexer: Lexer, defLineIndex: number, defLineRaw: string, label: string, fallback: number): number {
  const authored = authoredSourceLine(lexer, lexer.lineNumber(defLineIndex)) ?? defLineRaw
  const at = authored.indexOf(`[^${label}]`)
  return at < 0 ? fallback : sourceColumnAt(authored, at)
}

/** The note keeps an invisible line at its marker column or in its body (§17 L3, carve#5288). */
function atNoteMarker(column: number, markerColumn: number): boolean {
  return column === markerColumn || column >= markerColumn + FOOTNOTE_BODY_COLUMN
}

/** A follower's column after the quote prefixes left of `markerColumn`; a `>` at that column is its own block. */
function followerColumnFrom(line: string, markerColumn: number): number {
  let index = 0
  for (;;) {
    while (line[index] === ' ' || line[index] === '\t') index++
    if (line[index] !== '>' || sourceColumnAt(line, index) >= markerColumn) return sourceColumnAt(line, index)
    index++
  }
}

function losingPlusMarker(lexer: Lexer, defLineIndex: number, label: string, markerBody: string): boolean {
  if (!lexer.footnoteKeys.has(normalizeRefLabel(label))) return false
  const body = markerBody.trim()
  if (body === '+') return true
  // The ownership pass respells a refused `+` as `%%`; the authored line still shows it.
  const authored = authoredSourceLine(lexer, lexer.lineNumber(defLineIndex)) ?? ''
  return body === '%%' && /\]:[ \t]+\+[ \t]*$/.test(authored)
}

function consumeSameColumnLosingPlus(
  lexer: Lexer, defLineIndex: number, label: string, defLineRaw: string, firstBlockAttached: boolean,
): void {
  if (firstBlockAttached) return
  // Read authored lines by source line: a transparent comment line is gone from the lexer's own view.
  const firstAuthored = authoredSourceLine(lexer, lexer.lineNumber(defLineIndex)) ?? defLineRaw
  if (!/\]:[ \t]+\+[ \t]*$/.test(firstAuthored)) return
  for (let next = lexer.peek(); next !== undefined; next = lexer.peek()) {
    const duplicate = RE_FOOTNOTE_DEF.exec(next.trimStart())
    const nextAuthored = authoredSourceLine(lexer, lexer.lineNumber(lexer.pos)) ?? next
    if (duplicate === null || normalizeRefLabel(duplicate[1]!) !== normalizeRefLabel(label) ||
        !/\]:[ \t]+\+[ \t]*$/.test(nextAuthored) ||
        sourceColumn(firstAuthored) !== sourceColumn(nextAuthored)) break
    lexer.losingFootnoteLines.add(lexer.lineNumber(lexer.pos))
    lexer.consume()
  }
}

/** A same-label note nested in this body was read first, and loses to this one. */
function dropNestedSameKeyNote(lexer: Lexer, nested: string | undefined, label: string): void {
  if (nested === undefined) return
  for (const line of lexer.footnoteDefLines.get(nested) ?? []) lexer.losingFootnoteLines.add(line)
  if (nested === label) return
  lexer.footnoteDefs.delete(nested)
  lexer.footnoteDefPos.delete(nested)
  lexer.footnoteDefLines.delete(nested)
}

/**
 * A refused marker-line `+` whose invisible lead ends in a losing duplicate `+`:
 * the index after that lead when the next visible line reaches the note's body
 * column, else -1. That follower belongs to this note (PART 9R R2, carve#5482).
 */
function losingPlusLeadEnd(lexer: Lexer, label: string, markerColumn: number, quoteDepth: number): number {
  const labels = new Set([normalizeRefLabel(label)])
  let losing = false
  let otherLabel = false
  let laterPlus = false
  let index = lexer.pos
  for (let line = lexer.lineAt(index); line !== undefined && !isBlankLine(line); line = lexer.lineAt(index)) {
    const source = authoredSourceLine(lexer, lexer.lineNumber(index)) ?? line
    if (sourceColumn(source, quoteDepth) !== markerColumn) break
    const note = RE_FOOTNOTE_DEF.exec(line.trimStart())
    if (note === null) {
      if (!RE_COMMENT_LINE.test(line.trimStart())) break
      index++
      continue
    }
    const key = normalizeRefLabel(note[1]!)
    const plus = /\]:[ \t]+\+[ \t]*$/.test(source)
    losing = plus && (labels.has(key) || lexer.footnoteKeys.has(key))
    if (!labels.has(key) || !plus) otherLabel = true
    if (plus && !losing) laterPlus = true
    labels.add(key)
    index++
    if (!plus) while (lexer.lineAt(index) !== undefined && skippedNoteBodyLine(lexer.lineAt(index)!)) index++
  }
  // Same-label losers alone are read away by `consumeSameColumnLosingPlus`.
  if (!losing || !otherLabel) return -1
  let next = index
  while (lexer.lineAt(next) !== undefined && isBlankLine(lexer.lineAt(next)!)) next++
  // Past a blank, a winning `+` later in the lead offers the follower itself (carve#5528).
  if (laterPlus && next > index) return -1
  const line = lexer.lineAt(next)
  if (line === undefined || RE_FOOTNOTE_DEF.test(line.trimStart())) return -1
  const source = (lexer.rootLines ?? lexer.lines)[lexer.lineNumber(next) - 1] ?? line
  return quotePrefixDepth(source) >= quoteDepth && sourceColumn(source, quoteDepth) >= markerColumn + FOOTNOTE_BODY_COLUMN
    ? index : -1
}

/**
 * Move a refused marker-line `+` note's losing lead into its body, so the
 * follower is read there. Reports whether the lead holds this note's own label.
 */
function takeLosingPlusLead(
  lexer: Lexer, defLineIndex: number, label: string, attached: boolean, markerBody: string, hostLine: string | undefined,
  authoredBodyColumn: number | undefined, markerColumn: number,
  body: { lines: string[]; sources: (string | undefined)[]; numbers: number[] },
): boolean {
  if (attached || markerBody.trim() !== '%%' || hostLine === undefined ||
      !/\]:[ \t]+\+[ \t]*$/.test(authoredSourceLine(lexer, lexer.lineNumber(defLineIndex)) ?? '')) return false
  const leadEnd = losingPlusLeadEnd(lexer, label,
    authoredBodyColumn === undefined ? markerColumn : authoredBodyColumn - FOOTNOTE_BODY_COLUMN, quotePrefixDepth(hostLine))
  if (leadEnd === -1) return false
  let ownLabel = false
  body.lines[0] = ''
  body.sources[0] = undefined
  while (lexer.pos < leadEnd) {
    const note = RE_FOOTNOTE_DEF.exec(lexer.peek()!.trimStart())
    if (note !== null && normalizeRefLabel(note[1]!) === normalizeRefLabel(label)) ownLabel = true
    body.lines.push(lexer.peek()!.trimStart())
    body.sources.push(lexer.peek())
    body.numbers.push(lexer.lineNumber(lexer.pos))
    lexer.consume()
  }
  return ownLabel
}

/** Parse a note body; a duplicate of its label taken from the lead loses there, as it does outside. */
function parseNoteBody(
  lexer: Lexer, hooks: FootnoteHooks, sub: Lexer, key: string, label: string, ownLabelInLead: boolean, keyedBefore: boolean,
): BlockNode[] {
  const leadKey = ownLabelInLead && !keyedBefore
  if (leadKey) lexer.footnoteKeys.set(key, label)
  try {
    return hooks.parseBlocks(sub, 0)
  } finally {
    if (leadKey) lexer.footnoteKeys.delete(key)
  }
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
  // A losing duplicate's `+` takes nothing: the block below is read without it (carve#5474).
  if (losingPlusMarker(lexer, defLineIndex, label, m[2]!)) {
    lexer.losingFootnoteLines.add(lexer.lineNumber(defLineIndex))
    return null
  }
  const authoredLines = (lexer.documentRoot ?? lexer).authoredLines
  const firstFenceEligible = rewrittenPlusStartsFence(authoredLines, lexer.lineNumber(defLineIndex), m[2]!)
  let firstFenceRun: string | undefined
  let earlierClaim = false
  if (authoredLines !== undefined) {
    for (let line = lexer.lineNumber(defLineIndex) - 2; line >= 0 && !isBlankLine(authoredLines[line]!); line--) {
      const prior = /\[\^([^\]]+)\]:[ \t]+\+[ \t]*$/.exec(authoredLines[line]!)
      if (prior !== null && normalizeRefLabel(prior[1]!) !== normalizeRefLabel(label)) { earlierClaim = true; break }
    }
  }
  const refusedMarker = earlierClaim && m[2]!.trim() === '%%' && hooks.isClaimedMarker(lexer.lineNumber(defLineIndex))
  const bodyLines = [m[2]!]
  const bodyFenceClosers = openFenceScanner()
  const bodyLineNumbers = [lexer.lineNumber(defLineIndex)]
  // The source line each collected line came from, and which of them were
  // buffered blanks. `restoreVerbatimBlanks` reads both after the rebase.
  const bodySourceLines: (string | undefined)[] = [defLineRaw]
  const virtualOrigins = new Map<number, StrippedLineOrigin>()
  const bufferedBlanks = new Set<number>()
  const pendingBlankRun = new ContainerBlankBuffer()
  let attachmentEnd = -1
  // An attached container left a descendant fence open, so a blank after it is that fence's payload.
  let nestedFenceOpen = false
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
  const noteSpanScan = { ...newCommentSpanScan(), markerOwners: true }
  let nestedNoteSpan: { run: number, column: number, state: object } | undefined
  const lazyState = verbatimOnlyLazyState()
  // A fence an attached block left open still holds its payload.
  const trackAttached = (attached: string[]): void => {
    const lastRun = new Map<number, number>()
    attached.forEach((line, k) => { const run = commentFenceRun(line); if (run !== undefined) lastRun.set(run, k) })
    attached.forEach((a, k) => trackItemLazyState(a, lazyState, true,
      (width) => (lastRun.get(width) ?? -1) > k || commentBlockHasCloser(lexer, width),
      { whitespace: leadingWhitespace(a), descendantFrames: true, terminatorFree: false }))
  }
  // A marker-line `+` attaches only a visible block at the note's authored
  // marker column. Definitions with their own bodies are siblings; document
  // definitions and comments may be skipped when finding the next block.
  let firstBlockAttached = false
  let follower: string | undefined
  let passedNotes: PassedNote[] = []
  const passedNoteState: { body: PassedNote | undefined; blanks: number[]; nextNonblank: number } =
    { body: undefined, blanks: [], nextNonblank: -1 }
  if (/^\+[ \t]*$/.test(m[2]!)) {
    let followerIndex = lexer.pos
    follower = lexer.lineAt(followerIndex)
    let skippedClaimedNote = false
    const noteQuoteDepth = quotePrefixDepth(authoredLine ?? defLineRaw)
    const authoredMarkerColumn = authoredBodyColumn === undefined ? markerColumn : authoredBodyColumn - FOOTNOTE_BODY_COLUMN
    const claimedMarkerColumn = authoredLabelColumn(lexer, defLineIndex, defLineRaw, label, authoredMarkerColumn)
    while (follower !== undefined && !isBlankLine(follower)) {
      const skippedNote = RE_FOOTNOTE_DEF.exec(follower.trimStart())
      const claimedNote = skippedNote !== null && normalizeRefLabel(skippedNote[1]!) !== normalizeRefLabel(label) &&
        hooks.isConsumedMarker(lexer.lineNumber(followerIndex))
      const source = (lexer.rootLines ?? lexer.lines)[lexer.lineNumber(followerIndex) - 1] ?? follower
      const claimedLine = skippedClaimedNote || claimedNote
      const atMarker = claimedLine
        ? atNoteMarker(authoredPayloadAt(lexer, followerIndex, follower).column, claimedMarkerColumn)
        : atNoteMarker(sourceColumn(source, noteQuoteDepth), authoredMarkerColumn)
      if (!atMarker || !((lexer.atDocumentLevel && (isLinkDefLine(follower.trimStart()) || RE_ABBR_DEF.test(follower.trimStart()))) ||
          RE_FOOTNOTE_DEF.test(follower.trimStart()) ||
          isBlockAttributeLine(follower.trimStart()) ||
          RE_COMMENT_LINE.test(follower.trimStart()))) break
      // A skipped note definition takes its body along: lines up to a blank or a block opener (CARVE-P9-067, carve#5034).
      if (skippedNote !== null && !claimedNote) {
        for (let body = lexer.lineAt(followerIndex + 1); body !== undefined && skippedNoteBodyLine(body); body = lexer.lineAt(++followerIndex + 1));
      }
      if (claimedNote) skippedClaimedNote = true
      follower = lexer.lineAt(++followerIndex)
    }
    const followerSource = follower === undefined ? undefined
      : (lexer.rootLines ?? lexer.lines)[lexer.lineNumber(followerIndex) - 1] ?? follower
    const followerAuthored = follower === undefined ? undefined : authoredPayloadAt(lexer, followerIndex, follower)
    const canAttachFirstBlock = follower !== undefined && !isBlankLine(follower) &&
      followerSource !== undefined && quotePrefixDepth(skippedClaimedNote ? followerAuthored!.line : followerSource) >= noteQuoteDepth &&
      (skippedClaimedNote ? followerColumnFrom(followerAuthored!.line, claimedMarkerColumn) === claimedMarkerColumn
        : sourceColumn(followerSource, noteQuoteDepth) === authoredMarkerColumn) &&
      !RE_FOOTNOTE_DEF.test(follower.trimStart())
    if (canAttachFirstBlock) {
      // An attached paragraph ends at an opener that reaches the body column.
      const attachedParagraph = !lineOpensItemBlock(follower!.trimStart())
      const visibleLeadIsList = attachedLeadIsList(lexer)
      const listFence = visibleLeadIsList ? attachedListFenceBoundary(indentColumns(follower!)) : undefined
      const visibleLeadIsLineBlock = attachedStartsWithLineBlock([follower!])
      const noteBodyColumn = markerColumn + FOOTNOTE_BODY_COLUMN
      const { lines: attached, lineNumbers: attachedLineNumbers } = hooks.collectAttachedBlock(
        lexer,
        (a) => {
          const held = listFence?.(a)
          if (held !== undefined) return held
          return isBlankLine(a) || /^\+[ \t]*$/.test(a) ||
          (attachedParagraph && indentColumns(a) >= noteBodyColumn && startsInterruptingBlock(lexer, a.trimStart(), false)) ||
          // A list marker ends an attached block that is no list; the body then opens or closes at it (PART 0 S3, carve#4860).
          (!visibleLeadIsList && !visibleLeadIsLineBlock && isListMarkerLine(a.trimStart()))
        },
        0, true, true, 0, false, 0, 0, indentColumns(follower!) + 1,
      )
      // A block at the note's body column ends the pulled paragraph, as in a description (CARVE-P0-011, carve#5421).
      const quoteEnd = attachedQuoteEnd(attached)
      let cut = quoteEnd < attached.length ? quoteEnd : pulledParagraphBlockCut(attached, noteBodyColumn)
      if (skippedClaimedNote && attachedParagraph) {
        const firstVisible = attachedLineNumbers.indexOf(lexer.lineNumber(followerIndex))
        for (let index = firstVisible + 1; firstVisible >= 0 && index < attached.length; index++) {
          const line = attached[index]!.trimStart()
          if (startsInterruptingBlock(lexer, line, false) || isListMarkerLine(line) || RE_COMMENT_LINE.test(line)) {
            cut = cut < 0 ? index : Math.min(cut, index)
            break
          }
        }
      }
      if (cut > 0) {
        lexer.pos -= attached.length - cut
        attached.length = cut
        attachedLineNumbers.length = cut
      }
      firstBlockAttached = true
      bodyLines[0] = ''
      bodySourceLines[0] = undefined
      for (const a of attached) {
        bodyLines.push(a)
        bodySourceLines.push(a)
      }
      bodyLineNumbers.push(...attachedLineNumbers)
      rebaseAttachedCodeCloser(attached, bodyLines)
      // A definition in the invisible lead keeps its own continuation even
      // when this note reaches past it to attach the following block.
      passedNotes = passedNotesInAttachment(lexer, attached, attachedLineNumbers, label)
      trackAttached(attached)
      // An unclosed fence or colon the marker-line `+` took ends at its first blank (PART 0 S1, carve#5404).
      nestedFenceOpen = nestedAttachedFenceOpen(attached, bodyLines)
      for (const closer of plusBlockClosers(lexer, attached, bodyLines, bodyFenceClosers, noteBodyColumn)) {
        const parentIndex = lexer.pos - 1
        virtualOrigins.set(bodyLines.length, {
          text: closer, parentIndex, prefix: (lexer.lineAt(parentIndex) ?? '').length, virtual: true,
        })
        bodyLines.push(closer)
        bodyLineNumbers.push(attachedLineNumbers.at(-1)!)
        bodySourceLines.push(undefined)
        trackItemLazyState(closer, lazyState)
      }
      // A separating blank after this attached block belongs outside its fence.
      attachmentEnd = bodyLines.length
    }
  }
  const ownLabelInLead = takeLosingPlusLead(lexer, defLineIndex, label, firstBlockAttached, m[2]!, authoredLine,
    authoredBodyColumn, markerColumn, { lines: bodyLines, sources: bodySourceLines, numbers: bodyLineNumbers })
  // A same-key `+` encountered before the first attached block loses its own
  // attachment, but its marker still separates the winner from the following
  // body. Leave the follower to the ordinary column-based note collector.
  consumeSameColumnLosingPlus(lexer, defLineIndex, label, defLineRaw, firstBlockAttached)
  if (!firstBlockAttached) {
    // A fence behind an item marker on the note's line is no paragraph (CARVE-P0-013, PART 0 S4).
    const trackLead = (lead: string): void => {
      trackItemLazyState(lead, lazyState, true, run => commentCloserAhead(lexer, run, defLineIndex),
        isListMarkerLine(lead.trimStart())
          ? { whitespace: leadingWhitespace(lead), descendantFrames: true, terminatorFree: false }
          : undefined)
      const behindMarker = markerFreeContent(lead)
      if (behindMarker !== lead.trimStart() && opensCodeFence(behindMarker)) trackItemLazyState(behindMarker, lazyState)
    }
    trackLead(m[2]!)
    // A span on a nested note's marker line is that note's, so a line below its body ends it (PART 0 S1).
    let column = m[0].length - m[2]!.length
    for (let nested = RE_FOOTNOTE_DEF.exec(m[2]!); nested !== null; nested = RE_FOOTNOTE_DEF.exec(nested[2]!)) {
      trackLead(nested[2]!)
      const run = commentFenceRun(nested[2]!)
      if (run !== undefined && lazyState.opaque?.kind === 'comment') nestedNoteSpan = { run, column, state: lazyState.opaque }
      column += nested[0].length - nested[2]!.length
    }
  }
  const nestedMarkerHasText = RE_FOOTNOTE_DEF.exec(m[2]!)?.[2]?.trim() !== '' && RE_FOOTNOTE_DEF.test(m[2]!)
  const wrappedAttributeAtBody = { value: false, until: -1 }
  const attrSource = { column: -1 }
  const belowColumnCommentFence = new Set<number>()
  let commentFenceUntil = 0
  runIndentationContainer(
    lexer, 'footnote', markerColumn, bodyColumn, quotePrefixDepth(authoredLine ?? defLineRaw), (admission) => {
    const ln = admission.line
    if (collectPassedNoteLine(lexer, admission, passedNotes, passedNoteState, bodyColumn)) return 'continue'
    if (refusedMarker && admission.kind === 'below') return 'stop'
    if (lexer.separatingAbbreviations?.has(lexer.pos)) return 'stop'
    const sourceLine = admission.sourceLine
    if (abbreviationLeavesNote(lexer, lazyState, sourceLine, authoredBodyColumn, ln)) return 'stop'
    if (sourceOwnerLeavesNote(lexer, sourceLine, authoredBodyColumn, pendingBlankRun.count, ln, bodyColumn, defLineIndex)) return 'stop'
    if (wrappedAttributeLeavesNote(lexer, admission, sourceLine, authoredBodyColumn, lazyState, wrappedAttributeAtBody)) return 'stop'
    // A line leaving a nested note's body is still that note's lazy line (carve#3885),
    // and a line inside a fence this body opened is its payload.
    if (admission.kind !== 'content' && lazyState.opaque === null &&
        nestedSourceBodyLeft(lexer, defLineIndex, nestedSourceBodyColumn, sourceLine) &&
        !(pendingBlankRun.count === 0 && nestedParagraphStillOpen() &&
          !startsInterruptingBlock(lexer, ln, false, false, ln === ln.trimStart()))) return 'stop'
    if (admission.kind === 'blank') {
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
      let attachedCodeCloser: RegExp | undefined
      const attachedList = attachedLeadIsList(lexer)
      const { lines: attached, lineNumbers: attachedLineNumbers } = hooks.collectAttachedBlock(
        lexer,
        (a) => {
          if (isBlankLine(a) || /^\+[ \t]*$/.test(a)) return true
          if (attachedCodeCloser !== undefined) {
            if (attachedCodeCloser.test(a)) attachedCodeCloser = undefined
            return false
          }
          if (opensCodeFence(a)) attachedCodeCloser = fenceCloseRe(/^(`{3,}|~{3,})/.exec(a)![1]!)
          return RE_FOOTNOTE_DEF.test(a) || (!attachedList && isListMarkerLine(a.trimStart()))
        },
        0,
        true,
      )
      if (attached.length > 0) {
        for (const closer of bodyFenceClosers(bodyLines)) {
          bodyLines.push(closer)
          bodyLineNumbers.push(plusLineNumber)
          bodySourceLines.push(undefined)
          trackItemLazyState(closer, lazyState)
        }
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
        attachmentEnd = bodyLines.length
        nestedFenceOpen = nestedAttachedFenceOpen(attached, bodyLines)
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
    const captionHostBlock = attachedCaptionTakesHostBlock(lexer, bodyLines, firstBlockAttached, admission, authoredBodyColumn)
    if (reachesAuthoredNoteBody(lexer, admission, authoredBodyColumn, defLineIndex) || captionHostBlock) {
      for (let k = 0; k < pendingBlankRun.count; k++) {
        bufferedBlanks.add(bodyLines.length)
        bodyLines.push('')
        bodyLineNumbers.push(pendingBlankRun.lineNumbers[k]!)
        bodySourceLines.push(pendingBlankRun.lines[k])
      }
      pendingBlankRun.clear()
      // The quote ownership pass can add a synthetic margin to the first
      // follower of a marker-line plus. Measure the note body's margin from
      // the authored line so that this extra padding does not turn a fence
      // opener into paragraph text.
      const bodyContent = noteBodyContent(lexer, admission, bodyColumn, authoredBodyColumn, captionHostBlock,
        firstFenceEligible, firstFenceRun, bodyLines.length === 1)
      const content = bodyContent.content
      firstFenceRun = bodyContent.fenceRun
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
      if (nestedNoteSpan !== undefined && lazyState.opaque === nestedNoteSpan.state && content.trim() !== '' &&
          indentColumns(content) < nestedNoteSpan.column && !RE_COMMENT_LINE.test(content)) {
        lazyState.opaque = null
        nestedNoteSpan = undefined
      }
      const framedBelow = framesBelowNoteLine(admission, sourceLine, authoredBodyColumn, content)
      const captionFollower = attachedCaptionKeepsIndent(lexer, bodyLines, firstBlockAttached, ln)
      bodyLines.push(captionHostBlock ? content : captionFollower ? ln : framedBelow ? LAZY_FRAME + content.trimStart()
        : rebasedRunContent(lexer, lazyState, attrSource, content, admission.sourceColumn, authoredBodyColumn))
      // The tracker reads an overindented opener at its local zero; a line-block line keeps its column for the closer.
      // A line in a body item's frame keeps its indentation, so the item's own blocks open there.
      const tracked = framedBelow ? 'text' : lazyState.ownedColumn >= 0 && indentColumns(content) >= lazyState.ownedColumn
        ? content : lazyState.literalColon !== undefined ? content : trackedFootnoteContent(content)
      trackAuthoredAttributeRun(lexer, lazyState, attrSource, () => trackItemLazyState(tracked, lazyState, true, (run) => commentBlockHasCloser(lexer, run),
        framedBelow ? undefined : { whitespace: leadingWhitespace(tracked), descendantFrames: true, terminatorFree: false,
          payloadFenceCloser: marker => payloadCloserInBody(lexer, marker, bodyColumn),
          quotePayloadFenceCloser: marker => quotedPayloadCloserAhead(lexer, marker, lexer.pos, quoteMissesOf(lexer)) }))
      // A fence in a description's marker-line body opens no lazy paragraph.
      // Only a line reaching this note's body column can replace its paragraph claim (carve#4627).
      const description = RE_DEFLIST_DEF.exec(content)
      if (!framedBelow && lexer.hostBody !== 'description' && sourceLine !== undefined && authoredBodyColumn !== undefined &&
          sourceColumn(sourceLine) >= authoredBodyColumn && RE_DEFLIST_TERM.test(bodyLines[0] ?? '') &&
          description !== null && opensCodeFence(description[2]!)) lazyState.lazyFoldable = false
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
      // A blank inside the span is payload too (§28, carve#4996).
      RE_COMMENT_LINE.test(ln) &&
      bodyHoldsClosableCommentSpan(bodyLines, noteSpanScan, run => commentCloserAhead(lexer, run, lexer.pos - 1))
    ) {
      for (let k = 0; k < pendingBlankRun.count; k++) {
        bufferedBlanks.add(bodyLines.length)
        bodyLines.push('')
        bodyLineNumbers.push(pendingBlankRun.lineNumbers[k]!)
        bodySourceLines.push(pendingBlankRun.lines[k])
      }
      pendingBlankRun.clear()
      // ONE COLUMN of the authored indentation is kept, as the list collector
      // keeps it, so the body's own parse cannot read a delimiter written below
      // its column back as an authored column-0 one. A delimiter already AT
      // column 0 keeps it (markup-carve/carve-js#1623).
      const flush = ln.replace(/^[ \t]+/, '')
      bodyLines.push(flush === ln ? ln : ' ' + flush)
      bodyLineNumbers.push(lexer.lineNumber(lexer.pos))
      bodySourceLines.push(ln)
      // Payload in a marker-line span is invisible. It cannot revive the note's
      // paragraph after the marker ended it, even when the exact closer is below
      // this note's body column (carve#5314).
      clearParagraphAfterMarkerSpan(noteSpanScan, bodyLines, lazyState)
      lexer.consume()
    } else if (isListMarkerLine(ln.trimStart())) {
      // A list marker that misses a marker body closes it (PART 0 S3, carve#4860), ending a span the body holds (S1).
      return 'stop'
    } else if ((lazyState.opaque === null || lazyState.opaque.kind === 'code') && RE_COMMENT_LINE.test(ln.trimStart())) {
      // A comment below the body's column closes the body (carve#3885), and the code fence it holds.
      return 'stop'
    } else if (!verseStanzaOpen(lazyState) &&
        bodyHoldsClosableCommentSpan(bodyLines, noteSpanScan, run => commentCloserAhead(lexer, run, lexer.pos - 1))) {
      // A line below the body's column ends the span the body holds and leaves no paragraph to continue (PART 0 S1).
      return 'stop'
    } else if (
      pendingBlankRun.count === 0 && !RE_FOOTNOTE_DEF.test(ln) &&
      (((canTakePlainLazyLine(lazyState) || captionParagraphOpen(bodyLines, lazyState, ln)) &&
        !captionLeavesMarkerLineNote(lexer, defLineIndex, ln)) ||
        markerLineCommentContinuesNote(lexer, defLineIndex, sourceLine, authoredBodyColumn, ln) ||
        ((nestedMarkerHasText && bodyLines.length > 1) && isRetainableLineComment(lexer, ln))) &&
      (isRetainableLineComment(lexer, ln) ||
        (lexer.hostBody === 'list' && sourceLine !== undefined && authoredBodyColumn !== undefined &&
          sourceColumn(sourceLine) < authoredBodyColumn - FOOTNOTE_BODY_COLUMN &&
          isListMarkerLine(sourceQuoteBody(sourceLine).trimStart())) ||
        !startsInterruptingBlock(lexer, ln, false, false, ln === ln.trimStart())) &&
      !isLiteralLineBlockListMarker(lazyState, ln)
    ) {
      const content = ln
      // A wrapped attribute opened in the body takes its later lines at any column (PART 9 §15 A5).
      const attributeLine = lazyState.attrRun != null && lazyState.opaque === null
      // An open definition term takes below-column lines as term text, even
      // when a line would otherwise look like a block opener.
      const framedBelow = !attributeLine && framesBelowNoteLine(admission, sourceLine, authoredBodyColumn, content)
      bodyLines.push(attributeLine ? content.trimStart() : lazyState.inDefList === 'term' || framedBelow
        ? LAZY_FRAME + content.trimStart() : content)
      bodyLineNumbers.push(lexer.lineNumber(lexer.pos))
      bodySourceLines.push(ln)
      if (!attributeLine) lexer.itemLazyLines.add(lexer.lineNumber(lexer.pos))
      authoredAttributeShallow(lexer, lazyState, attrSource)
      trackItemLazyState(trackedLiteralLine(content, framedBelow), lazyState, false,
        (run) => commentBlockHasCloser(lexer, run))
      lexer.consume()
    } else {
      return 'stop'
    }
    return 'continue'
    })
  // A blank reaches every frame, so it is the open fence's content (corpus 291, carve#4033).
  // A `+` attachment ends at the blank instead.
  const endsOnPlusAttachment = attachmentEnd === bodyLines.length && !nestedFenceOpen
  if (pendingBlankRun.count > 0 && !endsOnPlusAttachment && bodyEndsInOpenCodeFence(bodyLines)) {
    for (let k = 0; k < pendingBlankRun.count; k++) {
      bufferedBlanks.add(bodyLines.length)
      bodyLines.push('')
      bodyLineNumbers.push(pendingBlankRun.lineNumbers[k]!)
      bodySourceLines.push(pendingBlankRun.lines[k])
    }
  }
  // A losing duplicate is still read: only its own label loses, and a definition
  // nested in its body is collected like any other (PART 9R R2).
  const wins = !lexer.footnoteDefs.has(label)
  const key = normalizeRefLabel(label)
  const keyedBefore = lexer.footnoteKeys.has(key)
  {
    // A recognized opener at or beyond the note's minimum column establishes
    // its authored column as a local base (carve#1729). The collector has
    // already removed the fixed two-column body margin.
    // A fence taken below the column keeps that column, as a `%%` line does.
    if (bodyLines.length !== 1 || !/^[A-Za-z][A-Za-z0-9 .]*$/.test(bodyLines[0]!)) {
      restoreVerbatimBlanks(bodyLines, bodySourceLines, bufferedBlanks, (index) =>
        index === 0 ? bodyColumn : indentColumns(bodySourceLines[index] ?? ''),
      )
    }
    if (!firstBlockAttached) measureLeadItemFromSource(bodyLines, defLineRaw.length - m[2]!.length - bodyColumn)
    alignFirstFenceAtItsBase(bodyLines, authoredLines, lexer.lineNumber(defLineIndex))
    const sub = nestedSubLexer(lexer, bodyLines, defLineIndex, bodyLineNumbers, virtualOrigins)
    sub.sublistsCarryAuthoredBase = true
    sub.inFootnoteBody = true
    // A marker body opens a list at its column 0 as an item does (PART 0 S3, carve#4860).
    sub.markerOpensSublist = true
    sub.hostBody = 'footnote'
    sub.hostBodyRoot = 'footnote'
    const body = bodyLines.length === 1 && trimEndSpaceTab(bodyLines[0] ?? '') === '{empty}' ? []
      : parseNoteBody(lexer, hooks, sub, key, label, ownLabelInLead, keyedBefore)
    const ownLines: number[] = []
    for (let index = defLineIndex; index < lexer.pos; index++) ownLines.push(lexer.lineNumber(index))
    if (!wins) {
      for (const line of ownLines) lexer.losingFootnoteLines.add(line)
      return null
    }
    dropNestedSameKeyNote(lexer, keyedBefore ? (lexer.footnoteDefs.has(label) ? label : undefined) : lexer.footnoteKeys.get(key), label)
    lexer.footnoteDefLines.set(label, ownLines)
    lexer.footnoteDefs.set(label, body)
    if (!keyedBefore) lexer.footnoteKeys.set(key, label)
    registerPassedNoteBodies(lexer, passedNotes, defLineIndex, hooks)
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
      } else if (body.length === 0) {
        // Collected definitions can consume continuation lines while leaving
        // this note empty. Those lines belong to the hoisted sibling, so an
        // empty note ends with the source on its own opening line.
        pos.endLine = pos.startLine
        pos.endColumn = lexer.lineStartColumn(defLineIndex) + defLine.length
        pos.endOffset = lexer.lineOffset(defLineIndex) + defLine.length
      }
      lexer.footnoteDefPos.set(label, pos)
    }
  }
  return null
}
