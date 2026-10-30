import type { Attrs, BlockNode, BlockQuote, CodeBlock, DefinitionItem, DefinitionList, Document, HeadingLevel, InlineNode, List, ListItem, Paragraph, Position, Table, TableRow, TaskState } from '../ast.js'
import type { InlineSource } from '../parse.js'
import { GENERATED_CONTENT_KINDS } from '../ast.js'
import { utf8ByteLength } from '../extension/abbr-budget.js'
import { dropPositions, toCodepointPositions } from '../source/source-positions.js'
import { normalizeRefLabel } from '../label-key.js'
import { promoteBlockImages } from '../heading/heading-ids.js'
import { promoteCitationDefinitions } from '../extension/citations.js'
import { mergeAttrs } from '../extension/attribute-merge.js'
import { parseAttrs, unescapeAttrValue } from '../extension/attribute-parser.js'
import { dropTrailingWhitespace, readCaptionText, trackItemLazyState, verbatimOnlyLazyState, type ItemLazyState } from './block/parse-block-boundaries.js'
import { MAX_NESTING_DEPTH, commentLineContent } from './block/parse-block-scan-core.js'
import { markAboveContentColumn } from './block/paragraph-indent.js'
import { RE_CAPTION, RE_COMMENT_BLOCK_ANY, blockQuoteParagraphClaimOpen, isBlockImageLine, trackBlockQuoteLazyState } from './block/parse-quote-core.js'
import { trimNonNbsp } from '../trim-non-nbsp.js'
import { parseDirective } from '../include-directive.js'
import { replaceLoneSurrogates } from '../well-formed.js'
import { InlineParseSession } from './inline/parse-inline-session.js'
import { inlineSource } from './inline/parse-inline-core.js'
import type { LinkDef } from './inline/inline-resolution.js'
import { olKindOf, olStartOf, sourceColumnAt, type OlKind } from './list/parse-item-core.js'
import { RE_ADMONITION_OPEN, RE_BLOCKQUOTE, RE_DIV_OPEN, RE_FENCE, RE_HARDBREAKS_OPEN, RE_HEADING, RE_HR, RE_LINE_BLOCK_OPEN, RE_ORDERED, RE_QUOTE_BLOCK_OPEN, RE_RAW_FENCE, RE_VALID_ADMONITION_OPEN, consumeLooseKey, deriveTableMetadata, extractItemAttr, isTableRow, matchLinkDef, parseBlockAttributeRun, probeBlockAttributes } from './parse-prepass-core.js'
import { Lexer, isBlankLine } from './parse-lexer.js'
import { ownLines, type LazyOwner, type LineEvent, type OwnerEnd } from './block/block-ownership.js'
import type { DanglingBlockAttributes, ParseOptions, UnclosedCodeFence, UnclosedContainer } from './block/parse-block-scan-core.js'
import { commentBlockHasCloser, isFigureGroupOpener, parseCommentBlock, parseLineBlockWithHelpers, parseRawBlock, parseTableBlock } from './parse-core.js'
import { delimitedTable, setDelimitedPayloadLines } from '../table/delimited-table.js'
import { verbatimSpanEnd } from './inline/parse-brackets.js'

/**
 * An isolated block-cursor experiment. It deliberately fails on syntax that has
 * not been migrated; production entry points never invoke it.
 */
export class UnsupportedCursorSyntax extends Error {}

interface SourceLine { text: string; start: number; number: number; baseColumn?: number; lead?: number;
  spanEndColumn?: number; lazyText?: boolean; wrappedAttr?: boolean;
  termWrapCut?: number;
  ownedDefinition?: boolean; ownedDefinitionBody?: boolean; descriptionRootLink?: boolean;
  ownedFirstBlock?: boolean; ownedListComment?: boolean; refusedPlus?: boolean;
  quoteResume?: boolean; quotedAttachedSibling?: boolean; claimedQuoteLazy?: boolean; ownedLazy?: boolean; noteLazy?: boolean; quoteListLazy?: boolean; quoteParaLazy?: boolean; plusAfterPara?: boolean; abbrText?: boolean; cutAfterMarker?: boolean; event?: LineEvent; ownerEnd?: OwnerEnd; textFence?: boolean }
type ContainerKind = 'root' | 'quote' | 'colon' | 'list' | 'definition'
interface ContainerOwner {
  readonly kind: ContainerKind
  readonly inList: boolean
  readonly inFigureGroup?: boolean
  readonly allowEmptyFence?: boolean
  readonly allowUnclosedFence?: boolean
  readonly fenceBoundary?: SourceLine
  readonly listRootPrefix?: number
  readonly colonCloser?: number
  readonly parent?: ContainerOwner
}
const ROOT_OWNER: ContainerOwner = { kind: 'root', inList: false }

function childOwner(parent: ContainerOwner, kind: Exclude<ContainerKind, 'root'>,
  allowEmptyFence = false, allowUnclosedFence = false, fenceBoundary?: SourceLine,
  listRootPrefix = parent.listRootPrefix): ContainerOwner {
  return { kind, inList: kind === 'list' || parent.inList, parent,
    ...(parent.inFigureGroup ? { inFigureGroup: true } : {}),
    ...(allowEmptyFence ? { allowEmptyFence } : {}),
    ...(allowUnclosedFence ? { allowUnclosedFence } : {}),
    ...(fenceBoundary ? { fenceBoundary } : {}),
    ...(listRootPrefix === undefined ? {} : { listRootPrefix }) }
}

function figureGroupOwner(owner: ContainerOwner, figureGroup: boolean): ContainerOwner {
  return figureGroup ? { ...owner, inFigureGroup: true } : owner
}

function hasContainerOwner(owner: ContainerOwner, kind: ContainerKind): boolean {
  for (let current: ContainerOwner | undefined = owner; current; current = current.parent) {
    if (current.kind === kind) return true
  }
  return false
}

function unsupportedReferencesColon(colon: RegExpExecArray): boolean {
  return colon[2] === 'references' && colon[1] !== ':::'
}

class Cursor {
  at = 0
  wrappedDefinitionAttributeMissUntil?: Map<number, number>
  sharedLexer?: Lexer
  rootLexer: Lexer | undefined
  simpleRootListDefinitions?: Map<number, NonNullable<ReturnType<typeof rootLinkDef>>>
  plusAttachRisk = false
  plusAdjacentRisk = false
  unclosedFenceAfterText = false
  noteLazyFenceEnd = 0
  strippedBom = false
  fenceColumnMemo?: Map<string, { from: number; to: number; found: boolean }>
  constructor(readonly lines: SourceLine[], readonly rootSource?: string,
    readonly owner: ContainerOwner = ROOT_OWNER,
    readonly physicalLines: SourceLine[] = lines,
    simpleListDefinitions?: Map<number, NonNullable<ReturnType<typeof rootLinkDef>>>) {
    if (simpleListDefinitions) this.simpleRootListDefinitions = simpleListDefinitions
  }
  peek(n = 0): SourceLine | undefined { return this.lines[this.at + n] }
  take(): SourceLine { return this.lines[this.at++]! }
}

function lexerForCursor(cursor: Cursor): Lexer {
  if (cursor.sharedLexer) return cursor.sharedLexer
  const lexer = cursor.rootSource ? cursor.rootLexer ?? new Lexer(cursor.rootSource) :
    new Lexer(cursor.lines.map((line) => line.text))
  if (cursor.rootSource) {
    const raw = lexer.lines
    if (cursor.strippedBom || cursor.lines.some((line, index) => line.text !== raw[index])) {
      lexer.lines = cursor.lines.map((line) => line.text)
      lexer.sourceOffsetMap = cursor.lines.map((line) => line.start)
      lexer.linePrefixWidths = cursor.lines.map((_line, index) => index === 0 && cursor.strippedBom ? 1 : 0)
      cursor.lines.forEach((line, index) => {
        const lead = (line.baseColumn ?? 1) - 1 - (index === 0 && cursor.strippedBom ? 1 : 0)
        if (lead > 0) (lexer.ownershipLeads ??= new Map()).set(index, lead)
      })
    }
  } else if (!cursor.rootSource) {
    lexer.nested = true
    lexer.sourceLineMap = cursor.lines.map((line) => line.number)
    lexer.sourceOffsetMap = cursor.lines.map((line) => line.start)
    lexer.linePrefixWidths = cursor.lines.map((line) => (line.baseColumn ?? 1) - 1)
  }
  cursor.sharedLexer = lexer
  return lexer
}

function scanLines(source: string): SourceLine[] {
  const lines: SourceLine[] = []
  let start = 0
  if (!source.includes('\r')) {
    let end: number
    while ((end = source.indexOf('\n', start)) !== -1) {
      lines.push({ text: source.slice(start, end), start, number: lines.length + 1 })
      start = end + 1
    }
    if (start < source.length || lines.length === 0) {
      lines.push({ text: source.slice(start), start, number: lines.length + 1 })
    }
    return lines
  }
  let nextLF = source.indexOf('\n', start)
  let nextCR = source.indexOf('\r', start)
  while (nextLF !== -1 || nextCR !== -1) {
    const end = nextCR !== -1 && (nextLF === -1 || nextCR < nextLF) ? nextCR : nextLF
    lines.push({ text: source.slice(start, end), start, number: lines.length + 1 })
    start = end + 1
    if (end === nextCR && source.charCodeAt(start) === 10) start++
    if (nextLF !== -1 && nextLF < start) nextLF = source.indexOf('\n', start)
    if (nextCR !== -1 && nextCR < start) nextCR = source.indexOf('\r', start)
  }
  if (start < source.length || lines.length === 0) {
    lines.push({ text: source.slice(start), start, number: lines.length + 1 })
  }
  return lines
}

interface LineShift { lead: number; cuts: { at: number; removed: number }[] }

/**
 * Run main's rule A ownership walk over the lines. A leading cut moves the line start; a cut after a
 * container marker is returned and applied to the finished positions by `shiftCutPositions`.
 */
function applyOwnership(lines: SourceLine[], source: string, knownFrom?: number): Map<number, LineShift> {
  const shifts = new Map<number, LineShift>()
  let from = knownFrom ?? 0
  if (knownFrom === undefined && source.startsWith('---')) {
    const lexer = new Lexer(lines.map((line) => line.text))
    lexer.consumeFrontmatter()
    from = lexer.pos
  }
  const owned = ownLines(lines.map((line) => line.text), from)
  for (const [index, cuts] of owned.cuts) {
    const line = lines[index]!
    let lead = 0
    if (cuts[0]!.at === 0) {
      lead = cuts.shift()!.removed
      line.start += lead
      line.baseColumn = (line.baseColumn ?? 1) + lead
      line.lead = lead
    }
    if (cuts.length) {
      shifts.set(line.number, { lead, cuts })
      line.cutAfterMarker = true
    }
  }
  for (let i = from; i < lines.length; i++) lines[i]!.text = owned.lines[i]!
  for (const [index, owner] of owned.lazy) {
    lines[index]!.ownedLazy = true
    if (quoteListLazyOwner(owner) || quotePlusHostLazyOwner(owner, owned.lines[index - 1], owned.lines[index]!)) {
      lines[index]!.quoteListLazy = true
    }
    if (colonNoteLazyOwner(owner)) lines[index]!.noteLazy = true
    if (quoteParagraphLazyOwner(owner)) lines[index]!.quoteParaLazy = true
  }
  for (const [index, event] of owned.events) lines[index]!.event = event
  for (const index of owned.refusedPlus) lines[index]!.refusedPlus = true
  for (const [index, end] of owned.ownerEnds) lines[index]!.ownerEnd = end
  for (const index of owned.textFences) lines[index]!.textFence = true
  for (const index of owned.plusAfterPara) lines[index]!.plusAfterPara = true
  for (const index of owned.abbrText) {
    if (/^ +\S/.test(owned.lines[index - 1]!)) throw new UnsupportedCursorSyntax('abbreviation line after a nested list paragraph')
    lines[index]!.abbrText = true
  }
  if (owned.lazy.size === 0) return shifts
  // A lazy line under a quote or footnote paragraph is owned by the walk; the cursor does not model that owner.
  let plain: PlainQuoteDoc | undefined
  const lazyBefore: number[] = []
  for (let index = from; index < lines.length; index++) {
    if (!owned.lazy.has(index)) continue
    lazyBefore[index] = index > from && owned.lazy.has(index - 1) ? lazyBefore[index - 1]! : index - 1
  }
  const noteRuns = quoteNoteRunIndex(owned.lines, from)
  const blankRunStart: number[] = []
  const listNoteCache = new Map<number, boolean>()
  const footnoteRunCache = new Map<number, boolean>()
  for (let index = from; index < lines.length; index++) {
    blankRunStart[index] = index > from && owned.lines[index - 1] !== '' ? blankRunStart[index - 1]! : index
  }
  for (const index of owned.lazy.keys()) {
    const before = lazyBefore[index]!
    const previous = owned.lines[before]!
    if (before < index - 1 && /^> *[^> ]/.test(previous) && lazyMarkerRun(owned.lines, before + 1, index)) {
      throw new UnsupportedCursorSyntax('chained lazy list-marker lines under a quote paragraph')
    }
    if (!quoteNoteLazyRun(owned.lines, before, index, from, noteRuns) && (!lines[index]!.quoteListLazy && owned.quoteMarkers.has(before) &&
        !simpleQuoteListLazy(owned.lines, before, index, from, plain ??= plainQuoteDoc(owned.lines)) ||
        owned.quoteNotes.has(before) ||
        /^\S/.test(owned.lines[index]!) && footnoteRunAbove(owned.lines, before, from, footnoteRunCache) &&
          !listNoteLazyRun(owned.lines, index, blankRunStart, listNoteCache))) {
      throw new UnsupportedCursorSyntax('lazy line owned by a quote or footnote')
    }
  }
  return shifts
}

interface PlainQuoteDoc { plain: boolean; lastListLine: number }

/** Document-level facts for `simpleQuoteListLazy`, computed once per parse. */
function plainQuoteDoc(lines: string[]): PlainQuoteDoc {
  let plain = true
  let lastListLine = -1
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (line.includes('\t') || /^ *(?:[:%[`~#{|]|>[ >]*>|>[^ ])/.test(line)) plain = false
    if (/^(?:[-*]|[0-9]+[.)]) /.test(line)) lastListLine = i
  }
  return { plain, lastListLine }
}

/** A lazy line under a single quote's list paragraph, in a document of plain quote, list and text lines. */
function simpleQuoteListLazy(lines: string[], marker: number, index: number, from: number, doc: PlainQuoteDoc): boolean {
  const quoted = lines[marker]!.replace(/^( *(?:[-*]|[0-9]+[.)]) )+/, '')
  const lazy = lines[index]!
  const next = lines[index + 1] ?? ''
  return /^> (?:[-*]|[0-9]+\.) \S/.test(lines[marker]!) && !/^[ >]*>[ >]*>/.test(quoted) &&
    (marker === from || lines[marker - 1] === '') && doc.plain && doc.lastListLine <= marker &&
    !/^ \S/.test(lazy) && !/^ *>/.test(next) &&
    !(next !== '' && /^ *(?:(?:[-*]|[0-9]+[.)]) |\+$)/.test(lazy))
}

/** The walk keeps this lazy line in a paragraph that only quotes were missed for, reached from the document. */
function quoteParagraphLazyOwner(owner: LazyOwner): boolean {
  return owner.reached === 'doc' && owner.missed.length > 0 && owner.missed.every((kind) => kind === 'quote')
}

/** A flush-left lazy line the walk keeps in a footnote paragraph opened directly inside a column-0 colon container. */
function colonNoteLazyOwner(owner: LazyOwner): boolean {
  return owner.reached === 'colon' && owner.col === 0 && owner.missed.length === 1 && owner.missed[0] === 'note'
}

/** Every line in `from..to` is a list-marker line: the quote paragraph above keeps them all, the cursor would split it. */
function lazyMarkerRun(lines: string[], from: number, to: number): boolean {
  for (let i = from; i <= to; i++) if (!/^ *(?:[-*+]|[0-9]+[.)]) /.test(lines[i]!)) return false
  return true
}

/** A flush-left or one-column lazy line the walk keeps in the paragraph of a `+` quote hosted by a quoted item. */
function quotePlusHostLazyOwner(owner: LazyOwner, previous: string | undefined, text: string): boolean {
  return previous === '> - > +' && owner.reached === 'doc' && owner.col <= 1 && /^ ?\S/.test(text) &&
    owner.missed.join() === 'quote,item,quote'
}

/** A lazy line the walk keeps in one quote's list paragraph: only quotes and items missed, flush left or under a container. */
function quoteListLazyOwner(owner: LazyOwner): boolean {
  return owner.missed.every((kind) => kind === 'quote' || kind === 'item') &&
    owner.missed.filter((kind) => kind === 'quote').length === 1 &&
    owner.missed.includes('item') && (owner.reached === 'doc' ? owner.col === 0 : owner.reached === 'item' || owner.reached === 'quote')
}

/** A plain flush-left line that a root list item's own footnote paragraph keeps lazily. */
function listNoteLazyText(text: string): boolean {
  return text !== '' && text === text.trimStart() && plainQuoteText(text) &&
    !isBlockStart(text) && !listMarker(text) && !FOOTNOTE_DEF.test(text) && !/^\+$/.test(text)
}

/** The blank-free run at `index` is `- item`, an item-hosted plain `[^f]: note` and plain lines only: the note keeps the flush-left ones. */
function listNoteLazyRun(lines: string[], index: number, starts: number[],
  cache: Map<number, boolean>): boolean {
  const start = starts[index]!
  const cached = cache.get(start)
  if (cached !== undefined) return cached
  const item = /^[-*] (\S.*)$/.exec(lines[start] ?? '')
  const note = /^  \[\^[^\]]+\]: +(\S.*)$/.exec(lines[start + 1] ?? '')
  if (!item || !note || !plainQuoteText(item[1]!) || isBlockStart(item[1]!) ||
      !plainQuoteText(note[1]!) || isBlockStart(note[1]!)) {
    cache.set(start, false)
    return false
  }
  for (let i = start + 2; lines[i] !== undefined && lines[i] !== ''; i++) {
    const text = lines[i]!
    if (text.includes('\t') || !(listNoteLazyText(text) ||
        /^ {2}\S/.test(text) && listNoteLazyText(text.slice(2)))) {
      cache.set(start, false)
      return false
    }
  }
  cache.set(start, true)
  return true
}

/** The blank-free run is `- item`, an item-hosted `> [^f]: plain` and plain lines: the hoisted note keeps the lazy ones, the quote stays empty. */
type QuoteNoteRunIndex = { subBase: number[]; prefixBad: number[]; tailValid: boolean[] }

function quoteNoteRunIndex(lines: string[], from: number): QuoteNoteRunIndex {
  const subBase: number[] = []
  const prefixBad: number[] = [0]
  const tailValid: boolean[] = Array(lines.length + 1).fill(true)
  for (let index = 0; index < lines.length; index++) {
    const text = lines[index]!
    const valid = listNoteLazyText(text) || quotedNoteSubLine(text)
    subBase[index] = index > from && quotedNoteSubLine(text) ? subBase[index - 1]! : index
    prefixBad[index + 1] = prefixBad[index]! + (valid ? 0 : 1)
  }
  for (let index = lines.length - 1; index >= 0; index--) {
    const text = lines[index]!
    tailValid[index] = text === '' ||
      (listNoteLazyText(text) || /^  [-*] \S/.test(text) &&
        listNoteLazyText(text.slice(2).replace(/^[-*] /, ''))) && tailValid[index + 1]!
  }
  return { subBase, prefixBad, tailValid }
}

function quoteNoteLazyRun(lines: string[], note: number, index: number, from: number,
  runs: QuoteNoteRunIndex): boolean {
  if (note > from) note = runs.subBase[note]!
  if (note <= from || note >= index) return false
  const item = /^[-*] (?:> )?(\S.*)$/.exec(lines[note - 1] ?? '')
  const head = /^  > \[\^[^\]]+\]: +(\S.*)$/.exec(lines[note] ?? '')
  if (!item || !head || !plainQuoteText(item[1]!) || isBlockStart(item[1]!) ||
      !plainQuoteText(head[1]!) || isBlockStart(head[1]!) || (lines[note - 2] ?? '') !== '' && note - 2 >= from) return false
  return runs.prefixBad[index]! === runs.prefixBad[note + 1] && runs.tailValid[index]!
}

/** An indented continuation line of a quoted note: `>   - sub`. */
function quotedNoteSubLine(text: string): boolean {
  const sub = /^(?: {2})?>   (?:[-*] )?(\S.*)$/.exec(text)
  return sub !== null && plainQuoteText(sub[1]!) && !isBlockStart(sub[1]!)
}

function quotedPlainNoteHead(text: string): boolean {
  const note = /^> ?\[\^[^\]]+\]: +(\S.*)$/.exec(text)
  return note !== null && plainQuoteText(note[1]!) && !isBlockStart(note[1]!)
}

/** An indented or list-hosted footnote definition opens the blank-free run above `index`: the flush-left lazy line there belongs to its note. */
function footnoteRunAbove(lines: string[], index: number, from: number,
  cache: Map<number, boolean>): boolean {
  const cached = cache.get(index)
  if (cached !== undefined) return cached
  for (let i = index; i >= from && lines[i] !== ''; i--) {
    if (/^(?:[ \t>]*(?:[-*+]|[0-9]+[.)]) +|[ \t]+)\[\^[^\]]+\]:/.test(lines[i]!)) {
      cache.set(index, true)
      return true
    }
  }
  cache.set(index, false)
  return false
}

/** A `: text` definition line whose body is plain text: a below-column `%%` after it ends the list. */
function plainDefinitionLine(text: string): boolean {
  const body = /^: +[ \t]*([^ \t].*)$/.exec(text)?.[1]
  return body !== undefined && !/^\+[ \t]*$/.test(body) && !isBlockStart(body)
}

/** The plain definition line at `index` follows a `:: term` line through `: ` lines only. */
function termLedPlainDefinition(lines: SourceLine[], index: number): boolean {
  if (!plainDefinitionLine(lines[index]!.text)) return false
  let i = index - 1
  while (i >= 0 && /^: /.test(lines[i]!.text)) i--
  return i >= 0 && /^:: /.test(lines[i]!.text)
}

/** The line at `end` is a `%%` comment below the content column of the plain definition line above it. */
function belowColumnDescriptionComment(cursor: Cursor, end: number,
  commentOpeners: ReadonlySet<number> | undefined): boolean {
  if (end <= cursor.at) return false
  const text = cursor.lines[end]!.text
  const above = cursor.lines[end - 1]!.text
  const unmatchedFence = /^ *%%%/.test(text) &&
    !commentOpeners?.has(cursor.lines[end]!.start)
  if (!plainDefinitionLine(above) ||
      !(/^ *%%(?!%)/.test(text) || unmatchedFence)) return false
  return text.length - text.trimStart().length < /^: +[ \t]*/.exec(above)![0].length - 1
}

/** A column-0 `%%` line under a note or description body: whether the body keeps it depends on the owner's kind. */
function rejectColumnZeroCommentAfterBody(lines: SourceLine[]): void {
  for (let i = 1; i < lines.length; i++) {
    if (!/^%%(?!%)/.test(lines[i]!.text)) continue
    const previous = lines[i - 1]!.text
    if (/^: /.test(previous) && !termLedPlainDefinition(lines, i - 1)) {
      throw new UnsupportedCursorSyntax('column-0 comment after a container body')
    }
  }
}

const POSITION_KEYS = ['startLine', 'endLine', 'startColumn', 'endColumn', 'startOffset', 'endOffset'] as const

/** Move every position past a mid-line cut by the characters the cut removed from the source. */
function shiftCutPositions(node: unknown, shifts: Map<number, LineShift>, keepEnd = false): void {
  if (!shifts.size || !node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const child of node) shiftCutPositions(child, shifts)
    return
  }
  const record = node as Record<string, unknown>
  if (typeof record.startLine === 'number' && typeof record.endColumn === 'number') {
    const pos = record as { startLine: number; endLine: number; startColumn: number; endColumn: number;
      startOffset: number; endOffset: number }
    const shiftAt = (line: number, column: number): number => {
      const shift = shifts.get(line)
      if (!shift) return 0
      let moved = 0
      for (const cut of shift.cuts) if (cut.at <= column - 1 - shift.lead) moved += cut.removed
      return moved
    }
    const start = shiftAt(pos.startLine, pos.startColumn)
    const end = keepEnd ? 0 : shiftAt(pos.endLine, pos.endColumn)
    pos.startColumn += start
    pos.startOffset += start
    pos.endColumn += end
    pos.endOffset += end
    return
  }
  for (const key of Object.keys(record)) {
    if (!POSITION_KEYS.includes(key as typeof POSITION_KEYS[number])) {
      // main ends a link reference definition at the owned line, so its end is never moved back.
      shiftCutPositions(record[key], shifts, key === 'pos' && record.type === 'link_reference_definition')
    }
  }
}

function commentOpenersWithCloser(lines: SourceLine[]): Set<number> {
  const remainingRuns = new Map<number, number>()
  const openers = new Set<number>()
  for (const line of lines) {
    if (line.text[0] !== '%') continue
    const match = RE_COMMENT_BLOCK_ANY.exec(line.text)
    if (!match) continue
    const run = match[1]!.length
    remainingRuns.set(run, (remainingRuns.get(run) ?? 0) + 1)
  }
  let openRun: number | undefined
  for (const line of lines) {
    if (line.text[0] !== '%') continue
    const match = RE_COMMENT_BLOCK_ANY.exec(line.text)
    if (!match) continue
    const run = match[1]!.length
    const remaining = remainingRuns.get(run)! - 1
    remainingRuns.set(run, remaining)
    if (openRun !== undefined) {
      if (openRun === run) openRun = undefined
    } else if (remaining > 0) {
      openers.add(line.start)
      openRun = run
    }
  }
  return openers
}

function position(first: SourceLine, last: SourceLine, firstColumn = 1, lastColumn = last.text.length + 1): Position {
  return {
    startLine: first.number,
    endLine: last.number,
    startColumn: (first.baseColumn ?? 1) + firstColumn - 1,
    endColumn: (last.baseColumn ?? 1) + lastColumn - 1,
    startOffset: first.start + firstColumn - 1,
    endOffset: last.start + lastColumn - 1,
  }
}

function contentEndColumn(line: SourceLine): number {
  if (line.spanEndColumn !== undefined) return line.spanEndColumn
  let end = line.text.length
  while (end > 0 && (line.text.charCodeAt(end - 1) === 32 || line.text.charCodeAt(end - 1) === 9)) end--
  return end + 1
}

type ContentLine = { line: SourceLine; column: number; text: string }
const RE_PLAIN_CURSOR_TEXT = /^[A-Za-z0-9 .,;!?():\-]+$/
function plainCursorText(text: string): boolean {
  if (!RE_PLAIN_CURSOR_TEXT.test(text) || text.includes('..') || text.includes('--') ||
      /\((?:c|r|tm)\)/i.test(text)) return false
  const colon = text.indexOf(':')
  return colon === -1 || text.indexOf(':', colon + 1) === -1
}

function cursorContainerLabel(text: string): string {
  if (!text.includes('%%')) return text
  const nodes = new InlineParseSession().parseRefLabelInlines(text)
  const last = nodes.at(-1)
  if (last?.type !== 'comment' || last.block) return text
  const start = last.pos?.startOffset
  return start === undefined ? text : text.slice(0, start).replace(/ +$/, '')
}

type CursorDiagnostic =
  | { kind: 'dangling'; event: DanglingBlockAttributes }
  | { kind: 'fence'; event: UnclosedCodeFence }
  | { kind: 'invalid'; event: UnclosedContainer }
  | { kind: 'container'; event: UnclosedContainer }

class CursorInline extends InlineParseSession {
  // Image promotion only changes paragraphs whose first inline node is an image.
  hasLeadingImage = false
  readonly unresolvedReferences = new Set<string>()
  footnoteDefs?: Record<string, BlockNode[]>
  footnoteDefPos?: Record<string, Position>
  documentDefinitionNodes?: BlockNode[]
  diagnostics?: CursorDiagnostic[]
  rawLines?: string[]
  constructor(readonly linkDefinitions: Map<string, LinkDef>,
    readonly abbreviations: Map<string, string>,
    readonly positionless = false,
    readonly recordDanglingAttributes = false,
    readonly recordUnclosedCodeFences = false,
    readonly recordInvalidMetadata = false,
    readonly recordUnclosedContainers = false,
    quoteCharacters?: readonly [string, string, string, string]) {
    super()
    if (quoteCharacters) {
      this.activeQuoteCharacters = quoteCharacters
      this.quoteGlyphHasNul = quoteCharacters.some((glyph) => glyph.includes('\0'))
    }
    if (recordDanglingAttributes || recordUnclosedCodeFences || recordInvalidMetadata ||
        recordUnclosedContainers) this.diagnostics = []
  }
  tableInlines(text: string, source?: InlineSource, captionContext = false): InlineNode[] {
    const nodes = this.parseInline(text, this.abbreviations, this.linkDefinitions, source, captionContext)
    this.recordUnresolvedReferences(nodes)
    return nodes
  }
  lineBlockInlines(text: string, source?: InlineSource, captionContext = false): InlineNode[] {
    const previous = this.inLineBlock
    this.inLineBlock = true
    try {
      const nodes = this.parseInline(text, this.abbreviations, this.linkDefinitions, source, captionContext)
      this.recordUnresolvedReferences(nodes)
      return nodes
    } finally {
      this.inLineBlock = previous
    }
  }
  inlines(parts: ContentLine[], captionContext = false): InlineNode[] {
    const first = parts[0]!
    const multiLine = parts.length > 1
    if (parts.length >= 3 && !captionContext && this.abbreviations.size === 0 &&
        parts.every((part) => part.text.trim() === part.text && plainCursorText(part.text))) {
      const nodes: InlineNode[] = []
      for (let index = 0; index < parts.length; index++) {
        const part = parts[index]!
        if (index > 0) {
          const before = parts[index - 1]!
          nodes.push({ type: 'soft_break', pos: position(before.line, part.line,
            before.column + before.text.length, part.column) })
        }
        nodes.push({ type: 'text', value: part.text,
          pos: position(part.line, part.line, part.column, part.column + part.text.length) })
      }
      return nodes
    }
    const text = dropTrailingWhitespace(multiLine ? parts.map((part) => part.text).join('\n') : first.text)
    if (!multiLine && !captionContext && this.abbreviations.size === 0 && text.length > 0 &&
        plainCursorText(text)) {
      return [{ type: 'text', value: text,
        pos: position(first.line, first.line, first.column, first.column + text.length) }]
    }
    const lineAnchors = multiLine ? parts.map((part) => ({
      offset: part.line.start + part.column - 1,
      column: (part.line.baseColumn ?? 1) + part.column - 1, line: part.line.number,
    })) : undefined
    const nodes = this.parseInline(text, this.abbreviations, this.linkDefinitions, {
      anchored: true,
      baseOffset: first.line.start + first.column - 1,
      startLine: first.line.number,
      startColumn: (first.line.baseColumn ?? 1) + first.column - 1,
      ...(lineAnchors ? { lineAnchors } : {}),
    }, captionContext)
    this.recordUnresolvedReferences(nodes)
    if (nodes[0]?.type === 'image' || nodes[0]?.type === 'comment' &&
        nodes.find((node) => node.type !== 'comment')?.type === 'image') this.hasLeadingImage = true
    return nodes
  }
  private recordUnresolvedReferences(nodes: InlineNode[]): void {
    const pending = [...nodes]
    while (pending.length) {
      const node = pending.pop()!
      if ((node.type === 'link' || node.type === 'image') && node.ref &&
          !this.linkDefinitions.has(normalizeRefLabel(node.ref))) {
        this.unresolvedReferences.add(normalizeRefLabel(node.ref))
      }
      if ('children' in node && Array.isArray(node.children)) pending.push(...node.children)
    }
  }
}

function rejectLateLinkDefinition(inline: CursorInline, key: string): void {
  if (!inline.linkDefinitions.has(key) && inline.unresolvedReferences.has(key)) {
    throw new UnsupportedCursorSyntax('late link definition after an unresolved reference')
  }
}

function captureDiagnosticRawLines(inline: CursorInline, source: string): void {
  if (inline.recordUnclosedCodeFences || inline.recordUnclosedContainers ||
      inline.recordDanglingAttributes) {
    inline.rawLines = source.split(/\r\n|\n|\r/)
  }
}

function imageReferenceResolved(image: Extract<InlineNode, { type: 'image' }>, inline: CursorInline): boolean {
  return !image.ref || inline.linkDefinitions.has(normalizeRefLabel(image.ref))
}

const BULLET = /^([ \t]*)([-*]) +(.*)$/
function fenceOpen(line: string) {
  if (line[0] !== '`' && line[0] !== '~') return null
  const match = RE_FENCE.exec(line)
  if (!match) return null
  const headerRaw = match[4] ?? match[6]
  const labelRaw = match[5] ?? match[7] ?? match[8]
  return { marker: match[2]!, lang: match[3],
    header: headerRaw?.slice(1, -1), label: labelRaw?.slice(1, -1) }
}
const COLON_OPEN = /^(:{3,})(?: +([A-Za-z0-9_][A-Za-z0-9_-]*))?(?: +"([^"]+)")?(?: *\[([A-Za-z0-9_/-]+)\])?[ \t]*$/
const BREAK = /^(?:-{3,}|\*{3,}|_{3,})[ \t]*$/
function rootLinkDef(line: string) {
  return line.startsWith('[') && (!line.startsWith('[^') || line[2] === ']') ? matchLinkDef(line) : null
}

function footnoteBodyLinkDef(line: SourceLine, previous: SourceLine | undefined,
  next: SourceLine | undefined) {
  return line.number === 2 && previous?.number === 1 && FOOTNOTE_DEF.test(previous.text) &&
    /^ {2,}\[/.test(line.text) && (!next || isBlankLine(next.text)) ?
    rootLinkDef(line.text.trimStart()) : null
}

function boundedAdjacentDefinitionTail(lines: SourceLine[], lineNumber: number,
  prefix: string): boolean {
  const next = lines[lineNumber]
  if (!next) return true
  if (next.text !== '') return !next.text.startsWith(prefix)
  let at = lineNumber
  while (lines[at]?.text === '') at++
  return !lines[at]?.text.startsWith(prefix + ' ')
}
const FOOTNOTE_DEF = /^\[\^([^\]]+)\]: +(.*)$/
const ABBR_DEF = /^\*\[([A-Za-z0-9]+)\]: +(?![ \t]*$)([^]+)$/u
const LINE_COMMENT = /^[ \t]*%%/

function closesFence(line: string, marker: string): boolean {
  let count = 0
  while (line[count] === marker[0]) count++
  return count >= marker.length && /^[ \t]*$/.test(line.slice(count))
}

function closedFenceEnd(cursor: Cursor, openerOffset = 0): number | undefined {
  const opener = cursor.peek(openerOffset)
  const marker = opener ? fenceOpen(opener.text)?.marker : undefined
  if (!marker) return undefined
  for (let offset = openerOffset + 1; cursor.peek(offset); offset++) {
    if (closesFence(cursor.peek(offset)!.text, marker)) return offset
  }
  return undefined
}

function recordFirstBlockFenceHandoff(inline: CursorInline, ownerLine: SourceLine,
  body: readonly SourceLine[]): void {
  if (!inline.recordUnclosedCodeFences) return
  const index = body.findIndex((line) => fenceOpen(line.text) !== null)
  if (index < 0) return
  const fence = fenceOpen(body[index]!.text)!
  if (body.slice(index + 1).some((line) => closesFence(line.text, fence.marker))) return
  const prior = body[index - 1] ?? ownerLine
  inline.diagnostics!.push({ kind: 'fence', event: { line: prior.number, column: 1,
    marker: fence.marker, endLine: body[index]!.number + 1, reason: 'document' } })
}

function attributedListMarker(line: string) {
  let indent = 0
  while (line[indent] === ' ') indent++
  const marker = line[indent]
  if ((marker !== '-' && marker !== '*' && marker !== '.') || line[indent + 1] !== '{') return undefined
  const start = indent + 1
  let quote: '"' | "'" | undefined
  for (let i = start + 1; i < line.length; i++) {
    const ch = line[i]
    if (ch === '\\') { i++; continue }
    if (quote) { if (ch === quote) quote = undefined; continue }
    if (ch === '"' || ch === "'") { quote = ch; continue }
    if (ch !== '}') continue
    const attrs = parseBlockAttributeRun(line.slice(start, i + 1))
    const rest = /^ +(.*)$/.exec(line.slice(i + 1))
    if (!attrs || !rest) return undefined
    return { indent, authoredIndent: indent, ordered: marker === '.',
      raw: marker === '.' ? '' : undefined, delim: marker === '.' ? '.' as const : undefined,
      bullet: marker === '.' ? undefined : marker as '-' | '*',
      width: i + 1 + rest[0].length - rest[1]!.length, continuationWidth: indent + 2,
      content: rest[1]!, attrs }
  }
  return undefined
}

function listMarker(line: string) {
  const attributed = attributedListMarker(line)
  if (attributed) return attributed
  const itemAttr = line.includes('{') ? extractItemAttr(line) : null
  const ordered = RE_ORDERED.exec(itemAttr?.stripped ?? line)
  if (ordered && !ordered[1]!.includes('\t')) {
    const markerWidth = ordered[0].length - ordered[4]!.length
    const attrWidth = itemAttr ? line.length - itemAttr.stripped.length : 0
    return { indent: sourceColumnAt(ordered[1]!, ordered[1]!.length),
      authoredIndent: ordered[1]!.length, ordered: true, raw: ordered[2]!,
      delim: ordered[3] as '.' | ')', bullet: undefined,
      width: markerWidth + attrWidth,
      ...(itemAttr ? { continuationWidth: markerWidth,
        ...(itemAttr.attrs ? { attrs: itemAttr.attrs } : {}) } : {}),
      content: ordered[4]! }
  }
  const bullet = BULLET.exec(itemAttr?.stripped ?? line)
  if (!bullet) return undefined
  const markerWidth = bullet[0].length - bullet[3]!.length
  const attrWidth = itemAttr ? line.length - itemAttr.stripped.length : 0
  return { indent: sourceColumnAt(bullet[1]!, bullet[1]!.length),
    authoredIndent: bullet[1]!.length, ordered: false, raw: undefined,
    delim: undefined, bullet: bullet[2] as '-' | '*',
    width: markerWidth + attrWidth,
    ...(itemAttr ? { continuationWidth: markerWidth,
      ...(itemAttr.attrs ? { attrs: itemAttr.attrs } : {}) } : {}),
    content: bullet[3]! }
}

function isBlockStart(line: string): boolean {
  return (line[0] === '#' && RE_HEADING.test(line)) ||
    ((line[0] === '`' || line[0] === '~') && RE_FENCE.test(line)) ||
    RE_RAW_FENCE.test(line) ||
    BREAK.test(line) || !!listMarker(line) ||
    (line[0] === '>' && RE_BLOCKQUOTE.test(line)) ||
    (line[0] === '|' && isTableRow(line)) || line.startsWith('::') ||
    rootLinkDef(line) !== null || FOOTNOTE_DEF.test(line) || ABBR_DEF.test(line) || LINE_COMMENT.test(line) ||
    (line.startsWith('{') && parseBlockAttributeRun(line) !== null)
}

function interruptsParagraph(line: string, owner: ContainerOwner): boolean {
  const marker = listMarker(line)
  if (marker) return owner.kind === 'list' && marker.indent === 0
  if (owner.kind !== 'root' && ABBR_DEF.test(line)) return false
  return isBlockStart(line)
}

function interruptsParagraphAtCursor(cursor: Cursor): boolean {
  if (cursor.peek()?.wrappedAttr) return true
  const line = cursor.peek()!.text
  if (cursor.owner.kind === 'root' && line[0] === '{' && !parseBlockAttributeRun(line)) {
    const lexer = lexerForCursor(cursor)
    lexer.pos = cursor.at
    if (probeBlockAttributes(lexer)) return true
  }
  if (cursor.owner.kind === 'quote' && cursor.owner.inList &&
      cursor.physicalLines[cursor.peek()!.number - 1]?.textFence) return false
  return interruptsParagraph(line, cursor.owner)
}

function takeDefinitionQuoteTail(cursor: Cursor, body: SourceLine[]): SourceLine | undefined {
  if (cursor.owner.kind !== 'definition' || body.length < 2 ||
      !/^\+ [^+]/.test(body.at(-1)!.text)) return undefined
  const line = cursor.peek()
  if (!line || !plainQuoteText(line.text) ||
      cursor.peek(1) && !isBlankLine(cursor.peek(1)!.text)) return undefined
  body.push(cursor.take())
  return line
}

function wrappedQuoteAttributeTail(body: SourceLine[]): boolean {
  const lastBodyText = body.at(-1)?.text
  return body.length >= 2 && lastBodyText?.charCodeAt(lastBodyText.length - 1) === 125 &&
    lastBodyText.trim() === '}' && body.at(-2)!.text.trimStart().startsWith('{') &&
    !!probeBlockAttributes(new Lexer([body.at(-2)!.text.trimStart(), lastBodyText.trimStart()]))
}

function quotedListPlainRun(cursor: Cursor, body: SourceLine[], line: SourceLine,
  active: boolean): boolean {
  if (!active || cursor.owner.kind !== 'list' || !listMarker(body[0]?.text ?? '') ||
      body.at(-1)?.number !== line.number - 1) return false
  return true
}

function quotedListSibling(cursor: Cursor, body: SourceLine[], line: SourceLine,
  active: boolean): boolean {
  if (!quotedListPlainRun(cursor, body, line, active)) return false
  const first = listMarker(body[0]!.text)!
  const next = listMarker(line.text)
  return next !== undefined && first.bullet !== undefined &&
    first.bullet === next.bullet && first.indent === next.indent
}

function quotedListPlainFollower(cursor: Cursor, body: SourceLine[], line: SourceLine,
  active: boolean): boolean {
  return quotedListPlainRun(cursor, body, line, active) && plainQuoteText(line.text)
}

function takeNestedQuoteListLazyLine(cursor: Cursor, body: SourceLine[]): SourceLine | undefined {
  if (cursor.owner.kind !== 'root' &&
      (cursor.owner.kind !== 'quote' || cursor.owner.parent?.kind !== 'root')) return undefined
  const first = listMarker(body[0]?.text ?? '')
  const line = cursor.peek()
  if (!first || first.indent !== 0 || !plainQuoteText(first.content) || !line ||
      body.at(-1)?.number !== line.number - 1 ||
      !line.text.startsWith(' '.repeat(first.width)) ||
      isBlankLine(line.text) ||
      line.text.slice(first.width).trimStart().startsWith('%%')) return undefined
  const owned = { ...cursor.take(), lazyText: true }
  body.push(owned)
  return owned
}

function takeQuoteNestedItemDescription(cursor: Cursor, body: SourceLine[]): SourceLine | undefined {
  const line = cursor.peek()
  const event = line?.event
  if (cursor.owner.kind !== 'root' || !line || !event?.lazy || event.kind !== 'text' ||
      event.reached !== 'doc' || event.missed.join(',') !== 'quote,item,item' ||
      !/^: +\S/.test(line.text) || body.at(-1)?.number !== line.number - 1 ||
      listMarker(body[0]?.text ?? '') === undefined ||
      listMarker(body.at(-1)?.text ?? '') === undefined) return undefined
  const owned = { ...cursor.take(), lazyText: true }
  body.push(owned)
  return owned
}

function quotedListFirstBlockFollower(cursor: Cursor, body: SourceLine[],
  line: SourceLine): boolean {
  return body.at(-1)?.number === line.number - 1 &&
    quoteListEndsInPlus(body.at(-1)!.text) &&
    (RE_HEADING.test(line.text) || isTableRow(line.text)) &&
    (!cursor.peek(1) || isBlankLine(cursor.peek(1)!.text))
}

function indentedLiteralAbbreviation(text: string): boolean {
  return text.startsWith(' ') && ABBR_DEF.test(text.trimStart())
}

function indentedLiteralColon(text: string): boolean {
  const content = text.trimStart()
  return text.startsWith(' ') && content.startsWith(':::') && !COLON_OPEN.test(content)
}

function mayContinueQuoteLazily(follower: string | undefined, innerLast: string | undefined): boolean {
  if (!follower || !innerLast || follower.startsWith('^ ')) return false
  let finalBlock = innerLast.trimStart()
  while (finalBlock.startsWith('>')) {
    finalBlock = finalBlock.slice(finalBlock[1] === ' ' ? 2 : 1).trimStart()
  }
  if (finalBlock === '' || (isBlockStart(finalBlock) && !indentedLiteralAbbreviation(innerLast) &&
      !finalBlock.startsWith(':: ') &&
      !/^ (?:\[|\{)/.test(innerLast))) return false
  return !interruptsParagraph(follower, ROOT_OWNER)
}

function finalNestedQuoteLazyListMarker(cursor: Cursor, body: SourceLine[],
  line: SourceLine): boolean {
  return cursor.owner.kind === 'root' &&
    body[0]?.text.startsWith('>') === true && body.at(-1)?.lazyText === true &&
    listMarker(body.at(-1)?.text ?? '') !== undefined &&
    listMarker(line.text) !== undefined &&
    (!cursor.peek(1) || isBlankLine(cursor.peek(1)!.text))
}

function continueQuoteLazily(cursor: Cursor, body: SourceLine[], line: SourceLine): boolean {
  return nestedQuoteParagraphLazyHandoff(cursor, body, line) ||
    repeatedNestedQuotedLiteralMarker(cursor.owner, body, line) ||
    finalNestedQuoteLazyListMarker(cursor, body, line) ||
    mayContinueQuoteLazily(line.text, body.at(-1)?.text)
}

function nestedQuoteParagraphLazyHandoff(cursor: Cursor, body: SourceLine[],
  line: SourceLine): boolean {
  const previous = body.at(-1)
  const prior = previous?.event
  const current = line.event
  return cursor.owner.kind === 'root' &&
    (body[0]?.text.startsWith('>') === true || body.at(-2)?.text.startsWith('>') === true) &&
    previous?.number === line.number - 1 && /^>[-*] [^ ]/.test(previous.text) &&
    prior?.lazy === true && prior.kind === 'text' && prior.reached === 'quote' &&
    prior.missed.length === 1 && prior.missed[0] === 'quote' &&
    current?.lazy === true && current.kind === 'text' && current.reached === 'doc' &&
    current.missed.length === 2 && current.missed.every((kind) => kind === 'quote') &&
    plainQuoteText(line.text)
}

function repeatedQuotedLiteralParagraphMarker(cursor: Cursor, body: SourceLine[],
  line: SourceLine): boolean {
  const previous = body.at(-1)
  const prior = previous?.event
  const current = line.event
  return cursor.owner.kind === 'quote' && body.length >= 2 &&
    plainQuoteText(body[0]!.text) && previous?.number === line.number - 1 &&
    quotedLiteralListMarker(previous.text) && quotedLiteralListMarker(line.text) &&
    prior?.lazy === true && prior.kind === 'text' && prior.reached === 'quote' &&
    prior.missed.length === 1 && prior.missed[0] === 'quote' &&
    current?.lazy === true && current.kind === 'text' && current.reached === 'quote' &&
    current.missed.length === 1 && current.missed[0] === 'quote'
}

function repeatedNestedQuotedLiteralMarker(owner: ContainerOwner, body: SourceLine[],
  line: SourceLine): boolean {
  const previous = body.at(-1)
  const prior = previous?.event
  const current = line.event
  return owner.kind === 'quote' && previous?.lazyText === true &&
    previous.number === line.number - 1 && quotedLiteralListMarker(previous.text) &&
    quotedLiteralListMarker(line.text) && prior?.kind === 'text' && prior.lazy &&
    prior.reached === 'quote' && prior.missed.length === 1 && prior.missed[0] === 'quote' &&
    current?.kind === 'text' && current.lazy && current.reached === 'quote' &&
    current.missed.length === 1 && current.missed[0] === 'quote'
}

function plainQuoteText(line: string): boolean {
  return /^(?:[\p{L}\p{N}]|\\#)/u.test(line) && !line.includes('\t') && !isBlockStart(line)
}

function plainPlusText(line: string): boolean {
  return line.startsWith('+ ') && line.length > 2 && !isBlockStart(line)
}

function nestedQuoteParagraphText(text: string): boolean {
  let inner = text
  while (inner.startsWith('>')) inner = inner.slice(inner[1] === ' ' ? 2 : 1)
  return plainQuoteText(inner)
}

function listFirstBlockParagraphText(text: string): boolean {
  if (text.startsWith('>')) return nestedQuoteParagraphText(text)
  const marker = listMarker(text)
  return marker !== undefined && nestedQuoteParagraphText(marker.content)
}

function quoteListLazyLine(body: SourceLine[], line: SourceLine, prefix: number):
  { line: SourceLine; prefix: number } {
  if (body[0]?.text.charCodeAt(0) !== 62) return { line, prefix }
  const previous = body.at(-1)
  if (previous?.number !== line.number - 1 ||
      !(nestedQuoteParagraphText(previous.text) || plainQuoteText(previous.text))) {
    return { line, prefix }
  }
  const text = line.text.trimStart()
  const indent = line.text.length - text.length
  const first = text.charCodeAt(0)
  const lazyBlock = (indent === 1 || indent >= 3) &&
    (first === 35 && RE_HEADING.test(text) || first === 62 && RE_BLOCKQUOTE.test(text) ||
      (first === 45 || first === 42 || first === 43 || first >= 48 && first <= 57) &&
        listMarker(text))
  if (!plainQuoteText(text) && !lazyBlock) return { line, prefix }
  return { line: { ...line, lazyText: true },
    prefix: Math.max(prefix, indent) }
}

function quoteEndsInPlus(text: string): boolean {
  while (text.startsWith('>')) text = text.slice(text[1] === ' ' ? 2 : 1)
  return text === '+'
}

function quoteListEndsInPlus(text: string): boolean {
  const marker = listMarker(text)
  return marker !== undefined && quoteEndsInPlus(marker.content)
}

function quoteListMarkerPrefix(line: SourceLine,
  marker: NonNullable<ReturnType<typeof listMarker>>,
  frame: { contentColumn?: number; body: SourceLine[] }): number | undefined {
  const previous = frame.body.at(-1)
  const tail = previous?.text ?? ''
  if (previous?.number !== line.number - 1) return undefined
  if (!tail.startsWith('>') || (!quoteEndsInPlus(tail) && !nestedQuoteParagraphText(tail))) {
    return undefined
  }
  if (line.lazyText) return 0
  if (frame.contentColumn !== undefined && marker.indent === frame.contentColumn - 1) {
    return frame.contentColumn - 1
  }
  if (frame.contentColumn !== undefined && frame.body[0]?.text.startsWith('>') &&
      marker.indent >= frame.contentColumn + 1) return marker.indent
  return undefined
}

function quotedListSiblingPrefix(line: SourceLine,
  marker: NonNullable<ReturnType<typeof listMarker>>,
  frame: { contentColumn?: number; body: SourceLine[] }): number | undefined {
  if (frame.contentColumn === undefined ||
      marker.indent !== frame.contentColumn - 1) return undefined
  const last = frame.body.at(-1)
  let opener = frame.body.length - 1
  while (opener > 0 && plainQuoteText(frame.body[opener]!.text) &&
      frame.body[opener - 1]!.number === frame.body[opener]!.number - 1) opener--
  const first = frame.body[opener]
  if (!first) return undefined
  if (last?.number !== line.number - 1 || !RE_BLOCKQUOTE.test(first.text)) return undefined
  const prefix = first.text.startsWith('> ') ? 2 : 1
  const nested = listMarker(first.text.slice(prefix))
  return nested?.bullet !== undefined && nested.bullet === marker.bullet ? marker.indent : undefined
}

function quoteOwnedListMarker(cursor: Cursor, line: SourceLine,
  marker: NonNullable<ReturnType<typeof listMarker>>,
  frame: ListCursorFrame):
  { line: SourceLine; prefix: number; rootLazy: boolean } | undefined {
  if (line.quotedAttachedSibling) frame.list.tight = false
  if (line.lazyText && cursor.owner.kind === 'quote') {
    return { line, prefix: 0, rootLazy: true }
  }
  const prefix = quotedListSiblingPrefix(line, marker, frame) ??
    quoteListMarkerPrefix(line, marker, frame)
  return prefix === undefined ? undefined :
    { line: { ...line, lazyText: true }, prefix, rootLazy: false }
}

function quotedFencePayload(text: string, depth: number): string | undefined {
  let rest = text
  for (let level = 0; level < depth; level++) {
    if (rest[0] !== '>') return undefined
    rest = rest.slice(rest[1] === ' ' ? 2 : 1)
  }
  return rest
}

function quotedFenceOpener(text: string): { marker: string; depth: number } | undefined {
  let depth = 0
  let rest = text
  while (rest[0] === '>') {
    rest = rest.slice(rest[1] === ' ' ? 2 : 1)
    depth++
  }
  const marker = fenceOpen(rest)?.marker
  return marker ? { marker, depth } : undefined
}

function listContinuationPrefix(line: string, base: number, body?: SourceLine[],
  closedQuoteFence = false, next?: string): number {
  const firstBlockText = body?.[0]?.text
  if (firstBlockText && listMarker(firstBlockText)) return base
  let column = base
  while (line[column] === ' ') column++
  const block = line.slice(column)
  if (block.startsWith('>') && body && openColonRun(body, true) !== undefined) return base
  const previousLine = body?.at(-1)
  const previous = previousLine?.text ?? ''
  if (block.startsWith('>') && previous === '' && body?.at(-2)?.ownedDefinitionBody &&
      (next === undefined || isBlankLine(next))) return base
  return column > base && (!closedQuoteFence && block.startsWith('>') ||
    RE_HEADING.test(block) || BREAK.test(previous) && fenceOpen(block) !== null ||
    body && previous === '' && /^:: +/.test(block) ||
    previousLine?.ownedDefinition && column === (previousLine.baseColumn ?? 1) - 1 &&
      /^: +/.test(block)) ? column : base
}

function tabbedListPrefix(line: string, contentColumn: number): number | undefined {
  if (!line.includes('\t')) return undefined
  let column = 0
  for (let index = 0; index < line.length; index++) {
    const char = line[index]
    if (char !== ' ' && char !== '\t') break
    column += char === '\t' ? 4 - column % 4 : 1
    if (column >= contentColumn - 1) return index + 1
  }
  return undefined
}

function reachableListPrefix(line: string, contentColumn: number): number | undefined {
  const spaces = ' '.repeat(contentColumn - 1)
  return line.startsWith(spaces) ? spaces.length : tabbedListPrefix(line, contentColumn)
}

function openColonRun(body: SourceLine[], quoted: boolean): number | undefined {
  let first = body[0]?.text
  if (!first) return undefined
  if (quoted) {
    if (!first.startsWith('>')) return undefined
    first = first.slice(first[1] === ' ' ? 2 : 1)
  }
  const opener = COLON_OPEN.exec(first)
  if (!opener) return undefined
  const closer = new RegExp(`^:{${opener[1]!.length}}[ \\t]*$`)
  for (let index = 1; index < body.length; index++) {
    let text = body[index]!.text
    if (quoted && text.startsWith('>')) text = text.slice(text[1] === ' ' ? 2 : 1)
    if (closer.test(text)) return undefined
  }
  return opener[1]!.length
}

function openDegradedQuoteCommentParagraph(body: SourceLine[], quoted: boolean): boolean {
  if (body.length < 2) return false
  const content = (text: string): string => quoted && text.startsWith('>') ?
    text.slice(text[1] === ' ' ? 2 : 1) : text
  return content(body[0]!.text) === '%%%' &&
    plainQuoteText(content(body.at(-1)!.text))
}

function beginsOpenQuotedParagraph(body: SourceLine[]): boolean {
  if (body.length !== 1 || !body[0]!.text.startsWith('>')) return false
  const first = body[0]!.text
  return plainQuoteText(first.slice(first[1] === ' ' ? 2 : 1))
}

function endsOpenQuotedParagraph(body: SourceLine[]): boolean {
  const last = body.at(-1)?.text
  return last !== undefined && RE_BLOCKQUOTE.test(last) &&
    plainQuoteText(last.slice(last[1] === ' ' ? 2 : 1))
}

function shiftedQuotedHeading(body: SourceLine[], line: SourceLine, prefix: number): boolean {
  return endsOpenQuotedParagraph(body) && body.at(-1)?.number === line.number - 1 &&
    line.text[prefix] === ' ' && RE_HEADING.test(line.text.slice(prefix).trimStart())
}

function listContinuationClaim(frame: ListCursorFrame, line: SourceLine,
  bodyPrefix: number, reachedPrefix: number, next?: SourceLine):
  { line: SourceLine; prefix: number } {
  if (frame.closedQuoteFence && frame.quoteFenceDepth > 1 &&
      line.text.slice(reachedPrefix).startsWith(' ') &&
      line.text.trimStart().startsWith('>') && next &&
      plainQuoteText(next.text) && !next.text.startsWith(' ')) {
    throw new UnsupportedCursorSyntax('nested quoted fence tail owner')
  }
  const prefix = bodyPrefix === reachedPrefix && !frame.fenceMarker ?
    listContinuationPrefix(line.text, bodyPrefix, frame.body, frame.closedQuoteFence,
      next?.text) : bodyPrefix
  const ownedDefinition = prefix > bodyPrefix && /^:: +/.test(line.text.slice(prefix))
  const ownedDefinitionBody = prefix > bodyPrefix && frame.body.at(-1)?.ownedDefinition &&
    /^: +/.test(line.text.slice(prefix))
  return { line: shiftedQuotedHeading(frame.body, line, bodyPrefix) ?
    { ...line, lazyText: true } : ownedDefinition ? { ...line, ownedDefinition: true } :
      ownedDefinitionBody ? { ...line, ownedDefinitionBody: true } : line, prefix }
}

function followsClosedListBlock(body: SourceLine[]): boolean {
  const last = body.at(-1)?.text
  return last !== undefined && (last === '' || parseBlockAttributeRun(last) !== null ||
    LINE_COMMENT.test(last))
}

function matchedShiftedFencePrefix(cursor: Cursor, line: string, base: number,
  afterBlock: boolean): number {
  let shifted = base
  while (line[shifted] === ' ') shifted++
  if (shifted === base) return base
  const shiftedText = line.slice(shifted)
  const codeFence = fenceOpen(shiftedText)
  let opener = codeFence?.marker
  if (!opener && (shiftedText[0] === '`' || shiftedText[0] === '~') &&
      cursor.lines[cursor.at - 1]?.text === '') {
    opener = RE_RAW_FENCE.exec(shiftedText)?.[1]
  }
  if (!opener) return base
  if (codeFence && afterBlock) return shifted
  const baseSpaces = ' '.repeat(base)
  const shiftedSpaces = ' '.repeat(shifted)
  for (let i = cursor.at + 1; i < cursor.lines.length; i++) {
    const candidate = cursor.lines[i]!.text
    if (candidate && !candidate.startsWith(baseSpaces)) break
    if (candidate.startsWith(shiftedSpaces) && closesFence(candidate.slice(shifted), opener)) {
      return shifted
    }
  }
  return base
}

function shiftedClosedListColon(cursor: Cursor, base: number):
  { prefix: number; count: number } | undefined {
  const line = cursor.peek()?.text
  if (!line?.startsWith(' '.repeat(base))) return undefined
  let prefix = base
  while (line[prefix] === ' ') prefix++
  if (prefix === base) return undefined
  const opener = COLON_OPEN.exec(line.slice(prefix))
  if (!opener) return undefined
  const closer = new RegExp(`^:{${opener[1]!.length}}[ \\t]*$`)
  for (let count = 1; cursor.peek(count); count++) {
    const follower = cursor.peek(count)!.text
    if (!follower.startsWith(' '.repeat(prefix))) return undefined
    if (closer.test(follower.slice(prefix))) return { prefix, count: count + 1 }
  }
  return undefined
}

function listGapBlockText(cursor: Cursor, next: SourceLine, base: number): string {
  const shiftedColon = shiftedClosedListColon(cursor, base)
  return next.text.slice(shiftedColon?.prefix ?? listContinuationPrefix(next.text, base))
}

function pipeSegments(line: SourceLine): Array<{ text: string; from: number; to: number }> {
  if (!line.text.startsWith('|') || !line.text.endsWith('|')) throw new UnsupportedCursorSyntax('table edge')
  if (line.text.includes('\\|')) throw new UnsupportedCursorSyntax('escaped table pipe')
  const cells: Array<{ text: string; from: number; to: number }> = []
  let from = 1
  for (let i = 1; i < line.text.length; i++) {
    if (line.text[i] !== '|') continue
    cells.push({ text: line.text.slice(from, i), from, to: i })
    from = i + 1
  }
  return cells
}

function parseSimpleTable(cursor: Cursor, inline: CursorInline): Table {
  const header = cursor.take()
  const separator = cursor.take()
  const separators = pipeSegments(separator)
  const alignments = separators.map((cell) => {
    const text = cell.text.trim()
    if (!/^:?-{3,}:?$/.test(text)) throw new UnsupportedCursorSyntax('table separator')
    return text.startsWith(':') && text.endsWith(':') ? 'center' :
      text.startsWith(':') ? 'left' : text.endsWith(':') ? 'right' : undefined
  })
  const widths = separators.map((cell) => cell.text.match(/-+/)![0].length)
  const rows: TableRow[] = []
  const addRow = (source: SourceLine, isHeader: boolean) => {
    // Row and cell positions stay in cut space, like the production table reader.
    const line = source.lead ? { ...source, baseColumn: (source.baseColumn ?? 1) - source.lead } : source
    const segments = pipeSegments(line)
    if (segments.length !== alignments.length) throw new UnsupportedCursorSyntax('table width')
    rows.push({ type: 'table_row', cells: segments.map((part, i) => {
      const trimmed = part.text.trim()
      const lead = part.text.length - part.text.trimStart().length
      const column = part.from + lead + 1
      return { type: 'table_cell', header: isHeader,
        children: inline.inlines([{ line, column, text: trimmed }]),
        ...(isHeader && alignments[i] ? { align: alignments[i] } : {}),
        pos: position(line, line, part.from + 1, part.to + 1) }
    }), pos: position(line, line) })
  }
  addRow(header, true)
  let last = header
  while (cursor.peek()?.text.startsWith('|')) {
    last = cursor.take()
    addRow(last, false)
  }
  return { type: 'table', rows, separatorWidths: widths, pos: position(header, last) }
}

function parseCanonicalTableWithExistingRules(cursor: Cursor, inline: CursorInline): Table {
  if (cursor.owner.inList && cursor.owner.kind !== 'list') {
    throw new UnsupportedCursorSyntax('list table source mapping')
  }
  const first = cursor.peek()!
  const lexer = lexerForCursor(cursor)
  lexer.pos = cursor.at
  lexer.abbrDefs = inline.abbreviations
  lexer.linkDefs = inline.linkDefinitions
  const table = parseTableBlock({
    parseInline: (text, _abbrDefs, _linkDefs, source) => inline.tableInlines(text, source),
    recordAttachedCaption: () => {},
    parseCaptionInline: (tableLexer, text) => {
      const capIndex = tableLexer.pos - 1
      const line = tableLexer.lineAt(capIndex)
      if (!line?.endsWith(text)) throw new UnsupportedCursorSyntax('table caption source')
      const within = line.length - text.length
      const anchors = [{ offset: tableLexer.lineOffset(capIndex) + within,
        column: tableLexer.sourceStartColumn(capIndex) + within,
        line: tableLexer.lineNumber(capIndex) }]
      const content = readCaptionText(tableLexer, text, anchors)
      return inline.tableInlines(content, inlineSource({ anchored: true,
        baseOffset: anchors[0]!.offset, startLine: anchors[0]!.line,
        startColumn: anchors[0]!.column, lineAnchors: anchors }), true)
    },
  }, lexer)
  if (table.type !== 'table' || lexer.pos <= cursor.at) {
    throw new UnsupportedCursorSyntax('canonical table adapter')
  }
  const last = cursor.lines[lexer.pos - 1]
  if (!last) throw new UnsupportedCursorSyntax('canonical table source range')
  cursor.at = lexer.pos
  table.pos = position(first, last)
  return table
}

function parseTableAtCursor(cursor: Cursor, inline: CursorInline): Table {
  const first = cursor.peek()!
  const second = cursor.peek(1)?.text
  const gfm = second?.startsWith('|') && /^\|(?: *:?-{3,}:? *\|)+$/.test(second)
  if (gfm) {
    let row = 0
    let needsCanonicalReader = false
    while (cursor.peek(row)?.text.startsWith('|')) {
      needsCanonicalReader ||= /\|[ \t]*[<^][ \t]*\||\|[ \t]*\{|^\|=/.test(cursor.peek(row)!.text)
      row++
    }
    return needsCanonicalReader ? parseCanonicalTableWithExistingRules(cursor, inline) :
      parseSimpleTable(cursor, inline)
  }
  const headed = first.text.startsWith('|=')
  const tabbedListRow = cursor.owner.kind === 'list' &&
    cursor.physicalLines[first.number - 1]?.text.startsWith('\t')
  if (!first.text.startsWith('|') ||
      (!headed && cursor.at > 0 && cursor.lines[cursor.at - 1]?.text !== '' &&
        (cursor.owner.kind !== 'root' && !cursor.owner.inList && !tabbedListRow ||
          /^ *(?:[-*+]|\d+[.)]) +[-*+]?[ \t]*$/.test(cursor.lines[cursor.at - 1]!.text) ||
          cursor.lines[cursor.at - 1]!.text.startsWith('>')))) {
    throw new UnsupportedCursorSyntax('canonical table header')
  }
  const tableStart = cursor.at
  const table = parseCanonicalTableWithExistingRules(cursor, inline)
  if (cursor.owner.inList && table.caption && tableStart > 0 &&
      listMarker(cursor.lines[tableStart - 1]!.text) !== undefined &&
      cursor.lines.slice(tableStart, cursor.at).some((line) => isBlankLine(line.text))) {
    throw new UnsupportedCursorSyntax('list table caption gap')
  }
  if (cursor.owner.inList && isBlankLine(cursor.peek()?.text ?? '') &&
      (RE_CAPTION.test(cursor.peek(1)?.text ?? '') ||
        isBlankLine(cursor.peek(1)?.text ?? '') && RE_CAPTION.test(cursor.peek(2)?.text ?? ''))) {
    throw new UnsupportedCursorSyntax('list table caption gap')
  }
  if (!headed && cursor.peek()?.text && !isBlockStart(cursor.peek()!.text) &&
      (hasContainerOwner(cursor.owner, 'definition') ||
        cursor.owner.inList && cursor.peek(1)?.text === '' &&
        RE_CAPTION.test(cursor.peek(2)?.text ?? ''))) {
    throw new UnsupportedCursorSyntax('data table paragraph follower')
  }
  if (!headed && cursor.peek()?.text === '' &&
      (listMarker(cursor.peek(1)?.text ?? '') || cursor.peek(1)?.text.startsWith('>'))) {
    throw new UnsupportedCursorSyntax('data table container follower')
  }
  return table
}

function rootBlockAttributeAt(cursor: Cursor, index: number): boolean {
  if (cursor.owner.kind !== 'root' || cursor.lines[index]?.text[0] !== '{') return false
  const lexer = lexerForCursor(cursor)
  const saved = lexer.pos
  lexer.pos = index
  const found = probeBlockAttributes(lexer) !== null
  lexer.pos = saved
  return found
}

function definitionStructuralOffset(text: string, column: number): number | undefined {
  if (!text.startsWith(' '.repeat(column - 1))) {
    const indent = /^ */.exec(text)![0].length
    const content = text.slice(indent)
    return indent < column - 1 && LINE_COMMENT.test(content) &&
      !RE_COMMENT_BLOCK_ANY.test(content) ? indent : undefined
  }
  let offset = column - 1
  while (text.charCodeAt(offset) === 32) offset++
  const content = text.slice(offset)
  return RE_HEADING.test(content) || RE_BLOCKQUOTE.test(content) ||
    !/[ \t]$/.test(text) && listMarker(content) !== undefined ||
    RE_HR.test(content) ||
    content === ':::' ||
    (LINE_COMMENT.test(content) && !RE_COMMENT_BLOCK_ANY.test(content)) ||
    (content[0] === '{' && parseBlockAttributeRun(content) !== null) ? offset : undefined
}

function definitionStructuralLine(text: string, column: number): boolean {
  return definitionStructuralOffset(text, column) !== undefined
}

const RE_DEFINITION_TERM_CONTAINER = /^ {1,3}:{3,}/
const RE_TERM_CONTAINER_OPENER = /^:{3,}/

/** An indented `:::` opener after a term that is the last line, or whose closer ends the input. */
function indentedTermContainerEnd(cursor: Cursor, at: number): boolean {
  if (!RE_TERM_CONTAINER_OPENER.test(cursor.lines[at]!.text) ||
      (cursor.lines[at]!.baseColumn ?? 1) <= 1) return false
  let last = at
  if (/^:{3,}[ \t]*\S/.test(cursor.lines[at]!.text)) {
    last = at + 1
    while (cursor.lines[last] && !/^:{3,}[ \t]*$/.test(cursor.lines[last]!.text)) last++
    if (!cursor.lines[last]) return false
  }
  return !cursor.lines[last + 1] || cursor.lines[last + 1]!.text === ''
}

function definitionTermBelowColumn(text: string, contentColumn: number): boolean {
  let indent = 0
  if (contentColumn !== 4) while (text.charCodeAt(indent) === 32) indent++
  const belowColumn = contentColumn === 4 ? /^ {1,3}[^ ]/.test(text) :
    indent > 0 && indent < contentColumn && text[indent] !== undefined
  return belowColumn && !listMarker(text) && !LINE_COMMENT.test(text) && !RE_DEFINITION_TERM_CONTAINER.test(text)
}

function definitionTermWrapText(cursor: Cursor, text: string, contentColumn: number): boolean {
  return definitionTermBelowColumn(text, contentColumn) ||
    /^:{1,2}[ \t]*$/.test(text) ||
    (cursor.owner.kind === 'root' && plainQuoteText(text)) ||
    (cursor.owner.kind === 'quote' && !cursor.owner.inList && plainQuoteText(text))
}

function definitionBodyWrapText(text: string, column: number): boolean {
  if (/^ *[A-Za-z0-9]/.test(text)) return true
  const indent = /^ */.exec(text)![0].length
  if (indent === column - 1 && /^\+ [^+]/.test(text.slice(indent))) return true
  return indent > 0 && indent < column - 1 &&
    (text[indent] === '>' || text[indent] === '#' ||
      text[indent] === '[' || text[indent] === '{' || text[indent] === '`')
}

function nestedDefinitionBodyEnd(cursor: Cursor, from: number, column: number): number | undefined {
  const first = cursor.lines[from]?.text
  if (!first || first.charCodeAt(column - 1) !== 58 ||
      first.charCodeAt(column) !== 58 || first.charCodeAt(column + 1) !== 32) return undefined
  const prefix = ' '.repeat(column - 1)
  if (!first.startsWith(prefix)) return undefined
  let after = from + 1
  while (cursor.lines[after]?.text.startsWith(prefix) &&
      cursor.lines[after]!.text.length > prefix.length) after++
  return !cursor.lines[after] || cursor.lines[after]!.text === '' ? after : undefined
}

function definitionFenceBodyEnd(cursor: Cursor, from: number, column: number): number | undefined {
  const prefix = ' '.repeat(column - 1)
  const first = cursor.lines[from]?.text
  if (!first?.startsWith(prefix)) return undefined
  const marker = fenceOpen(first.slice(prefix.length))?.marker
  if (!marker) return undefined
  for (let at = from + 1; at < cursor.lines.length; at++) {
    const text = cursor.lines[at]!.text
    if (text === '') return undefined
    if (!text.startsWith(prefix)) {
      return cursor.lines[from]!.lead === -1 ? undefined : at
    }
    if (!text.startsWith(prefix) || !closesFence(text.slice(prefix.length), marker)) continue
    const boundary = cursor.lines[at + 1]?.text
    return boundary === undefined || boundary === '' || !boundary.startsWith(prefix) ?
      at + 1 : undefined
  }
  return undefined
}

function definitionClosedColonBodyEnd(cursor: Cursor, from: number, column: number): number | undefined {
  const prefix = ' '.repeat(column - 1)
  const first = cursor.lines[from]?.text
  if (!first?.startsWith(prefix)) return undefined
  const content = first.slice(prefix.length)
  const opener = COLON_OPEN.exec(content) ?? RE_VALID_ADMONITION_OPEN.exec(content)
  if (!opener) return undefined
  const width = opener[1]!.length
  let fence: string | undefined
  for (let at = from + 1; cursor.lines[at]; at++) {
    const text = cursor.lines[at]!.text
    if (!text.startsWith(prefix)) return undefined
    const owned = text.slice(prefix.length)
    if (fence) {
      if (closesFence(owned, fence)) fence = undefined
      continue
    }
    fence = fenceOpen(owned)?.marker
    if (fence) continue
    if (closesColonOwner(owned, width)) {
      const boundary = cursor.lines[at + 1]?.text
      return boundary === undefined || boundary === '' || !boundary.startsWith(prefix) ?
        at + 1 : undefined
    }
    if (COLON_OPEN.test(owned)) return undefined
  }
  return undefined
}

function definitionFenceBoundary(cursor: Cursor, from: number, column: number,
  mayWrap: boolean, plain: boolean): { end: number; structural: boolean } | undefined {
  if (!mayWrap || !plain) return undefined
  const end = definitionFenceBodyEnd(cursor, from, column) ??
    definitionClosedColonBodyEnd(cursor, from, column)
  if (end === undefined) return undefined
  const boundary = cursor.lines[end]?.text
  return { end, structural: boundary !== undefined && boundary !== '' &&
    !boundary.startsWith(' '.repeat(column - 1)) }
}

function boundedDefinitionParagraphEnd(lines: SourceLine[], from: number): number | undefined {
  const codeRun = /^ +(`{3,})[ \t]*$/.exec(lines[from]?.text ?? '')?.[1]
  if (codeRun) {
    for (let at = from + 1; at < lines.length; at++) {
      if (lines[at]!.text !== codeRun) continue
      if (!lines[at + 1] || lines[at + 1]!.text === '') return at + 1
      break
    }
  }
  let after = from + 1
  while (lines[after] && plainQuoteText(lines[after]!.text)) after++
  return !lines[after] || lines[after]!.text === '' ? after : undefined
}

function startsRootBlockAfterDefinition(text: string): boolean {
  return RE_BLOCKQUOTE.test(text) || RE_HEADING.test(text) ||
    fenceOpen(text) !== null || COLON_OPEN.test(text) ||
    (text[0] === '|' && isTableRow(text))
}

function hasExposedDefinitionReference(body: SourceLine[]): boolean {
  let fence: string | undefined
  let commentRun: number | undefined
  for (let i = 1; i < body.length; i++) {
    const text = body[i]!.text.trimStart()
    const comment = RE_COMMENT_BLOCK_ANY.exec(text)
    if (commentRun !== undefined) {
      if (comment?.[1]?.length === commentRun) commentRun = undefined
      continue
    }
    if (fence) {
      if (closesFence(text, fence)) fence = undefined
      continue
    }
    if (comment) { commentRun = comment[1]!.length; continue }
    const opener = fenceOpen(text)
    if (opener) { fence = opener.marker; continue }
    if (/^\[(?:\^[^\]]+|[^\]]+)\]:/.test(text)) return true
  }
  return false
}

function definitionBlockFollowerEnd(cursor: Cursor, end: number, column: number): number | undefined {
  const prefix = ' '.repeat(column - 1)
  const first = cursor.lines[end]?.text
  if (!first?.startsWith(prefix) || first.length <= prefix.length) return undefined
  let after = end + 1
  while (cursor.lines[after]?.text.startsWith(prefix) &&
      cursor.lines[after]!.text.length > prefix.length) {
    if (definitionBlockRootLinkHandoff(cursor, after, column, true)) break
    after++
  }
  const opener = cursor.lines[end - 1]?.text.slice(column - 1)
  const last = cursor.lines[after - 1]?.text.slice(column - 1)
  if (RE_BLOCKQUOTE.test(opener ?? '') && RE_BLOCKQUOTE.test(last ?? '') &&
      plainQuoteText(cursor.lines[after]?.text ?? '')) {
    const paragraphEnd = boundedDefinitionParagraphEnd(cursor.lines, after)
    if (paragraphEnd !== undefined) return paragraphEnd
  }
  return after
}

function attachedDefinitionFollowerEnd(cursor: Cursor, end: number,
  contentPlain: boolean): number | undefined {
  if (cursor.lines[end]?.text !== '+') return undefined
  const follower = cursor.lines[end + 1]?.text ?? ''
  const boundary = cursor.lines[end + 2]?.text
  if (boundary !== undefined && boundary !== '' &&
      !(contentPlain && plainQuoteText(follower) &&
        startsRootBlockAfterDefinition(boundary))) return undefined
  const marker = listMarker(follower)
  return plainQuoteText(follower) || marker?.indent === 0 ||
    contentPlain && marker !== undefined ? end + 2 : undefined
}

function boundedDescriptionPlusText(cursor: Cursor, at: number, column: number): boolean {
  if (cursor.lines[at]?.text !== '+') return false
  const follower = cursor.lines[at + 1]?.text
  if (!follower || !plainQuoteText(follower.trimStart())) return false
  const indent = /^ */.exec(follower)![0].length
  return indent > 0 && indent < column - 1 &&
    (!cursor.lines[at + 2] || cursor.lines[at + 2]!.text === '')
}

function wrappedDefinitionAttributeCount(cursor: Cursor, at: number, column: number): number {
  const prefix = ' '.repeat(column - 1)
  const first = cursor.lines[at]?.text
  if (!first?.startsWith(prefix + '{') || first.includes('}')) return 0
  if (at < (cursor.wrappedDefinitionAttributeMissUntil?.get(column) ?? 0)) return 0
  const lines: string[] = []
  for (let index = at; cursor.lines[index]; index++) {
    const text = cursor.lines[index]!.text
    if (!text.startsWith(prefix) || isBlankLine(text)) {
      (cursor.wrappedDefinitionAttributeMissUntil ??= new Map()).set(column, index)
      return 0
    }
    lines.push(text.slice(prefix.length))
    if (text.includes('}')) break
  }
  if (!lines.at(-1)?.includes('}')) {
    (cursor.wrappedDefinitionAttributeMissUntil ??= new Map()).set(column, at + lines.length)
    return 0
  }
  const found = probeBlockAttributes(new Lexer(lines))
  if (found?.count !== lines.length) return 0
  const boundary = cursor.lines[at + lines.length]?.text
  return boundary === undefined || boundary === '' || !boundary.startsWith(prefix) ? lines.length : 0
}

function boundedDefinitionExtraEnd(cursor: Cursor, at: number, column: number,
  mayWrap: boolean, plain: boolean):
  { end: number; structural: boolean } | undefined {
  if (!mayWrap || !plain) return undefined
  if (boundedDescriptionPlusText(cursor, at, column)) {
    return { end: at + 2, structural: false }
  }
  const wrapped = wrappedDefinitionAttributeCount(cursor, at, column)
  return wrapped > 0 ? { end: at + wrapped, structural: true } : undefined
}

function definitionStructuralFollowerEnd(cursor: Cursor, end: number, column: number):
  number | undefined {
  if (!definitionStructuralLine(cursor.lines[end]?.text ?? '', column)) return undefined
  let after = end + 1
  while (cursor.lines[after] && definitionStructuralLine(cursor.lines[after]!.text, column) &&
      !cursor.lines[after]!.text.startsWith('%%')) after++
  const commentTail = definitionCommentTailEnd(cursor, after - 1, column)
  if (cursor.lines[end]!.text.startsWith('%%') && commentTail === undefined) return undefined
  if (commentTail !== undefined) after = commentTail
  const opener = cursor.lines[end]!.text
  const offset = definitionStructuralOffset(opener, column)!
  const followerEvent = cursor.lines[after]?.event
  if (listMarker(opener.slice(offset)) && followerEvent?.lazy === true &&
      followerEvent.reached === 'doc' && followerEvent.missed.length === 1 &&
      followerEvent.missed[0] === 'dd') return undefined
  if (offset > column - 1 && RE_BLOCKQUOTE.test(opener.slice(offset)) &&
      plainQuoteText(cursor.lines[after]?.text ?? '')) {
    const quoteContent = opener.slice(offset + (opener[offset + 1] === ' ' ? 2 : 1))
    const follower = cursor.lines[after]!.text
    return plainQuoteText(quoteContent) && !isBlockStart(quoteContent) &&
      !isBlockStart(follower) &&
      (!cursor.lines[after + 1] || isBlankLine(cursor.lines[after + 1]!.text)) ?
      after + 1 : undefined
  }
  return !cursor.lines[after] || !cursor.lines[after]!.text.startsWith(' '.repeat(column - 1)) ?
    after : undefined
}

function definitionCommentTailEnd(cursor: Cursor, commentAt: number,
  column: number): number | undefined {
  const comment = cursor.lines[commentAt]?.text ?? ''
  const indent = /^ */.exec(comment)![0].length
  if (indent >= column - 1 || !LINE_COMMENT.test(comment) ||
      RE_COMMENT_BLOCK_ANY.test(comment)) return undefined
  const tail = cursor.lines[commentAt + 1]?.text
  const tailIndent = /^ */.exec(tail ?? '')![0].length
  if (!tail || tailIndent > column - 1 || !plainQuoteText(tail.slice(tailIndent)) ||
      cursor.lines[commentAt + 2] && cursor.lines[commentAt + 2]!.text !== '') return undefined
  return commentAt + 2
}

function takeDefinitionBlockContinuation(cursor: Cursor, end: number, line: SourceLine,
  column: number, content: string, inline: CursorInline, depth: number):
  { blocks: BlockNode[]; last: SourceLine } | undefined {
  const prefix = ' '.repeat(column - 1)
  if (cursor.at >= end || !cursor.peek()!.text.startsWith(prefix)) return undefined
  const body: SourceLine[] = [{ text: content, start: line.start + column - 1,
    number: line.number, baseColumn: (line.baseColumn ?? 1) + column - 1 }]
  let last = line
  while (cursor.at < end && cursor.peek()!.text.startsWith(prefix)) {
    const follower = cursor.take()
    body.push({ text: follower.text.slice(column - 1), start: follower.start + column - 1,
      number: follower.number, baseColumn: (follower.baseColumn ?? 1) + column - 1 })
    last = follower
  }
  if (RE_BLOCKQUOTE.test(content)) while (cursor.at < end &&
      (plainQuoteText(cursor.peek()!.text) || cursor.peek()!.ownedLazy)) {
    const follower = cursor.take()
    body.push(follower)
    last = follower
  }
  if (hasExposedDefinitionReference(body)) {
    throw new UnsupportedCursorSyntax('definition body reference')
  }
  return { blocks: parseBlocks(new Cursor(body, undefined,
    childOwner(cursor.owner, 'definition'), cursor.physicalLines), inline, [], depth + 1, false), last }
}

function lastPlacedDefinitionLine(blocks: BlockNode[], last: SourceLine,
  physicalLines: SourceLine[]): SourceLine {
  const placedEnd = blocks.at(-1)?.pos?.endLine
  return placedEnd && placedEnd < last.number ? physicalLines[placedEnd - 1] ?? last : last
}

function attachedDefinitionFenceEnd(cursor: Cursor, plus: number): number | undefined {
  if (cursor.lines[plus]?.text !== '+') return undefined
  const attribute = rootBlockAttributeAt(cursor, plus + 1) &&
    fenceOpen(cursor.lines[plus + 2]?.text ?? '')
  const fence = plus + (attribute ? 2 : 1)
  const marker = fenceOpen(cursor.lines[fence]?.text ?? '')?.marker
  if (!marker) return undefined
  let close = fence + 1
  while (cursor.lines[close] && !closesFence(cursor.lines[close]!.text, marker)) close++
  return cursor.lines[close] && (!cursor.lines[close + 1] || cursor.lines[close + 1]!.text === '') ?
    close + 1 : undefined
}

function safeDefinitionListEnd(cursor: Cursor, end: number, body: string): boolean {
  const listBody = listMarker(body)
  if (!listBody) return false
  const nestedBody = listMarker(listBody.content)
  const previousText = cursor.lines[end - 1]?.text.trimStart() ?? ''
  const safeStructure = fenceOpen(listBody.content) ||
    nestedBody && fenceOpen(nestedBody.content) ||
    !listBody.ordered && !listBody.content.trimStart().startsWith('+') &&
    (RE_HEADING.test(previousText) ||
      isTableRow(listBody.content) && isTableRow(previousText))
  return Boolean(safeStructure) &&
    !cursor.lines.slice(cursor.at, end + 1).some((line) => line.text.includes('{'))
}

function emptyDescriptionBelowColumnSibling(cursor: Cursor, end: number,
  contentColumn: number, body: string): boolean {
  const line = cursor.lines[end]
  const event = line?.event
  return line !== undefined && body === '+' && cursor.owner.kind === 'root' &&
    event?.lazy === true && event.kind === 'text' && event.reached === 'doc' &&
    event.missed.length === 1 && event.missed[0] === 'dd' &&
    line.text.length - line.text.trimStart().length < contentColumn - 1 &&
    plainQuoteText(line.text.trimStart())
}

function uncertainDefinitionListEnd(cursor: Cursor, end: number,
  commentOpeners: ReadonlySet<number> | undefined, contentColumn: number,
  endedOnStructural: boolean, body: string): boolean {
  const line = cursor.lines[end]
  return Boolean(line && line.text !== '' &&
    !commentOpeners?.has(line.start) &&
    !emptyDescriptionBelowColumnSibling(cursor, end, contentColumn, body) &&
    !(endedOnStructural && !line.text.startsWith(' '.repeat(contentColumn - 1))) &&
    !(cursor.owner.kind === 'root' && (rootLinkDef(line.text) ||
      line.descriptionRootLink ||
      rootBlockAttributeAt(cursor, end) || startsRootBlockAfterDefinition(line.text) ||
      body === '' && LINE_COMMENT.test(line.text))) &&
    !(cursor.owner.kind === 'definition' && body === '' && !line.ownedLazy &&
      (RE_HEADING.test(line.text) || COLON_OPEN.test(line.text))) &&
    !(cursor.owner.kind === 'quote' && !cursor.owner.inList && !line.ownedLazy &&
      body === '' && startsRootBlockAfterDefinition(line.text)) &&
    !((cursor.owner.kind === 'root' || cursor.owner.kind === 'quote' && !cursor.owner.inList) &&
      !line.ownedLazy && RE_HR.test(line.text)) &&
    !safeDefinitionListEnd(cursor, end, body))
}

function termInvisibleBoundary(cursor: Cursor, end: number,
  afterTerm: boolean, contentColumn: number): boolean {
  const term = cursor.lines[end - 1]
  const line = cursor.lines[end]
  if (!afterTerm || !term || !line || line.number !== term.number + 1 ||
      !/^:: +/.test(term.text) ||
      !(LINE_COMMENT.test(line.text) || RE_COMMENT_BLOCK_ANY.test(line.text) ||
        rootLinkDef(line.text) || FOOTNOTE_DEF.test(line.text) || ABBR_DEF.test(line.text))) return false
  const termBase = term.baseColumn ?? 1
  const lineBase = line.baseColumn ?? 1
  return (lineBase > termBase || cursor.owner.kind === 'quote' && lineBase === termBase ||
    cursor.owner.kind === 'definition' && LINE_COMMENT.test(line.text) &&
      lineBase === termBase) &&
    lineBase - termBase < contentColumn - 1
}

function unresolvedDefinitionEnd(cursor: Cursor, end: number,
  commentOpeners: ReadonlySet<number> | undefined, contentColumn: number,
  endedOnStructural: boolean, body: string, afterTerm: boolean, termColumn: number): boolean {
  return uncertainDefinitionListEnd(cursor, end, commentOpeners,
    contentColumn, endedOnStructural, body) &&
    !termInvisibleBoundary(cursor, end, afterTerm, termColumn)
}

function terminalDefinitionFollower(text: string, following: SourceLine | undefined,
  mayFirstBlock: boolean, mayWrapDefinition: boolean, definitionContentPlain: boolean): boolean {
  if (following && following.text !== '') return false
  if (mayFirstBlock && (RE_BLOCKQUOTE.test(text) || plainQuoteText(text))) return true
  return mayWrapDefinition && definitionContentPlain &&
    /^ (?:-{3,}|\*{3,}|_{3,}|~{3,}|(?:- ){2,}-)[ \t]*$/.test(text)
}

function definitionFollowerContinues(cursor: Cursor, next: number, afterTerm: boolean): boolean {
  const follower = cursor.lines[next]?.text
  if (cursor.lines[next]?.descriptionRootLink) return false
  return Boolean(follower) && (/^[ \t+:]/.test(follower!) || follower!.startsWith('::')) &&
    !(afterTerm && indentedTermContainerEnd(cursor, next))
}

function markDescriptionRootLinkHandoff(cursor: Cursor, end: number,
  contentColumn: number): void {
  const line = cursor.lines[end]
  if (cursor.owner.kind === 'root' && contentColumn > 1 && line &&
      line.text.startsWith(' '.repeat(contentColumn - 1)) &&
      rootLinkDef(line.text.trimStart())) line.descriptionRootLink = true
}

function definitionBlockRootLinkHandoff(cursor: Cursor, end: number,
  contentColumn: number, block: boolean): boolean {
  const line = cursor.lines[end]
  if (cursor.owner.kind !== 'root' || !block || !line ||
      !line.text.startsWith(' '.repeat(contentColumn - 1)) ||
      !rootLinkDef(line.text.trimStart())) return false
  const next = cursor.lines[end + 1]
  return !next || isBlankLine(next.text) ||
    !next.text.startsWith(' '.repeat(contentColumn - 1))
}

function definitionDetachedPlainFollower(cursor: Cursor, end: number,
  contentColumn: number, mayWrap: boolean, text: string): boolean {
  const follower = cursor.lines[end + 1]
  return mayWrap && text === '' && contentColumn > 1 &&
    follower?.text.startsWith(' '.repeat(contentColumn - 1)) === true &&
    plainQuoteText(follower.text.slice(contentColumn - 1)) &&
    (!cursor.lines[end + 2] || cursor.lines[end + 2]!.text === '')
}

function definitionListEnd(cursor: Cursor, commentOpeners: ReadonlySet<number> | undefined): number {
  let end = cursor.at
  let mayWrapDefinition = false
  let mayWrapTerm = false
  let termContentColumn = 0
  let mayTermPlus = false
  let mayFirstBlock = false
  let definitionContentColumn = 0
  let definitionContentPlain = false
  let definitionContentBlock = false
  let definitionListText = ''
  let endedOnStructural = false
  let endedOnFenceBoundary = false
  while (end < cursor.lines.length) {
    const text = cursor.lines[end]!.text
    const termMatch = /^:: +[ \t]*([^ \t].*)$/.exec(text)
    const term = termMatch !== null
    const definition = /^: +[ \t]*[^ \t].*$/.test(text)
    if (term || definition) {
      if (/[ \t]$/.test(text)) throw new UnsupportedCursorSyntax('definition list trailing whitespace')
      mayWrapDefinition = definition && !/^: +\+[ \t]*$/.test(text)
      mayFirstBlock = definition && /^: +\+[ \t]*$/.test(text)
      if (definition) {
        const body = /^: +[ \t]*([^ \t].*)$/.exec(text)![1]!
        definitionContentColumn = text.length - body.length + 1
        definitionContentPlain = !isBlockStart(body)
        definitionListText = body
      }
      definitionContentBlock = definition && mayWrapDefinition && !definitionContentPlain
      mayWrapTerm = term
      mayTermPlus = term
      if (term) {
        termContentColumn = text.length - termMatch[1]!.length + 1
        definitionListText = ''
      }
      end++
      continue
    }
    if (belowColumnDescriptionComment(cursor, end, commentOpeners)) return end
    if (mayWrapTerm && definitionTermBelowColumn(text, termContentColumn)) {
      let after = end + 1
      while (cursor.lines[after] &&
          definitionTermBelowColumn(cursor.lines[after]!.text, termContentColumn)) after++
      const follower = cursor.lines[after]?.text
      if (follower === undefined || follower === '' ||
          /^: +[ \t]*[^ \t]/.test(follower)) {
        end = after
        mayWrapTerm = false
        continue
      }
    }
    if (mayWrapTerm && definitionTermWrapText(cursor, text, termContentColumn) &&
        (!cursor.lines[end + 1] || cursor.lines[end + 1]!.text === '' ||
          /^: +[ \t]*[^ \t]/.test(cursor.lines[end + 1]!.text) ||
          (cursor.lines[end + 1]!.text === '+' &&
            /^: +[ \t]*[^ \t]/.test(cursor.lines[end + 2]?.text ?? '')))) {
      end++
      mayWrapTerm = false
      continue
    }
    if (mayTermPlus && text === '+' && /^: +[ \t]*[^ \t]/.test(cursor.lines[end + 1]?.text ?? '')) {
      end++
      mayTermPlus = false
      continue
    }
    if (mayWrapTerm && text === '' && /^: +[ \t]*[^ \t]/.test(cursor.lines[end + 1]?.text ?? '') &&
        (!cursor.lines[end + 2] || cursor.lines[end + 2]!.text === '')) {
      end++
      mayWrapTerm = false
      continue
    }
    if (definitionDetachedPlainFollower(cursor, end, definitionContentColumn,
      mayWrapDefinition, text)) {
      end += 2
      break
    }
    if (definitionBlockRootLinkHandoff(cursor, end, definitionContentColumn,
      definitionContentBlock)) break
    const extra = boundedDefinitionExtraEnd(cursor, end, definitionContentColumn,
      mayWrapDefinition, definitionContentPlain)
    if (extra) {
      end = extra.end
      endedOnStructural = extra.structural
      break
    }
    if (terminalDefinitionFollower(text, cursor.lines[end + 1],
      mayFirstBlock, mayWrapDefinition, definitionContentPlain)) {
      end++
      break
    }
    if (mayWrapDefinition && text === '' &&
        definitionStructuralLine(cursor.lines[end + 1]?.text ?? '', definitionContentColumn) &&
        (!cursor.lines[end + 2] || cursor.lines[end + 2]!.text === '')) {
      end += 2
      break
    }
    const attachedFenceEnd = mayWrapDefinition ? attachedDefinitionFenceEnd(cursor, end) : undefined
    if (attachedFenceEnd !== undefined) { end = attachedFenceEnd; break }
    const nestedEnd = mayWrapDefinition && definitionContentPlain ?
      nestedDefinitionBodyEnd(cursor, end, definitionContentColumn) : undefined
    if (nestedEnd !== undefined) { end = nestedEnd; break }
    const fenced = definitionFenceBoundary(cursor, end, definitionContentColumn,
      mayWrapDefinition, definitionContentPlain)
    if (fenced) {
      endedOnStructural = fenced.structural
      endedOnFenceBoundary = fenced.structural
      end = fenced.end
      break
    }
    if (mayWrapDefinition && definitionContentPlain && definitionContentColumn > 1) {
      const structuralEnd = definitionStructuralFollowerEnd(cursor, end, definitionContentColumn)
      if (structuralEnd !== undefined) {
        end = structuralEnd
        endedOnStructural = true
        break
      }
    }
    if (definitionContentBlock) {
      const blockEnd = definitionBlockFollowerEnd(cursor, end, definitionContentColumn)
      if (blockEnd !== undefined) { end = blockEnd; break }
    }
    if (mayWrapDefinition && definitionContentPlain && /^:{1,2}[ \t]*$/.test(text)) {
      let after = end + 1
      while (cursor.lines[after] && plainQuoteText(cursor.lines[after]!.text)) after++
      const follower = cursor.lines[after]?.text
      const nextDefinitionItem = follower !== undefined && /^::? +[ \t]*[^ \t]/.test(follower)
      if (follower === undefined || follower === '' || nextDefinitionItem) {
        end = after
        if (nextDefinitionItem) continue
        break
      }
    }
    if (mayWrapDefinition && definitionBodyWrapText(text, definitionContentColumn) &&
        !/[ \t]$/.test(text)) {
      const boundary = boundedDefinitionParagraphEnd(cursor.lines, end)
      if (boundary !== undefined) end = boundary
    } else if (mayWrapDefinition) {
      const attachedEnd = attachedDefinitionFollowerEnd(cursor, end, definitionContentPlain)
      if (attachedEnd !== undefined) {
        end = attachedEnd
        mayWrapDefinition = false
      }
    }
    break
  }
  while (end > cursor.at && cursor.lines[end]?.ownedLazy &&
      (RE_BLOCKQUOTE.test(cursor.lines[end - 1]!.text.trimStart()) || cursor.lines[end - 1]!.ownedLazy)) end++
  if (end === cursor.at) throw new UnsupportedCursorSyntax('definition list body')
  markDescriptionRootLinkHandoff(cursor, end, definitionContentColumn)
  if (unresolvedDefinitionEnd(cursor, end, commentOpeners,
    definitionContentColumn, endedOnStructural, definitionListText,
    mayWrapTerm, termContentColumn)) {
    throw new UnsupportedCursorSyntax('definition list body')
  }
  let next = end
  while (cursor.lines[next]?.text === '') next++
  if (emptyDescriptionBelowColumnSibling(cursor, next, definitionContentColumn,
    definitionListText)) return end
  if (!endedOnFenceBoundary && definitionFollowerContinues(cursor, next, mayWrapTerm)) {
    throw new UnsupportedCursorSyntax('definition list continuation')
  }
  return end
}

/** Lines the ownership walk marked lazy continue the quote paragraph that ends `body`. */
function takeOwnedLazyQuoteLines(cursor: Cursor, end: number, body: SourceLine[],
  last: SourceLine): SourceLine {
  while (cursor.at < end && cursor.peek()!.ownedLazy &&
      (RE_BLOCKQUOTE.test(body.at(-1)!.text) || body.at(-1)!.lazyText)) {
    last = cursor.take()
    body.push({ ...last, lazyText: true })
  }
  return last
}

type CompleteSpans = DefinitionItem & {
  termSpans: Position[]; definitionLines: number[]; definitionSpans: Position[] }

function takeDefinitionBlankFollower(cursor: Cursor, definitions: BlockNode[][],
  inline: CursorInline, depth: number): SourceLine {
  const follower = cursor.take()
  const previous = cursor.lines[cursor.at - 3]
  const definition = previous && /^: +[ \t]*([^ \t].*)$/.exec(previous.text)
  const contentColumn = definition ? previous.text.length - definition[1]!.length + 1 : 0
  const structuralOffset = contentColumn ?
    definitionStructuralOffset(follower.text, contentColumn) : undefined
  if (structuralOffset !== undefined) {
    const body = { text: follower.text.slice(structuralOffset),
      start: follower.start + structuralOffset, number: follower.number,
      baseColumn: (follower.baseColumn ?? 1) + structuralOffset }
    definitions.at(-1)!.push(...parseBlocks(new Cursor([body], undefined,
      childOwner(cursor.owner, 'definition'), cursor.physicalLines), inline, [], depth + 1, false))
    return follower
  }
  const column = /^ */.exec(follower.text)![0].length + 1
  definitions.at(-1)!.push({ type: 'paragraph',
    children: inline.inlines([{ line: follower, column, text: follower.text.slice(column - 1) }]),
    pos: position(follower, follower, column) })
  return follower
}

function takeDefinitionTerm(cursor: Cursor, end: number, line: SourceLine, text: string,
  current: CompleteSpans, inline: CursorInline): SourceLine {
  const column = line.text.length - text.length + 1
  const parts: ContentLine[] = [{ line, column, text }]
  let termLast = line
  if (cursor.at < end && definitionTermWrapText(cursor, cursor.peek()!.text, column)) {
    const belowColumn = definitionTermBelowColumn(cursor.peek()!.text, column)
    do {
      termLast = cursor.take()
      const cut = termLast.termWrapCut ?? 0
      parts.push({ line: termLast, column: cut + 1, text: termLast.text.slice(cut) })
    } while (belowColumn && cursor.at < end &&
      definitionTermBelowColumn(cursor.peek()!.text, column))
  }
  if (cursor.at < end && cursor.peek()!.text === '+') {
    termLast = cursor.take()
    parts.push({ line: termLast, column: 1, text: termLast.text })
  }
  current.terms.push(inline.inlines(parts))
  current.termSpans.push(position(line, termLast))
  return termLast
}

function takeDefinitionPlusAttachment(cursor: Cursor, end: number, definitions: BlockNode[][],
  inline: CursorInline, depth: number): SourceLine {
  const follower = cursor.take()
  if (fenceOpen(follower.text) || rootBlockAttributeAt(cursor, cursor.at - 1) &&
      fenceOpen(cursor.peek()?.text ?? '')) {
    const body = [follower]
    while (cursor.at < end) body.push(cursor.take())
    definitions.at(-1)!.push(...parseBlocks(new Cursor(body, undefined,
      childOwner(cursor.owner, 'definition'), cursor.physicalLines), inline, [], depth + 1, false))
    return body.at(-1)!
  }
  const attached: BlockNode[] = listMarker(follower.text) ?
    parseBlocks(new Cursor([follower], undefined, childOwner(cursor.owner, 'definition'),
      cursor.physicalLines), inline, [], depth + 1, false) : [{ type: 'paragraph',
    children: inline.inlines([{ line: follower, column: 1, text: follower.text }]),
    pos: position(follower, follower) }]
  definitions.at(-1)!.push(...attached)
  return follower
}

function takeDefinitionPlainBody(cursor: Cursor, end: number, line: SourceLine, column: number,
  text: string, inline: CursorInline, depth: number):
  { blocks: BlockNode[]; last: SourceLine; continuation: boolean } {
  const blockBody = isBlockStart(text)
  const parts: ContentLine[] = [{ line, column, text }]
  let definitionLast = line
  const continuation = blockBody ? takeDefinitionBlockContinuation(cursor, end, line,
    column, text, inline, depth) : undefined
  if (continuation) return { blocks: continuation.blocks, last: continuation.last, continuation: true }
  while (cursor.at < end && !isBlankLine(cursor.peek()!.text) &&
      !/^(?:::|:) +[ \t]*[^ \t]/.test(cursor.peek()!.text) &&
      wrappedDefinitionAttributeCount(cursor, cursor.at, column) === 0) {
    if (!blockBody && boundedDescriptionPlusText(cursor, cursor.at, column)) {
      const plus = cursor.take()
      parts.push({ line: plus, column: 1, text: '+' })
      const follower = cursor.take()
      const followerColumn = /^ */.exec(follower.text)![0].length + 1
      parts.push({ line: follower, column: followerColumn,
        text: follower.text.slice(followerColumn - 1) })
      definitionLast = follower
      continue
    }
    if (!blockBody && cursor.peek()!.text === '+' &&
        (listMarker(cursor.peek(1)?.text ?? '')?.indent ?? 0) > 0) {
      const plus = cursor.take()
      parts.push({ line: plus, column: 1, text: plus.text })
      const follower = cursor.take()
      const followerColumn = /^ */.exec(follower.text)![0].length + 1
      parts.push({ line: follower, column: followerColumn,
        text: follower.text.slice(followerColumn - 1) })
      definitionLast = follower
      continue
    }
    if (cursor.peek()!.text === '+') break
    const follower = cursor.take()
    const followerColumn = /^ */.exec(follower.text)![0].length + 1
    parts.push({ line: follower, column: followerColumn,
      text: follower.text.slice(followerColumn - 1) })
    definitionLast = follower
  }
  if (blockBody && parts.length > 1) throw new UnsupportedCursorSyntax('definition block body')
  const mappedImageLine = parts.length === 1 && text.startsWith('![')
  const blocks = blockBody || mappedImageLine ? parseBlocks(new Cursor([{
    text, start: line.start + column - 1,
    number: line.number, baseColumn: (line.baseColumn ?? 1) + column - 1,
  }], undefined, childOwner(cursor.owner, 'colon'), cursor.physicalLines), inline, [], depth + 1, false) :
    [{ type: 'paragraph' as const, children: inline.inlines(parts),
      pos: position(line, definitionLast, column,
        /^:{1,2}[ \t]*$/.test(definitionLast.text) ?
          contentEndColumn(definitionLast) : definitionLast.text.length + 1) }]
  return { blocks, last: definitionLast, continuation: false }
}

function parseSimpleDefinitionList(cursor: Cursor, inline: CursorInline,
  commentOpeners: ReadonlySet<number> | undefined, depth: number): DefinitionList {
  const first = cursor.peek()!
  const end = definitionListEnd(cursor, commentOpeners)
  const items: DefinitionItem[] = []
  let current: CompleteSpans | undefined
  let last = first
  while (cursor.at < end) {
    const line = cursor.take()
    if (line.text === '' && current) {
      if (cursor.at < end && current.definitions.length) {
        last = takeDefinitionBlankFollower(cursor, current.definitions, inline, depth)
      }
      continue
    }
    const term = /^:: +[ \t]*([^ \t].*)$/.exec(line.text)
    const definition = /^: +[ \t]*([^ \t].*)$/.exec(line.text)
    if (term) {
      if (!current || current.definitions.length) {
        current = { terms: [], definitions: [], termSpans: [], definitionLines: [], definitionSpans: [] }
        items.push(current)
      }
      last = takeDefinitionTerm(cursor, end, line, term[1]!, current, inline)
    } else if (definition && current) {
      const column = line.text.length - definition[1]!.length + 1
      if (definition[1] === '+' && cursor.at === end &&
          emptyDescriptionBelowColumnSibling(cursor, end, column, '+')) {
        current.definitions.push([])
        current.definitionLines.push(line.number)
        current.definitionSpans.push(position(line, line))
        last = line
        continue
      }
      const following = cursor.at < end ? cursor.peek() : undefined
      const nestedEnd = !isBlockStart(definition[1]!) ?
        nestedDefinitionBodyEnd(cursor, cursor.at, column) : undefined
      if (nestedEnd !== undefined && nestedEnd <= end) {
        const body: SourceLine[] = [{ text: definition[1]!, start: line.start + column - 1,
          number: line.number, baseColumn: (line.baseColumn ?? 1) + column - 1 }]
        while (cursor.at < nestedEnd) {
          const follower = cursor.take()
          body.push({ text: follower.text.slice(column - 1),
            start: follower.start + column - 1, number: follower.number,
            baseColumn: (follower.baseColumn ?? 1) + column - 1 })
          last = follower
        }
        const blocks = parseBlocks(new Cursor(body, undefined,
          childOwner(cursor.owner, 'definition'), cursor.physicalLines), inline, [], depth + 1, false)
        current.definitions.push(blocks)
        current.definitionLines.push(line.number)
        current.definitionSpans.push(position(line, line))
        continue
      }
      const fencedEnd = !isBlockStart(definition[1]!) ?
        definitionFenceBodyEnd(cursor, cursor.at, column) ??
          definitionClosedColonBodyEnd(cursor, cursor.at, column) : undefined
      if (fencedEnd !== undefined && fencedEnd <= end) {
        const prefix = ' '.repeat(column - 1)
        const boundary = cursor.lines[fencedEnd]
        const unclosed = boundary !== undefined && boundary.text !== '' &&
          !boundary.text.startsWith(prefix)
        const body: SourceLine[] = [{ text: definition[1]!, start: line.start + column - 1,
          number: line.number, baseColumn: (line.baseColumn ?? 1) + column - 1 }]
        while (cursor.at < fencedEnd) {
          const follower = cursor.take()
          const offset = follower.text.startsWith(prefix) ? prefix.length : 0
          body.push({ text: follower.text.slice(offset), start: follower.start + offset,
            number: follower.number, baseColumn: (follower.baseColumn ?? 1) + offset })
          last = follower
        }
        const blocks = parseBlocks(new Cursor(body, undefined,
          childOwner(cursor.owner, 'definition', false, unclosed,
            unclosed ? boundary : undefined), cursor.physicalLines), inline, [], depth + 1, false)
        current.definitions.push(blocks)
        current.definitionLines.push(line.number)
        current.definitionSpans.push(position(line, line))
        continue
      }
      if (!isBlockStart(definition[1]!) &&
          following && definitionStructuralLine(following.text, column)) {
        const body: SourceLine[] = [
          { text: definition[1]!, start: line.start + column - 1,
            number: line.number, baseColumn: (line.baseColumn ?? 1) + column - 1 },
        ]
        while (cursor.at < end && definitionStructuralLine(cursor.peek()!.text, column)) {
          const block = cursor.take()
          const offset = definitionStructuralOffset(block.text, column)!
          body.push({ text: block.text.slice(offset), start: block.start + offset,
            number: block.number, baseColumn: (block.baseColumn ?? 1) + offset })
          last = block
        }
        last = takeOwnedLazyQuoteLines(cursor, end, body, last)
        if (cursor.at < end && body.length === 2 &&
            (body[1]!.baseColumn ?? 1) > column && RE_BLOCKQUOTE.test(body[1]!.text) &&
            plainQuoteText(body[1]!.text.slice(body[1]!.text[1] === ' ' ? 2 : 1)) &&
            !isBlockStart(body[1]!.text.slice(body[1]!.text[1] === ' ' ? 2 : 1)) &&
            plainQuoteText(cursor.peek()!.text) && !isBlockStart(cursor.peek()!.text) &&
            (!cursor.peek(1) || isBlankLine(cursor.peek(1)!.text))) {
          last = cursor.take()
          body.push(last)
        }
        if (cursor.at < end && definitionCommentTailEnd(cursor, cursor.at - 1, column) === cursor.at + 1) {
          last = cursor.take()
          const offset = last.text.startsWith(' '.repeat(column - 1)) ? column - 1 : 0
          body.push({ text: last.text.slice(offset), start: last.start + offset,
            number: last.number, baseColumn: (last.baseColumn ?? 1) + offset })
        }
        const blocks = parseBlocks(new Cursor(body, undefined,
          childOwner(cursor.owner, 'definition'), cursor.physicalLines), inline, [], depth + 1, false)
        current.definitions.push(blocks)
        last = lastPlacedDefinitionLine(blocks, last, cursor.physicalLines)
        current.definitionLines.push(line.number)
        current.definitionSpans.push(position(line, line))
        continue
      }
      if (definition[1] === '+' && cursor.at < end &&
          (RE_BLOCKQUOTE.test(cursor.peek()!.text) || plainQuoteText(cursor.peek()!.text))) {
        const follower = cursor.take()
        current.definitions.push(parseBlocks(new Cursor([follower], undefined,
          childOwner(cursor.owner, 'colon'), cursor.physicalLines), inline, [], depth + 1, false))
        current.definitionLines.push(line.number)
        current.definitionSpans.push(position(line, line))
        last = follower
        continue
      }
      const plain = takeDefinitionPlainBody(cursor, end, line, column, definition[1]!, inline, depth)
      if (plain.continuation) {
        current.definitions.push(plain.blocks)
        current.definitionLines.push(line.number)
        current.definitionSpans.push(position(line, line))
        last = plain.last
        continue
      }
      const blocks = plain.blocks
      const definitionLast = plain.last
      current.definitions.push(blocks)
      current.definitionLines.push(line.number)
      current.definitionSpans.push(position(line, line))
      last = definitionLast
      const wrapped = wrappedDefinitionAttributeCount(cursor, cursor.at, column)
      if (wrapped > 0) {
        const attribute = cursor.peek()!
        const offset = column - 1
        inline.diagnostics?.push({ kind: 'dangling', event: { line: attribute.number,
          column: (attribute.baseColumn ?? 1) + offset,
          startOffset: attribute.start + offset,
          endOffset: attribute.start + attribute.text.length } })
      }
      for (let index = 0; index < wrapped; index++) cursor.take()
    } else if (line.text === '+' && current?.definitions.length && cursor.at < end) {
      last = takeDefinitionPlusAttachment(cursor, end, current.definitions, inline, depth)
    } else throw new UnsupportedCursorSyntax('definition list body')
  }
  const lastBlock = items.at(-1)?.definitions.at(-1)?.at(-1)?.pos
  const endColumn = lastBlock?.endLine === last.number && lastBlock.endColumn !== undefined &&
    lastBlock.endColumn < contentEndColumn(last) ?
    lastBlock.endColumn : contentEndColumn(last)
  return { type: 'definition_list', items, pos: position(first, last, 1, endColumn) }
}

function takeCaption(cursor: Cursor, inline: CursorInline):
  { children: InlineNode[]; line: SourceLine } | undefined {
  const blank = cursor.peek()?.text === '' ? 1 : 0
  const line = cursor.peek(blank)
  const match = line && RE_CAPTION.exec(line.text)
  if (!match) return undefined
  if (blank) cursor.take()
  cursor.take()
  const column = line.text.length - match[1]!.length + 1
  const parts: ContentLine[] = [{ line, column, text: match[1]! }]
  let last = line
  while (cursor.peek() && plainQuoteText(cursor.peek()!.text) &&
      !RE_CAPTION.test(cursor.peek()!.text) && !isBlockStart(cursor.peek()!.text)) {
    last = cursor.take()
    parts.push({ line: last, column: 1, text: last.text })
  }
  return { children: inline.inlines(parts, true), line: last }
}

function takeQuoteCaption(cursor: Cursor, inline: CursorInline, quote: BlockQuote):
  { children: InlineNode[]; line: SourceLine } | undefined {
  return quote.children.length ? takeCaption(cursor, inline) : undefined
}

function positionlessImageCaptionIsText(inline: CursorInline, image: InlineNode,
  first: SourceLine): boolean {
  return inline.positionless && image.type === 'image' &&
    (image.ref !== undefined || image.pos?.startLine !== image.pos?.endLine ||
      /`{2,}/.test(first.text))
}

// A lone `+` before a list marker is paragraph text unless an earlier list, quote or footnote
// in this owner may claim the attachment (a directly preceding list, or a quote or footnote
// until a blank line); then the old split applies.
function plusMayAttachList(cursor: Cursor): boolean {
  if (cursor.owner.inList || (cursor.owner.kind !== 'root' && cursor.owner.kind !== 'colon')) return true
  return cursor.plusAttachRisk || cursor.plusAdjacentRisk
}

function claimIndentedPlusListFollower(cursor: Cursor): void {
  const first = cursor.peek()
  const next = cursor.peek(1)
  if (cursor.owner.kind !== 'root' || !cursor.plusAdjacentRisk ||
      !first?.text.startsWith(' ') || first.text.trim() !== '+' ||
      cursor.physicalLines[first.number - 2]?.text !== '' ||
      !next || !listMarker(next.text) ||
      cursor.peek(2) && !isBlankLine(cursor.peek(2)!.text)) return
  cursor.lines[cursor.at + 1] = { ...next, lazyText: true }
}

function parseParagraphAtCursor(cursor: Cursor, inline: CursorInline): BlockNode {
  const first = cursor.peek()!
  claimIndentedPlusListFollower(cursor)
  const codeInclude = first.text.includes('{{') &&
    parseDirective(first.text.trim())?.code !== undefined
  const parts: ContentLine[] = []
  let last = first
  let captionLead: InlineNode[] | undefined
  let imageCaptionSlot = false
  const literalColonOpener = /^:{3,}(?: *\t| +\{|>)/.test(first.text)
  while (cursor.peek() && !isBlankLine(cursor.peek()!.text) &&
      (parts.length === 0 || ((!interruptsParagraphAtCursor(cursor) || cursor.peek()!.lazyText) &&
        !(parts.length === 1 && parts[0]!.text.trim() === '+' &&
          listMarker(cursor.peek()!.text) && !cursor.peek()!.lazyText &&
          plusMayAttachList(cursor))) ||
        literalColonOpener && /^:{3,}[ \t]*$/.test(cursor.peek()!.text))) {
    if (codeInclude && parts.length > 0) break
    if (imageCaptionSlot && RE_CAPTION.test(cursor.peek()!.text)) break
    if (parts.length === 1 && /^!\[[^\]]*\]\[[^\]]+\][ \t]*$/.test(parts[0]!.line.text) &&
        RE_CAPTION.test(cursor.peek()!.text)) imageCaptionSlot = true
    if (parts.length > 0 && parts[0]!.text.startsWith('![') &&
        RE_CAPTION.test(cursor.peek()!.text)) {
      const lead = inline.inlines(parts)
      if (lead.length === 1 && lead[0]?.type === 'image' &&
          imageReferenceResolved(lead[0], inline) &&
          lead[0].pos?.startOffset === parts[0]!.line.start +
            (parts[0]!.line.text.length - parts[0]!.line.text.trimStart().length) &&
          lead[0].pos?.endOffset === last.start + last.text.length &&
          !positionlessImageCaptionIsText(inline, lead[0], first)) {
        captionLead = lead
        break
      }
    }
    if (parts.length === 1 && parts[0]!.text.startsWith('$$') &&
        RE_CAPTION.test(cursor.peek()!.text)) {
      const lead = inline.inlines(parts)
      if (lead.length === 1 && lead[0]?.type === 'math' && lead[0].display) {
        captionLead = lead
        break
      }
    }
    const line = cursor.take()
    const column = /^[ \t]*/.exec(line.text)![0].length + 1
    parts.push({ line, column, text: line.text.slice(column - 1) })
    last = line
  }
  if (parts.length > 2 && parts[0]!.text.trim() === '+' && listMarker(parts[1]!.text) &&
      parts.some((part) => (part.text[0] === '`' || part.text[0] === '~') && fenceOpen(part.text) ||
        rootLinkDef(part.text) !== null)) {
    throw new UnsupportedCursorSyntax('plus paragraph swallowing a fence or link definition')
  }
  const literalInclude = codeInclude && !/^\{\{ +["“]/.test(parts[0]!.text)
  const literalText = literalInclude ? dropTrailingWhitespace(parts[0]!.text) : ''
  const children: InlineNode[] = literalInclude ? [{ type: 'text', value: literalText,
    pos: position(first, first, parts[0]!.column, parts[0]!.column + literalText.length) }] :
    captionLead ?? inline.inlines(parts)
  const paragraph: Paragraph = { type: 'paragraph', children,
    pos: position(first, last, parts[0]!.column, last.text.replace(/[ \t]+$/, '').length + 1) }
  if (parts[0]!.column > 1 && paragraph.children[0]?.type === 'image') {
    markAboveContentColumn(paragraph)
  }
  if (paragraph.children.length === 1 && paragraph.children[0]?.type === 'image') {
    const image = paragraph.children[0]
    const caption = !positionlessImageCaptionIsText(inline, image, first) &&
      (imageReferenceResolved(image, inline) || cursor.peek()?.text === '') ?
      takeCaption(cursor, inline) : undefined
    if (caption) return { type: 'figure', target: image,
      caption: caption.children,
      pos: position(first, caption.line, first.text.length - first.text.trimStart().length + 1) }
    const baseColumn = first.baseColumn ?? 1
    const imageText = cursor.owner.inList && !indentedPastContent(cursor, first) ? first.text.trimStart() : first.text
    if (!image.ref && isBlockImageLine(imageText) &&
        image.pos?.startColumn === baseColumn + first.text.length - imageText.length &&
        image.pos.endColumn === baseColumn + first.text.length) return image
  }
  if (paragraph.children.length === 1 && paragraph.children[0]?.type === 'math' &&
      paragraph.children[0].display) {
    const caption = takeCaption(cursor, inline)
    if (caption) return { type: 'figure', target: paragraph,
      caption: caption.children, pos: position(first, caption.line) }
  }
  return paragraph
}

/** A list-hosted lone image indented past the item's content column is paragraph text, not a block image. */
function indentedPastContent(cursor: Cursor, first: SourceLine): boolean {
  return cursor.at > 1 && first.text !== first.text.trimStart() && first.lead === undefined &&
    cursor.lines[cursor.at - 2]?.text === ''
}

function parseRawAtCursor(cursor: Cursor, inline: CursorInline): BlockNode {
  const first = cursor.peek()!
  const marker = RE_RAW_FENCE.exec(first.text)?.[1]
  let closedInQuote = false
  if (marker && cursor.owner.kind === 'quote' && cursor.owner.parent?.kind === 'list') {
    for (let offset = cursor.at + 1; cursor.lines[offset]; offset++) {
      if (closesFence(cursor.lines[offset]!.text, marker)) { closedInQuote = true; break }
    }
  }
  if (cursor.owner.inList && cursor.at === 0 && !closedInQuote) {
    throw new UnsupportedCursorSyntax('marker-line raw block')
  }
  const lexer = lexerForCursor(cursor)
  lexer.pos = cursor.at
  const raw = parseRawBlock(lexer)
  if (cursor.owner.kind === 'quote' && lexer.pos === cursor.lines.length &&
      cursor.lines.at(-1)?.text === '') {
    throw new UnsupportedCursorSyntax('quote raw block boundary')
  }
  cursor.at = lexer.pos
  raw.pos = position(first, cursor.lines[cursor.at - 1] ?? first)
  if (inline.recordUnclosedCodeFences) {
    const marker = RE_RAW_FENCE.exec(first.text)?.[1]
    const last = cursor.lines[cursor.at - 1] ?? first
    if (marker && !closesFence(last.text, marker)) {
      inline.diagnostics!.push({ kind: 'fence', event: { line: first.number, column: first.baseColumn ?? 1,
        marker, endLine: last.number + 1,
        reason: last.number >= cursor.physicalLines.length ? 'document' : 'container' } })
    }
  }
  return raw
}

function parseLineBlockAtCursor(cursor: Cursor, inline: CursorInline): BlockNode {
  if (cursor.owner.inList && cursor.at === 0) {
    throw new UnsupportedCursorSyntax('marker-line line block')
  }
  const first = cursor.peek()!
  const lexer = lexerForCursor(cursor)
  lexer.pos = cursor.at
  const block = parseLineBlockWithHelpers({
    definitionRegionLines: null, inMatcherRequest: false, inLineBlock: false,
    activeMatchers: [], quoteGlyphHasNul: false,
    parseInline: (text, _abbr, _links, source, caption) =>
      inline.lineBlockInlines(text, source, caption),
  }, lexer)
  cursor.at = lexer.pos
  block.pos = position(first, cursor.lines[cursor.at - 1] ?? first)
  if (inline.recordUnclosedContainers) {
    const width = RE_LINE_BLOCK_OPEN.exec(first.text)?.[1]?.length
    if (width && !closesColonOwner(cursor.lines[cursor.at - 1]?.text ?? '', width)) {
      const rawColumn = inline.rawLines?.[first.number - 1]?.indexOf(':'.repeat(width),
        (first.baseColumn ?? 1) - 1) ?? -1
      const offset = cursor.owner.kind === 'quote' && rawColumn >= 0 ?
        rawColumn + 1 - (first.baseColumn ?? 1) : 0
      inline.diagnostics!.push({ kind: 'container', event: {
        kind: 'line block', line: first.number, column: (first.baseColumn ?? 1) + offset,
        startOffset: first.start + offset, endOffset: first.start + offset + width, fenceWidth: width,
      } })
    }
  }
  return block
}

function parseNestedCommentAtCursor(cursor: Cursor, run: number): BlockNode | undefined {
  const lexer = lexerForCursor(cursor)
  lexer.pos = cursor.at
  if (!commentBlockHasCloser(lexer, run)) return undefined
  const first = cursor.peek()!
  const previous = cursor.lines[cursor.at - 1]
  const physical = cursor.physicalLines[first.number - 1]
  if (cursor.owner.kind === 'list' && previous?.text === '' && physical?.lead &&
      (first.baseColumn ?? 1) > (physical.baseColumn ?? 1) &&
      listMarker(listMarker(cursor.physicalLines[cursor.lines[0]!.number - 1]?.text ?? '')?.content ?? '') &&
      cursor.lines[0]?.number !== first.number) {
    throw new UnsupportedCursorSyntax('shifted comment after list gap')
  }
  const shiftedAfterNestedList = previous && listMarker(previous.text) &&
    first.number === previous.number + 1 && /^ %%%/.test(first.text)
  if (cursor.owner.inList && cursor.owner.kind !== 'quote' && (cursor.at === 0 ||
      first.text[0] !== '%' && !shiftedAfterNestedList)) {
    throw new UnsupportedCursorSyntax('list comment source ownership')
  }
  const comment = parseCommentBlock(lexer)
  if (cursor.owner.inList && cursor.lines.slice(cursor.at, lexer.pos).some((line) => line.text === '')) {
    throw new UnsupportedCursorSyntax('list comment blank ownership')
  }
  cursor.at = lexer.pos
  const openerColumn = first.text.length - first.text.trimStart().length + 1
  comment.pos = position(first, cursor.lines[cursor.at - 1] ?? first, openerColumn)
  return comment
}

function ambiguousDegradedComment(cursor: Cursor, first: SourceLine,
  atDocumentLevel: boolean, afterList: boolean): boolean {
  if (first.ownedListComment) return false
  if ((atDocumentLevel && !afterList) || !first.text.trimStart().startsWith('%%%')) return false
  if (simpleListDegradedComment(cursor, first)) return false
  const physical = cursor.physicalLines
  const marker = listMarker(physical[first.number - 1]?.text ?? '')
  const priorRootItem = listMarker(physical[first.number - 2]?.text ?? '')
  if (atDocumentLevel && cursor.owner.kind === 'root' && afterList &&
      first.text === first.text.trimStart() && /^%{3,}$/.test(first.text) &&
      priorRootItem?.indent === 0 && plainQuoteText(priorRootItem.content) &&
      plainQuoteText(physical[first.number]?.text ?? '')) return false
  if (cursor.owner.kind === 'quote' && cursor.owner.parent?.kind === 'list' &&
      cursor.lines[0]?.number === first.number && marker?.content === '> %%%' &&
      plainQuoteText(cursor.lines[1]?.text ?? '')) return false
  if (!/^[ \t]+%%%/.test(physical[first.number - 1]?.text ?? '')) return true
  const previousMarker = listMarker(physical[first.number - 2]?.text ?? '')
  if (previousMarker && listMarker(previousMarker.content)) return true
  const next = physical[first.number]?.text ?? ''
  const after = physical[first.number + 1]?.text ?? ''
  return /^[ \t]+\S/.test(next) && /^[^ \t]/.test(after)
}

function simpleListDegradedComment(cursor: Cursor, first: SourceLine): boolean {
  const next = cursor.peek(1)
  const after = cursor.peek(2)
  const event = after?.event
  return cursor.owner.kind === 'list' && cursor.owner.parent?.kind === 'root' &&
    first.text === '%%%' && first.baseColumn === cursor.lines[0]?.baseColumn &&
    next?.number === first.number + 1 && plainQuoteText(next.text) &&
    (!after || after.number === next.number + 1 && plainQuoteText(after.text) &&
      event?.lazy === true && event.kind === 'text' && event.reached === 'doc' &&
      event.missed.length === 1 && event.missed[0] === 'item')
}

function isListGapBlockStart(text: string, body: SourceLine[]): boolean {
  if (ABBR_DEF.test(text)) return false
  if (text[0] === ' ') {
    const unindented = text.trimStart()
    if ((unindented[0] === '`' || unindented[0] === '~') &&
        (fenceOpen(unindented) || RE_RAW_FENCE.test(unindented))) return true
  }
  if (!RE_CAPTION.test(text)) return isBlockStart(text)
  if (listMarker(body[0]?.text ?? '') && body.length > 2 && body.at(-1)?.text === '' &&
      body.slice(1, -1).every((line) => line.text !== '' && !RE_BLOCKQUOTE.test(line.text) &&
        !fenceOpen(line.text) && !COLON_OPEN.test(line.text))) return false
  let only: string | undefined
  for (const line of body) {
    if (line.text === '') continue
    if (only !== undefined) return true
    only = line.text
  }
  return only === undefined || only.startsWith('![') || only.startsWith('$$') || isBlockStart(only)
}

function rejectAmbiguousNestedPlus(cursor: Cursor, marker: ReturnType<typeof listMarker>): void {
  if (!marker || marker.indent === 0 || !/^\+[ \t]*$/.test(marker.content)) return
  const parent = listMarker(cursor.lines[0]?.text ?? '')
  const next = cursor.peek(1)?.text ?? ''
  const indent = /^ */.exec(next)![0].length
  const opener = next.slice(indent)
  const sibling = listMarker(next)?.indent === marker.indent
  const firstBlock = indent === marker.indent && plainPlusText(opener) ||
    indent === marker.width && listMarker(opener) !== undefined
  const quote = RE_BLOCKQUOTE.test(opener) &&
    (!cursor.peek(2) || isBlankLine(cursor.peek(2)!.text))
  const fence = fenceOpen(opener)?.marker
  let closedFence = false
  if (fence) for (let offset = 2; cursor.peek(offset); offset++) {
    const line = cursor.peek(offset)!.text
    if (line.startsWith(' '.repeat(indent)) &&
        closesFence(line.slice(indent), fence)) {
      closedFence = !cursor.peek(offset + 1) || isBlankLine(cursor.peek(offset + 1)!.text)
      break
    }
  }
  if (!parent || parent.ordered || indent > marker.indent + (marker.ordered ? 0 : 2) ||
      !quote && !closedFence && !sibling && !firstBlock) {
    throw new UnsupportedCursorSyntax('indented first-block continuation marker')
  }
}

function rejectRaisedColonContinuation(text: string, frame: { contentColumn?: number } | undefined): void {
  const contentColumn = frame?.contentColumn
  if (contentColumn === undefined) return
  if (/^ {3,}:{3,}(?:[ \t]|$)/.test(text.slice(contentColumn - 1))) {
    throw new UnsupportedCursorSyntax('raised colon list ownership')
  }
}

function rejectAmbiguousListBoundary(marker: ReturnType<typeof listMarker>,
  frame: { indent: number; contentColumn?: number; body: SourceLine[] },
  line: SourceLine): void {
  if (marker && frame.contentColumn !== undefined &&
      marker.indent > frame.indent && marker.indent < frame.contentColumn - 1 &&
      RE_COMMENT_BLOCK_ANY.test(frame.body.at(-1)?.text ?? '')) {
    throw new UnsupportedCursorSyntax('marker after list comment')
  }
  if (frame.body[0]?.text.startsWith('>') && frame.body.at(-1)?.lazyText &&
      line.text.startsWith(' ') && rootLinkDef(line.text.trimStart())) {
    throw new UnsupportedCursorSyntax('quote continuation across list boundary')
  }
}

function rejectListQuoteBoundary(body: SourceLine[], line: SourceLine): void {
  if (line.ownedFirstBlock || line.lazyText) return
  if (body.at(-1)?.text.startsWith('>') &&
      mayContinueQuoteLazily(line.text, body.at(-1)?.text)) {
    throw new UnsupportedCursorSyntax('quote continuation across list boundary')
  }
}

function takeSimpleFirstBlockListPlus(cursor: Cursor, marker: NonNullable<ReturnType<typeof listMarker>>,
  depth: number, contentColumn: number): Array<{ line: SourceLine; prefix: number }> | undefined {
  const markerLineNested = depth === 1 &&
    (cursor.owner.kind === 'list' || cursor.owner.kind === 'quote')
  if (!(depth === 0 || markerLineNested) || marker.content !== '+') return undefined
  const follower = cursor.peek()
  if (!follower) return undefined
  const nestedPlus = depth === 0 && cursor.owner.kind === 'root' && marker.indent > 0 &&
    follower.text.startsWith(' '.repeat(marker.indent)) &&
    plainPlusText(follower.text.slice(marker.indent))
  const nestedList = depth === 0 && cursor.owner.kind === 'root' && marker.indent > 0 &&
    follower.text.startsWith(' '.repeat(contentColumn - 1)) &&
    listMarker(follower.text.slice(contentColumn - 1)) !== undefined
  if (marker.indent !== 0 && !nestedPlus && !nestedList) return undefined
  const after = cursor.peek(1)
  if (follower.text[0] === '\t' && after && RE_BLOCKQUOTE.test(after.text)) {
    throw new UnsupportedCursorSyntax('tab-owned first block before quote')
  }
  if (markerLineNested && cursor.owner.kind === 'list' &&
      (follower.baseColumn ?? 1) > 1 &&
      !RE_BLOCKQUOTE.test(follower.text)) return undefined
  const prefix = ' '.repeat(contentColumn - 1)
  const atContentColumn = prefix.length > 0 && follower.text.startsWith(prefix)
  if (atContentColumn && parseBlockAttributeRun(follower.text.slice(prefix.length)) &&
      after?.text.startsWith(prefix) &&
      fenceOpen(after.text.slice(prefix.length))) {
    const attached: Array<{ line: SourceLine; prefix: number }> = []
    for (let offset = 0; cursor.peek(offset); offset++) {
      const line = cursor.peek(offset)!
      if (!line.text.startsWith(prefix)) return undefined
      attached.push({ line, prefix: prefix.length })
    }
    if (attached.length < 3) return undefined
    for (const _line of attached) cursor.take()
    return attached
  }
  if (!(nestedPlus || nestedList || plainQuoteText(follower.text) ||
      (markerLineNested && RE_BLOCKQUOTE.test(follower.text)) ||
      (atContentColumn && plainQuoteText(follower.text.slice(prefix.length))))) return undefined
  if (after && !isBlankLine(after.text) && listMarker(after.text)?.indent !== 0 &&
      after.text !== '+' && !RE_BLOCKQUOTE.test(after.text) &&
      !RE_HEADING.test(after.text) && !BREAK.test(after.text)) return undefined
  cursor.take()
  return [{ line: follower, prefix: nestedPlus ? marker.indent : atContentColumn ? prefix.length : 0 }]
}

function takeTaskFirstBlockQuote(cursor: Cursor, marker: NonNullable<ReturnType<typeof listMarker>>,
  taskWidth: number, depth: number): Array<{ line: SourceLine; prefix: number }> | undefined {
  const markerLineNested = depth === 1 && cursor.owner.kind === 'list' && marker.indent === 0
  if (!(depth === 0 || markerLineNested) ||
      marker.content.slice(taskWidth) !== '+') return undefined
  const follower = cursor.peek()
  if (!follower) return undefined
  const indent = /^ */.exec(follower.text)![0].length
  if (indent !== 0 && (!markerLineNested && indent !== marker.indent && indent !== marker.width)) {
    return undefined
  }
  if (!RE_BLOCKQUOTE.test(follower.text.slice(indent))) return undefined
  const after = cursor.peek(1)
  if (after && !isBlankLine(after.text)) return undefined
  cursor.take()
  return [{ line: follower, prefix: indent }]
}

function takeTaskFirstBlockFence(cursor: Cursor, marker: NonNullable<ReturnType<typeof listMarker>>,
  taskWidth: number, depth: number): Array<{ line: SourceLine; prefix: number }> | undefined {
  const markerLineNested = depth === 1 && cursor.owner.kind === 'list' && marker.indent === 0
  if (!(depth === 0 || markerLineNested) || marker.content.slice(taskWidth) !== '+') return undefined
  const first = cursor.peek()
  if (!first) return undefined
  const indent = /^ */.exec(first.text)![0].length
  if (indent !== 0 && indent !== marker.indent && indent !== marker.width) return undefined
  const fence = fenceOpen(first.text.slice(indent))?.marker
  if (!fence) return undefined
  const lines: Array<{ line: SourceLine; prefix: number }> = []
  const contentColumn = taskContentColumn(marker, taskWidth) ?? marker.width + 1
  let blankBefore = false
  for (let offset = 0; cursor.peek(offset); offset++) {
    const line = cursor.peek(offset)!
    if (blankBefore && !isBlankLine(line.text) &&
        !line.text.startsWith(' '.repeat(contentColumn - 1))) {
      throw new UnsupportedCursorSyntax('task first-block fence crosses item boundary')
    }
    blankBefore = isBlankLine(line.text)
    const reached = line.text.startsWith(' '.repeat(indent))
    lines.push({ line, prefix: reached ? indent : 0 })
    if (offset > 0 && reached && closesFence(line.text.slice(indent), fence)) {
      for (let i = 0; i < lines.length; i++) cursor.take()
      return lines
    }
  }
  for (let i = 0; i < lines.length; i++) cursor.take()
  return lines
}

function nestedFirstFenceEnd(cursor: Cursor, frame: ListCursorFrame,
  stackLength: number, depth: number): number | undefined {
  if (depth !== 0 || stackLength !== 1 || frame.body.length !== 1 || frame.fenceMarker) return undefined
  const inner = listMarker(frame.body[0]!.text)
  const task = inner && /^\[[ xX\-_>/!?]\] \+$/.test(inner.content)
  if (!task && frame.body[0]!.text !== '> +') return undefined
  return closedFenceEnd(cursor)
}

function unclosedNestedInlineFence(cursor: Cursor, frame: ListCursorFrame,
  stackLength: number): number[] | undefined {
  const line = cursor.peek()
  if (!line || cursor.owner.kind !== 'root' || stackLength < 2 || frame.body.length !== 1 ||
      !plainQuoteText(frame.body[0]!.text) || frame.contentColumn === undefined ||
      !line.text.startsWith(' '.repeat(frame.indent))) return undefined
  const text = line.text.slice(frame.indent)
  const marker = fenceOpen(text)?.marker
  if (!marker || line.text.startsWith(' '.repeat(frame.contentColumn - 1))) return undefined
  const prefixes = [frame.indent]
  for (let offset = 1; cursor.peek(offset); offset++) {
    const following = cursor.peek(offset)!
    if (!plainQuoteText(following.text.trimStart())) return undefined
    const prefix = following.text.startsWith(' '.repeat(frame.indent)) ? frame.indent : 0
    if (closesFence(following.text.slice(prefix), marker)) return undefined
    prefixes.push(prefix)
  }
  return prefixes
}

function nestedSimpleFirstBlock(cursor: Cursor, frame: ListCursorFrame,
  stackLength: number, depth: number): boolean {
  if (depth === 1 && stackLength === 1 && frame.body[0]?.text === '> +' &&
      cursor.peek()?.ownedFirstBlock) return true
  if (depth === 0 && stackLength === 1 && frame.body.length === 1 &&
      frame.body[0]?.text === '> > +' && RE_BLOCKQUOTE.test(cursor.peek()?.text ?? '')) {
    const after = cursor.peek(1)
    return !after || isBlankLine(after.text)
  }
  if (depth !== 0 || stackLength > 2 || frame.body.length !== 1 || frame.fenceMarker) return false
  const inner = listMarker(frame.body[0]!.text)
  const follower = cursor.peek()
  if (!inner || !follower) return false
  const prefix = stackLength === 2 && follower.text.startsWith(' '.repeat(frame.indent)) ?
    frame.indent : 0
  const stackedQuote = inner.content === '> +' && stackLength === 2 &&
    prefix === frame.indent && plainQuoteText(follower.text.slice(prefix))
  if (!(stackedQuote || inner.content === '+' &&
      (stackLength === 1 && plainQuoteText(follower.text) ||
       stackLength === 2 && RE_BLOCKQUOTE.test(follower.text.slice(prefix))))) return false
  const after = cursor.peek(1)
  return !after || isBlankLine(after.text)
}

function nestedQuoteFirstHeading(cursor: Cursor, frame: ListCursorFrame,
  stackLength: number, depth: number): boolean {
  if (depth !== 0 || stackLength !== 2 || frame.body.length !== 1 ||
      frame.body[0]!.text !== '> +' || !RE_HEADING.test(cursor.peek()?.text ?? '')) return false
  const after = cursor.peek(1)
  return !after || isBlankLine(after.text)
}

function takeListFirstBlock(cursor: Cursor, marker: NonNullable<ReturnType<typeof listMarker>>,
  taskWidth: number, depth: number, contentColumn: number):
  Array<{ line: SourceLine; prefix: number }> | undefined {
  return takeSimpleFirstBlockListPlus(cursor, marker, depth, contentColumn) ??
    takeTaskFirstBlockQuote(cursor, marker, taskWidth, depth) ??
    takeTaskFirstBlockFence(cursor, marker, taskWidth, depth)
}

function isRefusedTaskFirstBlock(marker: NonNullable<ReturnType<typeof listMarker>>,
  taskWidth: number, next: SourceLine | undefined, depth: number): boolean {
  if (depth !== 0 || marker.indent === 0 || marker.content.slice(taskWidth) !== '+' || !next) return false
  const indent = /^ */.exec(next.text)![0].length
  return indent > 0 && indent < marker.indent &&
    (RE_BLOCKQUOTE.test(next.text.slice(indent)) || fenceOpen(next.text.slice(indent)) !== null)
}

function isUnattachedRootFirstBlock(marker: NonNullable<ReturnType<typeof listMarker>>,
  taskWidth: number, next: SourceLine | undefined, depth: number, owner: ContainerOwner): boolean {
  const hosted = depth === 1 && owner.parent?.kind === 'root' &&
    (owner.kind === 'colon' || owner.kind === 'definition')
  if (!(depth === 0 || hosted) || marker.indent !== 0 || marker.content.slice(taskWidth) !== '+') return false
  const nextIndent = next ? /^ */.exec(next.text)![0].length : 0
  return next === undefined || isBlankLine(next.text) ||
    (nextIndent > 0 || hosted) && nextIndent < marker.width + taskWidth ||
    (listMarker(next.text)?.indent ?? Number.POSITIVE_INFINITY) <= marker.indent
}

function isRefusedListFirstBlock(marker: NonNullable<ReturnType<typeof listMarker>>,
  taskWidth: number, next: SourceLine | undefined, depth: number, owner: ContainerOwner): boolean {
  return isUnattachedRootFirstBlock(marker, taskWidth, next, depth, owner) ||
    isRefusedTaskFirstBlock(marker, taskWidth, next, depth) ||
    depth === 1 && owner.kind === 'list' && marker.indent === 0 &&
    marker.content.slice(taskWidth) === '+' && (!next || (next.baseColumn ?? 1) > 1)
}

function isFenceMarkerContinuation(marker: ReturnType<typeof listMarker>, fenceMarker: string | undefined,
  contentColumn: number | undefined, text: string): boolean {
  return marker !== undefined && fenceMarker !== undefined && contentColumn !== undefined &&
    text.startsWith(' '.repeat(contentColumn - 1))
}

function listFenceContinuationClaim(marker: ReturnType<typeof listMarker>, frame: ListCursorFrame,
  line: SourceLine, owner: ContainerOwner, stackLength: number,
  orderedRoot: boolean): { line: SourceLine; prefix: number } | undefined {
  const column = frame.contentColumn
  if (owner.kind === 'root' && stackLength === 1 && orderedRoot &&
      frame.fenceMarker && column !== undefined && line.text.trim() === '' &&
      reachableListPrefix(line.text, column) === undefined) {
    return { line: { ...line, text: '' }, prefix: 0 }
  }
  return isFenceMarkerContinuation(marker, frame.fenceMarker, column, line.text) ?
    { line, prefix: column! - 1 } : undefined
}

function listContinuationFollower(cursor: Cursor, frame: ListCursorFrame,
  depth: number): Array<{ line: SourceLine; prefix: number }> {
  const indent = frame.indent
  const fenceMarker = frame.fenceMarker
  const next = cursor.peek(1)
  const after = cursor.peek(2)
  const ownPrefix = indent > 0 && next ? reachableListPrefix(next.text, indent + 1) : undefined
  const ownColumnQuote = ownPrefix !== undefined && next !== undefined &&
    RE_BLOCKQUOTE.test(next.text.slice(ownPrefix)) && !after
  const quoteContinuation = depth === 1 && cursor.owner.kind === 'quote' &&
    listMarker(cursor.lines[0]?.text ?? '')?.content.trim() !== '+'
  if (!(depth === 0 || quoteContinuation) ||
      fenceMarker || indent !== 0 && !ownColumnQuote) {
    throw new UnsupportedCursorSyntax('nested list continuation')
  }
  if (indent === 0 && next && fenceOpen(next.text)) {
    const marker = fenceOpen(next.text)!.marker
    const lines: Array<{ line: SourceLine; prefix: number }> = [{ line: next, prefix: 0 }]
    for (let offset = 2; cursor.peek(offset); offset++) {
      const line = cursor.peek(offset)!
      lines.push({ line, prefix: 0 })
      if (closesFence(line.text, marker)) {
        const caption = cursor.peek(offset + 1)
        if (caption && RE_CAPTION.test(caption.text)) lines.push({ line: caption, prefix: 0 })
        return lines
      }
    }
    throw new UnsupportedCursorSyntax('unclosed attached fence')
  }
  if (indent === 0 && next && RE_BLOCKQUOTE.test(next.text)) {
    const lines: Array<{ line: SourceLine; prefix: number }> = [{ line: next, prefix: 0 }]
    let offset = 2
    while (cursor.peek(offset) && RE_BLOCKQUOTE.test(cursor.peek(offset)!.text)) {
      lines.push({ line: cursor.peek(offset)!, prefix: 0 })
      offset++
    }
    const boundary = cursor.peek(offset)
    const sibling = boundary && listMarker(boundary.text)
    if (!boundary || isBlankLine(boundary.text) ||
        sibling?.indent === 0 && sameListKind(sibling, frame)) return lines
    throw new UnsupportedCursorSyntax('multiline list continuation')
  }
  if (!next || next.text === '' || next.text === '+' && RE_BLOCKQUOTE.test(after?.text ?? '') ||
      !ownColumnQuote &&
      (next.text[0] === ' ' || next.text[0] === '\t') ||
      isBlockStart(next.text) ||
      (after && after.text !== '' && !listMarker(after.text) &&
        !RE_BLOCKQUOTE.test(after.text))) {
    throw new UnsupportedCursorSyntax('multiline list continuation')
  }
  return [{ line: next, prefix: ownColumnQuote ? ownPrefix! : 0 }]
}

function attachedPlainFollower(attached: Array<{ line: SourceLine; prefix: number }>): boolean {
  return attached.length === 1 && plainQuoteText(attached[0]!.line.text)
}

function nestedPlusDisposition(cursor: Cursor,
  frame: { indent: number; item?: ListItem; fenceMarker: string | undefined },
  stackLength: number): SourceLine[] | 'literal' | undefined {
  const text = cursor.peek()!.text
  if (text.charCodeAt(text.length - 1) !== 43 || stackLength < 2 || !frame.item ||
      frame.fenceMarker || text.length !== frame.indent + 1 ||
      text !== `${' '.repeat(frame.indent)}+`) return undefined
  const follower = cursor.peek(1)
  if (!follower || !follower.text.startsWith(' '.repeat(frame.indent))) return 'literal'
  const content = follower.text.slice(frame.indent)
  const attribute = parseBlockAttributeRun(content)
  if (attribute) {
    const opener = cursor.peek(2)
    const fenced = opener?.text.startsWith(' '.repeat(frame.indent)) ?
      fenceOpen(opener.text.slice(frame.indent))?.marker : undefined
    if (fenced) {
      const lines = [follower, opener!]
      for (let offset = 3; cursor.peek(offset); offset++) {
        const next = cursor.peek(offset)!
        if (!next.text.startsWith(' '.repeat(frame.indent))) {
          throw new UnsupportedCursorSyntax('nested attached fence owner')
        }
        lines.push(next)
        if (closesFence(next.text.slice(frame.indent), fenced)) return lines
      }
      throw new UnsupportedCursorSyntax('unclosed nested attached fence')
    }
  }
  const fence = fenceOpen(content)?.marker
  if (fence) {
    const lines = [follower]
    for (let offset = 2; cursor.peek(offset); offset++) {
      const next = cursor.peek(offset)!
      if (!next.text.startsWith(' '.repeat(frame.indent))) {
        throw new UnsupportedCursorSyntax('nested attached fence owner')
      }
      lines.push(next)
      if (closesFence(next.text.slice(frame.indent), fence)) return lines
    }
    throw new UnsupportedCursorSyntax('unclosed nested attached fence')
  }
  if (!RE_BLOCKQUOTE.test(content) && !plainQuoteText(content)) return 'literal'
  const after = cursor.peek(2)
  return !after || isBlankLine(after.text) ? [follower] : 'literal'
}

function nestedPlusAtLine(cursor: Cursor, frame: ListCursorFrame,
  stackLength: number, line: SourceLine): ReturnType<typeof nestedPlusDisposition> {
  return line.text.charCodeAt(line.text.length - 1) === 43 ?
    nestedPlusDisposition(cursor, frame, stackLength) : undefined
}

function isTaskMarkerContent(content: string, ordered: boolean): boolean {
  return !ordered && /^\[([ xX\-_>/!?])\] /.test(content)
}

function takeTaskMarker(item: ListItem, content: string, ordered: boolean): number {
  if (ordered) return 0
  const task = /^\[([ xX\-_>/!?])\] /.exec(content)
  if (!task) return 0
  item.checked = task[1]!.toLowerCase() === 'x'
  if (task[1] !== ' ' && task[1]!.toLowerCase() !== 'x') item.taskState = task[1] as TaskState
  return task[0].length
}

/** The ownership walk puts a bullet task item's content column two past the marker, whatever its spacing. */
function taskContentColumn(marker: NonNullable<ReturnType<typeof listMarker>>,
  taskWidth: number): number | undefined {
  if (taskWidth === 0 || 'continuationWidth' in marker || marker.indent !== marker.authoredIndent) return undefined
  return marker.indent + 3
}

function sameListKind(marker: NonNullable<ReturnType<typeof listMarker>>,
  frame: { ordered: boolean; delim?: '.' | ')'; bullet?: '-' | '*'; taskList: boolean }): boolean {
  return marker.ordered === frame.ordered && marker.delim === frame.delim &&
    marker.bullet === frame.bullet && isTaskMarkerContent(marker.content, marker.ordered) === frame.taskList
}

function endsListBlankRun(blanks: number, next: SourceLine | undefined, rootIndent: number): boolean {
  const marker = next ? listMarker(next.text) : undefined
  return next === undefined || (blanks >= 3 && marker !== undefined && marker.indent <= rootIndent)
}

function isFenceBlankContinuation(cursor: Cursor, frame: ListCursorFrame, next: SourceLine | undefined,
  stackLength: number, depth: number): boolean {
  if (frame.fenceMarker === undefined) return false
  if (!next) return stackLength === 1 && depth === 0 && cursor.owner.kind === 'root' &&
    frame.itemFirst?.number === frame.body[0]?.number
  return frame.contentColumn !== undefined &&
    next.text.startsWith(' '.repeat(frame.contentColumn - 1))
}

function isListContinuationMarker(cursor: Cursor, line: SourceLine, frame: ListCursorFrame): boolean {
  if (!frame.item) return false
  if (line.text === '+' || line.text === `${' '.repeat(frame.indent)}+`) return true
  if (line.text.includes('\t') && line.text.endsWith('+')) {
    let column = 0
    for (const char of line.text.slice(0, -1)) {
      if (char === ' ') column++
      else if (char === '\t') column += 4 - column % 4
      else return false
    }
    const next = cursor.peek(1)
    const nextPrefix = next ? reachableListPrefix(next.text, frame.indent + 1) : undefined
    if (column === frame.indent && nextPrefix !== undefined && !cursor.peek(2) &&
        RE_BLOCKQUOTE.test(next!.text.slice(nextPrefix))) return true
  }
  return line.text === '+ ' && plainQuoteText(cursor.peek(1)?.text ?? '') &&
    (!cursor.peek(2) || cursor.peek(2)!.text === '')
}

function startsNestedListAfterLongBlankRun(blanks: number,
  marker: ReturnType<typeof listMarker>, rootIndent: number): boolean {
  return blanks >= 3 && marker !== undefined && marker.indent > rootIndent
}

function entersOpenListCodeSpan(body: SourceLine[], follower: string,
  contentColumn: number | undefined): boolean {
  const closer = /^ *(`{3,})[ \t]*$/.exec(follower)
  if (!closer || contentColumn === undefined ||
      closer[0].length - closer[0].trimStart().length >= contentColumn - 1 ||
      body.length < 2 || !plainQuoteText(body[0]!.text) ||
      body.some((line) => line.text === '')) return false
  const text = body.map((line) => line.text).join('\n')
  for (let at = 0; at < text.length; at++) {
    if (text[at] !== '`') continue
    const span = verbatimSpanEnd(text, at)
    if (!span.closed) return true
    at = span.end - 1
  }
  return false
}

function hasUnclosedListCodeSpan(body: SourceLine[]): boolean {
  if (body.length < 2 || body.some((line) => line.text === '')) return false
  const text = body.map((line) => line.text).join('\n')
  for (let at = 0; at < text.length; at++) {
    if (text[at] !== '`') continue
    const span = verbatimSpanEnd(text, at)
    if (!span.closed) return true
    at = span.end - 1
  }
  return false
}

function hasLaterIndentedTildeCloser(cursor: Cursor, indent: number, marker: string): boolean {
  const prefix = ' '.repeat(indent)
  for (let offset = 1; cursor.peek(offset); offset++) {
    const text = cursor.peek(offset)!.text
    if (text.startsWith(prefix) && closesFence(text.slice(indent), marker)) return true
  }
  return false
}

function attachedListFenceCaption(frame: ListCursorFrame, line: SourceLine,
  owner: ContainerOwner, stackLength: number, reachedPrefix: number | undefined): boolean {
  if (reachedPrefix !== undefined || stackLength !== 1 || owner.kind !== 'root' ||
      frame.indent !== 0 || frame.fenceMarker || frame.body.length < 2 ||
      line.text[0] !== '^' || !RE_CAPTION.test(line.text)) return false
  const marker = fenceOpen(frame.body[0]!.text)?.marker
  return marker !== undefined && closesFence(frame.body.at(-1)!.text, marker)
}

function foldsListTildeRun(body: SourceLine[], follower: string,
  contentColumn: number | undefined): boolean {
  const run = /^( +)(~{3,})[ \t]*$/.exec(follower)
  return run !== null && contentColumn !== undefined &&
    run[1]!.length < contentColumn - 1 && body.length >= 2 &&
    plainQuoteText(body[0]!.text) &&
    body.every((line) => line.text !== '') &&
    body.some((line) => line.text.trimStart() === run[2])
}

function mayFoldNestedListParagraph(cursor: Cursor,
  top: { indent: number; contentColumn?: number; ordered: boolean;
    delim?: '.' | ')'; bullet?: '-' | '*'; taskList: boolean;
    body: SourceLine[]; fenceMarker: string | undefined }, stackLength: number): boolean {
  if (stackLength < 2 || top.fenceMarker) return false
  const follower = cursor.peek()!.text
  const last = top.body.at(-1)?.text ?? ''
  const tilde = cursor.owner.kind === 'quote' ? /^( +)(~{3,})[ \t]*$/.exec(follower) : null
  if (tilde && hasUnclosedListCodeSpan(top.body) &&
      !hasLaterIndentedTildeCloser(cursor, tilde[1]!.length, tilde[2]!)) return true
  const lastLine = top.body.at(-1)
  if (cursor.peek()!.ownedLazy && lastLine?.ownedLazy && lastLine.number === cursor.peek()!.number - 1 &&
      top.body.length > 1 && plainQuoteText(top.body[0]!.text) &&
      /^ *(?:`{3,}|~{3,})/.test(top.body.find((line) => line.ownedLazy)?.text ?? '')) return true
  const nonRowPipe = follower.trimStart().startsWith('|') &&
    !isTableRow(follower.trimStart()) && follower.startsWith(' ')
  if ((plainQuoteText(follower) || nonRowPipe ||
      follower.startsWith('+ ') && top.body.at(-1)?.lazyText &&
      top.body.at(-1)?.text.trimStart().startsWith('|')) &&
      (plainQuoteText(last) || nonRowPipe || top.body.at(-1)?.lazyText ||
        last === '+' && plainQuoteText(top.body.at(-2)?.text ?? ''))) return true
  return (follower[0] === ' ' || follower[0] === '`') && follower.includes('`') &&
    entersOpenListCodeSpan(top.body, follower, top.contentColumn) ||
    follower[0] === ' ' && follower.includes('~') &&
    foldsListTildeRun(top.body, follower, top.contentColumn)
}

function mayFoldBelowColumnParagraph(cursor: Cursor,
  frame: { contentColumn?: number; fenceMarker: string | undefined; body: SourceLine[] },
  stack: readonly ListCursorFrame[]): boolean {
  const next = cursor.peek()!
  const last = frame.body.at(-1)
  const literalNested = listLiteralLazyTailOwner(cursor, frame.body, next)
  if (!frame.contentColumn || frame.fenceMarker || !last ||
      next.text.startsWith(' '.repeat(frame.contentColumn - 1)) ||
      last.number !== next.number - 1 || isBlankLine(next.text) ||
      isBlockStart(next.text) && !literalNested) return false
  if (next.text.includes('\t')) {
    const reached = reachableListPrefix(next.text, frame.contentColumn)
    if (reached !== undefined && isTableRow(next.text.slice(reached))) return false
  }
  const emphasizedAfterOwnerCut = frame.body.length === 1 && /^\*[^*]+\*$/.test(last.text) &&
    next.ownedLazy === true && next.event?.missed.length === 1 && next.event.missed[0] === 'item'
  if (!plainQuoteText(last.text) && !last.claimedQuoteLazy && !emphasizedAfterOwnerCut &&
      !(plainPlusText(last.text) && frame.body[0]?.text[0] !== '|')) {
    const nestedMarker = frame.body.length === 1 ? listMarker(last.text) : undefined
    if ((!nestedMarker || !plainQuoteText(nestedMarker.content)) && !literalNested) return false
  }
  if (literalNested) return true
  const raised = next.text.trimStart()
  if (raised.startsWith('>') || raised.startsWith('`') || raised.startsWith('~') ||
      raised.startsWith('{') || raised.startsWith('::')) return false
  return deepestReachableFrame(stack, next.text, true) === undefined
}

function listLiteralLazyTailOwner(cursor: Cursor, body: SourceLine[],
  line: SourceLine): boolean {
  const event = line.event
  return cursor.owner.kind === 'root' && plainQuoteText(body[0]?.text ?? '') &&
    /^: {2,}/.test(body.at(-1)?.text ?? '') &&
    body.at(-1)?.number === line.number - 1 &&
    (line.text.startsWith('>>') && listMarker(line.text.slice(2)) !== undefined ||
      /^: {2,}/.test(line.text)) && event?.lazy === true &&
    event.kind === 'text' && event.reached === 'doc' &&
    event.missed.length === 1 && event.missed[0] === 'item'
}

function ownsBelowColumnQuotedLiteral(body: SourceLine[], follower: string): boolean {
  const first = body[0]?.text
  const last = body.at(-1)?.text
  return first?.startsWith('>') === true && nestedQuoteParagraphText(first) &&
    last !== undefined && /^>  (?:\[|\{)/.test(last) && plainQuoteText(follower)
}

function markBelowColumnQuotedLiteral(body: SourceLine[], line: SourceLine): SourceLine {
  return ownsBelowColumnQuotedLiteral(body, line.text) ? { ...line, lazyText: true } : line
}

function foldedNestedParagraphLine(body: SourceLine[], line: SourceLine): SourceLine {
  const folded = markBelowColumnQuotedLiteral(body, line)
  return folded.text.trimStart().startsWith('|') &&
    !isTableRow(folded.text.trimStart()) ? { ...folded, lazyText: true } : folded
}

/** A `>` run that opens no quote, which the walk read as lazy text of an item paragraph under the document. */
function notAQuoteLazyText(line: SourceLine): boolean {
  const event = line.event
  return line.text[0] === '>' && !RE_BLOCKQUOTE.test(line.text) && event?.kind === 'text' &&
    event.lazy && event.reached === 'doc' && event.missed.length === 1 && event.missed[0] === 'item'
}

function mayFoldRootListParagraph(cursor: Cursor,
  frame: { indent: number; contentColumn?: number;
    fenceMarker: string | undefined; body: SourceLine[];
    lazyRootParagraph: boolean },
  stackLength: number, depth: number): boolean {
  const next = cursor.peek()!
  const first = frame.body[0]
  const last = frame.body.at(-1)
  const retainedCommentParagraph = first !== undefined && frame.body.length === 1 &&
    first.text.startsWith(' ') && first.number > 1 &&
    LINE_COMMENT.test(cursor.physicalLines[first.number - 2]?.text.trimStart() ?? '')
  const literalAbbreviation = frame.body.length >= 2 && first !== undefined &&
    last !== undefined && plainQuoteText(first.text) && ABBR_DEF.test(last.text)
  if (!(depth === 0 || depth === 1 &&
      (cursor.owner.kind === 'list' || cursor.owner.kind === 'definition' ||
        cursor.owner.kind === 'quote')) ||
      stackLength !== 1 || frame.indent !== 0 || frame.fenceMarker ||
      last?.number !== next.number - 1 ||
      !(frame.lazyRootParagraph || retainedCommentParagraph || literalAbbreviation ||
        ownsBelowColumnQuotedLiteral(frame.body, next.text) ||
        frame.body.length === 1 &&
        first !== undefined &&
        (plainQuoteText(first.text) || listFirstBlockParagraphText(first.text)))) return false
  if (frame.contentColumn !== undefined &&
      next.text.startsWith(' '.repeat(frame.contentColumn - 1))) {
    const owned = next.text.slice(frame.contentColumn - 1)
    if (isBlockStart(owned) || rootLinkDef(owned) !== null ||
        FOOTNOTE_DEF.test(owned)) return false
  }
  const follower = next.text
  let continues = plainQuoteText(follower) || ABBR_DEF.test(follower) || notAQuoteLazyText(next) ||
    frame.lazyRootParagraph &&
    frame.body[0]?.text[0] !== '>' && !isBlankLine(follower) && !isBlockStart(follower)
  if (!continues && frame.contentColumn !== undefined) {
    const indent = /^ */.exec(follower)![0].length
    if (indent > frame.indent && indent < frame.contentColumn - 1) {
      const content = follower.slice(indent)
      continues = content !== '' && content[0] !== '[' && content[0] !== '{' &&
        content[0] !== '+' && (cursor.owner.kind === 'definition' || !content.startsWith('*[')) &&
        !content.startsWith('%%')
    }
  }
  return continues
}

function mayFoldMarkerLineNestedFollower(cursor: Cursor,
  frame: { body: SourceLine[]; fenceMarker: string | undefined },
  stackLength: number, depth: number): boolean {
  if (!(depth === 0 || depth === 1 && cursor.owner.kind === 'quote') ||
      stackLength !== 1 || frame.fenceMarker || frame.body.length !== 1) return false
  const first = frame.body[0]!
  const marker = listMarker(first.text)
  const follower = cursor.peek()!
  if (first.number !== follower.number - 1) return false
  if (first.text === '> +' && (RE_BLOCKQUOTE.test(follower.text) ||
      RE_HEADING.test(follower.text) || isTableRow(follower.text)) && !cursor.peek(1)) return true
  return marker !== undefined &&
    (plainQuoteText(marker.content) && plainQuoteText(follower.text) ||
      marker.content.startsWith('+ ') && marker.content.includes('|') &&
      plainQuoteText(follower.text) ||
      (marker.content === '+' || /^\[[ xX\-_>/!?]\] \+$/.test(marker.content)) &&
      RE_BLOCKQUOTE.test(follower.text) && !cursor.peek(1))
}

function mayFoldListParagraph(cursor: Cursor,
  frame: { indent: number; contentColumn?: number; ordered: boolean;
    delim?: '.' | ')'; bullet?: '-' | '*';
    taskList: boolean; fenceMarker: string | undefined; body: SourceLine[];
    lazyRootParagraph: boolean }, stack: readonly ListCursorFrame[], depth: number): boolean {
  return mayFoldNestedListParagraph(cursor, frame, stack.length) ||
    mayFoldRootListParagraph(cursor, frame, stack.length, depth) ||
    mayFoldMarkerLineNestedFollower(cursor, frame, stack.length, depth) ||
    mayFoldBelowColumnParagraph(cursor, frame, stack)
}

function finalNestedListLazyLine(cursor: Cursor, body: SourceLine[]): 'fold' | undefined {
  const line = cursor.peek()!
  return line.ownedLazy && plainQuoteText(body.at(-1)?.text ?? '') &&
    plainQuoteText(line.text.trimStart()) ? 'fold' : undefined
}

function isBelowListMarkerColumn(marker: NonNullable<ReturnType<typeof listMarker>>,
  top: { indent: number; contentColumn?: number; fenceMarker: string | undefined;
    body: SourceLine[]; retainedBelowColumnComment: boolean; ordered: boolean },
  depth: number, line: SourceLine, owner: ContainerOwner, stackLength: number): boolean {
  const colonLazyItem = depth === 1 && owner.kind === 'colon' &&
    line.event?.kind === 'item' && line.event.lazy &&
    line.event.reached === 'colon' && line.event.missed.length === 1 &&
    line.event.missed[0] === 'item'
  if (!(depth === 0 || depth === 1 &&
      (owner.kind === 'list' || owner.kind === 'quote') || colonLazyItem) ||
      stackLength !== 1 ||
      top.fenceMarker || top.contentColumn === undefined ||
      marker.indent <= top.indent || marker.indent >= top.contentColumn - 1 ||
      top.body.at(-1)?.number !== line.number - 1) return false
  const last = top.body.at(-1)!.text
  if (owner.kind === 'root' && top.ordered && /^: +\S/.test(last) &&
      line.event?.kind === 'item' && line.event.lazy && line.event.reached === 'doc' &&
      line.event.missed.length === 1 && line.event.missed[0] === 'item' &&
      top.body.at(-1)?.event?.kind === 'text' && top.body.at(-1)?.event?.lazy) return true
  if (top.retainedBelowColumnComment) return true
  if (plainQuoteText(last) || last[0] === ' ' && plainQuoteText(last.trimStart()) &&
      top.body.every((part) => plainQuoteText(part.text.trimStart()))) return true
  if (owner.kind === 'root' && top.ordered && hasUnclosedListCodeSpan(top.body)) return true
  if (nestedQuoteParagraphText(last)) return true
  const priorMarker = listMarker(last)
  if (depth === 0 && owner.kind === 'root' &&
      priorMarker?.indent === marker.indent && plainQuoteText(priorMarker.content) &&
      top.body.length > 1 && top.body[0]!.text !== '' &&
      plainQuoteText(top.body[0]!.text)) return true
  const innerMarker = depth === 0 && top.body.length === 1 ? listMarker(last) : undefined
  return innerMarker !== undefined && plainQuoteText(innerMarker.content)
}

function isDedentedNestedParagraphMarker(marker: NonNullable<ReturnType<typeof listMarker>>,
  stack: readonly ListCursorFrame[], line: SourceLine): boolean {
  const top = stack.at(-1)
  const parent = stack[0]
  return stack.length === 2 && top !== undefined && parent !== undefined &&
    parent.contentColumn !== undefined && top.indent === parent.contentColumn - 1 &&
    marker.indent > parent.indent && marker.indent < top.indent &&
    top.body.at(-1)?.number === line.number - 1 &&
    plainQuoteText(top.body.at(-1)?.text ?? '')
}

function belowColumnListBody(line: SourceLine,
  marker: NonNullable<ReturnType<typeof listMarker>>,
  frame: { body: SourceLine[]; retainedBelowColumnComment: boolean }):
  { line: SourceLine; prefix: number } {
  const quoteFirstBlock = frame.body[0]?.text.startsWith('>')
  return { line: frame.retainedBelowColumnComment || quoteFirstBlock ?
    { ...line, lazyText: true } : line, prefix: quoteFirstBlock ? marker.indent : 0 }
}

function markerFallsBetweenListColumns(marker: ReturnType<typeof listMarker>,
  top: { indent: number; contentColumn?: number }): boolean {
  return marker !== undefined && top.contentColumn !== undefined &&
    marker.indent > top.indent && marker.indent < top.contentColumn - 1
}

function preservesNestedListGap(frame: { indent: number; contentColumn?: number;
  body: SourceLine[] }, nextMarker: ReturnType<typeof listMarker>): boolean {
  return nextMarker !== undefined && frame.contentColumn !== undefined &&
    nextMarker.indent > frame.indent && nextMarker.indent === frame.contentColumn - 1 &&
    listMarker(frame.body[0]?.text ?? '') !== undefined
}

function allowsEmptyRetainedFence(frame: { bareFenceAfterRetainedComment: boolean;
  fenceMarker: string | undefined; body: SourceLine[]; contentColumn?: number },
next: SourceLine | undefined): boolean {
  return frame.bareFenceAfterRetainedComment && frame.fenceMarker !== undefined &&
    /^(?:`{3,}|~{3,})$/.test(frame.body.at(-1)?.text ?? '') &&
    frame.contentColumn !== undefined &&
    !next?.text.startsWith(' '.repeat(frame.contentColumn - 1))
}

function nestedListSpanColumn(owner: ContainerOwner, hostColumn: number | undefined,
  markerIndent: number): number {
  return owner.kind === 'root' || owner.kind === 'colon' ?
    hostColumn ?? markerIndent + 1 : markerIndent + 1
}

function updateListFrameEnds(frames: Array<{ last: SourceLine; spanColumn: number;
  item?: ListItem; itemFirst?: SourceLine }>, line: SourceLine,
listSpan: (from: SourceLine, to: SourceLine, column: number) => Position): void {
  for (const frame of frames) {
    frame.last = line
    if (frame.item && frame.itemFirst) frame.item.pos = listSpan(frame.itemFirst, line, frame.spanColumn)
  }
}

type ListCursorFrame = { list: List; first: SourceLine; last: SourceLine; indent: number;
  spanColumn: number;
  ordered: boolean; taskList: boolean; kind?: OlKind; delim?: '.' | ')'; bullet?: '-' | '*';
  item?: ListItem; itemFirst?: SourceLine; contentColumn?: number;
  fenceMarker: string | undefined; fencePrefix: number | undefined; fenceMayDedent: boolean;
  fenceOpenedAt?: number;
  fenceBoundary?: SourceLine;
  quoteFenceMarker: string | undefined; quoteFenceDepth: number; closedQuoteFence: boolean;
  body: SourceLine[]; plainBody: boolean; lazyFoldBody: boolean;
  attachedPlain: boolean;
  blankBeforeInvisible: boolean; lazyRootParagraph: boolean;
  retainedBelowColumnComment: boolean; bareFenceAfterRetainedComment: boolean;
  possibleInvisibleTail: boolean; ownerState?: ItemLazyState }

function openColonParagraphClaimsListMarker(cursor: Cursor, frame: ListCursorFrame,
  line: SourceLine, marker: NonNullable<ReturnType<typeof listMarker>>): boolean {
  const opener = frame.body.at(-2)
  const paragraph = frame.body.at(-1)
  return cursor.owner.kind === 'root' && frame.contentColumn !== undefined &&
    opener?.baseColumn !== undefined && /^:{3,}(?:[ \t]|$)/.test(opener.text) &&
    opener.baseColumn >= frame.contentColumn &&
    paragraph?.number === line.number - 1 && plainQuoteText(paragraph.text) &&
    (line.baseColumn ?? 1) + marker.indent >= frame.contentColumn
}

function raisedEmptyColonClaimsListMarker(cursor: Cursor, frame: ListCursorFrame,
  line: SourceLine, marker: NonNullable<ReturnType<typeof listMarker>>): boolean {
  const opener = frame.body.at(-1)
  return cursor.owner.kind === 'root' && frame.contentColumn !== undefined &&
    opener?.baseColumn !== undefined && /^:{3,}[ \t]*$/.test(opener.text) &&
    cursor.physicalLines[opener.number - 2]?.text === '' &&
    opener.baseColumn > frame.contentColumn + 2 &&
    opener.number === line.number - 1 &&
    (line.baseColumn ?? 1) + marker.indent >= frame.contentColumn
}

function ownedListMarker(cursor: Cursor, frame: ListCursorFrame, line: SourceLine,
  marker: NonNullable<ReturnType<typeof listMarker>>): ReturnType<typeof quoteOwnedListMarker> {
  if (frame.attachedPlain && frame.contentColumn !== undefined &&
      marker.indent >= frame.contentColumn - 1 &&
      frame.body.at(-1)?.number === line.number - 1 &&
      plainQuoteText(frame.body.at(-1)!.text)) {
    return { line: { ...line, lazyText: true }, prefix: 0, rootLazy: true }
  }
  if (openColonParagraphClaimsListMarker(cursor, frame, line, marker)) {
    return { line: { ...line, lazyText: true }, prefix: marker.indent, rootLazy: true }
  }
  if (raisedEmptyColonClaimsListMarker(cursor, frame, line, marker)) {
    return { line, prefix: marker.indent, rootLazy: false }
  }
  return quoteOwnedListMarker(cursor, line, marker, frame)
}

/** A flush-left plain line the walk keeps in the hoisted note of an item's only quote: the quote stays empty. */
function quoteNoteLazyClaim(frame: ListCursorFrame, line: SourceLine,
  marker: ReturnType<typeof listMarker>): boolean {
  const previous = frame.body.at(-1)
  return line.ownedLazy === true && !marker && previous?.number === line.number - 1 &&
    listNoteLazyText(line.text) && frame.body.length >= 2 &&
    plainQuoteText(frame.body[0]!.text.replace(/^> /, '')) &&
    frame.body.slice(1).every((part, index) => index === 0 ? quotedPlainNoteHead(part.text) :
      part.noteLazy || quotedNoteSubLine(part.text))
}

function sharedQuoteClaimsLine(cursor: Cursor, frame: ListCursorFrame, line: SourceLine,
  marker: ReturnType<typeof listMarker>): boolean {
  if (!frame.ownerState) return false
  const previous = frame.body.at(-1)
  if (quoteNoteLazyClaim(frame, line, marker)) return true
  if (cursor.peek(1) && !frame.body[0]?.text.startsWith('>') &&
      previous?.number === line.number - 1 &&
      previous.text.startsWith('>') &&
      FOOTNOTE_DEF.test(previous.text.slice(previous.text[1] === ' ' ? 2 : 1))) {
    throw new UnsupportedCursorSyntax('quoted footnote follower owner')
  }
  if (previous?.number !== line.number - 1) return false
  const quote = frame.ownerState?.quoteInner
  if (!quote) return false
  if (!marker && line.text !== '' && previous.claimedQuoteLazy &&
      blockQuoteParagraphClaimOpen(quote) && plainQuoteText(line.text.trimStart())) return true
  if (!marker && frame.contentColumn !== undefined &&
      line.text.startsWith(' '.repeat(frame.contentColumn)) &&
      RE_HEADING.test(line.text.trimStart()) && blockQuoteParagraphClaimOpen(quote)) return true
  const mode = quote.mode
  const indent = line.text.length - line.text.trimStart().length
  if (mode.kind === 'paragraph' && mode.itemParagraph &&
      (plainQuoteText(line.text.trimStart()) &&
        frame.contentColumn !== undefined && indent < frame.contentColumn - 1 ||
        frame.contentColumn !== undefined && RE_HEADING.test(line.text.trimStart()) &&
          (indent > 0 && indent < frame.contentColumn - 1 ||
            indent >= frame.contentColumn))) return true
  return marker !== undefined && marker.indent > 0 && blockQuoteParagraphClaimOpen(quote)
}

function recordOrderedFenceBoundary(owner: ContainerOwner, stackLength: number,
  orderedRoot: boolean, frame: ListCursorFrame, line: SourceLine): void {
  if (owner.kind === 'root' && stackLength === 1 && orderedRoot &&
      frame.fenceMarker && frame.body.at(-1)?.text === '') frame.fenceBoundary = line
}

function releaseRootListFenceAtBoundary(frame: ListCursorFrame,
  owner: ContainerOwner, stackLength: number): void {
  if (stackLength !== 1 || owner.kind !== 'root' || !frame.fenceMarker ||
      !fenceOpen(frame.body[0]?.text ?? '')) return
  const lastChild = frame.item?.children.at(-1)
  const lastNestedBlock = lastChild?.type === 'list' ?
    lastChild.items.at(-1)?.children.at(-1) : undefined
  if (lastNestedBlock?.type !== 'paragraph') frame.fenceMayDedent = true
}

function shouldMatchShiftedListFence(frame: ListCursorFrame, line: SourceLine,
  prefix: number, stackLength: number): boolean {
  return !frame.fenceMarker && line.text[prefix] === ' ' && stackLength === 1 &&
    !listMarker(frame.body[0]?.text ?? '') && !endsOpenQuotedParagraph(frame.body)
}

function continuedListFencePrefix(frame: ListCursorFrame, line: SourceLine, prefix: number): number {
  if (!line.text.startsWith(' '.repeat(frame.fencePrefix!))) {
    if (!frame.fenceMayDedent) throw new UnsupportedCursorSyntax('shifted fence continuation')
    const indent = /^ */.exec(line.text)![0].length
    if (indent > prefix && fenceOpen(line.text.slice(indent))) return indent
    return prefix
  }
  return frame.fencePrefix!
}

function heldNestedMarkerPrefix(cursor: Cursor, frame: ListCursorFrame,
  line: SourceLine, marker: NonNullable<ReturnType<typeof listMarker>>): number | undefined {
  const column = frame.contentColumn
  if (column === undefined || marker.indent <= frame.indent ||
      !line.text.startsWith(' '.repeat(column - 1))) return undefined
  if (listMarker(frame.body[0]?.text ?? '')) return column - 1
  const opener = COLON_OPEN.exec(frame.body[0]?.text ?? '')
  if (!opener) return undefined
  const next = cursor.peek(1)
  if (listMarker(line.text.slice(column - 1)) &&
      (!next || /^:{3,}[ \t]*$/.test(next.text) && !cursor.peek(2))) return column - 1
  const closer = new RegExp(`^:{${opener[1]!.length}}[ \\t]*$`)
  for (let offset = 0; cursor.peek(offset); offset++) {
    const text = cursor.peek(offset)!.text
    if (!text.startsWith(' '.repeat(column - 1))) return undefined
    const body = text.slice(column - 1)
    if (closer.test(body)) return column - 1
    if (!listMarker(body)) return undefined
  }
  return undefined
}

function deepestReachableFrame<T extends { contentColumn?: number }>(frames: readonly T[],
  text: string, excludeTop = false, knownIndent?: number): T | undefined {
  let indent = knownIndent ?? 0
  if (knownIndent === undefined) while (text.charCodeAt(indent) === 32) indent++
  for (let index = frames.length - 1 - (excludeTop ? 1 : 0); index >= 0; index--) {
    const frame = frames[index]!
    if (frame.contentColumn !== undefined &&
        indent >= frame.contentColumn - 1) return frame
  }
  return undefined
}

function wrappedListAttributeCount(cursor: Cursor, prefix: number): number {
  if (cursor.owner.kind !== 'root' && cursor.owner.kind !== 'quote') return 0
  const first = cursor.peek()!.text.slice(prefix)
  if (first[0] !== '{' || first.includes('}')) return 0
  const lines = [first]
  for (let index = 1; cursor.peek(index); index++) {
    const text = cursor.peek(index)!.text
    if (isBlankLine(text)) return 0
    lines.push(text)
    if (text.includes('}')) break
  }
  return probeBlockAttributes(new Lexer(lines))?.count ?? 0
}

function attachTrailingListAttrs(body: SourceLine[], list: List): void {
  let end = body.length
  while (end > 0 && isBlankLine(body[end - 1]!.text)) end--
  let attrs: Attrs | null = null
  let start = end
  while (start > 0) {
    const found = parseBlockAttributeRun(body[start - 1]!.text)
    if (!found) break
    attrs = attrs ? mergeAttrs(found, attrs) : found
    start--
  }
  if (attrs) {
    list.attrs = attrs
    body.splice(start)
  }
}

function loosensListGap(cursor: Cursor, body: SourceLine[], text: string,
  prefix: number, nestedContinuation: boolean): boolean {
  if (parseBlockAttributeRun(text.trimStart())) return false
  if (nestedContinuation || isListGapBlockStart(text, body)) return false
  return text[0] !== '{' || wrappedListAttributeCount(cursor, prefix) <= 1
}

function listGapLoosens(cursor: Cursor, body: SourceLine[], text: string, blanks: number,
  prefix: number, nestedContinuation: boolean): boolean {
  if (blanks === 1 && rootLinkDef(text) !== null && prefix > 0 &&
      cursor.peek(1)?.text.startsWith(' '.repeat(prefix)) &&
      plainQuoteText(cursor.peek(1)!.text.slice(prefix))) return true
  const colonOpener = body.at(-3)?.text
  const colonMarker = colonOpener ? COLON_OPEN.exec(colonOpener)?.[1] : undefined
  const colonPlain = (value: string): boolean => plainQuoteText(value) ||
    /^ [^ ]/.test(value) && plainQuoteText(value.slice(1))
  if (blanks === 1 && colonMarker !== undefined &&
      colonPlain(body.at(-2)?.text ?? '') && isBlankLine(body.at(-1)?.text ?? '') &&
      colonPlain(text) && cursor.peek(1)?.text.trimStart() === colonMarker) return false
  if (text === '' && cursor.peek()?.text === '+' &&
      RE_BLOCKQUOTE.test(cursor.peek(1)?.text ?? '') &&
      (!cursor.peek(2) || isBlankLine(cursor.peek(2)!.text))) return false
  if (text === '' && !cursor.peek(1)) return false
  if (text === '' && FOOTNOTE_DEF.test(cursor.peek(1)?.text.trimStart() ?? '')) return false
  if (text === '' && COLON_OPEN.test(cursor.peek(1)?.text.trimStart() ?? '')) return false
  if (blanks === 1 && (/^ +:: +/.test(text) ||
      body.at(-2)?.ownedDefinitionBody && RE_BLOCKQUOTE.test(text.trimStart()))) return false
  return blanks > 1 && RE_CAPTION.test(text) ||
    loosensListGap(cursor, body, text, prefix, nestedContinuation)
}

function indentedListAttributePrefix(text: string, prefix: number): number {
  const remaining = text.slice(prefix)
  const attribute = remaining.trimStart()
  return attribute !== remaining && parseBlockAttributeRun(attribute) ?
    prefix + remaining.length - attribute.length : prefix
}

function markInvisibleListGap(frame: ListCursorFrame, attrsSeen: boolean, text: string): void {
  if (attrsSeen || LINE_COMMENT.test(text)) frame.blankBeforeInvisible = true
}

type NoteBodyState = { seen: number; blankAfterHead: boolean; nonblank: boolean; tailPlain: boolean }

function observeNoteBody(owned: SourceLine[], state: NoteBodyState): void {
  while (state.seen < owned.length) {
    const line = owned[state.seen]!
    state.nonblank &&= line.text !== ''
    if (state.seen > 0) {
      state.blankAfterHead ||= line.text === ''
      state.tailPlain &&= listNoteLazyText(line.text.trimStart())
    }
    state.seen++
  }
}

/** A flush-left plain line continues the paragraph that closes a list-owned note's second block. */
function lazyOnNoteParagraph(owned: SourceLine[], candidate: SourceLine,
  state: NoteBodyState): boolean {
  const last = owned.at(-1)
  return last !== undefined && last.text !== '' && owned.length > 2 &&
    state.blankAfterHead && plainQuoteText(last.text.trimStart()) &&
    candidate.text === candidate.text.trimStart() && plainQuoteText(candidate.text) &&
    !isBlockStart(candidate.text) && !listMarker(candidate.text)
}

/** A flush-left plain line continues the open paragraph of a blank-free list-hosted note. */
function lazyListNoteText(owned: SourceLine[], candidate: SourceLine,
  frameBodyNoBlank: boolean, state: NoteBodyState): boolean {
  return owned.length > 0 && state.nonblank && state.tailPlain &&
    frameBodyNoBlank && listNoteLazyText(candidate.text)
}

function takeListFrameFootnote(cursor: Cursor, inline: CursorInline, frame: ListCursorFrame,
  depth: number, stackLength: number, ordered: boolean, reachedPrefix: number,
  footnoteDefs?: Record<string, BlockNode[]>,
  footnoteDefPos?: Record<string, Position>): number | undefined {
  const line = cursor.peek()!
  if (!line.text.startsWith('[^', reachedPrefix) || depth !== 0 || stackLength !== 1 ||
      ordered || frame.fenceMarker || frame.item?.children.length !== 0 ||
      !footnoteDefs || !footnoteDefPos) return undefined
  const footnote = FOOTNOTE_DEF.exec(line.text.slice(reachedPrefix))
  if (!footnote || !plainQuoteText(footnote[2] ?? '') ||
      !frame.body.every((part) => isBlankLine(part.text) || plainQuoteText(part.text))) {
    return undefined
  }
  const contentColumn = frame.contentColumn!
  const afterNote = cursor.peek(1)?.text ?? ''
  const ambiguousGap = frame.body.some((part) => isBlankLine(part.text)) &&
    (afterNote.startsWith(' '.repeat(contentColumn - 1)) &&
      plainQuoteText(afterNote.slice(reachedPrefix)) ||
      listMarker(afterNote)?.indent === frame.indent)
  if (ambiguousGap) throw new UnsupportedCursorSyntax('list-owned footnote gap')
  const owned: SourceLine[] = []
  const noteState: NoteBodyState = { seen: 0, blankAfterHead: false, nonblank: true, tailPlain: true }
  const frameBodyNoBlank = frame.body.every((part) => !isBlankLine(part.text))
  for (let offset = 0; cursor.peek(offset); offset++) {
    observeNoteBody(owned, noteState)
    const candidate = cursor.peek(offset)!
    if (isBlankLine(candidate.text)) { owned.push({ ...candidate, text: '' }); continue }
    if (offset > 0 && listMarker(candidate.text)?.indent === contentColumn) break
    const claim = reachableListPrefix(candidate.text, contentColumn)
    if (claim === undefined) {
      if (lazyOnNoteParagraph(owned, candidate, noteState)) { owned.push(candidate); continue }
      if (lazyListNoteText(owned, candidate, frameBodyNoBlank, noteState)) { owned.push(candidate); continue }
      if (owned.length > 1 && owned.at(-1)?.text !== '' && owned.slice(1).some((part) =>
        fenceOpen(part.text) !== null || listMarker(part.text) !== undefined)) {
        throw new UnsupportedCursorSyntax('list-owned footnote structural boundary')
      }
      break
    }
    owned.push({ ...candidate, text: candidate.text.slice(claim),
      start: candidate.start + claim,
      baseColumn: (candidate.baseColumn ?? 1) + claim })
  }
  if (owned.slice(1).some((part) => LINE_COMMENT.test(part.text.trimStart()) ||
      rootLinkDef(part.text.trimStart()) || FOOTNOTE_DEF.test(part.text.trimStart()) ||
      /^ [^ ]/.test(part.text) && plainQuoteText(part.text.trimStart()))) {
    throw new UnsupportedCursorSyntax('list-owned footnote continuation')
  }
  const nested = new Cursor(owned, undefined, ROOT_OWNER, cursor.physicalLines)
  takeSimpleFootnote(nested, inline, owned[0]!, footnote, footnoteDefs, footnoteDefPos)
  return nested.at
}

function takeListFrameDefinition(cursor: Cursor, inline: CursorInline,
  frame: ListCursorFrame, depth: number, stackLength: number, ordered: boolean,
  reachedPrefix: number): { node: DefinitionList; count: number } | undefined {
  const line = cursor.peek()!
  if (!line.text.startsWith(':: ', reachedPrefix) || depth !== 0 || stackLength !== 1 ||
      ordered || frame.fenceMarker || frame.item?.children.length !== 0 ||
      !frame.body.every((part) => isBlankLine(part.text) || plainQuoteText(part.text))) {
    return undefined
  }
  const contentColumn = frame.contentColumn!
  const termFollower = cursor.peek(1)
  const underindentedTerm = cursor.owner.kind === 'root' &&
    frame.body.length === 1 && plainQuoteText(frame.body[0]!.text) &&
    termFollower !== undefined &&
    (/^ [^ ]/.test(termFollower.text) ||
      !termFollower.text.startsWith(' ') && plainQuoteText(termFollower.text)) &&
    (!cursor.peek(2) || isBlankLine(cursor.peek(2)!.text))
  if (underindentedTerm) {
    const term = { ...line, text: line.text.slice(reachedPrefix),
      start: line.start + reachedPrefix,
      baseColumn: (line.baseColumn ?? 1) + reachedPrefix }
    const cut = termFollower!.text.startsWith(' ') ? 1 : 0
    const wrapped = { ...termFollower!, termWrapCut: cut }
    const nested = new Cursor([term, wrapped], undefined,
      cut ? childOwner(cursor.owner, 'definition') : ROOT_OWNER, cursor.physicalLines)
    const node = parseSimpleDefinitionList(nested, inline, undefined, depth + 1)
    return { node, count: nested.at }
  }
  if (!cursor.peek(1)?.text.startsWith(' '.repeat(contentColumn - 1) + ': ')) return undefined
  const definitionLine = cursor.peek(1)!.text.slice(contentColumn - 1)
  const definitionBody = /^: +[ \t]*([^ \t].*)$/.exec(definitionLine)
  if (!definitionBody) return undefined
  const definitionBodyPrefix = definitionLine.length - definitionBody[1]!.length
  const owned: SourceLine[] = []
  for (let offset = 0; cursor.peek(offset); offset++) {
    const part = cursor.peek(offset)!
    if (isBlankLine(part.text)) { owned.push({ ...part, text: '' }); continue }
    const claim = reachableListPrefix(part.text, contentColumn)
    if (claim === undefined) { owned.push(part); break }
    const text = part.text.slice(claim)
    const indent = /^ */.exec(text)![0].length
    if (offset > 1 && indent < definitionBodyPrefix &&
        (RE_BLOCKQUOTE.test(text.slice(indent)) || RE_HEADING.test(text.slice(indent)))) break
    owned.push({ ...part, text, start: part.start + claim,
      baseColumn: (part.baseColumn ?? 1) + claim })
  }
  if (owned.slice(2).some((part) => rootLinkDef(part.text.trimStart()) ||
      /^: +/.test(part.text))) {
    throw new UnsupportedCursorSyntax('list-owned definition boundary')
  }
  const nested = new Cursor(owned, undefined, childOwner(cursor.owner, 'definition'),
    cursor.physicalLines)
  const node = parseSimpleDefinitionList(nested, inline, undefined, depth + 1)
  return { node, count: nested.at }
}

function listFrameDefinitionAction(cursor: Cursor, inline: CursorInline,
  frame: ListCursorFrame, stack: ListCursorFrame[], depth: number, ordered: boolean,
  reachedPrefix: number, definitionNodes: BlockNode[],
  listSpan: (from: SourceLine, to: SourceLine, column: number) => Position):
  (() => void) | undefined {
  const line = cursor.peek()!
  const link = cursor.simpleRootListDefinitions?.get(line.number)
  if (link) return () => takeLinkDefinitionAtCursor(cursor, inline,
    definitionNodes, true, link)
  if (line.text[reachedPrefix] !== ':') return undefined
  const definition = takeListFrameDefinition(cursor, inline,
    frame, depth, stack.length, ordered, reachedPrefix)
  if (!definition) return undefined
  return () => {
    frame.item!.children.push(definition.node)
    let last = line
    for (let offset = 0; offset < definition.count; offset++) last = cursor.take()
    updateListFrameEnds(stack, last, listSpan)
    frame.lazyRootParagraph = false
  }
}

function collectMarkerLineLinkDefinition(cursor: Cursor, inline: CursorInline,
  definitionNodes: BlockNode[], frame: ListCursorFrame, line: SourceLine,
  marker: NonNullable<ReturnType<typeof listMarker>>, depth: number): void {
  if (cursor.owner.kind !== 'root' || depth !== 0) return
  const definition = cursor.simpleRootListDefinitions?.get(line.number)
  if (!definition || !rootLinkDef(marker.content)) return
  frame.body = []
  frame.plainBody = true
  frame.lazyFoldBody = true
  frame.possibleInvisibleTail = true
  takeLinkDefinitionAtCursor(new Cursor([line], undefined, cursor.owner,
    cursor.physicalLines), inline, definitionNodes, true, definition)
}

function shiftedColonAtListFrame(cursor: Cursor, frame: ListCursorFrame,
  stackLength: number, prefixLength: number): ReturnType<typeof shiftedClosedListColon> {
  if (stackLength !== 1 || frame.fenceMarker || beginsOpenQuotedParagraph(frame.body)) {
    return undefined
  }
  return shiftedClosedListColon(cursor, prefixLength)
}

function ownsLazyNestedQuoteFollower(cursor: Cursor, frame: ListCursorFrame,
  line: SourceLine, reachedPrefix: number | undefined): boolean {
  return reachedPrefix === undefined && line.lazyText === true &&
    frame.body.at(-1)?.text === '> +' && /^ [^ ]/.test(line.text) &&
    (!cursor.peek(1) || isBlankLine(cursor.peek(1)!.text))
}

function indentedRootListLazyFollower(frame: ListCursorFrame,
  stack: readonly ListCursorFrame[], depth: number, line: SourceLine,
  reachedPrefix: number | undefined): boolean {
  if (depth !== 0 || stack.length !== 1 || frame.indent === 0 ||
      frame.contentColumn === undefined || reachedPrefix !== undefined ||
      frame.fenceMarker || frame.body.at(-1)?.number !== line.number - 1 ||
      !plainQuoteText(frame.body[0]?.text ?? '')) return false
  const indent = /^ */.exec(line.text)![0].length
  const content = line.text.slice(indent)
  const belowMarkerContainer = indent > 0 && indent < frame.indent &&
    (fenceOpen(content) !== null || COLON_OPEN.test(content))
  return (indent >= frame.indent || belowMarkerContainer) &&
    indent < frame.contentColumn - 1 &&
    content !== '' && !listMarker(line.text) && !LINE_COMMENT.test(content) &&
    !RE_COMMENT_BLOCK_ANY.test(content) && !FOOTNOTE_DEF.test(content)
}

function nestedListColonLazyClaim(cursor: Cursor, stackLength: number, line: SourceLine): boolean {
  const event = line.event
  return cursor.owner.kind === 'root' && stackLength > 1 &&
    event?.lazy === true && event.kind === 'text' && event.reached === 'doc' &&
    event.missed.length === stackLength && event.missed.every((kind) => kind === 'item') &&
    /^: +/.test(line.text)
}

function colonQuoteAfterLazyMarker(cursor: Cursor, frame: ListCursorFrame,
  stackLength: number, line: SourceLine): boolean {
  const event = line.event
  const previous = frame.body.at(-1)
  return cursor.owner.kind === 'colon' && stackLength === 1 &&
    event?.lazy === true && event.kind === 'text' && event.reached === 'colon' &&
    event.missed.length === 1 && event.missed[0] === 'item' &&
    previous?.number === line.number - 1 && previous.event?.lazy === true &&
    previous.event.kind === 'item' && previous.event.reached === 'colon' &&
    previous.event.missed.length === 1 && previous.event.missed[0] === 'item' &&
    listMarker(previous.text.trimStart()) !== undefined &&
    /^>>(?:[ \t]|$)/.test(line.text) &&
    listMarker(cursor.peek(1)?.text ?? '') !== undefined
}

function foldedListOwnerLine(cursor: Cursor, frame: ListCursorFrame,
  stack: readonly ListCursorFrame[], depth: number, line: SourceLine,
  reachedPrefix: number | undefined): SourceLine | undefined {
  if (mayFoldListParagraph(cursor, frame, stack, depth) ||
      ownsLazyNestedQuoteFollower(cursor, frame, line, reachedPrefix)) {
    const folded = foldedNestedParagraphLine(frame.body, line)
    return nestedListColonLazyClaim(cursor, stack.length, line) ?
      { ...folded, lazyText: true } : folded
  }
  const event = line.event
  const previous = frame.body.at(-1)
  if (colonQuoteAfterLazyMarker(cursor, frame, stack.length, line)) return { ...line, lazyText: true }
  const colonQuotedLiteralFollower = cursor.owner.kind === 'colon' && stack.length === 1 &&
    event?.lazy === true && event.kind === 'text' && event.reached === 'colon' &&
    event.missed.length === 1 && event.missed[0] === 'item' &&
    previous?.number === line.number - 1 && previous.event?.lazy === true &&
    previous.event.kind === 'text' && previous.event.reached === 'colon' &&
    previous.event.missed.length === 1 && previous.event.missed[0] === 'item' &&
    /^>>(?:[ \t]|$)/.test(previous.text) &&
    (plainQuoteText(line.text) || /^ +\+$/.test(line.text) ||
      /^: {2,}/.test(line.text) ||
      /^ {1,2}[^ ]/.test(line.text) && plainQuoteText(line.text.trimStart()) ||
      line.text.startsWith('>>') && listMarker(line.text.slice(2)) !== undefined)
  if (colonQuotedLiteralFollower) return { ...line, lazyText: true }
  const colonLiteralFollower = cursor.owner.kind === 'colon' &&
    event?.lazy === true && event.kind === 'text' && event.reached === 'colon' &&
    event.missed.length === stack.length && event.missed.every((kind) => kind === 'item') &&
    previous?.number === line.number - 1 && previous.event?.lazy === true &&
    previous.event.kind === 'text' && previous.event.reached === 'colon' &&
    previous.event.missed.length === stack.length &&
    previous.event.missed.every((kind) => kind === 'item') &&
    /^: {2,}/.test(previous.text.trimStart()) && plainQuoteText(frame.body[0]?.text ?? '') &&
    (plainQuoteText(line.text.trimStart()) ||
      line.text.startsWith('>>') && listMarker(line.text.slice(2)) !== undefined)
  if (colonLiteralFollower) return { ...line, lazyText: true }
  const literalDefinitionFollower = cursor.owner.kind === 'root' && stack.length === 1 &&
    depth === 0 && event?.lazy === true && event.kind === 'text' &&
    event.reached === 'doc' && event.missed.length === 1 && event.missed[0] === 'item' &&
    frame.body.at(-1)?.number === line.number - 1 &&
    /^: {2,}/.test(frame.body.at(-1)?.text ?? '') &&
    plainQuoteText(frame.body[0]?.text ?? '') && plainQuoteText(line.text)
  if (literalDefinitionFollower) return { ...line, lazyText: true }
  const missedItems = event?.missed.every((kind) => kind === 'item')
  const rootListLazy = cursor.owner.kind === 'root' && depth === 0 &&
    (event?.reached === 'doc' && event.missed.length === stack.length ||
      event?.reached === 'item' && stack.length > 1 &&
      event.missed.length === stack.length - 1)
  if (reachedPrefix === undefined && event?.lazy && missedItems &&
      (rootListLazy || cursor.owner.kind === 'colon' && stack.length === 1 &&
        event.reached === 'colon' && event.missed.length === 1) &&
      event.kind === 'text' && line.text[0] !== '{' &&
      frame.body.at(-1)?.number === line.number - 1 &&
      frame.lazyFoldBody) {
    return { ...line, lazyText: true }
  }
  return indentedRootListLazyFollower(frame, stack, depth, line, reachedPrefix) ?
    { ...line, lazyText: true } : undefined
}

function takeLazyListRootDefinition(cursor: Cursor, frame: ListCursorFrame,
  inline: CursorInline, definitionNodes: BlockNode[]): boolean {
  const line = cursor.peek()
  const previous = frame.body.at(-1)
  const event = previous?.event
  if (!line || !/^ +\[/.test(line.text) || previous?.number !== line.number - 1 ||
      event?.lazy !== true || event.kind !== 'text' || event.reached !== 'doc' ||
      event.missed.length !== 1 || event.missed[0] !== 'item') return false
  const definition = rootLinkDef(line.text.trimStart())
  if (!definition) return false
  const key = normalizeRefLabel(definition.label)
  if (inline.linkDefinitions.has(key)) return false
  rejectLateLinkDefinition(inline, key)
  inline.linkDefinitions.set(key, { rawLabel: definition.label, line: line.number - 1,
    href: definition.href,
    ...(definition.title !== undefined ? { title: unescapeAttrValue(definition.title) } : {}),
    ...(definition.attrText !== null ? { attrs: parseAttrs(definition.attrText) } : {}) })
  takeLinkDefinitionAtCursor(cursor, inline, definitionNodes, true, definition)
  return true
}

function isSimpleListWhitespaceGap(cursor: Cursor, frame: ListCursorFrame,
  stackLength: number): boolean {
  const line = cursor.peek()
  const next = cursor.peek(1)
  return (cursor.owner.kind === 'root' || cursor.owner.kind === 'colon') && stackLength === 1 &&
    line !== undefined && next !== undefined && !frame.fenceMarker &&
    isBlankLine(line.text) && frame.plainBody &&
    (plainQuoteText(next.text.trimStart()) ||
      cursor.owner.kind === 'colon' && next.text.trim() === '+') &&
    reachableListPrefix(next.text, frame.contentColumn ?? 0) !== undefined
}

function listBlankRunLength(cursor: Cursor, first: SourceLine): number {
  if (!isBlankLine(first.text)) return 0
  let count = 0
  while (cursor.peek(count) && isBlankLine(cursor.peek(count)!.text)) count++
  return count
}

function whitespaceBeforeListSibling(cursor: Cursor, frame: ListCursorFrame,
  line: SourceLine, stackLength: number): boolean {
  if (stackLength !== 1 || line.text === '' || !isBlankLine(line.text) ||
      frame.fenceMarker) return false
  const follower = cursor.peek(1)?.text ?? ''
  const next = listMarker(LINE_COMMENT.test(follower) ? cursor.peek(2)?.text ?? '' : follower)
  return next !== undefined && next !== null && sameListKind(next, frame) &&
    next.indent <= frame.indent
}

function whitespaceBeforeSiblingAfterBlank(cursor: Cursor, frame: ListCursorFrame,
  line: SourceLine, stackLength: number): boolean {
  if (stackLength !== 1 || line.text === '' || !isBlankLine(line.text) ||
      cursor.peek(1)?.text !== '' || frame.fenceMarker) return false
  const next = listMarker(cursor.peek(2)?.text ?? '')
  return next !== undefined && next !== null && sameListKind(next, frame) &&
    next.indent <= frame.indent
}

function isListBlankBoundary(cursor: Cursor, frame: ListCursorFrame,
  line: SourceLine, stackLength: number): boolean {
  return line.text === '' || isSimpleListWhitespaceGap(cursor, frame, stackLength) ||
    listMarker(cursor.peek(1)?.text ?? '') !== undefined &&
      whitespaceBeforeListSibling(cursor, frame, line, stackLength) ||
    whitespaceBeforeNestedList(cursor, frame, line, stackLength) ||
    whitespaceBeforeSiblingAfterBlank(cursor, frame, line, stackLength)
}

function markFenceSiblingBlankLoose(frame: ListCursorFrame, line: SourceLine): void {
  if (frame.fenceMarker && isBlankLine(frame.body.at(-1)?.text ?? '') &&
      frame.last.number === line.number - 1) frame.list.tight = false
}

function whitespaceBeforeNestedList(cursor: Cursor, frame: ListCursorFrame,
  line: SourceLine, stackLength: number): boolean {
  const nested = listMarker(cursor.peek(1)?.text ?? '')
  return cursor.owner.kind === 'root' && stackLength === 1 &&
    line.text !== '' && isBlankLine(line.text) && !frame.fenceMarker &&
    frame.contentColumn !== undefined && nested !== undefined &&
    nested.indent >= frame.contentColumn - 1 &&
    frame.body.length > 0 && plainQuoteText(frame.body.at(-1)!.text)
}

function whitespaceBeforeListDefinition(cursor: Cursor, frame: ListCursorFrame,
  line: SourceLine, stackLength: number): boolean {
  return stackLength === 1 && line.text !== '' && isBlankLine(line.text) &&
    !frame.fenceMarker && frame.body.some((part) => !isBlankLine(part.text)) &&
    /^ +: +/.test(cursor.peek(1)?.text ?? '')
}

function whitespaceBeforeListPlus(cursor: Cursor, frame: ListCursorFrame,
  line: SourceLine, stackLength: number): boolean {
  const next = cursor.peek(1)?.text
  return cursor.owner.kind === 'root' && stackLength === 1 && line.text !== '' &&
    isBlankLine(line.text) && !frame.fenceMarker && next !== undefined &&
    next.trim() === '+' && frame.contentColumn !== undefined &&
    next.startsWith(' '.repeat(frame.contentColumn - 1))
}

function parseList(cursor: Cursor, inline: CursorInline, definitionNodes: BlockNode[], depth: number,
  first: SourceLine, firstMarker: NonNullable<ReturnType<typeof listMarker>>,
  footnoteDefs?: Record<string, BlockNode[]>, footnoteDefPos?: Record<string, Position>): List {
  const listSpan = (from: SourceLine, to: SourceLine, column: number): Position =>
    position(from, to, depth === 0 && from.baseColumn === undefined &&
      column === firstMarker.indent + 1 ? 1 : column, contentEndColumn(to))
  const followingCommentSibling = new Map<number, ReturnType<typeof listMarker>>()
  const newFrame = (line: SourceLine, marker: NonNullable<ReturnType<typeof listMarker>>,
    hostColumn = marker.indent + 1, rootFrame = false): ListCursorFrame => {
    const list: List = { type: 'list', ordered: marker.ordered, tight: true, items: [] }
    let kind: OlKind | undefined
    if (marker.ordered) {
      let nextRaw: string | null = null
      for (let i = cursor.at + 1; i < cursor.lines.length; i++) {
        const next = listMarker(cursor.lines[i]!.text)
        if (!next || next.indent > marker.indent) continue
        if (next.indent === marker.indent && next.ordered && next.delim === marker.delim) nextRaw = next.raw!
        break
      }
      kind = olKindOf(marker.raw!, nextRaw)
      const start = olStartOf(marker.raw!, kind)
      if (start !== 1) list.start = start
      if (kind !== 'dec') list.olType = kind === 'alo' ? 'a' : kind === 'aup' ? 'A' : kind === 'rlo' ? 'i' : 'I'
      if (marker.delim === ')') list.delim = ')'
      if (marker.raw === '') list.bareMarker = true
    } else if (marker.bullet === '*') list.bulletChar = '*'
    const spanColumn = rootFrame && cursor.owner.kind === 'colon' && line.baseColumn === undefined ? 1 :
      Math.min(marker.indent + 1, hostColumn, marker.authoredIndent + 1)
    list.pos = listSpan(line, line, spanColumn)
    return { list, first: line, last: line,
      indent: marker.indent, spanColumn,
      ordered: marker.ordered,
      taskList: isTaskMarkerContent(marker.content, marker.ordered),
      ...(kind ? { kind } : {}),
      ...(marker.delim ? { delim: marker.delim } : {}),
      ...(marker.bullet ? { bullet: marker.bullet } : {}), fenceMarker: undefined,
      fencePrefix: undefined, fenceMayDedent: false,
      quoteFenceMarker: undefined, quoteFenceDepth: 0, closedQuoteFence: false,
      body: [], plainBody: true, lazyFoldBody: true, attachedPlain: false, blankBeforeInvisible: false,
      lazyRootParagraph: false, retainedBelowColumnComment: false,
      bareFenceAfterRetainedComment: false, possibleInvisibleTail: false }
  }
  const stack = [newFrame(first, firstMarker, firstMarker.indent + 1, true)]
  const blankContinuationFrame = (next: SourceLine,
    marker: ReturnType<typeof listMarker>, top: ListCursorFrame,
    blankCount: number): ListCursorFrame | undefined => {
    if (marker) return undefined
    if (stack.length > 1 && top.item && next.text === `${' '.repeat(top.indent)}+`) return top
    const follower = cursor.peek(blankCount + 1)
    const afterFollower = cursor.peek(blankCount + 2)
    if (depth === 0 && stack.length === 1 && top.indent === 0 && top.item && next.text === '+' &&
        (plainQuoteText(follower?.text ?? '') || RE_BLOCKQUOTE.test(follower?.text ?? '')) &&
        (!afterFollower || isBlankLine(afterFollower.text))) return top
    return deepestReachableFrame(stack, next.text)
  }
  const blankLooseFrame = (continued: ListCursorFrame, top: ListCursorFrame,
    next: SourceLine): ListCursorFrame => {
    return stack.length > 1 && continued === top &&
      next.text === `${' '.repeat(top.indent)}+` ? stack.at(-2)! : continued
  }
  const applyInvisibleTail = (frame: ListCursorFrame): void => {
    if (frame.blankBeforeInvisible) frame.list.tight = false
    frame.blankBeforeInvisible = false
  }
  const trimFrameEnd = (frame: ListCursorFrame) => {
    if (!frame.item || !frame.itemFirst) return
    if (frame.item.children.length === 0) {
      const marker = listMarker(frame.itemFirst.text)
      if (marker) {
        frame.last = { ...frame.itemFirst,
          spanEndColumn: 'continuationWidth' in marker ? marker.continuationWidth : marker.width + 1 }
        frame.item.pos = listSpan(frame.itemFirst, frame.last, frame.spanColumn)
      }
    }
    const placedEndLine = frame.item.children.at(-1)?.pos?.endLine
    const tail = frame.item.children.at(-1)
    const flushLeftComment = tail?.type === 'comment' && !tail.block && frame.indent === 0 &&
      (tail.pos?.startColumn === 1 && cursor.owner.kind === 'root' ||
        tail.pos?.startColumn === frame.item.pos?.startColumn &&
        (cursor.owner.kind === 'quote' || cursor.owner.kind === 'list'))
    if (flushLeftComment && isBlankLine(frame.last.text)) {
      const priorEnd = frame.item.children.at(-2)?.pos?.endLine
      const priorLine = priorEnd ? cursor.physicalLines[priorEnd - 1] : undefined
      if (priorLine && priorLine.number < frame.last.number) {
        frame.last = priorLine
        frame.item.pos = listSpan(frame.itemFirst, priorLine, frame.spanColumn)
      }
    }
    if (placedEndLine && placedEndLine > frame.last.number && !flushLeftComment) {
      const placed = cursor.physicalLines[placedEndLine - 1]
      if (placed) {
        frame.last = placed.ownerEnd && tail?.type === 'code_block' ?
          ownerEndBoundaryLine(placed) : { ...placed, text: '' }
        frame.item.pos = listSpan(frame.itemFirst, frame.last, frame.spanColumn)
      }
    }
    if (placedEndLine && placedEndLine < frame.last.number) {
      const placed = cursor.physicalLines[placedEndLine - 1]
      if (placed) {
        frame.last = placed
        frame.item.pos = listSpan(frame.itemFirst, placed, frame.spanColumn)
      }
    }
    if (tail?.type === 'code_block' && tail.pos?.endLine === frame.last.number &&
        tail.pos.endOffset !== undefined && tail.pos.endColumn !== undefined &&
        frame.item.pos?.endOffset !== undefined &&
        tail.pos.endOffset > frame.item.pos.endOffset) {
      const placed = cursor.physicalLines[frame.last.number - 1]
      if (placed) {
        frame.last = { ...placed, spanEndColumn: tail.pos.endColumn }
        frame.item.pos = listSpan(frame.itemFirst, frame.last, frame.spanColumn)
      }
    }
    const lastChild = frame.item.children.at(-1)
    if (lastChild?.type === 'block_quote' && lastChild.children.length === 0 &&
        lastChild.pos?.endLine === frame.last.number &&
        lastChild.pos.endColumn !== undefined &&
        lastChild.pos.endColumn < contentEndColumn(frame.last)) {
      frame.last = { ...frame.last, spanEndColumn: lastChild.pos.endColumn }
      frame.item.pos = listSpan(frame.itemFirst, frame.last, frame.spanColumn)
    }
    if (lastChild?.type === 'list' && placedEndLine === frame.last.number &&
        frame.itemFirst.number === frame.last.number && frame.last.text.endsWith('+') &&
        lastChild.pos?.endColumn !== undefined &&
        lastChild.pos.endColumn < contentEndColumn(frame.last)) {
      frame.last = { ...frame.last, spanEndColumn: lastChild.pos.endColumn }
      frame.item.pos = listSpan(frame.itemFirst, frame.last, frame.spanColumn)
    }
    const nestedMarker = listMarker(listMarker(frame.last.text)?.content ?? '')
    const markerDefinition = rootLinkDef(listMarker(frame.last.text)?.content ?? '')
    if (lastChild?.type === 'list' &&
        lastChild.items.length === 1 && lastChild.items[0]?.children.length === 0 &&
        lastChild.pos?.endLine === frame.last.number && lastChild.pos.endColumn !== undefined &&
        (frame.itemFirst.number === frame.last.number && nestedMarker &&
          rootLinkDef(nestedMarker.content) || markerDefinition)) {
      frame.last = { ...frame.last, spanEndColumn: lastChild.pos.endColumn }
      frame.item.pos = listSpan(frame.itemFirst, frame.last, frame.spanColumn)
    }
  }
  const flush = (frame: ListCursorFrame) => {
    if (!frame.item) return
    const emptyPlus = frame.itemFirst && listMarker(frame.itemFirst.text)
    const nextPhysical = frame.itemFirst ? cursor.physicalLines[frame.itemFirst.number] : undefined
    if (frame.body.length === 1 && frame.body[0]!.text === '+' && emptyPlus?.indent &&
        emptyPlus.content === '+' &&
        listMarker(nextPhysical?.text ?? '')?.indent === emptyPlus.indent) {
      frame.last = { ...frame.itemFirst!, spanEndColumn: emptyPlus.width + 1 }
      frame.item.pos = listSpan(frame.itemFirst!, frame.last, frame.spanColumn)
      return
    }
    if (!frame.body.length) {
      const tail = frame.item.children.at(-1)
      const markerDefinition = rootLinkDef(listMarker(frame.last.text)?.content ?? '')
      if (frame.possibleInvisibleTail || tail?.type === 'list' &&
          tail.items.length === 1 && tail.items[0]?.children.length === 0 && markerDefinition) {
        trimFrameEnd(frame)
      }
      return
    }
    let allowEmptyFence = allowsEmptyRetainedFence(frame, cursor.peek())
    const firstText = frame.body[0]!.text
    if (frame.body.length > 1 && firstText[0] === '{' &&
        !frame.body[0]!.wrappedAttr && !parseBlockAttributeRun(firstText) &&
        probeBlockAttributes(lexerForCursor(new Cursor(frame.body)))) {
      frame.body[0] = { ...frame.body[0]!, wrappedAttr: true }
      frame.possibleInvisibleTail = true
    }
    if (frame.body.length === 1 && (firstText[0] === '`' || firstText[0] === '~') &&
        /^(?:`{3,}|~{3,})$/.test(firstText) &&
        (frame.itemFirst?.number === frame.body[0]!.number ||
          (cursor.owner.kind === 'quote' && frame.item.children.at(-1)?.type === 'list'))) {
      const next = cursor.peek()
      const immediate = frame.itemFirst ? cursor.physicalLines[frame.itemFirst.number] : undefined
      allowEmptyFence = (!immediate || !isBlankLine(immediate.text)) &&
        (!next || (next.text !== '' && next.text.trim() !== '+' &&
          frame.contentColumn !== undefined &&
          !next.text.startsWith(' '.repeat(frame.contentColumn - 1))))
    }
    if (frame.body.length === 1 && plainQuoteText(firstText) && !frame.body[0]!.lazyText &&
        !frame.body[0]!.wrappedAttr) {
      const line = frame.body[0]!
      frame.item.children.push({ type: 'paragraph',
        children: inline.inlines([{ line, column: 1, text: line.text }]),
        pos: position(line, line, 1, line.text.replace(/[ \t]+$/, '').length + 1) })
    } else if (frame.body.length > 1 && !frame.body[0]!.wrappedAttr && frame.body.every((line) =>
      !line.lazyText && plainQuoteText(line.text))) {
      const first = frame.body[0]!
      const last = frame.body.at(-1)!
      frame.item.children.push({ type: 'paragraph',
        children: inline.inlines(frame.body.map((line) => ({ line, column: 1, text: line.text }))),
        pos: position(first, last, 1, last.text.replace(/[ \t]+$/, '').length + 1) })
    } else {
      if (frame.itemFirst && listMarker(frame.itemFirst.text)?.content === '+') {
        recordFirstBlockFenceHandoff(inline, frame.itemFirst, frame.body)
      }
      const unclosedAfterNestedList = cursor.owner.kind === 'root' &&
        frame.item.children.at(-1)?.type === 'list' &&
        fenceOpen(frame.body[0]!.text) !== null &&
        frame.body.at(-1)?.number === cursor.physicalLines.at(-1)?.number
      const rootOpenFenceAtEof = cursor.owner.kind === 'root' &&
        frame.fenceMarker !== undefined && frame.fenceOpenedAt !== undefined &&
        frame.itemFirst !== undefined && frame.fenceOpenedAt > frame.itemFirst.number &&
        frame.body.at(-1)?.number === cursor.physicalLines.at(-1)?.number &&
        !isBlankLine(frame.body.at(-1)!.text) &&
        frame.body.every((line) => line.number >= frame.fenceOpenedAt! ||
          plainQuoteText(line.text))
      frame.item.children.push(...parseBlocks(
        new Cursor(frame.body, undefined, childOwner(cursor.owner, 'list', allowEmptyFence,
          frame.fenceMayDedent || cursor.owner.allowUnclosedFence || unclosedAfterNestedList ||
            rootOpenFenceAtEof,
          frame.fenceBoundary ?? cursor.owner.fenceBoundary,
          cursor.owner.kind === 'root' ? firstMarker.width : undefined),
          cursor.physicalLines),
        inline, definitionNodes, depth + 1, false))
    }
    trimFrameEnd(frame)
    frame.body = []
    frame.plainBody = true
    frame.lazyFoldBody = true
    frame.attachedPlain = false
    frame.possibleInvisibleTail = false
    frame.lazyRootParagraph = false
    frame.retainedBelowColumnComment = false
  }
  const mixedNestedHost = (marker: NonNullable<ReturnType<typeof listMarker>>): ListCursorFrame => {
    let host = stack.at(-1)!
    if (stack.length > 1 && marker.indent === host.indent && !sameListKind(marker, host)) {
      const done = stack.pop()!
      flush(done)
      done.list.pos = listSpan(done.first, done.last, done.spanColumn)
      host = stack.at(-1)!
    }
    return host
  }
  const appendBody = (frame: ListCursorFrame, line: SourceLine, prefix: number,
    rootLazy = false) => {
    if (frame.body.length === 0 && /^[-*.] \t/.test(line.text)) {
      line = { ...line, lazyText: true }
      rootLazy = true
    }
    const claimed = quoteListLazyLine(frame.body, line, prefix)
    line = claimed.line
    prefix = claimed.prefix
    frame.bareFenceAfterRetainedComment = false
    const text = line.text.slice(prefix)
    if (frame.indent > 0 && !frame.fenceMarker && text[0] === '`' &&
        frame.body.some((prior) => prior.lazyText && /^`{3,}/.test(prior.text)) &&
        entersOpenListCodeSpan(frame.body, text, frame.contentColumn)) {
      line = { ...line, lazyText: true }
      rootLazy = true
    }
    if (line.wrappedAttr || text[0] === '{' && parseBlockAttributeRun(text)) {
      for (const open of stack) open.possibleInvisibleTail = true
    }
    frame.lazyRootParagraph = rootLazy || frame.lazyRootParagraph && plainQuoteText(text)
    const previous = frame.body.at(-1)?.text ?? ''
    if (frame.blankBeforeInvisible && text !== '' && !LINE_COMMENT.test(text) &&
        LINE_COMMENT.test(previous) && !RE_COMMENT_BLOCK_ANY.test(previous)) {
      frame.list.tight = false
      frame.blankBeforeInvisible = false
    }
    if (frame.blankBeforeInvisible && parseBlockAttributeRun(previous) &&
        isBlockStart(text) && !parseBlockAttributeRun(text)) {
      frame.blankBeforeInvisible = false
    }
    frame.body.push(prefix === 0 ? line : { text, start: line.start + prefix, number: line.number,
      baseColumn: (line.baseColumn ?? 1) + prefix,
      ...(line.lazyText ? { lazyText: true } : {}),
      ...(line.claimedQuoteLazy ? { claimedQuoteLazy: true } : {}),
      ...(line.ownedDefinition ? { ownedDefinition: true } : {}),
      ...(line.ownedDefinitionBody ? { ownedDefinitionBody: true } : {}),
      ...(line.ownedFirstBlock ? { ownedFirstBlock: true } : {}),
      ...(line.wrappedAttr ? { wrappedAttr: true } : {}) })
    frame.plainBody &&= plainQuoteText(text)
    frame.lazyFoldBody &&= line.lazyText && !isBlankLine(text) || plainQuoteText(text.trimStart()) ||
      text.trim() === '+' || isBlankLine(text)
    if (frame.ownerState || text.startsWith('>')) {
      const state = frame.ownerState ??= verbatimOnlyLazyState()
      if (line.claimedQuoteLazy && state.quoteInner) {
        const inner = state.quoteInner.mode
        if (inner.kind !== 'paragraph' || !inner.itemParagraph ||
            !RE_HEADING.test(text.trimStart())) {
          trackBlockQuoteLazyState(text, state.quoteInner, () => false, false)
        }
      } else {
        trackItemLazyState(text, state, false)
      }
    }
    if (frame.quoteFenceMarker && text[0] === '>') {
      const inner = quotedFencePayload(text, frame.quoteFenceDepth)
      if (inner !== undefined && closesFence(inner, frame.quoteFenceMarker)) {
        frame.quoteFenceMarker = undefined
        frame.closedQuoteFence = true
      }
    } else if (frame.closedQuoteFence &&
        (text === '' || text[0] === '>' || isBlockStart(text))) {
      frame.closedQuoteFence = false
      frame.quoteFenceDepth = 0
    } else if (frame.body.length === 1 && text[0] === '>') {
      const opened = quotedFenceOpener(text)
      frame.quoteFenceMarker = opened?.marker
      frame.quoteFenceDepth = opened?.depth ?? 0
    }
    if (frame.fenceMarker) {
      if (closesFence(text, frame.fenceMarker)) {
        frame.fenceMarker = undefined
        frame.fencePrefix = undefined
        delete frame.fenceOpenedAt
        frame.fenceMayDedent = false
      }
    } else {
      const marker = RE_RAW_FENCE.exec(text)?.[1] ?? fenceOpen(text)?.marker
      if (marker && !line.lazyText) {
        frame.fenceMarker = marker
        frame.fencePrefix = prefix
        frame.fenceOpenedAt = line.number
      }
    }
  }
  const consumeWrappedAttribute = (frame: ListCursorFrame, prefix: number): boolean => {
    if (cursor.peek()?.text[prefix] !== '{') return false
    const count = wrappedListAttributeCount(cursor, prefix)
    if (count <= 1) return false
    for (let index = 0; index < count; index++) {
      const line = cursor.take()
      appendBody(frame, index === 0 ? { ...line, wrappedAttr: true } : line,
        index === 0 ? prefix : 0)
      updateListFrameEnds(stack, line, listSpan)
    }
    return true
  }
  const appendNestedListGap = (frame: ListCursorFrame, nextMarker: ReturnType<typeof listMarker>,
    blanks: number): void => {
    if (!preservesNestedListGap(frame, nextMarker)) return
    for (let i = 0; i < blanks; i++) {
      appendBody(frame, cursor.lines[cursor.at - blanks + i]!, 0)
    }
  }
  const attachFirstBlock = (frame: ListCursorFrame, item: ListItem,
    line: SourceLine,
    firstBlock: Array<{ line: SourceLine; prefix: number }> | undefined): SourceLine | undefined => {
    if (!firstBlock) return undefined
    frame.body = []
    frame.plainBody = true
    frame.lazyFoldBody = true
    for (const attached of firstBlock) appendBody(frame, attached.line, attached.prefix)
    if (frame.fenceMarker && frame.body.at(-1)?.number === cursor.physicalLines.at(-1)?.number) {
      frame.fenceMayDedent = true
    }
    frame.last = firstBlock.at(-1)!.line
    item.pos = listSpan(line, frame.last, frame.spanColumn)
    return frame.last
  }
  const appendAttachedBlock = (frame: ListCursorFrame,
    attached: Array<{ line: SourceLine; prefix: number }>): void => {
    for (const { line, prefix } of attached) {
      cursor.take()
      appendBody(frame, line, prefix)
      updateListFrameEnds(stack, line, listSpan)
    }
  }
  const takeNestedFirstFence = (frame: ListCursorFrame): boolean => {
    const end = nestedFirstFenceEnd(cursor, frame, stack.length, depth)
    if (end === undefined) return false
    for (let offset = 0; offset <= end; offset++) {
      const owned = cursor.take()
      appendBody(frame, owned, 0)
      updateListFrameEnds(stack, owned, listSpan)
    }
    return true
  }
  const takeNestedFirstBlock = (frame: ListCursorFrame, line: SourceLine): boolean => {
    if (takeNestedFirstFence(frame)) return true
    if (nestedQuoteFirstHeading(cursor, frame, stack.length, depth)) {
      cursor.take()
      appendBody(frame, line, 0)
      updateListFrameEnds(stack, line, listSpan)
      return true
    }
    if (!nestedSimpleFirstBlock(cursor, frame, stack.length, depth)) return false
    cursor.take()
    const prefix = stack.length === 2 && line.text.startsWith(' '.repeat(frame.indent)) ?
      frame.indent : 0
    const ownedFirstBlock = listMarker(frame.body[0]?.text ?? '')?.content === '> +' ||
      frame.body[0]?.text === '> > +'
    appendBody(frame, ownedFirstBlock ? { ...line, ownedFirstBlock: true } : line, prefix)
    updateListFrameEnds(stack, line, listSpan)
    return true
  }
  const retainFenceSiblingBlanks = (frame: ListCursorFrame,
    target: ListCursorFrame | undefined, sibling: boolean | undefined, count: number): boolean => {
    if (!frame.fenceMarker || !sibling || target !== frame) return false
    for (let index = 0; index < count; index++) {
      const blank = cursor.take()
      appendBody(frame, blank, 0)
      updateListFrameEnds(stack, blank, listSpan)
    }
    frame.list.tight = false
    return true
  }
  const retainFenceBoundaryBlanks = (frame: ListCursorFrame, count: number,
    next: SourceLine | undefined): boolean => {
    const finalFence = frame.fenceMarker && !next && cursor.owner.allowUnclosedFence &&
      cursor.owner.fenceBoundary
    const nextMarker = next && listMarker(next.text)
    const differentRootBullet = frame.fenceMarker && stack.length === 1 && count === 1 &&
      cursor.owner.kind === 'root' && nextMarker?.indent === frame.indent &&
      !frame.ordered && nextMarker.bullet !== frame.bullet
    let nestedRootFence = false
    if (!finalFence && stack.length === 1 && count === 1 && frame.body.length === 1 &&
        next && plainQuoteText(next.text) &&
        (!cursor.peek(count + 1) || cursor.peek(count + 1)!.text === '')) {
      const nestedFirst = listMarker(frame.body[0]!.text)
      nestedRootFence = nestedFirst !== undefined && fenceOpen(nestedFirst.content) !== null
    }
    if (!finalFence && !nestedRootFence && !differentRootBullet) return false
    for (let index = 0; index < count; index++) {
      const blank = cursor.take()
      appendBody(frame, blank, 0)
      updateListFrameEnds(stack, blank, listSpan)
    }
    if (nestedRootFence || differentRootBullet) {
      frame.fenceMayDedent = true
      if (next) frame.fenceBoundary = next
    }
    return true
  }
  const takeFenceBlank = (frame: ListCursorFrame, count: number,
    next: SourceLine | undefined): 'break' | 'continue' | undefined => {
    if (frame.fenceOpenedAt !== undefined &&
        next?.ownerEnd?.opener === frame.fenceOpenedAt - 1 &&
        (next.ownerEnd.reached === 'doc' || next.ownerEnd.reached === 'colon') &&
        !listMarker(next.text)) {
      for (let index = 0; index < count; index++) {
        const blank = cursor.take()
        appendBody(frame, blank, 0)
        updateListFrameEnds(stack, blank, listSpan)
      }
      frame.fenceBoundary = next
      return 'break'
    }
    if (retainFenceBoundaryBlanks(frame, count, next)) return 'break'
    if (!isFenceBlankContinuation(cursor, frame, next, stack.length, depth)) return undefined
    for (let index = 0; index < count; index++) {
      const blank = cursor.take()
      appendBody(frame, blank, 0)
      updateListFrameEnds(stack, blank, listSpan)
    }
    return 'continue'
  }
  const continuationOwner = (line: SourceLine): ListCursorFrame => {
    const top = stack.at(-1)!
    if (line.text !== '+' || top.fenceMarker || stack.length < 2) return top
    let owner: ListCursorFrame | undefined
    for (let index = stack.length - 2; index >= 0; index--) {
      if (stack[index]!.indent === 0) { owner = stack[index]; break }
    }
    if (!owner) return top
    while (stack.at(-1) !== owner) {
      const done = stack.pop()!
      flush(done)
      done.list.pos = listSpan(done.first, done.last, done.spanColumn)
    }
    return owner
  }
  const takeRefusedPlus = (line: SourceLine): boolean => {
    if (!line.refusedPlus || line.text !== '+') return false
    const follower = cursor.peek(1)?.text ?? ''
    if (listMarker(follower) || FOOTNOTE_DEF.test(follower) ||
        /^: +/.test(follower) && cursor.peek(2)?.text.trim() === '+') {
      throw new UnsupportedCursorSyntax('refused plus before structural follower')
    }
    cursor.take()
    appendBody(stack.at(-1)!, { ...line, lazyText: true }, 0, true)
    updateListFrameEnds(stack, line, listSpan)
    return true
  }
  while (cursor.peek()) {
    const line = cursor.peek()!
    if (whitespaceBeforeListSibling(cursor, stack.at(-1)!, line, stack.length) ||
        whitespaceBeforeListDefinition(cursor, stack.at(-1)!, line, stack.length) ||
        whitespaceBeforeListPlus(cursor, stack.at(-1)!, line, stack.length)) {
      stack.at(-1)!.list.tight = false
    }
    if (line.quoteResume) break
    if (takeRefusedPlus(line)) continue
    const marker = listMarker(line.text)
    const inlineFence = fenceOpen(line.text.trimStart()) &&
      deepestReachableFrame(stack, line.text, true) ? undefined :
      unclosedNestedInlineFence(cursor, stack.at(-1)!, stack.length)
    if (inlineFence) {
      const frame = stack.at(-1)!
      for (const prefix of inlineFence) {
        const owned = cursor.take()
        appendBody(frame, { ...owned, lazyText: true }, prefix, true)
        updateListFrameEnds(stack, owned, listSpan)
      }
      continue
    }
    rejectAmbiguousNestedPlus(cursor, marker)
    const top = continuationOwner(line)
    if (stack.length === 1 && cursor.owner.kind === 'root' &&
        takeLazyListRootDefinition(cursor, top, inline, definitionNodes)) {
      flush(top)
      continue
    }
    if (sharedQuoteClaimsLine(cursor, top, line, marker)) {
      cursor.take()
      appendBody(top, { ...line, lazyText: true, claimedQuoteLazy: true,
        ...(quoteNoteLazyClaim(top, line, marker) ? { noteLazy: true } : {}) }, 0, true)
      updateListFrameEnds(stack, line, listSpan)
      continue
    }
    rejectAmbiguousListBoundary(marker, top, line)
    const nestedPlus = nestedPlusAtLine(cursor, top, stack.length, line)
    if (nestedPlus) {
      cursor.take()
      if (nestedPlus === 'literal') {
        appendBody(top, { ...line, lazyText: true }, top.indent, true)
        updateListFrameEnds(stack, line, listSpan)
      } else {
        flush(top)
        for (const attached of nestedPlus) {
          cursor.take()
          appendBody(top, attached, top.indent)
          updateListFrameEnds(stack, attached, listSpan)
        }
      }
      continue
    }
    if (isListContinuationMarker(cursor, line, top)) {
      const attached = listContinuationFollower(cursor, top, depth)
      cursor.take()
      flush(top)
      appendAttachedBlock(top, attached)
      top.attachedPlain = attachedPlainFollower(attached)
      continue
    }
    const fenceContinuation = listFenceContinuationClaim(marker, top, line,
      cursor.owner, stack.length, firstMarker.ordered)
    if (fenceContinuation) {
      cursor.take()
      appendBody(top, fenceContinuation.line, fenceContinuation.prefix)
      top.last = line
      if (top.item && top.itemFirst) top.item.pos = listSpan(top.itemFirst, line, top.spanColumn)
      continue
    }
    if (marker) {
      const quoteOwned = ownedListMarker(cursor, top, line, marker)
      if (quoteOwned) {
        cursor.take()
        appendBody(top, quoteOwned.line, quoteOwned.prefix, quoteOwned.rootLazy)
        updateListFrameEnds(stack, line, listSpan)
        continue
      }
      if (isBelowListMarkerColumn(marker, top, depth, line, cursor.owner, stack.length)) {
        cursor.take()
        const claimed = belowColumnListBody(line, marker, top)
        appendBody(top, claimed.line, claimed.prefix, true)
        top.retainedBelowColumnComment = false
        updateListFrameEnds(stack, line, listSpan)
        continue
      }
      if (isDedentedNestedParagraphMarker(marker, stack, line)) {
        cursor.take()
        appendBody(top, { ...line, lazyText: true }, 0, true)
        updateListFrameEnds(stack, line, listSpan)
        continue
      }
      if (markerFallsBetweenListColumns(marker, top)) break
      if (marker.indent < firstMarker.indent) break
      const heldPrefix = heldNestedMarkerPrefix(cursor, top, line, marker)
      if (heldPrefix !== undefined) {
        cursor.take()
        appendBody(top, line, heldPrefix)
        top.last = line
        if (top.item && top.itemFirst) top.item.pos = listSpan(top.itemFirst, line, top.spanColumn)
        continue
      }
      while (stack.length > 1 && marker.indent < stack.at(-1)!.indent) {
        const done = stack.pop()!
        flush(done)
        done.list.pos = listSpan(done.first, done.last, done.spanColumn)
      }
      const host = mixedNestedHost(marker)
      if (marker.indent > host.indent) {
        if (!host.item) break
        const nested = newFrame(line, marker,
          nestedListSpanColumn(cursor.owner, host.contentColumn, marker.indent))
        attachTrailingListAttrs(host.body, nested.list)
        host.blankBeforeInvisible = false
        flush(host)
        host.item.children.push(nested.list)
        stack.push(nested)
      } else if (!sameListKind(marker, host)) {
        break
      }
      const current = stack.at(-1)!
      markFenceSiblingBlankLoose(current, line)
      applyInvisibleTail(current)
      flush(current)
      cursor.take()
      const item: ListItem = { type: 'list_item', children: [], pos: listSpan(line, line, current.spanColumn) }
      const taskWidth = takeTaskMarker(item, marker.content, marker.ordered)
      if ('attrs' in marker) item.attrs = marker.attrs
      current.list.items.push(item)
      current.item = item
      current.itemFirst = line
      current.contentColumn = taskContentColumn(marker, taskWidth) ??
        ('continuationWidth' in marker ? marker.continuationWidth : marker.width) + 1
      current.body = []
      current.plainBody = true
      current.lazyFoldBody = true
      current.attachedPlain = false
      delete current.ownerState
      current.possibleInvisibleTail = false
      current.lazyRootParagraph = false
      current.retainedBelowColumnComment = false
      current.fenceMarker = undefined
      current.fencePrefix = undefined
      delete current.fenceOpenedAt
      current.fenceMayDedent = false
      delete current.fenceBoundary
      current.quoteFenceMarker = undefined
      current.quoteFenceDepth = 0
      current.closedQuoteFence = false
      appendBody(current, line, marker.width + taskWidth)
      collectMarkerLineLinkDefinition(cursor, inline, definitionNodes, current, line, marker, depth)
      const firstBlock = takeListFirstBlock(cursor, marker, taskWidth, depth, current.contentColumn)
      const refusedFirstBlock = !firstBlock && isRefusedListFirstBlock(marker, taskWidth,
        cursor.peek(), depth, cursor.owner)
      const emptyAttributedItem = 'attrs' in marker && current.body.length === 0
      const spanLine = refusedFirstBlock || emptyAttributedItem ?
        { ...line, spanEndColumn: 'continuationWidth' in marker ? marker.continuationWidth : marker.width + 1 } : line
      if (refusedFirstBlock) { current.body = []; current.plainBody = true; current.lazyFoldBody = true }
      const attachedLast = attachFirstBlock(current, item, line, firstBlock)
      updateListFrameEnds(stack, attachedLast ?? spanLine, listSpan)
      continue
    }
    if (isListBlankBoundary(cursor, top, line, stack.length)) {
      top.retainedBelowColumnComment = false
      const blanks = listBlankRunLength(cursor, line)
      const next = cursor.peek(blanks)!
      const fenceBlank = takeFenceBlank(top, blanks, next)
      if (fenceBlank === 'break') break
      if (fenceBlank === 'continue') continue
      if (rootListBlankCommentSibling(cursor, top, stack.length, blanks)) {
        const blank = cursor.take()
        appendBody(top, blank, 0)
        top.list.tight = false
        continue
      }
      if (endsListBlankRun(blanks, next, firstMarker.indent)) break
      const nextMarker = listMarker(next.text)
      if (markerFallsBetweenListColumns(nextMarker, top)) break
      if (startsNestedListAfterLongBlankRun(blanks, nextMarker, firstMarker.indent)) {
        while (stack.length > 1) {
          const done = stack.pop()!
          flush(done)
          done.list.pos = listSpan(done.first, done.last, done.spanColumn)
        }
        for (let i = 0; i < blanks; i++) cursor.take()
        continue
      }
      const target = nextMarker && stack.find((frame) => frame.indent === nextMarker.indent)
      const sibling = nextMarker && target && sameListKind(nextMarker, target)
      const nested = nextMarker && nextMarker.indent > top.indent
      const continuationFrame = blankContinuationFrame(next, nextMarker, top, blanks)
      rejectRaisedColonContinuation(next.text, continuationFrame)
      if (!sibling && !nested && !continuationFrame) break
      if (retainFenceSiblingBlanks(top, target, sibling, blanks)) continue
      for (let i = 0; i < blanks; i++) cursor.take()
      appendNestedListGap(top, nextMarker, blanks)
      if (continuationFrame) {
        while (stack.at(-1) !== continuationFrame) {
          const done = stack.pop()!
          flush(done)
          done.list.pos = listSpan(done.first, done.last, done.spanColumn)
        }
        for (let i = 0; i < blanks; i++) {
          const blank = cursor.lines[cursor.at - blanks + i]!
          appendBody(continuationFrame, blank, 0)
        }
        const firstNested = listMarker(continuationFrame.body[0]?.text ?? '')
        const nestedContinuation = firstNested && continuationFrame.contentColumn !== undefined &&
          next.text.startsWith(' '.repeat(continuationFrame.contentColumn - 1 + firstNested.width))
        const prefixLength = continuationFrame.contentColumn! - 1
        let lookahead = 0
        let blockText = listGapBlockText(cursor, next, prefixLength)
        while (parseBlockAttributeRun(blockText.trimStart())) {
          lookahead++
          const following = cursor.peek(lookahead)
          if (!following?.text.startsWith(' '.repeat(prefixLength))) break
          blockText = following.text.slice(listContinuationPrefix(following.text, prefixLength))
        }
        markInvisibleListGap(continuationFrame, lookahead > 0, blockText)
        if (listGapLoosens(cursor, continuationFrame.body, blockText, blanks,
          prefixLength, nestedContinuation === true)) {
          blankLooseFrame(continuationFrame, top, next).list.tight = false
        }
      } else if (sibling) target.list.tight = false
      continue
    }
    const contentColumn = top.contentColumn
    if (contentColumn === undefined) break
    const prefix = ' '.repeat(contentColumn - 1)
    const reachedPrefix = reachableListPrefix(line.text, contentColumn)
    if (attachedListFenceCaption(top, line, cursor.owner, stack.length, reachedPrefix)) {
      cursor.take()
      appendBody(top, line, 0)
      updateListFrameEnds(stack, line, listSpan)
      continue
    }
    const foldedOwnerLine = foldedListOwnerLine(cursor, top, stack, depth, line, reachedPrefix)
    if (foldedOwnerLine) {
      cursor.take()
      appendBody(top, foldedOwnerLine, 0, true)
      updateListFrameEnds(stack, line, listSpan)
      continue
    }
    if (reachedPrefix === undefined) {
      if (takeNestedFirstBlock(top, line)) continue
      const keptComment = keptByFollowingSibling(cursor, top, stack.length, firstMarker,
        line, followingCommentSibling)
      if (keptComment) {
        cursor.take()
        appendBody(top, keptComment, 0)
        continue
      }
      const ancestor = deepestReachableFrame(stack, line.text, true)
      if (ancestor) {
        if (finalNestedListLazyLine(cursor, top.body) === 'fold') {
          cursor.take()
          appendBody(top, line, 0)
          updateListFrameEnds(stack, line, listSpan)
          continue
        }
        rejectListQuoteBoundary(top.body, line)
        while (stack.at(-1) !== ancestor) {
          const done = stack.pop()!
          flush(done)
          done.list.pos = listSpan(done.first, done.last, done.spanColumn)
        }
        continue
      }
      rejectListQuoteBoundary(top.body, line)
      recordOrderedFenceBoundary(cursor.owner, stack.length, firstMarker.ordered, top, line)
      releaseRootListFenceAtBoundary(top, cursor.owner, stack.length)
      break
    }
    const footnoteLines = takeListFrameFootnote(cursor, inline, top, depth, stack.length,
      firstMarker.ordered, reachedPrefix, footnoteDefs, footnoteDefPos)
    if (footnoteLines !== undefined) {
      flush(top)
      for (let offset = 0; offset < footnoteLines; offset++) cursor.take()
      top.lazyRootParagraph = false
      continue
    }
    const definitionAction = listFrameDefinitionAction(cursor, inline, top, stack, depth,
      firstMarker.ordered, reachedPrefix, definitionNodes, listSpan)
    if (definitionAction) {
      flush(top)
      definitionAction()
      continue
    }
    const shiftedColon = shiftedColonAtListFrame(cursor, top, stack.length, prefix.length)
    if (shiftedColon) {
      for (let count = 0; count < shiftedColon.count; count++) {
        const owned = cursor.take()
        appendBody(top, owned, shiftedColon.prefix)
        updateListFrameEnds(stack, owned, listSpan)
      }
      continue
    }
    let bodyPrefix = reachedPrefix
    if (top.fenceMarker && top.fencePrefix !== undefined && top.fencePrefix > bodyPrefix) {
      bodyPrefix = continuedListFencePrefix(top, line, bodyPrefix)
    } else if (shouldMatchShiftedListFence(top, line, bodyPrefix, stack.length)) {
      top.fenceMayDedent = cursor.owner.kind !== 'quote' && followsClosedListBlock(top.body)
      bodyPrefix = matchedShiftedFencePrefix(cursor, line.text, bodyPrefix, top.fenceMayDedent)
    }
    if (line.text[bodyPrefix] === ' ') {
      bodyPrefix = indentedListAttributePrefix(line.text, bodyPrefix)
    }
    if (consumeWrappedAttribute(top, bodyPrefix)) continue
    const claim = listContinuationClaim(top, line, bodyPrefix, reachedPrefix, cursor.peek(1))
    cursor.take()
    appendBody(top, claim.line, claim.prefix)
    top.retainedBelowColumnComment = false
    updateListFrameEnds(stack, line, listSpan)
  }
  for (let i = stack.length - 1; i >= 0; i--) {
    const frame = stack[i]!
    flush(frame)
    frame.list.pos = listSpan(frame.first, frame.last, frame.spanColumn)
  }
  return stack[0]!.list
}

function rootListCommentBeforeSibling(cursor: Cursor, top: ListCursorFrame,
  stackDepth: number, line: SourceLine): boolean {
  if (stackDepth !== 1 || cursor.owner.kind !== 'root' || top.indent !== 0 ||
      !top.item || !/^%{3,}$/.test(line.text) ||
      !plainQuoteText(top.body.at(-1)?.text ?? '')) return false
  const following = listMarker(cursor.peek(1)?.text ?? '')
  return following?.indent === 0 && sameListKind(following, top)
}

function rootListBlankCommentSibling(cursor: Cursor, top: ListCursorFrame,
  stackDepth: number, blanks: number): boolean {
  if (stackDepth !== 1 || cursor.owner.kind !== 'root' || top.indent !== 0 ||
      !top.item || blanks !== 1 || !top.plainBody) return false
  const comment = cursor.peek(1)
  if (!comment || !/^%%(?!%)/.test(comment.text)) return false
  const sibling = listMarker(cursor.peek(2)?.text ?? '')
  return sibling?.indent === 0 && sameListKind(sibling, top)
}

/** A `%%` line at its list's marker column between two siblings stays in the item above it; the list continues past it. */
function keptByFollowingSibling(cursor: Cursor, top: ListCursorFrame, depth: number,
  firstMarker: NonNullable<ReturnType<typeof listMarker>>, line: SourceLine,
  cache: Map<number, ReturnType<typeof listMarker>>): SourceLine | undefined {
  if (rootListCommentBeforeSibling(cursor, top, depth, line)) {
    return { ...line, ownedListComment: true }
  }
  if (!top.item ||
      !/^ *%%(?!%)/.test(line.text) || line.lazyText) return undefined
  const flush = depth === 1
  if (flush ? firstMarker.indent !== 0 : line.text.length - line.text.trimStart().length !== top.indent) return undefined
  let next = cache.get(cursor.at)
  if (!cache.has(cursor.at)) {
    let ahead = 1
    while (cursor.peek(ahead) &&
      (cursor.peek(ahead)!.text === '' || /^ *%%(?!%)/.test(cursor.peek(ahead)!.text))) ahead++
    next = listMarker(cursor.peek(ahead)?.text ?? '')
    for (let offset = 0; offset < ahead; offset++) cache.set(cursor.at + offset, next)
  }
  if (next === null || next === undefined || !sameListKind(next, top)) return undefined
  return (flush ? next.indent < firstMarker.width + 1 : next.indent === top.indent) ? line : undefined
}

function takeQuotedInlineCodeContinuation(cursor: Cursor, body: SourceLine[]): SourceLine[] | undefined {
  if (!cursor.owner.inList || body.length !== 1 || !plainQuoteText(body[0]!.text)) return undefined
  const opener = /^( +)(`{3,})(?:[A-Za-z][\w-]*)?[ \t]*$/.exec(cursor.peek()?.text ?? '')
  if (!opener) return undefined
  const prefix = opener[1]!
  let count = 1
  while (cursor.peek(count)?.text.startsWith(prefix)) {
    if (cursor.peek(count)!.text.slice(prefix.length).trimEnd() === opener[2]) {
      if (cursor.peek(count + 1) && !isBlankLine(cursor.peek(count + 1)!.text)) return undefined
      const lines: SourceLine[] = []
      for (let i = 0; i <= count; i++) lines.push(cursor.take())
      return lines
    }
    count++
  }
  return undefined
}

function takeDegradedQuoteLazyLine(cursor: Cursor, first: SourceLine,
  body: SourceLine[]): SourceLine | undefined {
  const line = cursor.peek()
  if (!line?.lazyText || !line.text.startsWith('>') ||
      (line.baseColumn ?? 1) <= (first.baseColumn ?? 1) ||
      !openDegradedQuoteCommentParagraph(body, false)) return undefined
  const afterMarker = line.text.slice(line.text[1] === ' ' ? 2 : 1)
  if (rootLinkDef(afterMarker) || FOOTNOTE_DEF.test(afterMarker) || ABBR_DEF.test(afterMarker)) {
    throw new UnsupportedCursorSyntax('degraded quote definition owner')
  }
  return cursor.take()
}

function quoteChildrenAtCursor(cursor: Cursor, inline: CursorInline,
  definitionNodes: BlockNode[], depth: number, body: SourceLine[],
  directParagraph: boolean, boundaryFence = false, terminalAttachedFence = false): BlockNode[] {
  for (let index = 0; index < body.length - 1; index++) {
    const line = body[index]!
    if (line.text[0] !== '{' || parseBlockAttributeRun(line.text)) continue
    if (!probeBlockAttributes(lexerForCursor(new Cursor(body.slice(index))))) continue
    body[index] = { ...line, wrappedAttr: true }
    directParagraph = false
  }
  if (body.length > 0 && directParagraph) {
    const last = body.at(-1)!
    return [{ type: 'paragraph',
      children: inline.inlines(body.map((line) => ({ line, column: 1, text: line.text }))),
      pos: position(body[0]!, last, 1, last.text.replace(/[ \t]+$/, '').length + 1) }]
  }
  const openingFence = fenceOpen(body[0]?.text ?? '')?.marker
  const terminalFence = body.length > 1 ? fenceOpen(body.at(-1)!.text)?.marker : undefined
  const terminalAfterClosedFence = cursor.owner.kind === 'list' && openingFence &&
    terminalFence === openingFence &&
    body.at(-1)?.number === cursor.physicalLines.at(-1)?.number &&
    body.slice(1, -1).some((line) => closesFence(line.text, openingFence))
  const children = parseBlocks(new Cursor(body, undefined, childOwner(cursor.owner, 'quote', false,
    boundaryFence || Boolean(terminalAfterClosedFence), boundaryFence ? cursor.peek() : undefined),
    cursor.physicalLines, cursor.simpleRootListDefinitions), inline, definitionNodes, depth + 1, false)
  const last = children.at(-1)
  if (terminalAttachedFence && cursor.rootSource?.endsWith('\n') && last?.type === 'code_block') {
    last.content += '\n'
    const boundary = cursor.peek()
    if (boundary?.text === '+' && !cursor.peek(1) && last.pos) {
      last.pos = { ...last.pos, endLine: boundary.number, endColumn: 1,
        endOffset: boundary.start }
    }
  }
  return children
}

interface QuoteListOwnerFrame { contentColumn: number; fence: string | undefined }

class QuoteListOwner {
  readonly frames: QuoteListOwnerFrame[] = []
  releasedFence = false
  shiftedFence = false

  observe(text: string): boolean {
    if (text === '') return false
    let indent = 0
    while (text.charCodeAt(indent) === 32) indent++
    let released = false
    const reached = deepestReachableFrame(this.frames, text, false, indent)
    while (this.frames.length && this.frames.at(-1) !== reached) {
      const old = this.frames.pop()!
      released ||= old.fence !== undefined
      this.releasedFence ||= old.fence !== undefined
    }
    const top = this.frames.at(-1)
    const owned = top && indent >= top.contentColumn - 1 ?
      text.slice(top.contentColumn - 1) : text
    if (top?.fence) {
      if (indent === top.contentColumn - 1 && closesFence(owned, top.fence)) top.fence = undefined
      return false
    }
    const marker = listMarker(text)
    if (marker && (!top || marker.indent >= top.contentColumn - 1)) {
      const frame: QuoteListOwnerFrame = { contentColumn: marker.width + 1,
        fence: fenceOpen(marker.content)?.marker }
      this.frames.push(frame)
      return false
    }
    if (top && indent > top.contentColumn - 1 && fenceOpen(text.slice(indent))) this.shiftedFence = true
    if (top && indent === top.contentColumn - 1) top.fence = fenceOpen(owned)?.marker
    return released && !top && plainQuoteText(text)
  }

  get openFence(): boolean { return this.frames.some((frame) => frame.fence !== undefined) }
  get boundaryFence(): boolean { return !this.shiftedFence && (this.releasedFence || this.openFence) }
}

function observeQuoteListOwner(owner: QuoteListOwner | undefined, container: ContainerOwner,
  text: string, firstLine: boolean): { owner: QuoteListOwner | undefined; resumed: boolean } {
  if (!owner && firstLine && container.kind === 'root' &&
      (text[0] === '-' || text[0] === '*') && listMarker(text)?.indent === 0) {
    owner = new QuoteListOwner()
  }
  return { owner, resumed: !!owner?.observe(text) && !owner.shiftedFence }
}

function quotedParagraphText(text: string, plain: boolean): boolean {
  return plain || indentedLiteralAbbreviation(text) || nestedQuoteParagraphText(text) ||
    /^>[-*] [^ ]/.test(text) ||
    /^ (?:\[|\{)/.test(text) ||
    /^: +/.test(text) || /^:: +[^ ]/.test(text)
}

function quoteNeedsLazyBoundary(follower: string | undefined, last: string | undefined,
  wrappedAttributeTail: boolean, inlineCode: SourceLine[] | undefined): boolean {
  return mayContinueQuoteLazily(follower, last) && !wrappedAttributeTail || !!inlineCode
}

function rejectOpenQuotedListFence(body: SourceLine[], listOwner: QuoteListOwner | undefined): void {
  if (listOwner?.openFence && body[2]?.text === '' && body.at(-1)?.text === '' &&
      body.some((line) => /^ +`{3,}/.test(line.text)) &&
      body.some((line) => /^ +~{3,}/.test(line.text))) {
    throw new UnsupportedCursorSyntax('open quoted list fence across a blank')
  }
}

function takeQuoteFirstBlock(cursor: Cursor, inline: CursorInline,
  definitionNodes: BlockNode[], depth: number): BlockQuote | undefined {
  const first = cursor.peek()!
  if (first.text !== '> +') return undefined
  const markerLineNested = cursor.owner.kind === 'list' &&
    (depth === 1 || depth === 2 && cursor.owner.parent?.kind === 'quote' ||
      cursor.peek(1)?.ownedFirstBlock === true)
  const nestedQuote = depth === 1 && cursor.owner.kind === 'quote'
  const ownedNested = cursor.owner.kind === 'quote' && cursor.peek(1)?.ownedFirstBlock === true
  if (depth === 0 || markerLineNested || nestedQuote || ownedNested) {
    const fenceEnd = closedFenceEnd(cursor, 1)
    if (fenceEnd !== undefined &&
        (!cursor.peek(fenceEnd + 1) || isBlankLine(cursor.peek(fenceEnd + 1)!.text))) {
      cursor.take()
      const body: SourceLine[] = []
      for (let offset = 1; offset <= fenceEnd; offset++) body.push(cursor.take())
      const last = body.at(-1)!
      return { type: 'block_quote',
        children: parseBlocks(new Cursor(body, undefined, childOwner(cursor.owner, 'quote'),
          cursor.physicalLines), inline, definitionNodes, depth + 1, false),
        pos: position(first, last, 1, contentEndColumn(last)) }
    }
  }
  if (!(depth === 0 || markerLineNested || nestedQuote || ownedNested)) return undefined
  const follower = cursor.peek(1)
  const after = cursor.peek(2)
  if (!follower || !(plainQuoteText(follower.text) || RE_HEADING.test(follower.text) ||
      isTableRow(follower.text) || (markerLineNested || ownedNested) &&
      RE_BLOCKQUOTE.test(follower.text)) ||
      after && !isBlankLine(after.text)) return undefined
  cursor.take()
  cursor.take()
  return { type: 'block_quote',
    children: parseBlocks(new Cursor([follower], undefined, childOwner(cursor.owner, 'quote'),
      cursor.physicalLines),
      inline, definitionNodes, depth + 1, false),
    pos: position(first, follower, 1, contentEndColumn(follower)) }
}

function takeQuotedColonDefinitionTail(cursor: Cursor, body: SourceLine[]): SourceLine | undefined {
  const line = cursor.peek()
  if (!line || openColonRun(body, false) === undefined || !/^ +>/.test(line.text)) {
    return undefined
  }
  const afterMarker = line.text.trimStart().replace(/^> ?/, '')
  if (rootLinkDef(afterMarker) || FOOTNOTE_DEF.test(afterMarker) || ABBR_DEF.test(afterMarker)) {
    throw new UnsupportedCursorSyntax('quoted colon definition owner')
  }
  const owned = cursor.take()
  const prefix = /^ +/.exec(owned.text)![0].length
  body.push({ text: owned.text.slice(prefix), start: owned.start + prefix,
    number: owned.number, baseColumn: (owned.baseColumn ?? 1) + prefix, lazyText: true })
  return owned
}

function takeQuotedListLiteralTail(cursor: Cursor, body: SourceLine[],
  listOwner: QuoteListOwner | undefined): SourceLine | undefined {
  const line = cursor.peek()
  const last = body.at(-1)?.text ?? ''
  const literalDefinition = /^ +> {2,}\[[^\]]+\]: +\S/.test(last)
  const quotedAbbreviation = listOwner && ABBR_DEF.test(last) &&
    listMarker(body[0]?.text ?? '') !== undefined
  if (!listOwner || !(indentedLiteralAbbreviation(last) || literalDefinition || quotedAbbreviation) ||
      !line || !plainQuoteText(line.text) ||
      cursor.peek(1) && !isBlankLine(cursor.peek(1)!.text)) return undefined
  body.push(cursor.take())
  return line
}

function takeIndentedColonQuoteTail(cursor: Cursor, body: SourceLine[]): SourceLine | undefined {
  const line = cursor.peek()
  if (!line || !indentedLiteralColon(body.at(-1)?.text ?? '') ||
      !/^ +:::$/.test(line.text) ||
      cursor.peek(1) && !isBlankLine(cursor.peek(1)!.text)) return undefined
  body.push(cursor.take())
  return line
}

function quotedContinuationFollower(cursor: Cursor, body: SourceLine[]): boolean {
  const next = cursor.peek(1)?.text ?? ''
  return listMarker(next)?.indent === 0 ||
    body.at(-1)?.text === '' && plainQuoteText(next) ||
    cursor.owner.kind === 'quote' && listMarker(body.at(-1)?.text ?? '') !== undefined &&
      plainQuoteText(next)
}

function quotedOwnedBodyLine(line: SourceLine, body: SourceLine[], prefix: number,
  text: string): SourceLine {
  if (line.ownedFirstBlock && body.at(-1)?.text === '> +') return line
  const event = line.event
  const nestedItemLazy = body.length === 1 && body[0]!.text.startsWith('>') &&
    event?.lazy === true && event.kind === 'item' && event.reached === 'quote' &&
    event.missed.length === 1 && event.missed[0] === 'quote' &&
    listMarker(text) !== undefined
  const nestedLazy = (body.at(-1)?.lazyText || body.length === 1 &&
    body[0]!.text.startsWith('>') && listMarker(text.slice(1)) !== undefined) &&
    event?.lazy && event.kind === 'text' &&
    event.reached === 'quote' && event.missed.length === 1 &&
    event.missed[0] === 'quote' && (plainQuoteText(text) || quotedLiteralListMarker(text))
  return { text, start: line.start + prefix, number: line.number,
    baseColumn: (line.baseColumn ?? 1) + prefix,
    ...(nestedLazy || nestedItemLazy ? { lazyText: true } : {}),
    ...(line.ownedFirstBlock ? { ownedFirstBlock: true } : {}),
    ...(line.event ? { event: line.event } : {}) }
}

function quoteLazyItemBlock(event: LineEvent | undefined, follower: SourceLine | undefined): boolean {
  return event?.lazy === true && event.kind === 'item' &&
    event.reached === 'doc' && event.missed.length === 1 &&
    event.missed[0] === 'quote' && isBlockStart(follower?.text ?? '')
}

function quoteLazyItemHeadingFollower(lazyItemBlock: boolean, follower: SourceLine | undefined,
  after: SourceLine | undefined): boolean {
  return lazyItemBlock && RE_HEADING.test(follower?.text ?? '') &&
    plainQuoteText(after?.text.trimStart() ?? '')
}

function rootNestedQuoteDefinitionFollower(cursor: Cursor, body: SourceLine[], line: SourceLine,
  follower: SourceLine | undefined, after: SourceLine | undefined): boolean {
  const last = body.at(-1)
  return cursor.owner.kind === 'root' && line.plusAfterPara === true &&
    body.length === 2 && plainQuoteText(body[0]!.text) &&
    last?.text.startsWith('>') === true && listMarker(last.text.slice(1).trimStart()) !== undefined &&
    /^: {2,}\S/.test(follower?.text ?? '') && !after
}

function initialQuoteFenceContinuation(cursor: Cursor, body: SourceLine[], line: SourceLine,
  follower: SourceLine | undefined): boolean {
  const first = body[0]
  return first !== undefined && cursor.owner.kind === 'root' &&
    first.number === cursor.physicalLines[0]?.number &&
    line.plusAfterPara === true && body.length >= 2 &&
    (plainQuoteText(first.text) || quotedLiteralListMarker(first.text)) &&
    listMarker(body.at(-1)?.text.trimStart() ?? '') !== undefined &&
    fenceOpen(follower?.text.trimStart() ?? '') !== null
}

function takeAttachedQuoteFencePayload(cursor: Cursor, body: SourceLine[],
  marker: string): { last: SourceLine; unclosed: boolean } {
  let last = body.at(-1)!
  while (cursor.peek()) {
    if (cursor.peek()!.text === '+' && !cursor.peek(1)) return { last, unclosed: true }
    last = cursor.take()
    body.push(last)
    if (closesFence(last.text.trimStart(), marker)) return { last, unclosed: false }
  }
  return { last, unclosed: true }
}

function takeAttachedQuotedListTail(cursor: Cursor, body: SourceLine[],
  attached: SourceLine): SourceLine | undefined {
  if (cursor.owner.kind !== 'root' || body.length !== 3 ||
      !quotedLiteralListMarker(body[0]!.text) ||
      !attached.text.startsWith('>> ') || !listMarker(attached.text.slice(3))) return undefined
  const first = cursor.peek()
  if (!first) return undefined
  const quoted = first.text.startsWith('>> ') && listMarker(first.text.slice(3))
  const resumed = listMarker(first.text)?.indent === 0 &&
    cursor.peek(1)?.text.startsWith('>> ') && listMarker(cursor.peek(1)!.text.slice(3))
  const definition = /^: {2}\S/.test(first.text) &&
    RE_BLOCKQUOTE.test(cursor.peek(1)?.text ?? '')
  if (!quoted && !resumed && !definition) return undefined
  if (resumed) body.push({ ...cursor.take(), lazyText: true })
  const last = cursor.take()
  body.push({ ...last, lazyText: true })
  return last
}

function takeAttachedQuoteContinuation(cursor: Cursor, body: SourceLine[], line: SourceLine):
  { last: SourceLine; listReturn: boolean; unclosedFence: boolean } | undefined {
  if (!canAttachQuoteContinuation(cursor, body, line)) return undefined
  const attachFence = initialQuoteFenceContinuation(cursor, body, line, cursor.peek(1))
  const marker = cursor.take()
  body.push({ ...marker, text: '' })
  const attached = cursor.take()
  body.push(attached)
  const quotedTail = takeAttachedQuotedListTail(cursor, body, attached)
  const colonPayload = cursor.owner.kind === 'root' && body.length === 3 &&
    quotedLiteralListMarker(body[0]!.text) && attached.text === ':::' &&
    /^ {2}: {2}\S/.test(cursor.peek()?.text ?? '') ? takeColonBody(cursor, 3).lines : undefined
  if (colonPayload) body.push(...colonPayload)
  const fence = attachFence ? fenceOpen(attached.text.trimStart()) : null
  const payload = fence ? takeAttachedQuoteFencePayload(cursor, body, fence.marker) : undefined
  return { last: payload?.last ?? colonPayload?.at(-1) ?? quotedTail ?? attached,
    listReturn: listMarker(attached.text)?.indent === 0,
    unclosedFence: payload?.unclosed ?? false }
}

function rejectAmbiguousAttachedQuoteList(cursor: Cursor, line: SourceLine): void {
  const attachedList = line.text === '+' && listMarker(cursor.peek(1)?.text ?? '')?.indent === 0
  const quotedAfterList = cursor.peek(2)?.text
  if (attachedList && quotedAfterList?.startsWith('>') &&
      RE_BLOCKQUOTE.test(quotedAfterList) &&
      !plainQuoteText(quotedAfterList.slice(quotedAfterList[1] === ' ' ? 2 : 1))) {
    throw new UnsupportedCursorSyntax('quote owner after attached list')
  }
}

function quotedColonPayloadOwner(cursor: Cursor, body: SourceLine[], line: SourceLine,
  follower: SourceLine | undefined, after: SourceLine | undefined): boolean {
  return cursor.owner.kind === 'root' && line.plusAfterPara === true &&
    body.length === 1 && quotedLiteralListMarker(body[0]!.text) &&
    follower?.text === ':::' && /^ {2}: {2}\S/.test(after?.text ?? '')
}

function canAttachQuoteContinuation(cursor: Cursor, body: SourceLine[], line: SourceLine): boolean {
  if (cursor.owner.inList || line.text !== '+' || body.length === 0) return false
  const follower = cursor.peek(1)
  const after = cursor.peek(2)
  if (rootNestedQuoteDefinitionFollower(cursor, body, line, follower, after)) return true
  if (initialQuoteFenceContinuation(cursor, body, line, follower)) return true
  const quotedColonPayload = quotedColonPayloadOwner(cursor, body, line, follower, after)
  if (line.plusAfterPara && body.length === 1 && body[0]!.number === line.number - 1 &&
      quotedLiteralListMarker(body[0]!.text) &&
      follower && (isBlockStart(follower.text) ||
        follower.text.startsWith('>>') && listMarker(follower.text.slice(2)) !== undefined ||
        /^:  \S/.test(follower.text)) &&
      (quotedColonPayload || quotePlusFollowerBlockOwned(cursor.owner, follower.text, after))) return true
  const plain = plainQuoteText(follower?.text ?? '')
  const firstBody = body[0]
  const nestedQuote = body.length === 1 && firstBody !== undefined &&
    firstBody.number === cursor.lines[0]?.number && plainQuoteText(firstBody.text) &&
    follower?.text[0] === '>' && RE_BLOCKQUOTE.test(follower.text) &&
    (!after || isBlankLine(after.text))
  const quotedAfter = after?.text[0] === '>' && RE_BLOCKQUOTE.test(after.text) ?
    after.text.slice(after.text[1] === ' ' ? 2 : 1) : undefined
  const attachedMarker = listMarker(follower?.text ?? '')
  const resumedMarker = listMarker(quotedAfter ?? '')
  const sameAttachedList = attachedMarker?.indent === 0 && resumedMarker?.indent === 0 &&
    attachedMarker.ordered === resumedMarker.ordered &&
    attachedMarker.bullet === resumedMarker.bullet && attachedMarker.delim === resumedMarker.delim &&
    !('attrs' in attachedMarker) && !('attrs' in resumedMarker) &&
    plainQuoteText(attachedMarker.content) && plainQuoteText(resumedMarker.content)
  const afterResumedList = cursor.peek(3)?.text
  const boundedResumedList = sameAttachedList &&
    (!afterResumedList || isBlankLine(afterResumedList))
  const nestedFirstList = body[0] !== undefined && quotedLiteralListMarker(body[0].text)
  const nestedLiteralPair = nestedFirstList && body.length === 2 &&
    listMarker(body[1]!.text.trimStart()) !== undefined &&
    isBlockStart(follower?.text ?? '') && !after
  const lazyAttachedList = line.plusAfterPara && body.length === 2 &&
    plainQuoteText(body[0]!.text) && listMarker(body[1]!.text)?.indent === 2 &&
    listMarker(follower?.text ?? '')?.indent === 0 &&
    after?.event?.kind === 'text' && after.event.lazy &&
    after.event.reached === 'doc' && after.event.missed.length === 1 &&
    after.event.missed[0] === 'item'
  const itemEvent = body.at(-1)?.event
  const lazyItemBlock = quoteLazyItemBlock(itemEvent, follower)
  const nestedAttachedQuote = quotedIndentedItemAttachQuote(cursor, body, line, follower)
  return (quotedContinuationFollower(cursor, body) || plain || nestedQuote || lazyItemBlock ||
    nestedLiteralPair || nestedAttachedQuote) &&
    (!after || isBlankLine(after.text) || lazyAttachedList ||
      quoteLazyItemHeadingFollower(lazyItemBlock, follower, after) ||
      attachedMarker?.indent === 0 && quotedAfter !== undefined &&
        (!resumedMarker || boundedResumedList) ||
      plain && isBlockStart(after.text) && !RE_BLOCKQUOTE.test(after.text) ||
      nestedFirstList && (plain && after.text === '+' ||
        attachedMarker?.indent === 0 && body.at(-2)?.text === ''))
}

function quotedIndentedItemAttachQuote(cursor: Cursor, body: SourceLine[],
  line: SourceLine, follower: SourceLine | undefined): boolean {
  return cursor.owner.kind === 'root' && line.plusAfterPara === true &&
    body.length === 2 && plainQuoteText(body[0]!.text) &&
    listMarker(body[1]!.text)?.indent === 2 &&
    cursor.physicalLines[body[0]!.number - 1]?.text.startsWith('> ') === true &&
    cursor.physicalLines[body[1]!.number - 1]?.text.startsWith('>   ') === true &&
    follower?.text.startsWith('> ') === true &&
    plainQuoteText(follower.text.slice(2))
}

function quotePlusFollowerBlockOwned(owner: ContainerOwner, text: string,
  after: SourceLine | undefined): boolean {
  const colon = /^(:{3,})[ \t]*$/.exec(text)
  if (!colon) return true
  return (owner.kind === 'root' || (owner.kind === 'colon' &&
    owner.colonCloser !== undefined && owner.colonCloser !== colon[1]!.length)) &&
    (!after || isBlankLine(after.text))
}

function takeRootQuotedItemFinalPlus(cursor: Cursor, body: SourceLine[],
  line: SourceLine): SourceLine | undefined {
  if (cursor.owner.kind !== 'root' || line.text !== '+' || cursor.peek(1) ||
      !line.plusAfterPara || body.length < 2 || body.at(-1)!.number !== line.number - 1 ||
      !plainQuoteText(body[0]!.text) ||
      !cursor.physicalLines[body[0]!.number - 1]?.text.startsWith('> ')) return undefined
  const quotedItem = body.length === 2 && quotedLiteralListMarker(body[1]!.text) &&
    cursor.physicalLines[body[1]!.number - 1]?.text.startsWith('> >')
  const indentedItem = body.slice(1).every((part, index) =>
    part.number === body[index]!.number + 1 &&
    listMarker(part.text)?.indent === 2 &&
    cursor.physicalLines[part.number - 1]?.text.startsWith('>   '))
  if (!quotedItem && !indentedItem) return undefined
  return { ...cursor.take(), lazyText: true }
}

function takeNestedQuoteItemPlainTail(cursor: Cursor, body: SourceLine[],
  line: SourceLine): SourceLine[] | undefined {
  const item = body.at(-1)
  const event = item?.event
  const follower = cursor.peek(1)
  const after = cursor.peek(2)
  if (cursor.owner.kind !== 'root' || body.length !== 2 ||
      !body[0]!.text.startsWith('>') || item?.lazyText !== true ||
      event?.lazy !== true || event.kind !== 'item' || event.reached !== 'quote' ||
      event.missed.length !== 1 || event.missed[0] !== 'quote' ||
      line.text !== '+' || line.plusAfterPara !== true || !follower ||
      !/^ {2,4}\S/.test(follower.text) || !plainQuoteText(follower.text.trimStart()) ||
      after && !isBlankLine(after.text) && !COLON_OPEN.test(after.text)) return undefined
  return [{ ...cursor.take(), lazyText: true, claimedQuoteLazy: true },
    { ...cursor.take(), lazyText: true, claimedQuoteLazy: true }]
}

function takeLiteralNestedQuotePlusTail(cursor: Cursor, body: SourceLine[],
  line: SourceLine): SourceLine[] | undefined {
  const follower = cursor.peek(1)
  const after = cursor.peek(2)
  if ((cursor.owner.kind !== 'root' && cursor.owner.kind !== 'colon') || body.length !== 1 ||
      !/^>[-*] [^ ]/.test(body[0]!.text) || line.text !== '+' ||
      line.plusAfterPara !== true || !follower ||
      !/^ {2}[^ ]/.test(follower.text) || !plainQuoteText(follower.text.slice(2)) ||
      after && !isBlankLine(after.text) &&
        !(after.text.startsWith('> ') && plainQuoteText(after.text.slice(2)))) return undefined
  return [{ ...cursor.take(), lazyText: true }, { ...cursor.take(), lazyText: true }]
}

function takeQuotePlusTail(cursor: Cursor, body: SourceLine[],
  line: SourceLine): SourceLine[] | undefined {
  const final = takeRootQuotedItemFinalPlus(cursor, body, line)
  return final ? [final] : takeNestedQuoteItemPlainTail(cursor, body, line) ??
    takeLiteralNestedQuotePlusTail(cursor, body, line)
}

function takeQuoteLazyBoundaryTail(cursor: Cursor, body: SourceLine[],
  wrappedAttributeTail: boolean, inlineCode: SourceLine[] | undefined,
  listOwner: QuoteListOwner | undefined, directParagraph: boolean): SourceLine[] | undefined {
  if (!quoteNeedsLazyBoundary(cursor.peek()?.text, body.at(-1)?.text,
    wrappedAttributeTail, inlineCode)) return undefined
  if (body.length === 1 && plainQuoteText(body[0]!.text) &&
      cursor.peek()?.text === '+' && !cursor.peek(1)) {
    return [{ ...cursor.take(), lazyText: true }]
  }
  const tableLine = (text: string): string => text.replace(/^(?:> ?)+/, '')
  const joinedTableEnd = body.length === 2 &&
    /^\|.*\|[ \t]*$/.test(tableLine(body[0]!.text)) &&
    /^\+.*\|/.test(tableLine(body[1]!.text))
  const nestedLazy = !inlineCode && !tableLine(body[0]?.text ?? '').startsWith('|') &&
    body.at(-1)?.text.startsWith('>') &&
    !directParagraph && plainQuoteText(cursor.peek()?.text ?? '') &&
    (!cursor.peek(1) || isBlankLine(cursor.peek(1)!.text))
  if (nestedLazy) return [{ ...cursor.take(), lazyText: true }]
  if (!inlineCode && !(listOwner?.openFence && !listOwner.shiftedFence) && !joinedTableEnd) {
    throw new UnsupportedCursorSyntax('lazy quote continuation')
  }
  return inlineCode
}

function isRootDefinitionOnlyQuote(cursor: Cursor, children: BlockNode[], body: SourceLine[]): boolean {
  return cursor.owner.kind === 'root' && children.length === 0 && body.length > 1 &&
    body.every((line) => rootLinkDef(line.text) !== null || FOOTNOTE_DEF.test(line.text))
}

function isSingleDefinitionOnlyQuote(children: BlockNode[], body: SourceLine[]): boolean {
  return children.length === 0 && body.length > 0 &&
    (rootLinkDef(body[0]!.text) !== null || FOOTNOTE_DEF.test(body[0]!.text)) &&
    (body.length === 1 || FOOTNOTE_DEF.test(body[0]!.text) && body.slice(1).every((line) => line.lazyText))
}

function isNestedDefinitionOnlyQuote(cursor: Cursor, children: BlockNode[],
  body: SourceLine[]): boolean {
  return cursor.owner.kind === 'root' && body.length === 1 &&
    rootLinkDef(body[0]!.text.slice(2)) !== null &&
    children.length === 1 && children[0]?.type === 'block_quote' &&
    children[0].children.length === 0
}

function definitionOnlyQuoteEndColumn(first: SourceLine, last: SourceLine,
  nested: boolean, direct: boolean, markerDefinitionEnd: number | undefined): number {
  if (nested) return first.text.indexOf('[') + 1
  if (direct) return first.text[1] === ' ' ? 3 : 2
  if (markerDefinitionEnd !== undefined) return markerDefinitionEnd
  return contentEndColumn(last)
}

function markerDefinitionOnlyQuoteEnd(children: BlockNode[], body: SourceLine[]): number | undefined {
  const tail = children.at(-1)
  if (tail?.type !== 'list' || tail.items.length !== 1 ||
      tail.items[0]?.children.length !== 0) return undefined
  const marker = listMarker(body.at(-1)?.text ?? '')
  return marker && rootLinkDef(marker.content) ? tail.pos?.endColumn : undefined
}

function rejectOverindentedQuotedColon(cursor: Cursor, first: SourceLine): void {
  const follower = cursor.peek(1)?.text
  if (/^>  +:{3,}/.test(first.text) && follower &&
      !follower.startsWith('>') && !follower.startsWith(' ')) {
    throw new UnsupportedCursorSyntax('overindented quoted colon owner')
  }
}

function takeLeadingPlusQuoteFollower(cursor: Cursor, body: SourceLine[]): SourceLine | undefined {
  if (body.length !== 1 || body[0]!.text !== '+') return undefined
  const line = cursor.peek()
  if (!line?.text.startsWith(' ') || !plainQuoteText(line.text.trimStart()) ||
      cursor.peek(1) && !isBlankLine(cursor.peek(1)!.text)) return undefined
  return cursor.take()
}

/** The walk read a list marker as lazy text of a quote paragraph: only quotes were missed. */
function quoteParagraphMarkerLazy(line: SourceLine, previous: SourceLine | undefined): boolean {
  const event = line.event
  return event?.lazy === true && event.kind === 'item' && event.missed.length > 0 &&
    event.missed.every((kind) => kind === 'quote') && previous?.number === line.number - 1 &&
    !RE_BLOCKQUOTE.test(line.text)
}

function quoteParagraphPlusLazy(cursor: Cursor, body: SourceLine[], line: SourceLine,
  previous: SourceLine | undefined): boolean {
  const event = previous?.event
  const terminalNestedList = body.length === 2 && body[0]?.text.startsWith('>') &&
    listMarker(body[0]!.text.slice(1).trimStart()) !== undefined &&
    listMarker(previous?.text.trimStart() ?? '') !== undefined
  return line.plusAfterPara === true && line.text === '+' && !cursor.peek(1) &&
    (terminalNestedList || body.length === 2 && (plainQuoteText(body[0]!.text.slice(2)) ||
      event?.missed.length === 1 && !body[0]!.text.startsWith('>') &&
      plainQuoteText(body[0]!.text)) &&
      event?.lazy === true && event.kind === 'item' && event.missed.length > 0 &&
      event.missed.every((kind) => kind === 'quote') && previous?.number === line.number - 1)
}

function rootQuoteTerminalListPlus(cursor: Cursor, body: SourceLine[], line: SourceLine,
  previous: SourceLine | undefined): boolean {
  return cursor.owner.kind === 'root' && line.text === '+' && line.plusAfterPara === true &&
    body.length > 1 && plainQuoteText(body[0]!.text) &&
    previous?.number === line.number - 1 &&
    listMarker(previous.text.trimStart()) !== undefined && !cursor.peek(1)
}

function quoteParagraphTextLazy(line: SourceLine, previous: SourceLine | undefined): boolean {
  const event = previous?.event
  return line.quoteParaLazy === true && line.event?.kind === 'text' &&
    event?.lazy === true && event.kind === 'item' && event.missed.length > 0 &&
    event.missed.every((kind) => kind === 'quote') && previous?.number === line.number - 1 &&
    plainQuoteText(line.text.trimStart())
}

function nestedQuoteLazyFollower(line: SourceLine, previous: SourceLine | undefined,
  owner: ContainerOwner): boolean {
  const currentEvent = line.event
  const previousEvent = previous?.event
  if (owner.kind !== 'quote' || line.lazyText !== true || previous?.lazyText !== true ||
      previous.number !== line.number - 1 || currentEvent?.lazy !== true ||
      currentEvent.kind !== 'text' || previousEvent?.lazy !== true) return false
  const one = (event: LineEvent): boolean => event.reached === 'quote' &&
    event.missed.length === 1 && event.missed[0] === 'quote'
  const two = (event: LineEvent): boolean => event.reached === 'doc' &&
    event.missed.length === 2 && event.missed.every((kind) => kind === 'quote')
  const colonTwo = (event: LineEvent): boolean => event.reached === 'colon' &&
    event.missed.length === 2 && event.missed.every((kind) => kind === 'quote')
  return one(currentEvent) && two(previousEvent) || two(currentEvent) && one(previousEvent) ||
    one(currentEvent) && one(previousEvent) && previousEvent.kind === 'item' ||
    colonTwo(currentEvent) && colonTwo(previousEvent) && previousEvent.kind === 'item'
}

function colonNestedQuoteLazyFollower(line: SourceLine, previous: SourceLine | undefined,
  body: SourceLine[], owner: ContainerOwner): boolean {
  const current = line.event
  const prior = previous?.event
  return owner.kind === 'colon' && body[0]?.text.startsWith('>') === true &&
    previous?.lazyText === true && previous.number === line.number - 1 &&
    prior?.lazy === true && prior.kind === 'item' && prior.reached === 'colon' &&
    prior.missed.length === 2 && prior.missed.every((kind) => kind === 'quote') &&
    current?.lazy === true && current.kind === 'text' && current.reached === 'colon' &&
    current.missed.length === 2 && current.missed.every((kind) => kind === 'quote')
}

function colonQuoteTextFollower(line: SourceLine, previous: SourceLine | undefined,
  body: SourceLine[], owner: ContainerOwner): boolean {
  const prior = previous?.event
  const current = line.event
  return owner.kind === 'colon' && plainQuoteText(body[0]?.text ?? '') &&
    previous?.number === line.number - 1 && previous.text.startsWith('>') &&
    prior?.lazy === true && prior.kind === 'text' && prior.reached === 'colon' &&
    prior.missed.length === 1 && prior.missed[0] === 'quote' &&
    current?.lazy === true && current.kind === 'text' && current.reached === 'colon' &&
    current.missed.length === 1 && current.missed[0] === 'quote' &&
    (plainQuoteText(line.text.trimStart()) || /^: {2,}/.test(line.text))
}

function nestedQuoteRootTail(line: SourceLine, previous: SourceLine | undefined,
  body: SourceLine[], owner: ContainerOwner): boolean {
  const currentEvent = line.event
  const previousEvent = previous?.event
  return owner.kind === 'root' && body[0]?.text.startsWith('>') === true &&
    previous?.lazyText === true && previous.number === line.number - 1 &&
    previousEvent?.lazy === true && previousEvent.reached === 'quote' &&
    previousEvent.missed.length === 1 && previousEvent.missed[0] === 'quote' &&
    currentEvent?.lazy === true && currentEvent.kind === 'text' &&
    currentEvent.reached === 'doc' && currentEvent.missed.length === 2 &&
    currentEvent.missed.every((kind) => kind === 'quote') &&
    (plainQuoteText(line.text) || /^ {2}[^ ]/.test(line.text) &&
      plainQuoteText(line.text.slice(2)) || /^ *: {2,}/.test(line.text) ||
      line.text.startsWith('>>') && listMarker(line.text.slice(2)) !== undefined)
}

function colonQuoteItemFollower(line: SourceLine, previous: SourceLine | undefined,
  body: SourceLine[], owner: ContainerOwner): boolean {
  const current = line.event
  const prior = previous?.event
  const missedQuotes = (event: LineEvent): boolean => event.missed.length > 0 &&
    event.missed.length <= 2 && event.missed.every((kind) => kind === 'quote')
  return owner.kind === 'colon' && body[0] !== undefined &&
    (plainQuoteText(body[0].text) || nestedQuoteParagraphText(body[0].text)) &&
    previous?.number === line.number - 1 &&
    previous.lazyText === true && prior?.lazy === true && prior.kind === 'item' &&
    prior.reached === 'colon' && missedQuotes(prior) &&
    current?.lazy === true && current.kind === 'text' && current.reached === 'colon' &&
    current.missed.length === prior.missed.length && missedQuotes(current) &&
    (plainQuoteText(line.text.trimStart()) || /^: {2,}/.test(line.text) ||
      /^ +\+$/.test(line.text) ||
      line.text.startsWith('>>') && listMarker(line.text.slice(2)) !== undefined)
}

function quoteNestedParagraphPlus(line: SourceLine, previous: SourceLine | undefined,
  body: SourceLine[], owner: ContainerOwner): boolean {
  const event = previous?.event
  return owner.kind === 'root' && body[0] !== undefined &&
    plainQuoteText(body[0].text) && line.text === '+' && line.plusAfterPara === true &&
    previous?.lazyText === true && previous.number === line.number - 1 &&
    event?.lazy === true && event.kind === 'text' && event.reached === 'doc' &&
    event.missed.length === 1 && event.missed[0] === 'quote' &&
    /^>>(?:[ \t]|$)/.test(previous.text)
}

function takeCursorQuoteLazyFollower(cursor: Cursor, body: SourceLine[]): SourceLine | undefined {
  const line = cursor.peek()
  if (!line) return undefined
  if (rootQuotedLiteralPlusTail(cursor, body, line)) {
    return { ...cursor.take(), lazyText: true }
  }
  if (attachedQuoteListLazyFollower(cursor.owner, body, line)) {
    return { ...cursor.take(), lazyText: true }
  }
  if (line.claimedQuoteLazy) return cursor.take()
  const previous = body.at(-1)
  if (rootQuoteTerminalListPlus(cursor, body, line, previous)) {
    return { ...cursor.take(), lazyText: true }
  }
  if (colonNestedQuoteLazyFollower(line, previous, body, cursor.owner)) {
    return { ...cursor.take(), lazyText: true }
  }
  if (colonQuoteTextFollower(line, previous, body, cursor.owner)) {
    return { ...cursor.take(), lazyText: true }
  }
  if (quoteNestedParagraphPlus(line, previous, body, cursor.owner)) {
    return { ...cursor.take(), lazyText: true }
  }
  if (colonQuoteItemFollower(line, previous, body, cursor.owner)) {
    return { ...cursor.take(), lazyText: true }
  }
  if (nestedQuoteLazyFollower(line, previous, cursor.owner)) return cursor.take()
  if (nestedQuoteRootTail(line, previous, body, cursor.owner)) {
    return { ...cursor.take(), lazyText: true }
  }
  if (nestedQuoteRootPlus(line, previous, body, cursor.owner)) {
    return { ...cursor.take(), lazyText: true }
  }
  const physicalFollower = cursor.physicalLines[line.number]
  if ((cursor.owner.kind === 'root' || (cursor.owner.kind === 'colon' &&
      (!physicalFollower || isBlankLine(physicalFollower.text)))) &&
      body.length === 1 && line.plusAfterPara &&
      line.text === '+' && previous?.number === line.number - 1 &&
      quotedLiteralListMarker(previous.text) &&
      (!cursor.peek(1) || isBlankLine(cursor.peek(1)!.text))) {
    return { ...cursor.take(), lazyText: true }
  }
  const previousMarker = listMarker(previous?.text ?? '')
  const firstMarker = listMarker(body[0]?.text ?? '')
  if (cursor.owner.kind === 'quote' && cursor.owner.parent?.kind === 'root' &&
      previous?.number === line.number - 1 && body.length >= 2 &&
      previousMarker?.content === '> +' && firstMarker?.content === '> +' &&
      /^ [^ ]/.test(line.text) && plainQuoteText(line.text.trimStart()) &&
      (!cursor.peek(1) || isBlankLine(cursor.peek(1)!.text))) {
    return { ...cursor.take(), lazyText: true }
  }
  if (quoteParagraphMarkerLazy(line, previous)) return { ...cursor.take(), lazyText: true }
  if (quoteParagraphPlusLazy(cursor, body, line, previous)) {
    return { ...cursor.take(), lazyText: true }
  }
  if (quoteParagraphTextLazy(line, previous)) {
    return { ...cursor.take(), lazyText: true }
  }
  if (cursor.owner.kind === 'quote' && line.lazyText && line.quoteParaLazy &&
      previous?.number === line.number - 1 && body.length === 1 && plainQuoteText(previous.text) &&
      /^\+ +$/.test(line.text) && line.event?.missed.length === 2 &&
      line.event.missed.every((kind) => kind === 'quote')) {
    return cursor.take()
  }
  if (line.quoteParaLazy && previous?.number === line.number - 1 && body.length === 1 &&
      previous.text.startsWith('>') && /^\+ +$/.test(line.text) &&
      line.event?.missed.length === 2 && line.event.missed.every((kind) => kind === 'quote')) {
    return { ...cursor.take(), lazyText: true }
  }
  if (line.plusAfterPara && previous?.lazyText && previous.number === line.number - 1 &&
      ((previous.event?.lazy && previous.event.missed.length > 1) || previous.quoteParaLazy && body.at(-2)?.quoteParaLazy)) {
    throw new UnsupportedCursorSyntax('plus marker after a quote lazy chain')
  }
  if (line.quoteParaLazy && previous?.quoteParaLazy && previous.lazyText &&
      previous.number === line.number - 1 && !fenceOpen(line.text)) {
    return { ...cursor.take(), lazyText: true }
  }
  if (previous?.lazyText && previous.number === line.number - 1 &&
      listMarker(previous.text) && /^ {2}[^ ]/.test(line.text) &&
      plainQuoteText(line.text.trimStart())) return { ...cursor.take(), lazyText: true }
  if (cursor.owner.kind !== 'root') return undefined
  const listQuote = body.length > 0 && /^- > \+$/.test(body.at(-1)!.text) &&
    /^ [^ ]/.test(line.text)
  const bracedParagraph = body.length === 2 && /^ +\{[^}]+$/.test(body[0]!.text) &&
    body[1]!.text === '}' && plainQuoteText(line.text)
  return (listQuote || bracedParagraph) &&
    (!cursor.peek(1) || isBlankLine(cursor.peek(1)!.text)) ?
    { ...cursor.take(), lazyText: true } : undefined
}

function attachedQuoteListLazyFollower(owner: ContainerOwner, body: SourceLine[],
  line: SourceLine): boolean {
  return owner.kind === 'root' && body.at(-2)?.text === '' &&
    listMarker(body.at(-1)?.text ?? '')?.indent === 0 &&
    line.event?.kind === 'text' && line.event.lazy &&
    line.event.reached === 'doc' && line.event.missed.length === 1 &&
    line.event.missed[0] === 'item'
}

function rootQuotedLiteralPlusTail(cursor: Cursor, body: SourceLine[],
  line: SourceLine): boolean {
  if (cursor.owner.kind !== 'root' || !quotedLiteralListMarker(body[0]?.text ?? '') ||
      cursor.peek(1) === undefined && line.text === '+') return false
  if (body.length === 1 && line.text === '+' && line.plusAfterPara &&
      body[0]!.number === line.number - 1) {
    return rootQuotedLiteralTailText(cursor.peek(1)?.text ?? '') && !cursor.peek(2)
  }
  return body.length === 2 && body[1]!.text === '+' && body[1]!.lazyText === true &&
    body[1]!.number === line.number - 1 && rootQuotedLiteralTailText(line.text) &&
    !cursor.peek(1)
}

function rootQuotedLiteralTailText(text: string): boolean {
  return /^ {2}: {2}\S/.test(text) || /^ {4}[^ ]/.test(text) &&
    plainQuoteText(text.slice(4))
}

function nestedQuoteRootPlus(line: SourceLine, previous: SourceLine | undefined,
  body: SourceLine[], owner: ContainerOwner): boolean {
  const prior = previous?.event
  const current = line.event
  return owner.kind === 'root' && body[0]?.text.startsWith('>') === true &&
    previous?.lazyText === true && previous.number === line.number - 1 &&
    quotedLiteralListMarker(previous.text) && /^ {2}\+$/.test(line.text) &&
    line.quoteParaLazy === true && prior?.kind === 'text' && prior.lazy &&
    prior.reached === 'quote' && prior.missed.length === 1 && prior.missed[0] === 'quote' &&
    current?.kind === 'text' && current.lazy && current.reached === 'doc' &&
    current.missed.length === 2 && current.missed.every((kind) => kind === 'quote')
}

function quotedLiteralListMarker(text: string): boolean {
  return text[0] === '>' && listMarker(text.slice(1))?.indent === 0
}

function skipQuotePlusAtColonCloser(cursor: Cursor, body: SourceLine[], line: SourceLine): boolean {
  const width = cursor.owner.colonCloser
  const follower = cursor.physicalLines[line.number]?.text
  if (cursor.owner.kind !== 'colon' || width === undefined || cursor.peek(1) ||
      !line.plusAfterPara || line.text !== '+' || body.length !== 1 ||
      body[0]!.number !== line.number - 1 ||
      !quotedLiteralListMarker(body[0]!.text) || !follower?.startsWith(':'.repeat(width)) ||
      !/^[ \t]*$/.test(follower.slice(width))) {
    return false
  }
  cursor.take()
  return true
}

function quoteLazyBodyLine(line: SourceLine): SourceLine {
  return listMarker(line.text) || (line.quoteParaLazy && /^>>(?:[ \t]|$)/.test(line.text)) ?
    { ...line, lazyText: true } : line
}

function takeRepeatedQuoteLazyItem(cursor: Cursor, body: SourceLine[]): SourceLine[] | undefined {
  const last = body.at(-1)
  const event = last?.event
  const repeated = listMarker(cursor.peek(1)?.text ?? '')
  const previous = listMarker(last?.text ?? '')
  if (cursor.owner.kind !== 'root' || cursor.peek()?.text !== '+' ||
      event?.lazy !== true || event.kind !== 'item' || event.reached !== 'doc' ||
      event.missed.length !== 1 || event.missed[0] !== 'quote' ||
      !repeated || !previous || repeated.ordered !== previous.ordered ||
      repeated.delim !== previous.delim || repeated.bullet !== previous.bullet) return undefined
  return [{ ...cursor.take(), lazyText: true }, { ...cursor.take(), lazyText: true }]
}

function takeQuotedLiteralParagraphTail(cursor: Cursor, body: SourceLine[]): SourceLine[] | undefined {
  const plus = cursor.peek()
  const follower = cursor.peek(1)
  const after = cursor.peek(2)
  if (plus?.text !== '+' || body.length !== 1 ||
      !quotedLiteralListMarker(body[0]!.text) ||
      !/^ {1,3}\S/.test(follower?.text ?? '') ||
      !plainQuoteText(follower!.text.trimStart()) ||
      !after || !isBlockStart(after.text) || RE_BLOCKQUOTE.test(after.text)) return undefined
  return [{ ...cursor.take(), lazyText: true }, { ...cursor.take(), lazyText: true }]
}

function parseQuote(cursor: Cursor, inline: CursorInline, definitionNodes: BlockNode[], depth: number): BlockQuote {
  const first = cursor.peek()!
  rejectOverindentedQuotedColon(cursor, first)
  const firstBlock = takeQuoteFirstBlock(cursor, inline, definitionNodes, depth)
  if (firstBlock) return firstBlock
  const body: SourceLine[] = []
  let last = first
  let plainParagraph = true
  let directParagraph = true
  let quotedListRun = false
  let firstFence = false
  let listOwner: QuoteListOwner | undefined
  let attachedListReturn = false
  let attachedUnclosedFence = false
  while (cursor.peek()) {
    const line = cursor.peek()!
    const repeatedLazyItem = takeRepeatedQuoteLazyItem(cursor, body)
    if (repeatedLazyItem) {
      body.push(...repeatedLazyItem)
      last = body.at(-1)!
      directParagraph = false
      continue
    }
    if (skipQuotePlusAtColonCloser(cursor, body, line)) continue
    const literalTail = takeQuotedLiteralParagraphTail(cursor, body)
    if (literalTail) {
      body.push(...literalTail)
      last = literalTail.at(-1)!
      directParagraph = false
      continue
    }
    const leadingPlusFollower = takeLeadingPlusQuoteFollower(cursor, body)
    if (leadingPlusFollower) {
      last = leadingPlusFollower
      body.push(leadingPlusFollower)
      directParagraph = false
      continue
    }
    const ownedLazy = takeCursorQuoteLazyFollower(cursor, body)
    if (ownedLazy) {
      last = ownedLazy
      body.push(last)
      directParagraph = false
      continue
    }
    if (depth === 0 && body.length === 1 && body[0]!.text === '> +') {
      const fenceEnd = closedFenceEnd(cursor)
      if (fenceEnd !== undefined &&
          (!cursor.peek(fenceEnd + 1) || isBlankLine(cursor.peek(fenceEnd + 1)!.text))) {
        for (let offset = 0; offset <= fenceEnd; offset++) {
          last = cursor.take()
          body.push(last)
        }
        directParagraph = false
        plainParagraph = false
        continue
      }
    }
    const degraded = takeDegradedQuoteLazyLine(cursor, first, body)
    if (degraded) {
      body.push(degraded)
      directParagraph = false
      last = degraded
      continue
    }
    if (repeatedQuotedLiteralParagraphMarker(cursor, body, line)) {
      body.push({ ...cursor.take(), lazyText: true })
      directParagraph = false
      last = line
      continue
    }
    if (!line.lazyText && line.text[0] === '>' && RE_BLOCKQUOTE.test(line.text)) {
      const prefix = line.text.startsWith('> ') ? 2 : 1
      const text = line.text.slice(prefix)
      quotedListRun = body.length === 0 && cursor.owner.kind === 'list' &&
        listMarker(text) !== undefined
      cursor.take()
      const owned = quotedOwnedBodyLine(line, body, prefix, text)
      body.push(attachedListReturn ? { ...owned,
        ...(listMarker(text) ? { quotedAttachedSibling: true } : { quoteResume: true }) } : owned)
      attachedListReturn = false
      if (body.length === 1) firstFence = fenceOpen(text) !== null
      const plain: boolean = plainQuoteText(text)
      const observed = observeQuoteListOwner(listOwner, cursor.owner, text, body.length === 1)
      listOwner = observed.owner
      directParagraph &&= plain
      plainParagraph = plain && !firstFence || observed.resumed ||
        plainParagraph && quotedParagraphText(text, plain)
      last = line
      continue
    }
    const definitionTail = takeDefinitionQuoteTail(cursor, body)
    if (definitionTail) {
      directParagraph = false
      last = definitionTail
      continue
    }
    const nestedListLazy = takeNestedQuoteListLazyLine(cursor, body)
    if (nestedListLazy) {
      directParagraph = false
      plainParagraph = false
      last = nestedListLazy
      continue
    }
    const nestedItemDescription = takeQuoteNestedItemDescription(cursor, body)
    if (nestedItemDescription) {
      directParagraph = false
      plainParagraph = false
      last = nestedItemDescription
      continue
    }
    if (quotedListPlainFollower(cursor, body, line, quotedListRun)) {
      body.push(cursor.take())
      directParagraph = false
      plainParagraph = false
      last = line
      continue
    }
    if (quotedListSibling(cursor, body, line, quotedListRun)) {
      body.push(cursor.take())
      directParagraph = false
      plainParagraph = false
      last = line
      continue
    }
    if (quotedListFirstBlockFollower(cursor, body, line)) {
      body.push(cursor.take())
      directParagraph = false
      plainParagraph = false
      last = line
      continue
    }
    const colonTail = takeQuotedColonDefinitionTail(cursor, body)
    if (colonTail) {
      directParagraph = false
      last = colonTail
      continue
    }
    const plusTail = takeQuotePlusTail(cursor, body, line)
    if (plusTail) {
      body.push(...plusTail)
      last = plusTail.at(-1)!
      directParagraph = false
      continue
    }
    const attached = takeAttachedQuoteContinuation(cursor, body, line)
    if (attached) {
      attachedListReturn = attached.listReturn
      last = attached.last
      plainParagraph = false
      directParagraph = false
      attachedUnclosedFence = attached.unclosedFence
      continue
    }
    rejectAmbiguousAttachedQuoteList(cursor, line)
    const abbreviationTail = takeQuotedListLiteralTail(cursor, body, listOwner)
    if (abbreviationTail) {
      directParagraph = false
      last = abbreviationTail
      continue
    }
    const colonLiteralTail = takeIndentedColonQuoteTail(cursor, body)
    if (colonLiteralTail) {
      directParagraph = false
      last = colonLiteralTail
      continue
    }
    const lazyColon = /^ +: +/.test(line.text) && body.at(-1)?.text.startsWith(': ')
    const refusedFirstBlock = (quoteEndsInPlus(body.at(-1)?.text ?? '') ||
      quoteListEndsInPlus(body.at(-1)?.text ?? '')) &&
      listMarker(line.text) !== undefined
    const nestedHandoff = nestedQuoteParagraphLazyHandoff(cursor, body, line)
    if (((!cursor.owner.inList || line.lazyText) && plainParagraph) || refusedFirstBlock ||
        nestedHandoff) {
      if ((plainQuoteText(line.text) || listMarker(line.text) || lazyColon ||
          line.lazyText && (RE_HEADING.test(line.text) || RE_BLOCKQUOTE.test(line.text)) ||
          (line.text[0] === '>' && !RE_BLOCKQUOTE.test(line.text))) &&
          (lazyColon || refusedFirstBlock || line.lazyText &&
            (listMarker(line.text) || RE_HEADING.test(line.text) || RE_BLOCKQUOTE.test(line.text)) ||
            continueQuoteLazily(cursor, body, line))) {
        const lazyLine = cursor.take()
        body.push(nestedHandoff ?
          { ...lazyLine, lazyText: true, claimedQuoteLazy: true } : quoteLazyBodyLine(lazyLine))
        directParagraph = false
        last = line
        continue
      }
    }
    break
  }
  if (body.at(-1)?.text.trim() === '+' && cursor.peek()?.text.startsWith('|')) {
    throw new UnsupportedCursorSyntax('quote continuation into table')
  }
  const wrappedAttributeTail = wrappedQuoteAttributeTail(body)
  const inlineCode = !wrappedAttributeTail && cursor.peek()?.text[0] === ' ' &&
    cursor.peek()!.text.includes('`') ? takeQuotedInlineCodeContinuation(cursor, body) : undefined
  const lazyTail = takeQuoteLazyBoundaryTail(cursor, body,
    !!wrappedAttributeTail, inlineCode, listOwner, directParagraph)
  if (lazyTail) {
    body.push(...lazyTail)
    directParagraph = false
    last = lazyTail.at(-1)!
  }
  rejectOpenQuotedListFence(body, listOwner)
  const children = quoteChildrenAtCursor(cursor, inline, definitionNodes, depth, body,
    directParagraph, listOwner?.boundaryFence || attachedUnclosedFence, attachedUnclosedFence)
  if (attachedUnclosedFence && cursor.peek()?.text === '+' && !cursor.peek(1)) {
    last = { ...cursor.peek()!, text: '' }
  }
  const onlyDefinition = isSingleDefinitionOnlyQuote(children, body)
  const onlyRootDefinitions = isRootDefinitionOnlyQuote(cursor, children, body)
  const onlyNestedDefinition = isNestedDefinitionOnlyQuote(cursor, children, body)
  const markerDefinitionEnd = markerDefinitionOnlyQuoteEnd(children, body)
  const placedEndLine = children.at(-1)?.pos?.endLine
  const quoteLast = onlyRootDefinitions || onlyDefinition || onlyNestedDefinition ? first : placedEndLine && placedEndLine < last.number ?
    cursor.physicalLines[placedEndLine - 1] ?? last : last
  return { type: 'block_quote', children,
    pos: position(first, quoteLast, 1,
      definitionOnlyQuoteEndColumn(first, quoteLast, onlyNestedDefinition,
        onlyDefinition || onlyRootDefinitions, markerDefinitionEnd)) }
}

function closesColonOwner(text: string, width: number): boolean {
  let offset = 0
  while (text[offset] === ':') offset++
  if (offset !== width) return false
  while (offset < text.length) {
    if (text[offset] !== ' ' && text[offset] !== '\t') return false
    offset++
  }
  return true
}

function foldedColonListText(line: SourceLine, previous: SourceLine | undefined): SourceLine | undefined {
  if (previous?.lazyText !== true || listMarker(previous.text) === undefined ||
      !/^ {2}[^ ]/.test(line.text) || !plainQuoteText(line.text.slice(2))) return undefined
  return { ...line, text: line.text.slice(2), start: line.start + 2,
    baseColumn: (line.baseColumn ?? 1) + 2, lazyText: true }
}

function takeColonBody(cursor: Cursor, openerLength: number):
  { lines: SourceLine[]; unclosedFence: boolean; ambiguousUnclosedFence: boolean } {
  const body: SourceLine[] = []
  const nestedClosers: number[] = []
  let opaqueFence: string | undefined
  let colonLazyBeforeFence = false
  let ambiguousUnclosedFence = false
  while (cursor.peek()) {
    const line = cursor.peek()!
    const text = line.text
    if (opaqueFence) {
      body.push(cursor.take())
      if (closesFence(text, opaqueFence)) opaqueFence = undefined
      continue
    }
    const firstChar = text[0]
    const openingFence = firstChar === '`' || firstChar === '~' ?
      fenceOpen(text)?.marker ?? RE_RAW_FENCE.exec(text)?.[1] : undefined
    if (openingFence) {
      const prior = body.at(-1)?.text ?? ''
      const priorMarker = listMarker(prior)
      ambiguousUnclosedFence = colonLazyBeforeFence || prior.trim() === '+' ||
        prior.includes('{#') && (RE_BLOCKQUOTE.test(prior) ||
          priorMarker !== undefined && priorMarker.indent > 0)
      opaqueFence = openingFence
      body.push(cursor.take())
      continue
    }
    colonLazyBeforeFence ||= line.event?.lazy === true && line.event.reached === 'colon'
    if (closesColonOwner(text, nestedClosers.at(-1) ?? openerLength)) {
      if (nestedClosers.length === 0) break
      nestedClosers.pop()
      body.push(cursor.take())
      continue
    }
    const nested = text[0] === ':' ? COLON_OPEN.exec(text) ?? RE_DIV_OPEN.exec(text) ??
      RE_VALID_ADMONITION_OPEN.exec(text) ?? RE_ADMONITION_OPEN.exec(text) ??
      RE_LINE_BLOCK_OPEN.exec(text) ?? RE_QUOTE_BLOCK_OPEN.exec(text) ??
      RE_HARDBREAKS_OPEN.exec(text) : null
    if (nested) {
      nestedClosers.push(nested[1]!.length)
    } else if (text.startsWith(':::')) throw new UnsupportedCursorSyntax('nested colon container')
    const foldedText = foldedColonListText(line, body.at(-1))
    cursor.take()
    body.push(foldedText ?? line)
  }
  return { lines: body, unclosedFence: opaqueFence !== undefined, ambiguousUnclosedFence }
}

function boundedColonFence(body: SourceLine[], cursor: Cursor, run: number): SourceLine | undefined {
  let openerIndex = 0
  while (openerIndex < body.length) {
    const text = body[openerIndex]!.text
    if (text === '' || LINE_COMMENT.test(text) && !RE_COMMENT_BLOCK_ANY.test(text) ||
        (text[0] === '{' || text[0] === ' ' || text[0] === '\t') &&
        parseBlockAttributeRun(text)) openerIndex++
    else break
  }
  const opener = body[openerIndex] && fenceOpen(body[openerIndex]!.text)
  const boundary = cursor.peek()
  if (!opener || !boundary || !new RegExp(`^:{${run}}[ \t]*$`).test(boundary.text)) return undefined
  for (let i = openerIndex + 1; i < body.length; i++) {
    if (closesFence(body[i]!.text, opener.marker)) return undefined
  }
  return boundary
}

function colonMayEndInCodeFence(body: SourceLine[], boundary: SourceLine | undefined,
  atEnd: boolean, unclosedFence: boolean, ambiguousUnclosedFence: boolean): boolean {
  if (boundary !== undefined || fenceOpen(body[0]?.text ?? '') !== null) return true
  if (atEnd && unclosedFence && !ambiguousUnclosedFence) return true
  if (!atEnd || !FOOTNOTE_DEF.test(body[0]?.text ?? '') || body.length < 3) return false
  const fenceIndex = body.findIndex((line, index) => index > 1 && fenceOpen(line.text) !== null)
  if (fenceIndex < 0) return false
  const marker = fenceOpen(body[fenceIndex]!.text)!.marker
  return !body.slice(fenceIndex + 1).some((line) => closesFence(line.text, marker))
}

function boundedQuoteFence(cursor: Cursor, first: SourceLine, payload: SourceLine[]): boolean {
  if (cursor.owner.kind !== 'quote' || cursor.lines[0]?.number !== first.number) return false
  const firstPayload = payload[0]
  const next = cursor.physicalLines[(payload.at(-1) ?? first).number]
  if (firstPayload && cursor.owner.parent?.kind === 'list' &&
      cursor.owner.parent.parent?.kind === 'root' &&
      cursor.owner.listRootPrefix !== undefined && next &&
      new RegExp(`^ {${cursor.owner.listRootPrefix + 2},}>`).test(next.text)) return true
  if (!firstPayload) {
    return !next || next.text !== '' && next.text[0] !== ' ' && next.text[0] !== '>'
  }
  const column = firstPayload.baseColumn ?? 1
  if (column >= (first.baseColumn ?? 1) ||
      payload.some((line) => (line.baseColumn ?? 1) < column)) return false
  return !next || !plainQuoteText(next.text)
}

function boundedListFence(cursor: Cursor, first: SourceLine, payload: SourceLine[], marker: string): boolean {
  if (cursor.owner.kind !== 'list' || cursor.owner.listRootPrefix === undefined) return false
  const index = cursor.lines.findIndex((line) => line.number === first.number)
  if (index <= 0 || cursor.lines[index - 1]?.text !== '') return false
  const next = cursor.physicalLines[(payload.at(-1) ?? first).number]
  if (!next || !closesFence(next.text.trimStart(), marker)) return false
  const indent = /^ */.exec(next.text)![0].length
  return indent <= cursor.owner.listRootPrefix
}

function boundedListDedentFence(cursor: Cursor, first: SourceLine,
  payload: SourceLine[], marker: string): boolean {
  if (cursor.owner.kind !== 'list' || cursor.owner.listRootPrefix === undefined ||
      payload.length === 0) return false
  const next = cursor.physicalLines[payload.at(-1)!.number]
  const closer = cursor.physicalLines[payload.at(-1)!.number + 1]
  if (!next || !closer || !plainQuoteText(next.text.trimStart())) return false
  const prefix = cursor.owner.listRootPrefix
  const ownerPrefix = Math.max(prefix, (first.baseColumn ?? 1) - 1)
  const indent = /^ */.exec(next.text)![0].length
  const closerIndent = /^ */.exec(closer.text)![0].length
  return indent < prefix && (closerIndent === prefix || closerIndent === ownerPrefix) &&
    closesFence(closer.text.slice(closerIndent), marker) &&
    (!cursor.physicalLines[closer.number] || cursor.physicalLines[closer.number]!.text === '')
}

function boundedListEofFence(cursor: Cursor, first: SourceLine, payload: SourceLine[]): boolean {
  const last = payload.at(-1)
  return cursor.owner.kind === 'list' && cursor.lines[0]?.number === first.number &&
    last?.text === '' && last.number === cursor.physicalLines.at(-1)?.number
}

function boundedListSiblingFence(cursor: Cursor, payload: SourceLine[]): SourceLine | undefined {
  const last = payload.at(-1)
  if (cursor.owner.kind !== 'list' || cursor.owner.listRootPrefix === undefined ||
      !last || last.text !== '' || cursor.physicalLines[last.number - 1]?.text !== '') return undefined
  const next = cursor.physicalLines[last.number]
  return next && listMarker(next.text)?.indent === 0 ? { ...next, text: '' } : undefined
}

/** The walk ended this fence at the line after its payload: that line fell outside the fence's owner. */
function ownerEndBoundaryLine(next: SourceLine): SourceLine {
  return { ...next, text: '', baseColumn: (next.baseColumn ?? 1) - (next.lead ?? 0) }
}

function ownerEndBoundary(cursor: Cursor, first: SourceLine, payload: SourceLine[]): SourceLine | undefined {
  const next = cursor.physicalLines[(payload.at(-1) ?? first).number]
  if (next?.ownerEnd?.opener !== first.number - 1) return undefined
  const last = payload.at(-1)
  return last && isBlankLine(last.text) &&
    cursor.physicalLines[last.number - 1]?.text === '' ? ownerEndBoundaryLine(next) : last ?? first
}

/** The fence payload reaches the last physical line: end of input closes it for every owner. */
function boundedEofFence(cursor: Cursor, first: SourceLine, payload: SourceLine[]): boolean {
  if (cursor.owner.kind === 'root' ||
      (payload.at(-1) ?? first).number !== cursor.physicalLines.at(-1)?.number) return false
  const index = cursor.lines.indexOf(first)
  if (index <= 0) return false
  if (cursor.owner.kind === 'quote' &&
      payload.some((line) => !/^\s*>/.test(cursor.physicalLines[line.number - 1]?.text ?? ''))) return false
  return !followsParagraphText(cursor.lines[index - 1]!.text)
}

function followsParagraphText(previous: string): boolean {
  const before = previous.trim()
  return !(before === '' || /^\{[^{}]*\}$/.test(before) || /^%%?\s/.test(before))
}

function boundedPostBreakEmptyFence(cursor: Cursor, first: SourceLine, payload: SourceLine[]): boolean {
  const index = cursor.lines.indexOf(first)
  return cursor.owner.kind === 'list' && payload.length === 0 && index > 0 &&
    BREAK.test(cursor.lines[index - 1]!.text) &&
    first.number === cursor.physicalLines.at(-1)?.number
}

function boundedPostTermEmptyFence(cursor: Cursor, first: SourceLine,
  payload: SourceLine[]): boolean {
  const index = cursor.lines.indexOf(first)
  const term = index > 0 ? /^:: +[ \t]*([^ \t].*)$/.exec(cursor.lines[index - 1]!.text) : null
  if (cursor.owner.kind !== 'quote' || payload.some((line) => !isBlankLine(line.text)) ||
      !term || (payload.at(-1) ?? first).number !== cursor.physicalLines.at(-1)?.number) return false
  const termColumn = cursor.lines[index - 1]!.text.length - term[1]!.length
  const termBase = cursor.lines[index - 1]!.baseColumn ?? 1
  return (first.baseColumn ?? 1) < termBase + termColumn
}

function takeFenceCloseAtCursor(cursor: Cursor, first: SourceLine, payload: SourceLine[]): SourceLine {
  if (cursor.peek()) return cursor.take()
  const marker = fenceOpen(first.text)?.marker
  const siblingBoundary = marker ? boundedListSiblingFence(cursor, payload) : undefined
  if (siblingBoundary) return siblingBoundary
  const ownerEnd = marker ? ownerEndBoundary(cursor, first, payload) : undefined
  if (ownerEnd && !payload.some((line) => closesFence(line.text.trimStart(), marker!))) return ownerEnd
  if (marker && (cursor.owner.allowUnclosedFence || boundedQuoteFence(cursor, first, payload) ||
      boundedListFence(cursor, first, payload, marker) ||
      boundedListDedentFence(cursor, first, payload, marker) ||
      boundedListEofFence(cursor, first, payload) ||
      boundedEofFence(cursor, first, payload) ||
      boundedPostBreakEmptyFence(cursor, first, payload) ||
      boundedPostTermEmptyFence(cursor, first, payload)) &&
      !payload.some((line) => closesFence(line.text.trimStart(), marker))) {
    const last = payload.at(-1)
    return cursor.owner.fenceBoundary && last && isBlankLine(last.text) ?
      { ...cursor.owner.fenceBoundary, text: '' } : last ?? first
  }
  if (cursor.owner.allowEmptyFence && payload.length === 0 &&
      /^(?:`{3,}|~{3,})$/.test(first.text)) return first
  if (cursor.owner.kind === 'root' && marker) {
    return payload.at(-1) ?? first
  }
  if (cursor.owner.kind === 'list' && cursor.lines[0]?.number === first.number &&
      payload.length === 1 && payload[0]!.text !== '' &&
      payload[0]!.number === cursor.physicalLines.at(-1)?.number) return payload[0]!
  throw new UnsupportedCursorSyntax('unclosed fence')
}

function footnotePlainColumn(line: SourceLine): number {
  return /^[ \t]*/.exec(line.text)![0].length + 1
}

// Flush-left lines a root footnote paragraph keeps as lazy text instead of handing back to the root.
function footnoteLazyOwnedLine(text: string): boolean {
  return !text.includes('\t') && (listMarker(text) !== undefined || /^: +\S/.test(text))
}

function rootNoteLazyText(line: SourceLine | undefined): boolean {
  const event = line?.event
  return event?.lazy === true && event.kind === 'text' && event.reached === 'doc' &&
    event.missed.length === 1 && event.missed[0] === 'note' &&
    line?.text.startsWith('>> ') === true
}

function footnoteListLazyText(cursor: Cursor, index: number, bodyLength: number): boolean {
  const line = cursor.peek(index)
  const previous = cursor.peek(index - 1)
  const event = line?.event
  return bodyLength > 0 && previous !== undefined && line?.number === previous.number + 1 &&
    event?.lazy === true && event.kind === 'text' && event.reached === 'item' &&
    event.missed.length === 1 && event.missed[0] === 'note' &&
    plainQuoteText(line.text)
}

function simpleFootnoteBodyLine(cursor: Cursor, index: number, bodyLength: number, separated: boolean,
  lazyFirstLine: boolean, lazyOwned: boolean): boolean {
  const afterPlus = bodyLength > 0 && cursor.peek(index - 1)!.text.trim() === '+'
  return simpleFootnoteParagraphLine(cursor.peek(index), !separated, lazyFirstLine, afterPlus, lazyOwned) ||
    rootNoteLazyText(cursor.peek(index)) ||
    footnoteListLazyText(cursor, index, bodyLength) ||
    separated && bodyLength > 0 && lazyPlainNoteLine(cursor.peek(index)) ||
    bodyLength > 0 && cursor.peek(index)?.noteLazy === true && cursor.peek(index)?.claimedQuoteLazy === true ||
    bodyLength > 0 && (lazyFenceBefore(cursor, index) && lazyPlainNoteLine(cursor.peek(index)) &&
        rootLinkDef(cursor.peek(index)!.text) === null)
}

/** A non-blank line after the note body that is neither a blank gap nor a root block the note hands back to. */
function footnoteBodyContinuesPast(cursor: Cursor, index: number): boolean {
  const line = cursor.peek(index)
  return line !== undefined && line.text !== '' && !footnoteEndsAtRootBlock(cursor, index)
}

/** A flush-left closed fence, or a link definition after a lazy fence line, is a root block after the note. */
function footnoteEndsAtRootBlock(cursor: Cursor, index: number): boolean {
  const text = cursor.peek(index)?.text ?? ''
  if (text !== text.trimStart()) return false
  const fence = fenceOpen(text)
  if (fence) return true
  return lazyFenceBefore(cursor, index) && rootLinkDef(text) !== null
}

/** Index of the lazy fence line in the note body, or -1. */
function lazyFenceIndex(cursor: Cursor, nextIndex: number, bodyLength: number): number {
  for (let i = 0; i < bodyLength; i++) {
    const text = cursor.peek(nextIndex + i)!.text
    if (text === text.trimStart() && fenceOpen(text) !== null) return i
  }
  return -1
}

function markLazyNoteFence(cursor: Cursor, hasBodyLine: boolean, nextIndex: number, bodyLength: number): void {
  if (!hasBodyLine) return
  const at = lazyFenceIndex(cursor, nextIndex, bodyLength)
  if (at < 0) return
  if (!indentedPlainBeforeFence(cursor, nextIndex, at)) {
    throw new UnsupportedCursorSyntax('footnote lazy fence after structural body lines')
  }
  cursor.noteLazyFenceEnd = cursor.peek(nextIndex + bodyLength)?.number ?? 0
}

/** The reference registers a definition after the lazy fence unless the note body was only indented plain lines. */
function indentedPlainBeforeFence(cursor: Cursor, nextIndex: number, fenceAt: number): boolean {
  for (let i = 0; i < fenceAt; i++) {
    const text = cursor.peek(nextIndex + i)!.text
    if (!/^ {2,}\S/.test(text) || listMarker(text.trimStart()) !== undefined || !plainQuoteText(text.trimStart())) {
      return false
    }
  }
  return true
}

function lazyFenceBefore(cursor: Cursor, index: number): boolean {
  const text = cursor.peek(index - 1)?.text ?? ''
  return index > 1 && text === text.trimStart() && fenceOpen(text) !== null
}

/** A flush-left plain line continues the paragraph of a note's blank-separated body. */
function lazyPlainNoteLine(line: SourceLine | undefined): boolean {
  return line !== undefined && line.text === line.text.trimStart() && plainQuoteText(line.text) &&
    !isBlockStart(line.text) && listMarker(line.text) === undefined
}

function simpleFootnoteParagraphLine(line: SourceLine | undefined, allowList = false,
  allowLazy = false, afterPlus = false, allowOwned = false): boolean {
  if (!line) return false
  const prefix = footnotePlainColumn(line) - 1
  if (!allowLazy && sourceColumnAt(line.text, prefix) + (allowList ? line.lead ?? 0 : 0) < 2) return false
  const content = line.text.slice(prefix)
  return plainQuoteText(content) ||
    allowLazy && content === '+' ||
    allowOwned && prefix === 0 && !(afterPlus && listMarker(content) !== undefined) &&
      footnoteLazyOwnedLine(content) ||
    allowLazy && prefix === 1 && rootLinkDef(content) !== null ||
    allowList && !(line.text[0] === '\t' && content[0] === ' ') && listMarker(content) !== undefined ||
    ((content[0] === '*' || content[0] === '_' || content[0] === '`') && !isBlockStart(content))
}

function simpleFootnoteStructuralLines(cursor: Cursor, nextIndex: number):
  { source: SourceLine[]; body: SourceLine[] } | undefined {
  const first = cursor.peek(nextIndex)
  if (!first?.text.startsWith('  ')) return undefined
  const firstIndent = /^[ ]*/.exec(first.text)![0].length
  const firstText = first.text.slice(firstIndent)
  const heading = RE_HEADING.test(firstText)
  const quote = RE_BLOCKQUOTE.test(firstText)
  const fence = fenceOpen(firstText)?.marker ?? RE_RAW_FENCE.exec(firstText)?.[1]
  const table = firstText[0] === '|' && isTableRow(firstText)
  const list = listMarker(firstText)
  if (list && nextIndex === 1) return undefined
  const attrs = firstText[0] === '{' && parseBlockAttributeRun(firstText)
  const comment = LINE_COMMENT.test(firstText)
  if (!heading && !quote && !fence && !table && !list && !attrs && !comment) return undefined
  const source = [first]
  const body: SourceLine[] = [{ text: firstText, start: first.start + firstIndent, number: first.number,
    baseColumn: (first.baseColumn ?? 1) + firstIndent }]
  const second = cursor.peek(nextIndex + 1)
  if ((quote || attrs) && second?.text.startsWith('  ')) {
    const indent = /^[ ]*/.exec(second.text)![0].length
    const text = second.text.slice(indent)
    if ((quote && (plainQuoteText(text) ||
        (indent === firstIndent && RE_HEADING.test(text)))) ||
        (attrs && indent === firstIndent && plainQuoteText(text))) {
      source.push(second)
      body.push({ text, start: second.start + indent, number: second.number,
        baseColumn: (second.baseColumn ?? 1) + indent })
    }
  }
  if (fence) {
    let closed = false
    for (let offset = nextIndex + 1; cursor.peek(offset); offset++) {
      const line = cursor.peek(offset)!
      if (!line.text.startsWith(' '.repeat(firstIndent))) return undefined
      const text = line.text.slice(firstIndent)
      source.push(line)
      body.push({ text, start: line.start + firstIndent, number: line.number,
        baseColumn: (line.baseColumn ?? 1) + firstIndent })
      if (closesFence(text, fence)) { closed = true; break }
    }
    if (!closed) return undefined
  } else if (table) {
    for (let offset = nextIndex + 1; cursor.peek(offset); offset++) {
      const line = cursor.peek(offset)!
      if (!line.text.startsWith(' '.repeat(firstIndent))) break
      const text = line.text.slice(firstIndent)
      if (!isTableRow(text)) break
      source.push(line)
      body.push({ text, start: line.start + firstIndent, number: line.number,
        baseColumn: (line.baseColumn ?? 1) + firstIndent })
    }
  } else if (comment) {
    const opener = RE_COMMENT_BLOCK_ANY.exec(firstText)
    if (opener) {
      let closed = false
      for (let offset = nextIndex + 1; cursor.peek(offset); offset++) {
        const line = cursor.peek(offset)!
        if (!line.text.startsWith(' '.repeat(firstIndent))) return undefined
        const text = line.text.slice(firstIndent)
        source.push(line)
        body.push({ text, start: line.start + firstIndent, number: line.number,
          baseColumn: (line.baseColumn ?? 1) + firstIndent })
        if (RE_COMMENT_BLOCK_ANY.exec(text)?.[1]?.length === opener[1]!.length) {
          closed = true
          break
        }
      }
      if (!closed) return undefined
    }
    const trailing = cursor.peek(nextIndex + source.length)
    const afterTrailing = cursor.peek(nextIndex + source.length + 1)
    if (trailing?.text.startsWith(' '.repeat(firstIndent)) &&
        plainQuoteText(trailing.text.slice(firstIndent)) &&
        (!afterTrailing || isBlankLine(afterTrailing.text))) {
      source.push(trailing)
      body.push({ text: trailing.text.slice(firstIndent), start: trailing.start + firstIndent,
        number: trailing.number, baseColumn: (trailing.baseColumn ?? 1) + firstIndent })
    }
  }
  if (table) {
    let offset = nextIndex + source.length
    let blanks = 0
    while (cursor.peek(offset + blanks)?.text === '') blanks++
    const trailing = cursor.peek(offset + blanks)
    const afterTrailing = cursor.peek(offset + blanks + 1)
    if (blanks > 0 && trailing?.text.startsWith(' '.repeat(firstIndent)) &&
        plainQuoteText(trailing.text.trimStart()) &&
        (!afterTrailing || isBlankLine(afterTrailing.text))) {
      for (let i = 0; i < blanks; i++) {
        const blank = cursor.peek(offset + i)!
        source.push(blank)
        body.push(blank)
      }
      source.push(trailing)
      body.push({ text: trailing.text.slice(firstIndent), start: trailing.start + firstIndent,
        number: trailing.number, baseColumn: (trailing.baseColumn ?? 1) + firstIndent })
    }
  } else if (list) {
    let offset = nextIndex + source.length
    let blanks = 0
    while (cursor.peek(offset + blanks)?.text === '') blanks++
    const trailing = cursor.peek(offset + blanks)
    const afterTrailing = cursor.peek(offset + blanks + 1)
    if (blanks > 0 && trailing?.text.startsWith(' '.repeat(firstIndent + 2)) &&
        RE_BLOCKQUOTE.test(trailing.text.slice(firstIndent + 2)) &&
        (!afterTrailing || isBlankLine(afterTrailing.text))) {
      for (let i = 0; i < blanks; i++) {
        const blank = cursor.peek(offset + i)!
        source.push(blank)
        body.push(blank)
      }
      source.push(trailing)
      body.push({ text: trailing.text.slice(firstIndent), start: trailing.start + firstIndent,
        number: trailing.number, baseColumn: (trailing.baseColumn ?? 1) + firstIndent })
    }
  }
  const after = cursor.peek(nextIndex + source.length)
  if (after && isBlankLine(after.text)) {
    let offset = nextIndex + source.length
    while (cursor.peek(offset) && isBlankLine(cursor.peek(offset)!.text)) offset++
    if (cursor.peek(offset)?.text.startsWith('  ')) return undefined
  }
  return !after || isBlankLine(after.text) ? { source, body } : undefined
}

function footnoteLateList(cursor: Cursor, nextIndex: number, bodyLength: number):
  { gap: number; source: SourceLine[]; body: SourceLine[] } | undefined {
  const last = cursor.peek(nextIndex + bodyLength - 1)
  if (bodyLength === 0 || last?.text.trim() !== '+' &&
      !plainQuoteText(last?.text.trimStart() ?? '')) return undefined
  let at = nextIndex + bodyLength
  while (cursor.peek(at) && isBlankLine(cursor.peek(at)!.text)) at++
  const line = cursor.peek(at)
  if (at === nextIndex + bodyLength || line?.lead !== 2 ||
      listMarker(line.text)?.indent !== 2) return undefined
  const structural = simpleFootnoteStructuralLines(cursor, at)
  if (structural?.body[0] && listMarker(structural.body[0].text)) {
    return { gap: at - nextIndex - bodyLength, ...structural }
  }
  const follower = cursor.peek(at + 1)
  if (follower?.event?.kind === 'text' && follower.event.lazy &&
      follower.event.reached === 'note' && follower.event.missed.length === 1 &&
      follower.event.missed[0] === 'item' && plainQuoteText(follower.text.trimStart())) {
    const indent = line.text.length - line.text.trimStart().length
    return { gap: at - nextIndex - bodyLength, source: [line, follower],
      body: [{ text: line.text.slice(indent), start: line.start + indent,
        number: line.number, baseColumn: (line.baseColumn ?? 1) + indent },
      { ...follower, lazyText: true }] }
  }
  if (rootLinkDef(cursor.peek(at + 1)?.text ?? '') === null) return undefined
  const indent = line.text.length - line.text.trimStart().length
  return { gap: at - nextIndex - bodyLength, source: [line],
    body: [{ text: line.text.slice(indent), start: line.start + indent,
      number: line.number, baseColumn: (line.baseColumn ?? 1) + indent }] }
}

type FootnoteLateList = NonNullable<ReturnType<typeof footnoteLateList>>

function footnoteLateListForBody(cursor: Cursor, footnote: RegExpExecArray,
  structural: ReturnType<typeof simpleFootnoteStructuralLines>, nextIndex: number,
  bodyLength: number): FootnoteLateList | undefined {
  return !structural && plainQuoteText(footnote[2] ?? '') ?
    footnoteLateList(cursor, nextIndex, bodyLength) : undefined
}

function consumeFootnoteLateList(cursor: Cursor, lateList: FootnoteLateList | undefined): void {
  if (!lateList) return
  for (let i = 0; i < lateList.gap + lateList.source.length; i++) cursor.take()
}

function appendFootnoteLateList(cursor: Cursor, inline: CursorInline, body: BlockNode[],
  lateList: FootnoteLateList | undefined): void {
  if (!lateList) return
  body.push(...parseBlocks(new Cursor(lateList.body, undefined,
    childOwner(cursor.owner, 'colon'), cursor.physicalLines), inline, [], 1, false))
}

function takeFootnoteFirstFence(cursor: Cursor, inline: CursorInline, first: SourceLine,
  footnote: RegExpExecArray, footnoteDefs: Record<string, BlockNode[]> | undefined,
  footnoteDefPos: Record<string, Position> | undefined): boolean {
  if (footnote[2] !== '+' || cursor.owner.kind !== 'root' || !footnoteDefs || !footnoteDefPos) {
    return false
  }
  const fenceOffset = parseBlockAttributeRun(cursor.peek(1)?.text ?? '') ? 2 : 1
  let end = closedFenceEnd(cursor, fenceOffset)
  const unclosed = end === undefined && fenceOpen(cursor.peek(fenceOffset)?.text ?? '') !== null
  if (unclosed) {
    let boundary = fenceOffset + 1
    while (cursor.peek(boundary) && !isBlankLine(cursor.peek(boundary)!.text)) boundary++
    if (boundary > 2 && cursor.peek(boundary + 1)) end = boundary - 1
  }
  if (end === undefined || cursor.peek(end + 1) && !isBlankLine(cursor.peek(end + 1)!.text)) {
    return false
  }
  cursor.take()
  const body: SourceLine[] = []
  for (let offset = 1; offset <= end; offset++) body.push(cursor.take())
  recordFirstBlockFenceHandoff(inline, first, body)
  const label = footnote[1]!
  if (Object.hasOwn(footnoteDefs, label)) return true
  const blocks = parseBlocks(new Cursor(body, undefined,
    childOwner(cursor.owner, 'colon', false, unclosed), cursor.physicalLines), inline, [], 1, false)
  Object.defineProperty(footnoteDefs, label, { value: blocks,
    enumerable: true, configurable: true, writable: true })
  Object.defineProperty(footnoteDefPos, label, { value: position(first, body.at(-1)!),
    enumerable: true, configurable: true, writable: true })
  return true
}

function takeFootnoteOpaqueHead(cursor: Cursor, inline: CursorInline, first: SourceLine,
  footnote: RegExpExecArray, footnoteDefs: Record<string, BlockNode[]> | undefined,
  footnoteDefPos: Record<string, Position> | undefined): boolean {
  const content = footnote[2]
  if (cursor.owner.kind !== 'root' || !content || !footnoteDefs || !footnoteDefPos) return false
  const comment = RE_COMMENT_BLOCK_ANY.exec(content)
  const raw = RE_RAW_FENCE.exec(content)?.[1]
  if (!comment && !raw && !LINE_COMMENT.test(content)) return false
  const column = first.text.length - content.length + 1
  const body: SourceLine[] = [{ text: content, start: first.start + column - 1,
    number: first.number, baseColumn: (first.baseColumn ?? 1) + column - 1 }]
  let end = 0
  if (comment || raw) {
    let closed = false
    for (let offset = 1; cursor.peek(offset)?.text.startsWith('  '); offset++) {
      const line = cursor.peek(offset)!
      const text = line.text.slice(2)
      body.push({ text, start: line.start + 2, number: line.number,
        baseColumn: (line.baseColumn ?? 1) + 2 })
      end = offset
      if (raw ? closesFence(text, raw) :
        RE_COMMENT_BLOCK_ANY.exec(text)?.[1]?.length === comment![1]!.length) {
        closed = true
        break
      }
    }
    if (!closed) return false
  }
  let after = end + 1
  while (cursor.peek(after) && isBlankLine(cursor.peek(after)!.text)) after++
  if (cursor.peek(after)?.text.startsWith('  ')) return false
  for (let offset = 0; offset <= end; offset++) cursor.take()
  const label = footnote[1]!
  if (Object.hasOwn(footnoteDefs, label)) return true
  const blocks = parseBlocks(new Cursor(body, undefined,
    childOwner(cursor.owner, 'colon'), cursor.physicalLines), inline, [], 1, false)
  Object.defineProperty(footnoteDefs, label, { value: blocks,
    enumerable: true, configurable: true, writable: true })
  Object.defineProperty(footnoteDefPos, label, { value: position(first, cursor.lines[cursor.at - 1]!),
    enumerable: true, configurable: true, writable: true })
  return true
}

function takeFootnoteHeadingHead(cursor: Cursor, inline: CursorInline, first: SourceLine,
  footnote: RegExpExecArray, footnoteDefs: Record<string, BlockNode[]> | undefined,
  footnoteDefPos: Record<string, Position> | undefined): boolean {
  const content = footnote[2]
  if (cursor.owner.kind !== 'root' || !content || !RE_HEADING.test(content) ||
      !footnoteDefs || !footnoteDefPos ||
      cursor.peek(1) && !isBlankLine(cursor.peek(1)!.text)) return false
  cursor.take()
  const label = footnote[1]!
  if (Object.hasOwn(footnoteDefs, label)) return true
  const column = first.text.length - content.length + 1
  const body: SourceLine = { text: content, start: first.start + column - 1,
    number: first.number, baseColumn: (first.baseColumn ?? 1) + column - 1 }
  const blocks = parseBlocks(new Cursor([body], undefined,
    childOwner(cursor.owner, 'colon'), cursor.physicalLines), inline, [], 1, false)
  Object.defineProperty(footnoteDefs, label, { value: blocks,
    enumerable: true, configurable: true, writable: true })
  Object.defineProperty(footnoteDefPos, label, { value: position(first, first),
    enumerable: true, configurable: true, writable: true })
  return true
}

function takeFootnoteOpaqueTail(cursor: Cursor, inline: CursorInline, first: SourceLine,
  footnote: RegExpExecArray, footnoteDefs: Record<string, BlockNode[]> | undefined,
  footnoteDefPos: Record<string, Position> | undefined): boolean {
  const content = footnote[2]
  if (cursor.owner.kind !== 'root' || !content || !LINE_COMMENT.test(content) ||
      RE_COMMENT_BLOCK_ANY.test(content) || !footnoteDefs || !footnoteDefPos ||
      !isBlankLine(cursor.peek(1)?.text ?? '')) return false
  let opener = 1
  while (cursor.peek(opener) && isBlankLine(cursor.peek(opener)!.text)) opener++
  const marker = RE_RAW_FENCE.exec(cursor.peek(opener)?.text.slice(2) ?? '')?.[1]
  if (!marker || !cursor.peek(opener)?.text.startsWith('  ')) return false
  let end = opener + 1
  while (cursor.peek(end)?.text.startsWith('  ') &&
      !closesFence(cursor.peek(end)!.text.slice(2), marker)) end++
  if (!cursor.peek(end)?.text.startsWith('  ')) return false
  let after = end + 1
  while (cursor.peek(after) && isBlankLine(cursor.peek(after)!.text)) after++
  if (cursor.peek(after)?.text.startsWith('  ')) return false
  const column = first.text.length - content.length + 1
  const body: SourceLine[] = [{ text: content, start: first.start + column - 1,
    number: first.number, baseColumn: (first.baseColumn ?? 1) + column - 1 }]
  for (let offset = 1; offset <= end; offset++) {
    const line = cursor.peek(offset)!
    body.push(offset < opener ? line : { text: line.text.slice(2), start: line.start + 2,
      number: line.number, baseColumn: (line.baseColumn ?? 1) + 2 })
  }
  for (let offset = 0; offset <= end; offset++) cursor.take()
  const label = footnote[1]!
  if (Object.hasOwn(footnoteDefs, label)) return true
  const blocks = parseBlocks(new Cursor(body, undefined,
    childOwner(cursor.owner, 'colon'), cursor.physicalLines), inline, [], 1, false)
  Object.defineProperty(footnoteDefs, label, { value: blocks,
    enumerable: true, configurable: true, writable: true })
  Object.defineProperty(footnoteDefPos, label, { value: position(first, cursor.lines[cursor.at - 1]!),
    enumerable: true, configurable: true, writable: true })
  return true
}

function takeFootnoteAuthoredFirstBlock(cursor: Cursor, inline: CursorInline, first: SourceLine,
  footnote: RegExpExecArray, footnoteDefs: Record<string, BlockNode[]> | undefined,
  footnoteDefPos: Record<string, Position> | undefined): boolean {
  const content = footnote[2]
  if (cursor.owner.kind !== 'root' || !content || !plainQuoteText(content) ||
      !footnoteDefs || !footnoteDefPos || !isBlankLine(cursor.peek(1)?.text ?? '')) return false
  let start = 1
  while (cursor.peek(start) && isBlankLine(cursor.peek(start)!.text)) start++
  const opener = cursor.peek(start)
  if (!opener) return false
  const base = (opener.baseColumn ?? 1) - 1 + opener.text.length - opener.text.trimStart().length
  const text = opener.text.trimStart()
  if (base < 3 || !(isBlockImageLine(text) || /^:{3,} >$/.test(text))) return false
  let end = start
  while (cursor.peek(end) && !isBlankLine(cursor.peek(end)!.text) &&
      (cursor.peek(end)!.baseColumn ?? 1) - 1 +
        cursor.peek(end)!.text.length - cursor.peek(end)!.text.trimStart().length >= base) end++
  if (end === start || /^:{3,} >$/.test(text) &&
      !/^:{3,}[ \t]*$/.test(cursor.peek(end - 1)!.text.trimStart())) return false
  let after = end
  while (cursor.peek(after) && isBlankLine(cursor.peek(after)!.text)) after++
  if (cursor.peek(after) && (cursor.peek(after)!.baseColumn ?? 1) - 1 +
      cursor.peek(after)!.text.length - cursor.peek(after)!.text.trimStart().length >= base) return false
  const body: SourceLine[] = []
  for (let offset = start; offset < end; offset++) {
    const line = cursor.peek(offset)!
    const prefix = Math.max(0, base - (line.baseColumn ?? 1) + 1)
    body.push({ text: line.text.slice(prefix), start: line.start + prefix,
      number: line.number, baseColumn: (line.baseColumn ?? 1) + prefix })
  }
  for (let offset = 0; offset < end; offset++) cursor.take()
  const label = footnote[1]!
  if (Object.hasOwn(footnoteDefs, label)) return true
  const column = first.text.length - content.length + 1
  const paragraph: Paragraph = { type: 'paragraph',
    children: inline.inlines([{ line: first, column, text: content }]),
    pos: position(first, first, column) }
  let blocks = parseBlocks(new Cursor(body, undefined,
    childOwner(cursor.owner, 'colon'), cursor.physicalLines), inline, [], 1, false)
  const caption = body.length === 2 && blocks[0]?.type === 'image' ?
    RE_CAPTION.exec(body[1]!.text) : null
  if (caption && blocks[0]?.type === 'image') {
    const line = body[1]!
    const column = line.text.length - caption[1]!.length + 1
    blocks = [{ type: 'figure', target: blocks[0],
      caption: inline.inlines([{ line, column, text: caption[1]! }], true),
      pos: position(body[0]!, line) }]
  }
  Object.defineProperty(footnoteDefs, label, { value: [paragraph, ...blocks],
    enumerable: true, configurable: true, writable: true })
  Object.defineProperty(footnoteDefPos, label, { value: position(first, cursor.lines[cursor.at - 1]!),
    enumerable: true, configurable: true, writable: true })
  return true
}

function takeFootnoteAuthoredNestedRun(cursor: Cursor, inline: CursorInline, first: SourceLine,
  footnote: RegExpExecArray, footnoteDefs: Record<string, BlockNode[]> | undefined,
  footnoteDefPos: Record<string, Position> | undefined): boolean {
  const content = footnote[2]
  if (cursor.owner.kind !== 'root' || !content || !plainQuoteText(content) ||
      !footnoteDefs || !footnoteDefPos || !isBlankLine(cursor.peek(1)?.text ?? '')) return false
  let start = 1
  while (cursor.peek(start) && isBlankLine(cursor.peek(start)!.text)) start++
  const opener = cursor.peek(start)
  const nestedNote = opener && FOOTNOTE_DEF.test(opener.text.trimStart())
  const definition = opener && /^:: +[^ ]/.test(opener.text.trimStart())
  if (!nestedNote && !definition) return false
  const base = (opener.baseColumn ?? 1) - 1 + opener.text.length - opener.text.trimStart().length
  if (base < (definition ? 2 : 3)) return false
  let end = start
  let last = start
  let rootLinkHandoff: SourceLine | undefined
  while (cursor.peek(end)) {
    const line = cursor.peek(end)!
    if (isBlankLine(line.text)) { end++; continue }
    if (definition && end > start && rootLinkDef(line.text.trimStart())) {
      rootLinkHandoff = line
      break
    }
    const column = (line.baseColumn ?? 1) - 1 + line.text.length - line.text.trimStart().length
    if (column < base) break
    last = end++
  }
  if (last === start || nestedNote && !plainQuoteText(cursor.peek(last)!.text.trimStart())) return false
  if (rootLinkHandoff) rootLinkHandoff.descriptionRootLink = true
  const body: SourceLine[] = []
  for (let offset = start; offset <= last; offset++) {
    const line = cursor.peek(offset)!
    const prefix = isBlankLine(line.text) ? line.text.length :
      Math.max(0, base - (line.baseColumn ?? 1) + 1)
    body.push({ text: line.text.slice(prefix), start: line.start + prefix,
      number: line.number, baseColumn: (line.baseColumn ?? 1) + prefix })
  }
  const column = first.text.length - content.length + 1
  const paragraph: Paragraph = { type: 'paragraph',
    children: inline.inlines([{ line: first, column, text: content }]),
    pos: position(first, first, column) }
  const label = footnote[1]!
  if (Object.hasOwn(footnoteDefs, label)) {
    for (let offset = 0; offset <= last; offset++) cursor.take()
    return true
  }
  const shallowQuote = definition ? body.findIndex((line, index) => index > 1 &&
    /^ {1,2}>/.test(line.text)) : -1
  const owner = childOwner(cursor.owner, 'colon')
  const blocks = parseBlocks(new Cursor(shallowQuote < 0 ? body : body.slice(0, shallowQuote),
    undefined, owner, cursor.physicalLines), inline, [], 1, Boolean(definition),
  footnoteDefs, footnoteDefPos)
  if (shallowQuote >= 0) {
    const follower = body.slice(shallowQuote).map((line) => {
      const prefix = /^[ 	]*/.exec(line.text)![0].length
      return { ...line, text: line.text.slice(prefix), start: line.start + prefix,
        baseColumn: (line.baseColumn ?? 1) + prefix }
    })
    blocks.push(...parseBlocks(new Cursor(follower, undefined, owner, cursor.physicalLines),
      inline, [], 1, true, footnoteDefs, footnoteDefPos))
  }
  for (let offset = 0; offset <= last; offset++) cursor.take()
  Object.defineProperty(footnoteDefs, label, { value: [paragraph, ...blocks],
    enumerable: true, configurable: true, writable: true })
  Object.defineProperty(footnoteDefPos, label, { value: position(first, cursor.lines[cursor.at - 1]!),
    enumerable: true, configurable: true, writable: true })
  return true
}

function takeFootnoteFirstSpecial(cursor: Cursor, inline: CursorInline, first: SourceLine,
  footnote: RegExpExecArray, footnoteDefs: Record<string, BlockNode[]> | undefined,
  footnoteDefPos: Record<string, Position> | undefined): boolean {
  return takeFootnoteFirstFence(cursor, inline, first, footnote, footnoteDefs, footnoteDefPos) ||
    takeFootnoteOpaqueHead(cursor, inline, first, footnote, footnoteDefs, footnoteDefPos) ||
    takeFootnoteHeadingHead(cursor, inline, first, footnote, footnoteDefs, footnoteDefPos) ||
    takeFootnoteOpaqueTail(cursor, inline, first, footnote, footnoteDefs, footnoteDefPos) ||
    takeFootnoteAuthoredFirstBlock(cursor, inline, first, footnote, footnoteDefs, footnoteDefPos) ||
    takeFootnoteAuthoredNestedRun(cursor, inline, first, footnote, footnoteDefs, footnoteDefPos)
}

function takeFootnoteFirstPlain(cursor: Cursor, inline: CursorInline, first: SourceLine,
  footnote: RegExpExecArray, footnoteDefs: Record<string, BlockNode[]> | undefined,
  footnoteDefPos: Record<string, Position> | undefined): boolean {
  const follower = cursor.peek(1)
  if (footnote[2] !== '+' || cursor.owner.kind !== 'root' || !footnoteDefs || !footnoteDefPos ||
      !follower || !(plainQuoteText(follower.text) ||
        /^~[^~]+~$/.test(follower.text) && /^ [^ ]/.test(cursor.peek(2)?.text ?? ''))) return false
  const body: SourceLine[] = []
  for (let offset = 1; cursor.peek(offset) && !isBlankLine(cursor.peek(offset)!.text); offset++) {
    const line = cursor.peek(offset)!
    if (!(plainQuoteText(line.text.trimStart()) ||
        offset === 1 && /^~[^~]+~$/.test(line.text)) ||
        line.text.length - line.text.trimStart().length > 1) return false
    body.push(line)
  }
  if (body.length === 0) return false
  let after = body.length + 1
  while (cursor.peek(after) && isBlankLine(cursor.peek(after)!.text)) after++
  if (after > body.length + 1 && cursor.peek(after)?.text.startsWith('  ')) {
    throw new UnsupportedCursorSyntax('footnote plain run continues after blank')
  }
  cursor.take()
  for (const _line of body) cursor.take()
  const label = footnote[1]!
  if (Object.hasOwn(footnoteDefs, label)) return true
  const paragraph: Paragraph = { type: 'paragraph',
    children: inline.inlines(body.map((line) => ({ line,
      column: line.text.length - line.text.trimStart().length + 1,
      text: line.text.trimStart() }))),
    pos: position(follower, body.at(-1)!) }
  Object.defineProperty(footnoteDefs, label, { value: [paragraph],
    enumerable: true, configurable: true, writable: true })
  Object.defineProperty(footnoteDefPos, label, { value: position(first, body.at(-1)!),
    enumerable: true, configurable: true, writable: true })
  return true
}

function takeFootnoteAttachedBlock(cursor: Cursor, inline: CursorInline, first: SourceLine,
  footnote: RegExpExecArray, footnoteDefs: Record<string, BlockNode[]> | undefined,
  footnoteDefPos: Record<string, Position> | undefined): boolean {
  const content = footnote[2]
  if (!content || !plainQuoteText(content) || cursor.owner.kind !== 'root' ||
      !footnoteDefs || !footnoteDefPos || cursor.peek(1)?.text !== '+') return false
  const end = closedFenceEnd(cursor, 2) ??
    (/^\S/.test(cursor.peek(2)?.text ?? '') && (listMarker(cursor.peek(2)!.text) ||
      RE_BLOCKQUOTE.test(cursor.peek(2)!.text)) ? 2 : undefined)
  if (end === undefined || cursor.peek(end + 1) && !isBlankLine(cursor.peek(end + 1)!.text)) {
    return false
  }
  cursor.take()
  cursor.take()
  const body: SourceLine[] = []
  for (let offset = 2; offset <= end; offset++) body.push(cursor.take())
  const label = footnote[1]!
  if (Object.hasOwn(footnoteDefs, label)) return true
  const column = first.text.length - content.length + 1
  const paragraph: Paragraph = { type: 'paragraph',
    children: inline.inlines([{ line: first, column, text: content }]),
    pos: position(first, first, column) }
  const blocks = parseBlocks(new Cursor(body, undefined,
    childOwner(cursor.owner, 'colon'), cursor.physicalLines), inline, [], 1, false)
  Object.defineProperty(footnoteDefs, label, { value: [paragraph, ...blocks],
    enumerable: true, configurable: true, writable: true })
  Object.defineProperty(footnoteDefPos, label, { value: position(first, body.at(-1)!),
    enumerable: true, configurable: true, writable: true })
  return true
}

/** A flush-left comment and its indented plain follower end the note; both are document blocks. */
function commentEndsFootnote(cursor: Cursor): boolean {
  const comment = cursor.peek()
  const follower = cursor.peek(1)
  return comment !== undefined && LINE_COMMENT.test(comment.text) && follower !== undefined &&
    footnotePlainColumn(follower) > 1 && plainQuoteText(follower.text.trimStart()) &&
    cursor.peek(2) !== undefined && isBlankLine(cursor.peek(2)!.text)
}

function takeBoundedFootnoteBlocks(cursor: Cursor, inline: CursorInline, first: SourceLine,
  footnote: RegExpExecArray, footnoteDefs: Record<string, BlockNode[]> | undefined,
  footnoteDefPos: Record<string, Position> | undefined): boolean {
  const content = footnote[2]
  const firstList = content ? listMarker(content) !== undefined : false
  if (!content || !plainQuoteText(content) && !firstList || cursor.owner.kind !== 'root' ||
      !footnoteDefs || !footnoteDefPos) return false
  const source: SourceLine[] = []
  let structural = false
  let offset = 1
  let nonblank = 0
  while (cursor.peek(offset)) {
    const line = cursor.peek(offset)!
    if (isBlankLine(line.text)) {
      let next = offset
      while (cursor.peek(next) && isBlankLine(cursor.peek(next)!.text)) next++
      if (!cursor.peek(next)?.text.startsWith('  ')) break
      while (offset < next) source.push(cursor.peek(offset++)!)
      continue
    }
    if (!line.text.startsWith('  ')) break
    const text = line.text.slice(2)
    if (text.startsWith(' ') && !listMarker(text) || text.startsWith('[') ||
        text.startsWith(':') && !COLON_OPEN.test(text)) return false
    structural ||= RE_BLOCKQUOTE.test(text) || RE_HEADING.test(text) ||
      listMarker(text) !== undefined || fenceOpen(text) !== null || COLON_OPEN.test(text)
    source.push(line)
    nonblank++
    offset++
  }
  const detachedList = firstList && nonblank === 1 && structural &&
    source.filter((line) => isBlankLine(line.text)).length >= 2 &&
    listMarker(source.find((line) => !isBlankLine(line.text))?.text.slice(2) ?? '') !== undefined
  if (nonblank < 2 && !detachedList ||
      !structural && !source.some((line) => isBlankLine(line.text))) return false
  const firstBody = source.find((line) => !isBlankLine(line.text))?.text.slice(2) ?? ''
  if (RE_BLOCKQUOTE.test(firstBody) &&
      listMarker(source[1]?.text.slice(2) ?? '') !== undefined) return false
  const next = cursor.peek(offset)
  if (next && !isBlankLine(next.text)) return false
  let after = offset
  while (cursor.peek(after) && isBlankLine(cursor.peek(after)!.text)) after++
  if (cursor.peek(after)?.text.startsWith('  ')) return false
  cursor.take()
  for (const _line of source) cursor.take()
  const label = footnote[1]!
  if (Object.hasOwn(footnoteDefs, label)) return true
  const column = first.text.length - content.length + 1
  const body: SourceLine[] = [{ text: content, start: first.start + column - 1,
    number: first.number, baseColumn: (first.baseColumn ?? 1) + column - 1 },
  ...source.map((line) => isBlankLine(line.text) && line.text.length < 2 ? { ...line, text: '' } :
    ({ text: line.text.slice(2), start: line.start + 2,
      number: line.number, baseColumn: (line.baseColumn ?? 1) + 2 }))]
  const blocks = parseBlocks(new Cursor(body, undefined,
    childOwner(cursor.owner, 'colon'), cursor.physicalLines), inline, [], 1, false)
  Object.defineProperty(footnoteDefs, label, { value: blocks,
    enumerable: true, configurable: true, writable: true })
  Object.defineProperty(footnoteDefPos, label, { value: position(first, source.at(-1)!),
    enumerable: true, configurable: true, writable: true })
  return true
}

function simpleFootnoteLazyFirstLine(cursor: Cursor, footnote: RegExpExecArray,
  next: string | undefined, nextIndex: number): boolean {
  if (nextIndex !== 1 || next === undefined || cursor.owner.kind !== 'root' ||
      footnote[2] === undefined || FOOTNOTE_DEF.test(next.trimStart())) return false
  if (rootNoteLazyText(cursor.peek(nextIndex))) return true
  const indented = /^ {1,2}[^ ]/.test(next)
  if (cursor.owner === ROOT_OWNER && cursor.rootSource !== undefined && plainQuoteText(footnote[2]) && next === next.trimStart() &&
      footnoteLazyOwnedLine(next)) return true
  if (!plainQuoteText(footnote[2]) && !(footnote[2] === '+' && indented)) return false
  return next === next.trimStart() && (plainQuoteText(next) || next === '+' &&
    (/^ {1,2}[^ ]/.test(cursor.peek(2)?.text ?? '') ||
      !cursor.peek(2) || isBlankLine(cursor.peek(2)!.text))) ||
    /^ - +\S/.test(next) || /^ \[[^\]]+\]: +\S/.test(next) ||
    footnote[2] === '+' && indented
}

function footnoteLazyOwnedNext(cursor: Cursor, next: string | undefined): boolean {
  return cursor.owner === ROOT_OWNER && cursor.rootSource !== undefined && next !== undefined &&
    footnoteLazyOwnedLine(next) && next === next.trimStart()
}

function footnoteCommentFollows(text: string | undefined, next: string | undefined): boolean {
  return text !== undefined && text !== '' && plainQuoteText(text) && next !== undefined && /^%%/.test(next)
}

// A lazy list or definition line ends the footnote paragraph only if nothing indented follows it.
function rejectOpenLazyOwnedBody(cursor: Cursor, nextIndex: number, bodyLength: number): void {
  let owned = false
  for (let i = 0; i < bodyLength; i++) owned ||= footnoteLazyOwnedLine(cursor.peek(nextIndex + i)!.text)
  if (!owned) return
  let after = nextIndex + bodyLength
  while (cursor.peek(after)?.text !== undefined && isBlankLine(cursor.peek(after)!.text)) after++
  const text = cursor.peek(after)?.text
  if (text !== undefined && /^[ \t]/.test(text)) {
    throw new UnsupportedCursorSyntax('footnote body continues after lazy list or definition line')
  }
}

/** An ownership cut moved this line left; its paragraph text still continues the footnote above. */
function ownedFootnoteParagraphLine(cursor: Cursor, nextIndex: number): boolean {
  const line = cursor.peek(nextIndex)
  return nextIndex === 1 && line?.lead !== undefined && simpleFootnoteParagraphLine(line, true)
}

/** The reference keeps an unclosed fence or a definition line as lazy text under an owned footnote; the cursor cannot. */
function rejectOwnedFootnoteOpener(cursor: Cursor, first: SourceLine, nextIndex: number,
  next: string | undefined): void {
  if (nextIndex !== 1 || first.lead === undefined || cursor.peek(1)?.lead === undefined) return
  const text = next!.trimStart()
  const fence = fenceOpen(text)
  const unclosed = fence !== null &&
    !cursor.lines.slice(cursor.at + 2).some((line) => closesFence(line.text.trimStart(), fence.marker))
  if (unclosed || /^: +\S/.test(text)) {
    throw new UnsupportedCursorSyntax('owned footnote continuation opens a fence or definition')
  }
}

/** Lines of a footnote paragraph the walk extends lazily past its note head in a root-level colon container. */
function colonNoteLazyRun(cursor: Cursor, nextIndex: number): number {
  if (nextIndex !== 1 || !(cursor.owner.kind === 'colon' && cursor.peek(1)?.noteLazy === true ||
      cursor.owner.kind === 'quote' && cursor.peek(1)?.claimedQuoteLazy)) return 0
  let length = 0
  while (cursor.peek(1 + length)?.noteLazy) {
    const text = cursor.peek(1 + length)!.text
    if (!plainQuoteText(text) && !footnoteLazyOwnedLine(text)) {
      throw new UnsupportedCursorSyntax('colon footnote lazy line is not plain text')
    }
    length++
  }
  return length
}

function footnoteBodyLength(cursor: Cursor, nextIndex: number, plain: boolean, separated: boolean,
  lazyFirstLine: boolean, lazyOwned: boolean): number {
  const lazy = colonNoteLazyRun(cursor, nextIndex)
  if (lazy > 0 || !plain) return lazy
  let length = 0
  while (simpleFootnoteBodyLine(cursor, nextIndex + length, length, separated, lazyFirstLine, lazyOwned)) length++
  return length
}

function colonFootnoteLazyFencePlus(cursor: Cursor, nextIndex: number, bodyLength: number): boolean {
  return cursor.owner.kind === 'colon' && bodyLength > 0 &&
    fenceOpen(cursor.peek(nextIndex + bodyLength - 1)?.text ?? '') !== null &&
    cursor.peek(nextIndex + bodyLength)?.text === '+' &&
    rootLinkDef(cursor.peek(nextIndex + bodyLength + 1)?.text ?? '') !== null
}

function colonFootnoteFinalPlus(cursor: Cursor, first: SourceLine,
  footnote: RegExpExecArray, nextIndex: number): boolean {
  const line = cursor.peek(nextIndex)
  return cursor.owner.kind === 'colon' && cursor.owner.parent?.kind === 'root' &&
    nextIndex === 1 && line?.text === '+' && line.plusAfterPara === true &&
    line.baseColumn === first.baseColumn && line.number === first.number + 1 &&
    !cursor.peek(2) && plainQuoteText(footnote[2] ?? '')
}

function takeSimpleFootnote(cursor: Cursor, inline: CursorInline, first: SourceLine,
  footnote: RegExpExecArray, footnoteDefs: Record<string, BlockNode[]> | undefined,
  footnoteDefPos: Record<string, Position> | undefined): void {
  if (takeFootnoteFirstSpecial(cursor, inline, first, footnote, footnoteDefs, footnoteDefPos)) return
  if (takeFootnoteFirstPlain(cursor, inline, first, footnote, footnoteDefs, footnoteDefPos)) return
  if (takeFootnoteAttachedBlock(cursor, inline, first, footnote, footnoteDefs, footnoteDefPos)) return
  if (takeBoundedFootnoteBlocks(cursor, inline, first, footnote, footnoteDefs, footnoteDefPos)) return
  let nextIndex = 1
  while (cursor.peek(nextIndex)?.text === '') nextIndex++
  const next = cursor.peek(nextIndex)?.text
  const lazyFirstLine = simpleFootnoteLazyFirstLine(cursor, footnote, next, nextIndex)
  const lazyOwned = lazyFirstLine && footnoteLazyOwnedNext(cursor, next)
  const finalPlus = colonFootnoteFinalPlus(cursor, first, footnote, nextIndex)
  const bodyDefinition = cursor.peek(nextIndex) &&
    footnoteBodyLinkDef(cursor.peek(nextIndex)!, first, cursor.peek(nextIndex + 1))
  if (bodyDefinition && cursor.peek(nextIndex + 2)?.text.startsWith('  ')) {
    throw new UnsupportedCursorSyntax('footnote definition after body link')
  }
  const hasBodyLine = next !== undefined &&
    !bodyDefinition &&
    (sourceColumnAt(next, /^[ \t]*/.exec(next)![0].length) >= 2 || lazyFirstLine || colonNoteLazyRun(cursor, nextIndex) > 0 ||
      ownedFootnoteParagraphLine(cursor, nextIndex) || finalPlus)
  rejectOwnedFootnoteOpener(cursor, first, nextIndex, next)
  const separated = hasBodyLine && nextIndex > 1
  const structural = hasBodyLine ? simpleFootnoteStructuralLines(cursor, nextIndex) : undefined
  let bodyLength = footnoteBodyLength(cursor, nextIndex, hasBodyLine && !structural, separated, lazyFirstLine,
    lazyOwned)
  if (finalPlus) bodyLength = 1
  const lazyFencePlus = colonFootnoteLazyFencePlus(cursor, nextIndex, bodyLength)
  if (lazyFencePlus) bodyLength++
  const lateList = footnoteLateListForBody(cursor, footnote, structural, nextIndex, bodyLength)
  if (lazyOwned) rejectOpenLazyOwnedBody(cursor, nextIndex, bodyLength)
  const initialQuote = footnote[2] !== undefined && RE_BLOCKQUOTE.test(footnote[2])
  if (!footnote[2] || initialQuote && hasBodyLine && !separated ||
      (footnote[2] !== '{empty}' && isBlockStart(footnote[2]) && !initialQuote) ||
      (hasBodyLine && (footnote[2] === '{empty}' ||
      (bodyLength === 0 && !structural) ||
      (!structural && footnoteBodyContinuesPast(cursor, nextIndex + bodyLength) && !lazyFencePlus)))) {
    throw new UnsupportedCursorSyntax('nested or multiline footnote definition')
  }
  markLazyNoteFence(cursor, hasBodyLine, nextIndex, bodyLength)
  cursor.take()
  if (separated) for (let i = 1; i < nextIndex; i++) cursor.take()
  const continuation: SourceLine[] = []
  for (let i = 0; i < bodyLength; i++) continuation.push(cursor.take())
  if (structural) for (let i = 0; i < structural.source.length; i++) cursor.take()
  consumeFootnoteLateList(cursor, lateList)
  const plusFollower = cursor.peek()?.text === '+' ? cursor.peek(1) : undefined
  if (footnote[2] === '{empty}' && plusFollower) {
    throw new UnsupportedCursorSyntax('empty footnote continuation')
  }
  const doublePlus = plusFollower?.text === '+' &&
    (!cursor.peek(2) || isBlankLine(cursor.peek(2)!.text)) ? plusFollower : undefined
  const attached = plusFollower && plainQuoteText(plusFollower.text) &&
    (!cursor.peek(2) || isBlankLine(cursor.peek(2)!.text) ||
      isBlockStart(cursor.peek(2)!.text)) ? plusFollower : undefined
  if (attached || doublePlus) { cursor.take(); cursor.take() }
  else if (plusFollower) throw new UnsupportedCursorSyntax('footnote plus line folded into the paragraph')
  const commentTail = !attached && !doublePlus && !structural && bodyLength === 0 &&
    footnote[2] && plainQuoteText(footnote[2]) && commentEndsFootnote(cursor)
  if (!commentTail && !structural && !attached && !doublePlus && bodyLength === 0 && nextIndex === 1 &&
      footnoteCommentFollows(footnote[2], next)) {
    throw new UnsupportedCursorSyntax('flush-left comment after footnote paragraph')
  }
  const label = footnote[1]!
  if (!footnoteDefs || !footnoteDefPos || Object.hasOwn(footnoteDefs, label)) return
  const bodyIndent = /^[ \t]*/.exec(footnote[2]!)![0].length
  const column = first.text.length - footnote[2]!.length + bodyIndent + 1
  const parts: ContentLine[] = [{ line: first, column, text: footnote[2]!.slice(bodyIndent) }]
  if (!separated) for (const line of continuation) {
    const nextColumn = footnotePlainColumn(line)
    parts.push({ line, column: nextColumn, text: line.text.slice(nextColumn - 1) })
  }
  const bodyLast = lateList?.source.at(-1) ?? structural?.source.at(-1) ?? continuation.at(-1) ?? first
  const paragraphLast = continuation.at(-1) ?? first
  const last = attached ?? doublePlus ?? bodyLast
  const initialBody: BlockNode[] = initialQuote ? parseBlocks(new Cursor([{
    text: footnote[2]!.slice(bodyIndent), start: first.start + column - 1,
    number: first.number, baseColumn: column }], undefined,
  childOwner(cursor.owner, 'colon'), cursor.physicalLines), inline, [], 1, false) : [{
    type: 'paragraph', children: inline.inlines(parts),
    pos: position(first, separated || structural ? first : paragraphLast, column) }]
  const separateBody: Paragraph | undefined = separated && continuation.length ? { type: 'paragraph',
    children: inline.inlines(continuation.map((line) => {
      const nextColumn = footnotePlainColumn(line)
      return { line, column: nextColumn, text: line.text.slice(nextColumn - 1) }
    })),
    pos: position(continuation[0]!, continuation.at(-1)!,
      footnotePlainColumn(continuation[0]!)) } : undefined
  const attachedLine = attached ?? doublePlus
  const attachedBody: Paragraph | undefined = attachedLine ? { type: 'paragraph',
    children: inline.inlines([{ line: attachedLine, column: 1, text: attachedLine.text }]),
    pos: position(attachedLine, attachedLine) } : undefined
  const structuralBody = structural ? parseBlocks(new Cursor(structural.body, undefined,
    childOwner(cursor.owner, 'colon'), cursor.physicalLines), inline, [], 1, false) : []
  appendFootnoteLateList(cursor, inline, structuralBody, lateList)
  Object.defineProperty(footnoteDefs, label, { value: footnote[2] === '{empty}' ? [] :
    attachedBody ? separateBody ? [...initialBody, separateBody, ...structuralBody, attachedBody] :
      [...initialBody, ...structuralBody, attachedBody] :
      separateBody ? [...initialBody, separateBody, ...structuralBody] :
        [...initialBody, ...structuralBody],
    enumerable: true, configurable: true, writable: true })
  Object.defineProperty(footnoteDefPos, label, { value: position(first, last),
    enumerable: true, configurable: true, writable: true })
}

function matchSigilFence(line: string): { kind: 'hardbreak' | 'quote'; width: number } | undefined {
  const hardbreak = RE_HARDBREAKS_OPEN.exec(line)
  if (hardbreak) return { kind: 'hardbreak', width: hardbreak[1]!.length }
  const quote = RE_QUOTE_BLOCK_OPEN.exec(line)
  return quote ? { kind: 'quote', width: quote[1]!.length } : undefined
}

function parseSigilFence(cursor: Cursor, inline: CursorInline, definitionNodes: BlockNode[],
  depth: number, sigil: NonNullable<ReturnType<typeof matchSigilFence>>): BlockNode {
  const first = cursor.take()
  const { lines: body } = takeColonBody(cursor, sigil.width)
  const close = cursor.peek() ? cursor.take() : body.at(-1) ?? first
  const inner = parseBlocks(new Cursor(body, undefined, childOwner(cursor.owner,
    sigil.kind === 'quote' ? 'quote' : 'colon'), cursor.physicalLines),
    inline, definitionNodes, depth + 1, false)
  if (sigil.kind === 'hardbreak') {
    for (const child of inner) {
      if (child.type !== 'paragraph') continue
      child.children = child.children.map((node) => node.type === 'soft_break' ?
        { type: 'hard_break', ...(node.pos ? { pos: node.pos } : {}) } : node)
    }
    return { type: 'div', attrs: { classes: ['hardbreaks'], order: ['.class'] },
      children: inner, pos: position(first, close) }
  }
  const quote: BlockQuote = { type: 'block_quote', fenced: true,
    children: inner, pos: position(first, close) }
  const caption = takeQuoteCaption(cursor, inline, quote)
  return caption ? { type: 'figure', target: quote, caption: caption.children,
    pos: position(first, caption.line) } : quote
}

function takeBlockAttrsAtCursor(cursor: Cursor, atDocumentLevel: boolean): Attrs | null {
  const first = cursor.peek()!
  if (first.text[0] !== '{') return null
  const oneLine = parseBlockAttributeRun(first.text)
  if (oneLine) { cursor.take(); return oneLine }
  if (!atDocumentLevel && !first.wrappedAttr) return null
  const lexer = lexerForCursor(cursor)
  lexer.pos = cursor.at
  const wrapped = probeBlockAttributes(lexer)
  if (!wrapped) return null
  for (let i = 0; i < wrapped.count; i++) cursor.take()
  return wrapped.attrs
}

function simpleClosedListColon(cursor: Cursor, run: string, kind: string | undefined): boolean {
  if (cursor.owner.kind !== 'list') return false
  const body = cursor.peek(1)?.text
  const close = cursor.peek(2)?.text
  if (body !== undefined && plainQuoteText(body) && close === undefined) {
    const following = cursor.physicalLines[cursor.peek(1)!.number]
    if (!following || isBlankLine(following.text)) return true
  }
  const closer = new RegExp(`^:{${run.length}}[ \\t]*$`)
  if (body !== undefined && closer.test(body) &&
      (!cursor.peek(2) || isBlankLine(cursor.peek(2)!.text))) return true
  if (body !== undefined && (plainQuoteText(body) || kind === 'html' && body[0] === '<') &&
      close !== undefined &&
      closer.test(close) && (!cursor.peek(3) || isBlankLine(cursor.peek(3)!.text))) return true
  const raisedNoteBody = kind === 'note' && body !== undefined && /^ [^ ]/.test(body) &&
    plainQuoteText(body.slice(1)) && /^ [^ ]/.test(cursor.peek(3)?.text ?? '') &&
    plainQuoteText(cursor.peek(3)!.text.slice(1))
  if (body !== undefined && (plainQuoteText(body) &&
      plainQuoteText(cursor.peek(3)?.text ?? '') || raisedNoteBody) && isBlankLine(close ?? '') &&
      closer.test(cursor.peek(4)?.text ?? '') &&
      (!cursor.peek(5) || isBlankLine(cursor.peek(5)!.text))) return true
  if (!listMarker(body ?? '')) return false
  if (close === undefined) {
    const follower = cursor.physicalLines[cursor.peek(1)!.number]?.text
    if (follower === undefined || /^:{3,}[ \t]*$/.test(follower)) return true
  }
  for (let offset = 1; cursor.peek(offset); offset++) {
    const text = cursor.peek(offset)!.text
    if (closer.test(text)) return !cursor.peek(offset + 1) ||
      isBlankLine(cursor.peek(offset + 1)!.text)
    if (!listMarker(text)) return false
  }
  return false
}

/** An indented definition line the walk cut onto a quote paragraph's quote nested in lists and quotes. */
function cutQuoteDefinition(cursor: Cursor, line: SourceLine): boolean {
  for (let owner = cursor.owner.parent; owner; owner = owner.parent) {
    if (owner.kind !== 'list' && owner.kind !== 'quote' && owner.kind !== 'root') return false
  }
  return cursor.physicalLines[line.number - 1]?.cutAfterMarker === true
}

function closedColonDefinitionAtCursor(cursor: Cursor, line: SourceLine): boolean {
  if (cursor.owner.kind !== 'colon' || cursor.owner.inList ||
      cursor.owner.colonCloser === undefined ||
      cursor.owner.parent?.kind !== 'root' && cursor.owner.parent?.kind !== 'quote') return false
  const next = cursor.physicalLines[line.number]?.text
  return next !== undefined &&
    closesColonOwner(next.replace(/^> ?/, '').trimStart(), cursor.owner.colonCloser)
}

/** A definition line the walk cut onto a container paragraph: the reference registers it like any other. */
function registerCutDefinition(line: SourceLine, linkDefinitions: Map<string, LinkDef>): void {
  if (!line.cutAfterMarker) return
  const match = rootLinkDef(line.text.replace(/^(?: *(?:>|[-*]|[0-9]+[.)]) ?)+/, ''))
  if (!match) return
  linkDefinitions.set(normalizeRefLabel(match.label),
    { rawLabel: match.label, line: line.number - 1, href: match.href,
      ...(match.title !== undefined ? { title: unescapeAttrValue(match.title) } : {}),
      ...(match.attrText !== null ? { attrs: parseAttrs(match.attrText) } : {}) })
}

function takeLinkDefinitionAtCursor(cursor: Cursor, inline: CursorInline,
  definitionNodes: BlockNode[], atDocumentLevel: boolean,
  definition: NonNullable<ReturnType<typeof rootLinkDef>>): void {
  const first = cursor.peek()!
  const standaloneListQuote = cursor.owner.kind === 'quote' &&
    cursor.owner.parent?.kind === 'list' && cursor.at === 0 && !cursor.peek(1)
  const standaloneNestedQuote = cursor.owner.kind === 'quote' &&
    cursor.owner.parent?.kind === 'quote' && cursor.at === 0 && !cursor.peek(1) &&
    /^> ?> +\[(?!\^)/.test(cursor.physicalLines[first.number - 1]?.text ?? '')
  const quotedMarkerLineDefinition = cursor.owner.kind === 'list' &&
    cursor.owner.parent?.kind === 'quote' && cursor.owner.parent.parent?.kind === 'root' &&
    cursor.at === 0 && !cursor.peek(1) &&
    /^> [-*] +\[(?!\^)/.test(cursor.physicalLines[first.number - 1]?.text ?? '')
  const rootMarkerLineDefinition = cursor.owner.kind === 'list' &&
    cursor.owner.parent?.kind === 'root' && cursor.at === 0 && !cursor.peek(1) &&
    /^ *[-*] +\[(?!\^)/.test(cursor.physicalLines[first.number - 1]?.text ?? '')
  const nestedMarkerLineDefinition = cursor.owner.kind === 'list' &&
    cursor.owner.parent?.kind === 'list' && cursor.owner.parent.parent?.kind === 'root' &&
    cursor.at === 0 && (!cursor.peek(1) || cursor.peek(1)?.text === ':') &&
    /^[-*] +[-*] +\[(?!\^)/.test(cursor.physicalLines[first.number - 1]?.text ?? '')
  const standaloneDescription = cursor.owner.kind === 'colon' &&
    cursor.owner.parent?.kind === 'root' &&
    cursor.at === 0 && !cursor.peek(1) &&
    /^: +\[(?!\^)/.test(cursor.physicalLines[first.number - 1]?.text ?? '')
  const rootQuoteAfterParagraph = cursor.owner.kind === 'quote' &&
    cursor.owner.parent?.kind === 'root' && cursor.at === 1 && !cursor.peek(1) &&
    cursor.lines[0]?.number === first.number - 1 &&
    plainQuoteText(cursor.lines[0]!.text) &&
    /^> +\[(?!\^)/.test(cursor.physicalLines[first.number - 1]?.text ?? '') &&
    plainQuoteText(cursor.physicalLines[first.number]?.text ?? '')
  if (!atDocumentLevel && !(cursor.owner.kind === 'quote' &&
      (cursor.owner.parent?.kind === 'root' && cursor.at === 0 ||
        rootQuoteAfterParagraph ||
        standaloneListQuote ||
        standaloneNestedQuote ||
        cutQuoteDefinition(cursor, first))) &&
      !standaloneDescription && !quotedMarkerLineDefinition && !rootMarkerLineDefinition &&
      !nestedMarkerLineDefinition &&
      !(cursor.owner.kind === 'colon' && cursor.noteLazyFenceEnd === first.number) &&
      !closedColonDefinitionAtCursor(cursor, first)) {
    throw new UnsupportedCursorSyntax('nested link definition')
  }
  cursor.take()
  rejectLateLinkDefinition(inline, normalizeRefLabel(definition.label))
  if ((standaloneListQuote || standaloneNestedQuote || standaloneDescription ||
      rootQuoteAfterParagraph || quotedMarkerLineDefinition || rootMarkerLineDefinition ||
      nestedMarkerLineDefinition) &&
      !inline.linkDefinitions.has(normalizeRefLabel(definition.label))) {
    inline.linkDefinitions.set(normalizeRefLabel(definition.label),
      { rawLabel: definition.label, line: first.number - 1, href: definition.href,
        ...(definition.title !== undefined ? { title: unescapeAttrValue(definition.title) } : {}),
        ...(definition.attrText !== null ? { attrs: parseAttrs(definition.attrText) } : {}) })
  }
  const registered = inline.linkDefinitions.get(normalizeRefLabel(definition.label))
  if (registered === undefined && (cursor.unclosedFenceAfterText && cursor.noteLazyFenceEnd !== first.number ||
      definition.label.startsWith('^'))) {
    throw new UnsupportedCursorSyntax('link definition after an unclosed fence that may be paragraph text')
  }
  if (registered?.line !== first.number - 1) return
  const definitionLine = atDocumentLevel && cursor.owner.kind === 'root' ? first :
    cursor.physicalLines[first.number - 1] ?? first
  const target = standaloneDescription ? inline.documentDefinitionNodes ?? definitionNodes : definitionNodes
  target.push({ type: 'link_reference_definition', label: definition.label, href: definition.href,
    ...(definition.title !== undefined ? { title: unescapeAttrValue(definition.title) } : {}),
    ...(definition.attrText !== null ? { attrs: parseAttrs(definition.attrText) } : {}),
    pos: position(definitionLine, definitionLine) })
}

function descriptionRootLinkDefinition(first: SourceLine,
  inline: CursorInline): ReturnType<typeof rootLinkDef> {
  if (!first.descriptionRootLink) return null
  const definition = rootLinkDef(first.text.trimStart())
  if (!definition) return null
  const key = normalizeRefLabel(definition.label)
  if (!inline.linkDefinitions.has(key)) {
    rejectLateLinkDefinition(inline, key)
    inline.linkDefinitions.set(key, { rawLabel: definition.label, line: first.number - 1,
      href: definition.href,
      ...(definition.title !== undefined ? { title: unescapeAttrValue(definition.title) } : {}),
      ...(definition.attrText !== null ? { attrs: parseAttrs(definition.attrText) } : {}) })
  }
  return definition
}

function boundedListColonBody(cursor: Cursor): boolean {
  if (cursor.owner.kind !== 'list' || !cursor.peek(1)) return false
  let last = cursor.peek()!
  const width = /^(:{3,})/.exec(last.text)?.[1]?.length
  for (let offset = 1; cursor.peek(offset); offset++) {
    const line = cursor.peek(offset)!
    if (line.number !== last.number + 1) return false
    if (width && closesColonOwner(line.text, width) && !cursor.peek(offset + 1)) return true
    const foldedMarker = offset > 1 && line.lazyText === true &&
      listMarker(line.text) !== undefined && plainQuoteText(last.text)
    if (!plainQuoteText(line.text) && !foldedMarker && !foldedColonListText(line, last)) return false
    last = line
  }
  const follower = cursor.physicalLines[last.number]?.text
  if (last.number > cursor.peek()!.number + 1 && follower?.startsWith('+')) return false
  return follower === undefined || follower !== '' &&
    follower[0] !== ' ' && follower[0] !== '\t'
}

function boundedFootnoteColonBody(cursor: Cursor, kind: string | undefined,
  marker: string): boolean {
  return cursor.owner.kind === 'colon' && cursor.owner.parent?.kind === 'root' &&
    kind === 'note' && plainQuoteText(cursor.peek(1)?.text ?? '') &&
    cursor.peek(2)?.text === marker && cursor.peek(3) === undefined
}

/** The physical line as the owner sees it: one quote marker is dropped per enclosing quote. */
function unquotedPhysicalText(cursor: Cursor, text: string | undefined): string | undefined {
  if (text === undefined) return undefined
  let rest = text
  for (let owner: ContainerOwner | undefined = cursor.owner; owner; owner = owner.parent) {
    if (owner.kind === 'quote') rest = rest.replace(/^ {0,3}> ?/, '')
  }
  return rest
}

function boundedDefinitionColonFence(cursor: Cursor, closer: string): boolean {
  const marker = fenceOpen(cursor.peek(1)?.text ?? '')?.marker
  if (!marker) return false
  let at = 2
  while (cursor.peek(at) && !closesFence(cursor.peek(at)!.text, marker)) at++
  return cursor.peek(at) !== undefined && cursor.peek(at + 1)?.text === closer &&
    cursor.peek(at + 2) === undefined
}

function boundedDefinitionContainerAt(cursor: Cursor, kind: string | undefined,
  closer: string): boolean {
  if (cursor.owner.kind !== 'definition' || kind !== 'note') return false
  return plainQuoteText(cursor.peek(1)?.text ?? '') &&
    cursor.peek(2)?.text === closer && cursor.peek(3) === undefined ||
    boundedDefinitionColonFence(cursor, closer)
}

function parseColonAtCursor(cursor: Cursor, inline: CursorInline,
  definitionNodes: BlockNode[], depth: number, atDocumentLevel: boolean,
  footnoteDefs: Record<string, BlockNode[]> | undefined,
  footnoteDefPos: Record<string, Position> | undefined,
  colonDepth: number): BlockNode | undefined {
  const first = cursor.peek()!
  if (first.text[0] !== ':') return undefined
  const simple = COLON_OPEN.exec(first.text)
  const div = simple ? null : RE_DIV_OPEN.exec(first.text)
  const valid = simple || div ? null : RE_VALID_ADMONITION_OPEN.exec(first.text)
  const opener = simple ?? div ?? valid ?? RE_ADMONITION_OPEN.exec(first.text)
  if (!opener) return undefined
  const kind = div ? undefined : opener[2]
  const titleRaw = div ? undefined : opener[3]
  const labelRaw = div ? div[2] : opener[4]
  const figureGroup = isFigureGroupOpener(first.text, !!cursor.owner.inFigureGroup)
  const emptyBareDefinition = cursor.owner.kind === 'definition' &&
    kind === undefined && cursor.peek(1) === undefined
  const physicalFollower = unquotedPhysicalText(cursor, cursor.physicalLines[first.number]?.text)
  const belowListColumnParagraph = physicalFollower !== undefined &&
    first.baseColumn !== undefined && /^ +\S/.test(physicalFollower) &&
    /^ */.exec(physicalFollower)![0].length < first.baseColumn - 1 &&
    plainQuoteText(physicalFollower.trimStart())
  const emptyListContainer = cursor.owner.kind === 'list' && cursor.peek(1) === undefined &&
    (physicalFollower === undefined || physicalFollower === '' ||
      physicalFollower[0] !== ' ' && physicalFollower[0] !== '\t' ||
      belowListColumnParagraph)
  const boundedListContainer = boundedListColonBody(cursor)
  const boundedDefinitionContainer = boundedDefinitionContainerAt(cursor, kind, opener[1]!)
  const boundedFootnoteContainer = boundedFootnoteColonBody(cursor, kind, opener[1]!)
  if ((!atDocumentLevel && colonDepth === 0 && cursor.owner.kind !== 'quote' &&
      !simpleClosedListColon(cursor, opener[1]!, kind) && !emptyBareDefinition &&
      !emptyListContainer && !boundedListContainer && !boundedDefinitionContainer &&
      !boundedFootnoteContainer) ||
      unsupportedReferencesColon(opener)) {
    throw new UnsupportedCursorSyntax('nested or specialized colon container')
  }
  if (!simple && !div && !valid && inline.recordInvalidMetadata) {
    inline.diagnostics!.push({ kind: 'invalid', event: {
      kind: kind && GENERATED_CONTENT_KINDS.has(kind) ? 'directive' : 'admonition',
      line: first.number, column: first.baseColumn ?? 1,
      startOffset: first.start, endOffset: first.start + first.text.length,
      fenceWidth: opener[1]!.length,
    } })
  }
  cursor.take()
  const { lines: body, unclosedFence, ambiguousUnclosedFence } = takeColonBody(cursor, opener[1]!.length)
  const boundary = boundedColonFence(body, cursor, opener[1]!.length)
  if (kind === undefined && body.some((line) => ABBR_DEF.test(line.text))) {
    throw new UnsupportedCursorSyntax('abbreviation inside bare container')
  }
  const finalBodyLine = body.at(-1) ?? first
  const continuationBoundary = cursor.owner.kind === 'list' &&
    cursor.lines[0]?.number === first.number &&
    cursor.physicalLines[finalBodyLine.number]?.text === '+'
  if (cursor.owner.kind === 'list' && !continuationBoundary &&
      cursor.physicalLines[finalBodyLine.number]?.text === '+' &&
      cursor.lines[0]?.number !== first.number) {
    throw new UnsupportedCursorSyntax('nested list container continuation owner')
  }
  if (!cursor.peek() && !continuationBoundary && inline.recordUnclosedContainers) {
    const rawColonLine = inline.rawLines?.[first.number - 1]
    const rawColonColumn = rawColonLine?.indexOf(opener[1]!, (first.baseColumn ?? 1) - 1) ?? -1
    const quoteOffset = cursor.owner.parent?.kind === 'quote' && rawColonColumn >= 0 ?
      rawColonColumn + 1 - (first.baseColumn ?? 1) : 0
    inline.diagnostics!.push({ kind: 'container', event: {
      kind: kind === undefined ? 'div' : GENERATED_CONTENT_KINDS.has(kind) ? 'directive' : 'admonition',
      line: first.number, column: (first.baseColumn ?? 1) + quoteOffset,
      startOffset: first.start + quoteOffset, endOffset: first.start + quoteOffset + opener[1]!.length,
      fenceWidth: opener[1]!.length,
    } })
  }
  const close = cursor.peek() ? cursor.take() : body.at(-1) ?? first
  const owner: ContainerOwner = { ...childOwner(cursor.owner, 'colon', false,
    colonMayEndInCodeFence(body, boundary, !cursor.peek(), unclosedFence, ambiguousUnclosedFence),
    boundary), colonCloser: opener[1]!.length }
  const children = parseBlocks(new Cursor(body, undefined,
    figureGroupOwner(owner, figureGroup), cursor.physicalLines),
  inline, definitionNodes, depth + 1, false,
  footnoteDefs, footnoteDefPos, undefined, colonDepth + 1)
  if (figureGroup) {
    const caption = takeCaption(cursor, inline)
    return { type: 'figure_group', children,
      ...(caption ? { caption: caption.children } : {}),
      pos: position(first, caption?.line ?? close) }
  }
  const pos = position(first, close)
  if (titleRaw && kind === undefined) throw new UnsupportedCursorSyntax('bare div title')
  const titleText = simple ? titleRaw : titleRaw?.slice(1, -1)
  const title = titleText ? inline.inlines([{ line: first,
    column: first.text.indexOf('"') + 2, text: titleText }]) : undefined
  const labelText = simple ? labelRaw : labelRaw?.slice(1, -1)
  const label = labelText === undefined ? undefined : cursorContainerLabel(labelText)
  return kind === undefined ? { type: 'div', children,
    ...(label === undefined ? {} : { label }), pos } :
    GENERATED_CONTENT_KINDS.has(kind) ?
      { type: 'directive', kind, children, ...(title ? { title } : {}),
        ...(label === undefined ? {} : { label }), pos } :
      { type: 'admonition', kind, children, ...(title ? { title } : {}),
        ...(label === undefined ? {} : { label }), pos }
}

function reportDanglingAtCursor(cursor: Cursor, inline: CursorInline,
  pendingAt: SourceLine | undefined, children: BlockNode[]): void {
  if (!pendingAt || !inline.recordDanglingAttributes) return
  const authored = cursor.physicalLines[pendingAt.number - 1]?.text ?? ''
  if (cursor.owner.kind === 'colon' && pendingAt.text === '{empty}' &&
      /^: +\{empty\}$/.test(authored)) return
  let wholeBodyOf: 'description' | 'footnote' | undefined
  if (children.length === 0) {
    if (cursor.owner.kind === 'definition' || cursor.owner.kind === 'colon' && /^: +\{/.test(authored)) {
      wholeBodyOf = 'description'
    } else if (cursor.owner.kind === 'colon' && /^\[\^[^\]]+\]: +\{/.test(authored)) {
      wholeBodyOf = 'footnote'
    }
  }
  const rawLine = inline.rawLines?.[pendingAt.number - 1]
  const rawColumn = rawLine?.indexOf(pendingAt.text, (pendingAt.baseColumn ?? 1) - 1) ?? -1
  const offset = cursor.owner.kind === 'quote' && cursor.owner.parent?.kind === 'list' &&
    rawColumn >= 0 ? rawColumn + 1 - (pendingAt.baseColumn ?? 1) : 0
  inline.diagnostics!.push({ kind: 'dangling', event: { line: pendingAt.number,
    column: (pendingAt.baseColumn ?? 1) + offset,
    startOffset: pendingAt.start + offset, endOffset: pendingAt.start + offset + pendingAt.text.length,
    ...(wholeBodyOf ? { wholeBodyOf } : {}) } })
}

function fenceDiagnosticColumn(cursor: Cursor, inline: CursorInline,
  first: SourceLine, marker: string): number {
  const column = cursor.owner.kind === 'root' && first.text === marker &&
    first.lead !== undefined ? 1 : first.baseColumn ?? 1
  const rawQuoteLine = cursor.owner.kind === 'list' && cursor.owner.parent?.kind === 'quote' ?
    inline.rawLines?.[first.number - 1] : undefined
  return rawQuoteLine === undefined ? column :
    rawQuoteLine.indexOf(marker, (first.baseColumn ?? 1) - 1) + 1 || column
}

function sharesGlobalFootnoteMaps(cursor: Cursor): boolean {
  const singleRootQuoteFootnote = cursor.owner.kind === 'quote' &&
    cursor.owner.parent?.kind === 'root' && cursor.lines.length === 1 &&
    FOOTNOTE_DEF.test(cursor.lines[0]!.text)
  const singleRootColonFootnote = cursor.owner.kind === 'colon' &&
    cursor.owner.parent?.kind === 'root' && cursor.lines.length === 1 &&
    FOOTNOTE_DEF.test(cursor.lines[0]!.text)
  const rootQuoteDefinitions = cursor.owner.kind === 'quote' &&
    cursor.owner.parent?.kind === 'root' && cursor.lines.length > 1 &&
    cursor.lines.every((line) => rootLinkDef(line.text) !== null || FOOTNOTE_DEF.test(line.text))
  return cursor.owner.kind === 'quote' && cursor.owner.parent?.kind === 'list' ||
    singleRootQuoteFootnote || singleRootColonFootnote || rootQuoteDefinitions
}

function quoteHostedListOwner(owner: ContainerOwner): boolean {
  return hasContainerOwner(owner, 'list') && hasContainerOwner(owner, 'quote')
}

function colonHostedListOwner(owner: ContainerOwner): boolean {
  return owner.kind === 'list' && hasContainerOwner(owner, 'colon')
}

function rootListContinuedFootnoteOwner(cursor: Cursor, first: SourceLine,
  footnote: RegExpExecArray): boolean {
  if (cursor.owner.kind !== 'list' || cursor.owner.parent?.kind !== 'root' ||
      !plainQuoteText(footnote[2] ?? '') || cursor.at === 0) return false
  const prior = cursor.lines[cursor.at - 1]!
  if (prior.number !== first.number - 1) return false
  return prior.text !== '' && !prior.ownedLazy && !prior.lazyText
}

function indentedRootFootnoteLine(cursor: Cursor, first: SourceLine,
  seenRootFootnote: boolean): SourceLine | undefined {
  if (cursor.owner.kind !== 'root' || !seenRootFootnote ||
      cursor.physicalLines[first.number - 2]?.text !== '' ||
      !first.text.startsWith('  [^')) return undefined
  return { ...first, text: first.text.slice(2), start: first.start + 2,
    baseColumn: (first.baseColumn ?? 1) + 2 }
}

function skipIgnoredBlockLine(cursor: Cursor, prior: BlockNode['type'] | undefined): boolean {
  const first = cursor.peek()!
  if (isBlankLine(first.text)) {
    cursor.plusAdjacentRisk = false
    cursor.take()
    return true
  }
  if (cursor.owner.kind === 'root' && prior === 'block_quote' &&
      first.text === '+' && first.plusAfterPara === true &&
      rootLinkDef(cursor.peek(1)?.text ?? '')) {
    cursor.take()
    return true
  }
  return false
}

function listTermOpaqueFollower(cursor: Cursor): boolean {
  if (cursor.owner.kind !== 'list') return false
  const follower = cursor.peek(1)
  if (!follower || follower.number !== cursor.peek()!.number + 1) return false
  const text = follower.text.trimStart()
  return text.startsWith('%%') || FOOTNOTE_DEF.test(text)
}

function listMarkerTermBoundary(cursor: Cursor): boolean {
  if (cursor.owner.kind !== 'list') return false
  const first = cursor.peek()!
  const physical = cursor.physicalLines[first.number - 1]
  const marker = listMarker(physical?.text ?? '')
  if (!marker || !/^:: +[^ ]/.test(marker.content)) return false
  const description = cursor.physicalLines[first.number]?.text ?? ''
  const follower = cursor.physicalLines[first.number + 1]?.text ?? ''
  if (/^ +: +[^ ]/.test(description)) {
    return listMarker(follower.trimStart()) !== undefined || /^ *%%/.test(follower)
  }
  const afterBlank = cursor.physicalLines[first.number + 2]?.text ?? ''
  return /^: +[^ ]/.test(description) && isBlankLine(follower) &&
    /^ {3,}[^ ]/.test(afterBlank) && plainQuoteText(afterBlank.trimStart())
}

function parseBlocks(cursor: Cursor, inline: CursorInline, definitionNodes: BlockNode[],
  depth = 0, atDocumentLevel = true, footnoteDefs?: Record<string, BlockNode[]>,
  footnoteDefPos?: Record<string, Position>, commentOpeners?: Set<number>,
  colonDepth = 0): BlockNode[] {
  if (depth >= MAX_NESTING_DEPTH) throw new UnsupportedCursorSyntax('container nesting limit')
  if (sharesGlobalFootnoteMaps(cursor)) {
    footnoteDefs ??= inline.footnoteDefs
    footnoteDefPos ??= inline.footnoteDefPos
  }
  const children: BlockNode[] = []
  let seenRootFootnote = false
  let pendingAttrs: Attrs | null = null
  let pendingAt: SourceLine | undefined
  const emit = (input: BlockNode) => {
    let node = input
    if (node.type !== 'comment' && node.type !== 'abbreviation_def' && pendingAttrs) {
      node.attrs = mergeAttrs(pendingAttrs, node.attrs ?? {})
      pendingAttrs = null
      pendingAt = undefined
    }
    const code = node.type === 'code_block' ? node :
      node.type === 'figure' && node.target.type === 'code_block' ? node.target : undefined
    if (code && node.attrs?.keyValues?.table === '') {
      const table = delimitedTable(code, node.attrs)
      if (table) {
        if (node.type === 'figure') {
          table.caption = node.caption
          if (node.pos) table.pos = node.pos
        }
        node = table
      }
    }
    if (code?.header !== undefined && node.attrs?.keyValues?.title === undefined &&
        code.attrs?.keyValues?.title === undefined) {
      code.attrs = { ...(code.attrs ?? {}),
        keyValues: { ...(code.attrs?.keyValues ?? {}), title: code.header } }
    }
    if (node.type === 'table') deriveTableMetadata(node)
    consumeLooseKey(node)
    children.push(node)
  }
  while (cursor.peek()) {
    const first = cursor.peek()!
    const prior = children.at(-1)?.type
    if (skipIgnoredBlockLine(cursor, prior)) continue
    cursor.plusAttachRisk = prior === 'list'
    cursor.plusAdjacentRisk = prior === 'block_quote' ||
      prior !== 'code_block' && cursor.plusAdjacentRisk
    if (first.lazyText) { emit(parseParagraphAtCursor(cursor, inline)); continue }
    const attrs = takeBlockAttrsAtCursor(cursor, atDocumentLevel)
    if (attrs) {
      pendingAttrs = pendingAttrs ? mergeAttrs(pendingAttrs, attrs) : attrs
      pendingAt ??= first
      continue
    }
    const indentedNote = indentedRootFootnoteLine(cursor, first, seenRootFootnote)
    const footnote = FOOTNOTE_DEF.exec(indentedNote?.text ?? first.text)
    if (footnote) {
      cursor.plusAdjacentRisk = true
      if (quoteHostedListOwner(cursor.owner) || colonHostedListOwner(cursor.owner) ||
          rootListContinuedFootnoteOwner(cursor, first, footnote)) {
        footnoteDefs ??= inline.footnoteDefs
        footnoteDefPos ??= inline.footnoteDefPos
      }
      if (!footnoteDefs || !footnoteDefPos) {
        throw new UnsupportedCursorSyntax('nested or multiline footnote definition')
      }
      takeSimpleFootnote(cursor, inline, indentedNote ?? first, footnote, footnoteDefs, footnoteDefPos)
      seenRootFootnote = seenRootFootnote || cursor.owner.kind === 'root'
      continue
    }
    const definition = rootLinkDef(first.text) ||
      atDocumentLevel && descriptionRootLinkDefinition(first, inline) ||
      atDocumentLevel && footnoteBodyLinkDef(first, cursor.physicalLines[first.number - 2],
        cursor.physicalLines[first.number])
    if (definition) {
      takeLinkDefinitionAtCursor(cursor, inline, definitionNodes, atDocumentLevel, definition)
      continue
    }
    const abbreviation = ABBR_DEF.exec(first.text)
    if (abbreviation && atDocumentLevel) {
      cursor.take()
      emit({ type: 'abbreviation_def', abbr: abbreviation[1]!,
        expansion: dropTrailingWhitespace(abbreviation[2]!), pos: position(first, first) })
      continue
    }
    const commentFence = RE_COMMENT_BLOCK_ANY.exec(first.text)
    if (commentFence) {
      if (!atDocumentLevel) {
        const comment = parseNestedCommentAtCursor(cursor, commentFence[1]!.length)
        if (comment) { emit(comment); continue }
      }
      if (first.text[0] !== '%') throw new UnsupportedCursorSyntax('nested block comment')
      if (commentOpeners?.has(first.start)) {
        cursor.take()
        const content: string[] = []
        const openerTail = trimNonNbsp(commentFence[2]!)
        if (openerTail) content.push(openerTail)
        while (cursor.peek()) {
          const closer = RE_COMMENT_BLOCK_ANY.exec(cursor.peek()!.text)
          if (closer?.[1]?.length === commentFence[1]!.length) break
          content.push(cursor.take().text)
        }
        const close = cursor.take()
        emit({ type: 'comment', block: true, content: content.join('\n'), pos: position(first, close) })
        continue
      }
    }
    if (LINE_COMMENT.test(first.text)) {
      if (ambiguousDegradedComment(cursor, first, atDocumentLevel,
        children.at(-1)?.type === 'list')) {
        throw new UnsupportedCursorSyntax('nested degraded block comment')
      }
      cursor.take()
      emit({ type: 'comment', block: false, content: commentLineContent(first.text),
        pos: position(first, first, /^[ \t]*/.exec(first.text)![0].length + 1) })
      continue
    }
    const heading = first.text[0] === '#' ? RE_HEADING.exec(first.text) : null
    if (heading) {
      cursor.take()
      const column = /^#{1,6} +/.exec(first.text)![0].length + 1
      emit({ type: 'heading', level: heading[1]!.length as HeadingLevel,
        children: inline.inlines([{ line: first, column,
          text: heading[3] ? first.text.slice(column - 1) : heading[2]! }]),
        pos: position(first, first, 1, contentEndColumn(first)) })
      continue
    }
    if (BREAK.test(first.text)) {
      cursor.take()
      emit({ type: 'thematic_break',
        ...(first.text[0] === '-' ? {} : { marker: first.text[0] as '*' | '_' }),
        pos: position(first, first) })
      continue
    }
    if (RE_RAW_FENCE.test(first.text)) {
      emit(parseRawAtCursor(cursor, inline))
      continue
    }
    if (RE_LINE_BLOCK_OPEN.test(first.text)) {
      emit(parseLineBlockAtCursor(cursor, inline))
      continue
    }
    const fence = fenceOpen(first.text)
    if (fence) {
      cursor.take()
      const payload: string[] = []
      const payloadLines: SourceLine[] = []
      while (cursor.peek() && !closesFence(cursor.peek()!.text, fence.marker)) {
        const line = cursor.take()
        payload.push(line.text)
        payloadLines.push(line)
      }
      const unclosed = inline.recordUnclosedCodeFences && !cursor.peek()
      const close = takeFenceCloseAtCursor(cursor, first, payloadLines)
      if (unclosed) {
        const endLine = payloadLines.at(-1)?.number ?? first.number
        inline.diagnostics!.push({ kind: 'fence', event: { line: first.number,
          column: fenceDiagnosticColumn(cursor, inline, first, fence.marker),
          marker: fence.marker, endLine: endLine + 1,
          reason: endLine >= cursor.physicalLines.length ? 'document' : 'container' } })
      }
      const block: CodeBlock = { type: 'code_block', content: payload.length ? payload.join('\n') + '\n' : '',
        ...(fence.lang ? { lang: fence.lang } : {}),
        ...(fence.header !== undefined ? { header: fence.header } : {}),
        ...(fence.label !== undefined ? { label: fence.label } : {}),
        pos: position(first, close) }
      if (fence.lang === 'csv' || fence.lang === 'tsv') {
        setDelimitedPayloadLines(block, payloadLines.map((line) => ({
          offset: line.start, line: line.number,
          column: line.baseColumn ?? 1, text: line.text,
        })))
      }
      const caption = takeCaption(cursor, inline)
      emit(caption ? { type: 'figure', target: block, caption: caption.children,
        pos: position(first, caption.line) } : block)
      continue
    }
    if (first.text[0] === '>' && RE_BLOCKQUOTE.test(first.text)) {
      const quote = parseQuote(cursor, inline, definitionNodes, depth)
      const caption = takeQuoteCaption(cursor, inline, quote)
      emit(caption ? { type: 'figure', target: quote, caption: caption.children,
        pos: position(first, caption.line) } : quote)
      continue
    }
    if (first.text[0] === '|' && isTableRow(first.text)) {
      const table = parseTableAtCursor(cursor, inline)
      const caption = takeCaption(cursor, inline)
      if (caption) {
        table.caption = caption.children
        table.pos = position(first, caption.line)
      }
      emit(table)
      continue
    }
    const firstMarker = listMarker(first.text)
    if (firstMarker) {
      emit(parseList(cursor, inline, definitionNodes, depth, first, firstMarker,
        footnoteDefs, footnoteDefPos))
      continue
    }
    const sigilFence = matchSigilFence(first.text)
    if (sigilFence) {
      emit(parseSigilFence(cursor, inline, definitionNodes, depth, sigilFence))
      continue
    }
    const colonNode = parseColonAtCursor(cursor, inline, definitionNodes, depth,
      atDocumentLevel, footnoteDefs, footnoteDefPos, colonDepth)
    if (colonNode) { emit(colonNode); continue }
    if (/^:: +[ \t]*[^ \t]/.test(first.text) &&
        (atDocumentLevel || cursor.owner.kind === 'definition' || first.ownedDefinition ||
          (cursor.owner.kind === 'quote' && !cursor.owner.inList) ||
          listTermOpaqueFollower(cursor) || listMarkerTermBoundary(cursor))) {
      emit(parseSimpleDefinitionList(cursor, inline, commentOpeners, depth))
      continue
    }
    if (/^::[ \t]*$/.test(first.text)) {
      emit(parseParagraphAtCursor(cursor, inline))
      continue
    }
    if (atDocumentLevel && cursor.owner.kind === 'root' && /^::\t/.test(first.text)) {
      emit(parseParagraphAtCursor(cursor, inline))
      continue
    }
    if (/^:{3,}>/.test(first.text)) {
      emit(parseParagraphAtCursor(cursor, inline))
      continue
    }
    if (/^(?::::|::)/.test(first.text) && !/^:{3,}(?: *\t| +\{)/.test(first.text)) {
      throw new UnsupportedCursorSyntax(`block at line ${first.number}`)
    }
    emit(parseParagraphAtCursor(cursor, inline))
  }
  reportDanglingAtCursor(cursor, inline, pendingAt, children)
  return children
}

function hoistBareListFootnote(lines: SourceLine[], inline: CursorInline,
  footnoteDefs: Record<string, BlockNode[]>, footnoteDefPos: Record<string, Position>):
  SourceLine[] | undefined {
  const marker = listMarker(lines[0]?.text ?? '')
  const note = lines[1]
  const follower = lines[2]
  // An ownership cut already moved a line left; `lead` is how far, so the authored indent is text + lead.
  const authored = (line: SourceLine): string => ' '.repeat(line.lead ?? 0) + line.text
  if (!marker?.ordered || marker.raw !== '' || marker.indent !== 0 ||
      !note || !/^ {3}\[\^[^\]]+\]: +\S/.test(authored(note)) ||
      lines.length !== 3 || !follower ||
      !/^ {4,5}- +\S/.test(authored(follower))) return undefined
  const strip = (line: SourceLine): SourceLine => {
    const width = 3 - (line.lead ?? 0)
    return { ...line, text: line.text.slice(width), start: line.start + width,
      baseColumn: (line.baseColumn ?? 1) + width }
  }
  const owned = [strip(note)]
  if (authored(follower).startsWith('    ') && listMarker(authored(follower))?.indent !== 4) {
    owned.push(strip(follower))
  }
  const nested = new Cursor(owned, undefined, ROOT_OWNER, lines)
  const match = FOOTNOTE_DEF.exec(owned[0]!.text)
  if (!match) return undefined
  takeSimpleFootnote(nested, inline, owned[0]!, match, footnoteDefs, footnoteDefPos)
  const consumed = new Set(owned.slice(0, nested.at).map((line) => line.number))
  return lines.filter((line) => !consumed.has(line.number))
}

function hoistMarkerLineFootnote(lines: SourceLine[], inline: CursorInline,
  footnoteDefs: Record<string, BlockNode[]>, footnoteDefPos: Record<string, Position>):
  SourceLine[] | undefined {
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!
    const marker = listMarker(line.text)
    if (!marker || marker.indent !== 0 || marker.ordered || marker.width !== 2 ||
        'attrs' in marker || 'continuationWidth' in marker) continue
    const noteText = line.text.slice(marker.width)
    const note = FOOTNOTE_DEF.exec(noteText)
    if (!note || !plainQuoteText(note[2] ?? '')) continue
    const body: SourceLine[] = []
    let end = index + 1
    while (end < lines.length) {
      const next = lines[end]!
      if (isBlankLine(next.text)) {
        let after = end + 1
        while (after < lines.length && isBlankLine(lines[after]!.text)) after++
        if (!lines[after]?.text.startsWith(' '.repeat(marker.width + 2))) break
        while (end < after) body.push({ ...lines[end++]!, text: '' })
        continue
      }
      if (!next.text.startsWith(' '.repeat(marker.width + 2))) break
      body.push({ ...next, text: next.text.slice(marker.width + 2),
        start: next.start + marker.width + 2,
        baseColumn: (next.baseColumn ?? 1) + marker.width + 2 })
      end++
    }
    if (body.filter((part) => !isBlankLine(part.text)).length === 1 &&
          body.some((part) => LINE_COMMENT.test(part.text)) ||
        body.some((part) => listMarker(part.text) !== undefined) &&
          plainQuoteText(lines[end]?.text ?? '')) {
      throw new UnsupportedCursorSyntax('marker-line footnote owner')
    }
    const contentColumn = marker.width + noteText.length - note[2]!.length + 1
    const firstBody = { ...line, text: note[2]!, start: line.start + contentColumn - 1,
      baseColumn: (line.baseColumn ?? 1) + contentColumn - 1 }
    const blocks = parseBlocks(new Cursor([firstBody, ...body], undefined,
      childOwner(ROOT_OWNER, 'colon'), lines), inline, [], 1, false)
    Object.defineProperty(footnoteDefs, note[1]!, { value: blocks,
      enumerable: true, configurable: true, writable: true })
    Object.defineProperty(footnoteDefPos, note[1]!, { value: position({ ...line,
      text: noteText, start: line.start + marker.width,
      baseColumn: (line.baseColumn ?? 1) + marker.width }, lines[end - 1] ?? line),
    enumerable: true, configurable: true, writable: true })
    return [...lines.slice(0, index), { ...line, text: line.text.slice(0, marker.width) },
      ...lines.slice(end)]
  }
  return undefined
}

function hasDedentedNestedFenceBoundary(lines: readonly SourceLine[]): boolean {
  for (let index = 0; index + 6 < lines.length; index++) {
    if (lines[index + 1]!.text !== '' || lines[index + 5]!.text !== '') continue
    const marker = listMarker(lines[index]!.text)
    if (!marker || marker.indent === 0) continue
    const opener = lines[index + 2]!.text
    const openIndent = /^ */.exec(opener)![0].length
    const fence = fenceOpen(opener.slice(openIndent))?.marker
    if (!fence || openIndent <= marker.width) continue
    const close = lines[index + 4]!.text
    const closeIndent = /^ */.exec(close)![0].length
    const tail = lines[index + 6]!.text
    if (closeIndent > marker.indent && closeIndent < marker.width &&
        closesFence(close.slice(closeIndent), fence) &&
        tail.startsWith(' '.repeat(marker.indent)) && plainQuoteText(tail.trimStart())) return true
  }
  return false
}

function recordMarkerLineLinkDefinition(cursor: Cursor, line: SourceLine,
  links: Map<string, LinkDef>, known?: Map<number, NonNullable<ReturnType<typeof rootLinkDef>>>):
  Map<number, NonNullable<ReturnType<typeof rootLinkDef>>> | undefined {
  if (line.text[0] !== '-' && line.text[0] !== '*' &&
      !/^[0-9A-Za-z]/.test(line.text)) return known
  const marker = listMarker(line.text)
  const previous = cursor.lines[line.number - 2]
  const previousMarker = line.number === 2 && previous ? listMarker(previous.text) : undefined
  const precedingRootItem = previousMarker?.indent === 0 && plainQuoteText(previousMarker.content)
  if (!marker || marker.indent !== 0 ||
      line.number > 1 && !isBlankLine(previous!.text) && !precedingRootItem) return known
  const definition = rootLinkDef(marker.content)
  if (!definition) return known
  const definitions = known ?? new Map<number, NonNullable<ReturnType<typeof rootLinkDef>>>()
  definitions.set(line.number, definition)
  links.set(normalizeRefLabel(definition.label), { rawLabel: definition.label,
    line: line.number - 1, href: definition.href,
    ...(definition.title !== undefined ? { title: unescapeAttrValue(definition.title) } : {}),
    ...(definition.attrText !== null ? { attrs: parseAttrs(definition.attrText) } : {}) })
  return definitions
}

function indexedQuoteListDefinition(line: SourceLine, previous: SourceLine | undefined,
  next: SourceLine | undefined, prefix: string | undefined,
  hasNestedMarker: boolean): ReturnType<typeof rootLinkDef> {
  if (!hasNestedMarker || !prefix || !line.text.startsWith(prefix + '[')) return null
  const prior = previous?.text ?? ''
  const simpleItem = (prior.startsWith('> - ') || prior.startsWith('> * ')) &&
    plainQuoteText(prior.slice(4)) && !isBlockStart(prior.slice(4))
  if (prior !== '> ' && !(simpleItem && (!next || isBlankLine(next.text)))) return null
  return rootLinkDef(line.text.slice(prefix.length))
}

function rejectAmbiguousShallowListOwnership(lines: SourceLine[], source: string): void {
  if (lines.length < 2) return
  // A nested quote can keep ownership of a later, shallow list marker after
  // another block has started. The cursor list frame cannot yet make that
  // decision from physical columns alone.
  let nestedQuoteSeen = false
  for (let index = 0; index < lines.length; index++) {
    const text = lines[index]!.text
    // A flush-left follower can still belong to a quoted list item's paragraph.
    if (text[0] === '>' && text[1] === ' ' && index + 1 < lines.length &&
        (text[2] === '-' || text[2] === '*' || /^[0-9A-Za-z]$/.test(text[2] ?? ''))) {
      const quotedMarker = listMarker(text.slice(2))
      const follower = lines[index + 1]!.text
      if (quotedMarker && plainQuoteText(quotedMarker.content) &&
          follower !== '' && !RE_BLOCKQUOTE.test(follower) &&
          follower[0] !== ' ' && follower[0] !== '\t' &&
          !(index === 0 && lines[1]!.lead && /^\[[^\]^][^\]]*\]: /.test(follower)) &&
          !follower.startsWith('^ ')) {
        throw new UnsupportedCursorSyntax('quoted list physical follower owner')
      }
    }
    if (lines.length < 3) continue
    // Only an indented line can be a one-column marker.
    const marker = text[0] === ' ' || text[0] === '\t' ? listMarker(text) : undefined
    if (index >= 2 && marker?.indent === 1 &&
        listMarker(lines[index - 1]!.text)?.indent === 1 &&
        listMarker(lines[index - 2]!.text)?.indent === 0 &&
        listMarker(lines[index - 2]!.text)?.content === '') {
      throw new UnsupportedCursorSyntax('one-column list sibling owner')
    }
    if (lines.length >= 6 && index >= 4 && source.includes('>') &&
        nestedQuoteSeen && marker?.indent === 1) {
      throw new UnsupportedCursorSyntax('nested quote and shallow list owner')
    }
    if (/^\s{2,}>/.test(text)) nestedQuoteSeen = true
  }
}

function emitCursorDiagnostics(inline: CursorInline, opts: ParseOptions): void {
  if (!inline.diagnostics) return
  const seen = new Set<string>()
  for (const diagnostic of inline.diagnostics) {
    if (diagnostic.kind === 'dangling') {
      const event = diagnostic.event
      const key = `attr:${event.startOffset}:${event.endOffset}`
      if (seen.has(key)) continue
      seen.add(key)
      opts.onDanglingBlockAttributes?.(event)
    } else if (diagnostic.kind === 'fence') {
      const event = diagnostic.event
      const key = `fence:${event.line}:${event.column}:${event.marker}`
      if (seen.has(key)) continue
      seen.add(key)
      opts.onUnclosedCodeFence?.(event)
    } else if (diagnostic.kind === 'invalid') {
      const event = diagnostic.event
      const key = `invalid:${event.startOffset}:${event.endOffset}`
      if (seen.has(key)) continue
      seen.add(key)
      opts.onInvalidContainerMetadata?.(event)
    } else {
      const event = diagnostic.event
      const key = `container:${event.startOffset}:${event.endOffset}`
      if (seen.has(key)) continue
      seen.add(key)
      opts.onUnclosedContainer?.(event)
    }
  }
}

function rejectUnmigratedOptions(opts: ParseOptions): void {
  if (opts.extensions?.some((extension) => extension.matchInline || extension.matchBlock) ||
      opts.onRefusedContinuationMarker) {
    throw new UnsupportedCursorSyntax('parser options and callbacks are not migrated')
  }
}

/** The frontmatter lexer is built once and reused by the cursor's readers; a BOM or an explicit default format keeps the two-lexer path. */
function prebuiltFrontmatterLexer(source: string, strippedBom: boolean, opts: ParseOptions): Lexer | undefined {
  if (!source.startsWith('---') || strippedBom || opts.defaultFrontmatterFormat !== undefined) return undefined
  const lexer = new Lexer(source)
  lexer.consumeFrontmatter()
  return lexer
}

function consumeCursorFrontmatter(lexer: Lexer, prebuilt: Lexer | undefined, opts: ParseOptions): void {
  if (lexer === prebuilt) return
  lexer.defaultFrontmatterFormat = opts.defaultFrontmatterFormat ?? 'yaml'
  lexer.consumeFrontmatter()
}

export function parseCursorPrototype(source: string, opts: ParseOptions = {}): Document {
  rejectUnmigratedOptions(opts)
  const rawSource = source
  const rawByteLength = utf8ByteLength(source)
  const strippedBom = source.charCodeAt(0) === 0xfeff
  if (strippedBom) source = source.slice(1)
  if (source.includes('\0')) source = source.replace(/\0/g, '�')
  source = replaceLoneSurrogates(source)
  const lines = scanLines(source)
  const rootLexer = prebuiltFrontmatterLexer(source, strippedBom, opts)
  const cutShifts = applyOwnership(lines, source, rootLexer?.pos)
  rejectAmbiguousShallowListOwnership(lines, source)
  rejectColumnZeroCommentAfterBody(lines)
  if ((source.includes('```') || source.includes('~~~')) &&
      hasDedentedNestedFenceBoundary(lines)) {
    throw new UnsupportedCursorSyntax('dedented nested fence owner')
  }
  if (strippedBom) for (let i = 0; i < lines.length; i++) {
    lines[i]!.start++
    if (i === 0) lines[i]!.baseColumn = (lines[i]!.baseColumn ?? 1) + 1
  }
  const cursor = new Cursor(lines, source)
  cursor.strippedBom = strippedBom
  cursor.rootLexer = rootLexer
  const commentOpeners = source.includes('%%%') ? commentOpenersWithCloser(cursor.lines) : new Set<number>()
  const linkDefinitions = new Map<string, LinkDef>()
  const abbreviations = new Map<string, string>()
  let openFence: string | undefined
  let fenceAfterText = false
  let fenceLineIndex = 0
  // An indented `[^x]:` line in the blank-free run above a fence keeps the later link definition exact.
  let indentedFootnoteInRun = false
  let openComment: number | undefined
  let simpleRootListPrefix: string | undefined
  let simpleRootListNested = false
  let simpleQuoteListPrefix: string | undefined
  const hasDefinitionMarker = source.includes(']:')
  const mayHaveNestedListDefinition = hasDefinitionMarker &&
    (source.includes('  [') || source.includes('>   ['))
  let simpleRootListDefinitions = mayHaveNestedListDefinition ?
    new Map<number, NonNullable<ReturnType<typeof rootLinkDef>>>() : undefined
  if (hasDefinitionMarker) {
    for (const line of cursor.lines) {
      const footnoteInRunAbove = indentedFootnoteInRun
      indentedFootnoteInRun = line.text !== '' &&
        (indentedFootnoteInRun || /^[ \t]+\[\^[^\]]+\]:/.test(line.text))
      if (mayHaveNestedListDefinition && !openFence && openComment === undefined) {
        const marker = listMarker(line.text)
        if (marker?.indent === 0) {
          simpleRootListPrefix = ' '.repeat(marker.width)
          simpleRootListNested = false
        }
        else if (line.text !== '' && simpleRootListPrefix &&
            !line.text.startsWith(simpleRootListPrefix)) {
          simpleRootListPrefix = undefined
          simpleRootListNested = false
        }
        else if (simpleRootListPrefix && line.text.startsWith(simpleRootListPrefix) &&
            (line.text.startsWith(simpleRootListPrefix + '  ') ||
             isBlockStart(line.text.slice(simpleRootListPrefix.length)) &&
             !rootLinkDef(line.text.slice(simpleRootListPrefix.length)))) {
          if (listMarker(line.text.slice(simpleRootListPrefix.length))) {
            simpleRootListNested = true
          } else if (!rootLinkDef(line.text.slice(simpleRootListPrefix.length).trimStart())) {
            simpleRootListPrefix = undefined
            simpleRootListNested = false
          }
        }
        const quoteMarker = line.text.startsWith('> ') ? listMarker(line.text.slice(2)) : undefined
        if (quoteMarker?.indent === 0) simpleQuoteListPrefix = '> ' + ' '.repeat(quoteMarker.width)
        else if (line.text !== '> ' && simpleQuoteListPrefix &&
            !line.text.startsWith(simpleQuoteListPrefix)) simpleQuoteListPrefix = undefined
        else if (simpleQuoteListPrefix && line.text.startsWith(simpleQuoteListPrefix) &&
            (line.text.startsWith(simpleQuoteListPrefix + '  ') ||
             isBlockStart(line.text.slice(simpleQuoteListPrefix.length)) &&
             !rootLinkDef(line.text.slice(simpleQuoteListPrefix.length)))) {
          simpleQuoteListPrefix = undefined
        }
      }
      if (openComment !== undefined) {
        const closer = RE_COMMENT_BLOCK_ANY.exec(line.text)
        if (closer?.[1]?.length === openComment) openComment = undefined
        continue
      }
      if (openFence) {
        if (closesFence(line.text, openFence)) openFence = undefined
        continue
      }
      const fence = fenceOpen(line.text)
      if (fence) {
        openFence = fence.marker
        const prev = cursor.lines[line.number - 2]?.text
        fenceLineIndex = line.number
        fenceAfterText = prev !== undefined && prev !== '' && plainQuoteText(prev.trimStart()) &&
          !footnoteInRunAbove
        continue
      }
      const comment = RE_COMMENT_BLOCK_ANY.exec(line.text)
      if (comment && commentOpeners.has(line.start)) {
        openComment = comment[1]!.length
        continue
      }
      const quoteDefinition = line.text.startsWith('> ') &&
        (line.number === 1 || cursor.lines[line.number - 2]?.text === '')
      const simpleListDefinition = mayHaveNestedListDefinition && simpleRootListPrefix &&
        line.text.startsWith(simpleRootListPrefix) &&
        /^ *\[/.test(line.text.slice(simpleRootListPrefix.length)) &&
        (!simpleRootListNested && cursor.lines[line.number - 2]?.text === '' ||
         boundedAdjacentDefinitionTail(cursor.lines, line.number, simpleRootListPrefix)) ?
        rootLinkDef(line.text.slice(simpleRootListPrefix.length).trimStart()) : null
      const quoteListDefinition = indexedQuoteListDefinition(line,
        cursor.lines[line.number - 2], cursor.lines[line.number], simpleQuoteListPrefix,
        mayHaveNestedListDefinition)
      if (simpleListDefinition || quoteListDefinition) {
        simpleRootListDefinitions!.set(line.number, (simpleListDefinition ?? quoteListDefinition)!)
      }
      simpleRootListDefinitions = recordMarkerLineLinkDefinition(cursor, line,
        linkDefinitions, simpleRootListDefinitions)
      const match = rootLinkDef(line.text) ||
        footnoteBodyLinkDef(line, cursor.physicalLines[line.number - 2],
          cursor.physicalLines[line.number]) ||
        simpleListDefinition || quoteListDefinition ||
        (quoteDefinition ? rootLinkDef(line.text.slice(2)) : null)
      if (match) linkDefinitions.set(normalizeRefLabel(match.label),
        { rawLabel: match.label, line: line.number - 1, href: match.href,
          ...(match.title !== undefined ? { title: unescapeAttrValue(match.title) } : {}),
          ...(match.attrText !== null ? { attrs: parseAttrs(match.attrText) } : {}) })
      if (!match) registerCutDefinition(line, linkDefinitions)
      const abbr = line.abbrText ? null : ABBR_DEF.exec(line.text)
      if (abbr) abbreviations.set(abbr[1]!, dropTrailingWhitespace(abbr[2]!))
    }
  }
  cursor.unclosedFenceAfterText = openFence !== undefined && fenceAfterText &&
    !cursor.lines.slice(fenceLineIndex).some((l) => closesFence(l.text.trimStart(), openFence!))
  if (simpleRootListDefinitions) cursor.simpleRootListDefinitions = simpleRootListDefinitions
  const inline = new CursorInline(linkDefinitions, abbreviations, opts.positions === false,
    opts.onDanglingBlockAttributes !== undefined, opts.onUnclosedCodeFence !== undefined,
    opts.onInvalidContainerMetadata !== undefined, opts.onUnclosedContainer !== undefined,
    opts.extensions?.map((extension) => extension.quoteCharacters)
      .filter((quotes): quotes is readonly [string, string, string, string] => quotes !== undefined)
      .at(-1))
  captureDiagnosticRawLines(inline, rawSource)
  const definitionNodes: BlockNode[] = []
  inline.documentDefinitionNodes = definitionNodes
  const footnoteDefs: Record<string, BlockNode[]> = {}
  const footnoteDefPos: Record<string, Position> = {}
  inline.footnoteDefs = footnoteDefs
  inline.footnoteDefPos = footnoteDefPos
  const ownedFootnoteLines = hoistBareListFootnote(lines, inline, footnoteDefs, footnoteDefPos) ??
    (source.includes(' [^') ?
      hoistMarkerLineFootnote(lines, inline, footnoteDefs, footnoteDefPos) : undefined)
  const blockCursor = ownedFootnoteLines ? new Cursor(ownedFootnoteLines, source, ROOT_OWNER, lines) : cursor
  if (ownedFootnoteLines && simpleRootListDefinitions) {
    blockCursor.simpleRootListDefinitions = simpleRootListDefinitions
  }
  let frontmatter: Document['frontmatter']
  if (source.startsWith('---')) {
    const lexer = lexerForCursor(cursor)
    consumeCursorFrontmatter(lexer, rootLexer, opts)
    cursor.at = lexer.pos
    frontmatter = lexer.frontmatter
  }
  const children = parseBlocks(blockCursor, inline, definitionNodes, 0, true, footnoteDefs, footnoteDefPos,
    commentOpeners)
  const document: Document = { type: 'document', children, srcByteLength: rawByteLength }
  if (Object.keys(footnoteDefs).length) {
    document.footnoteDefs = footnoteDefs
    document.footnoteDefPos = footnoteDefPos
  }
  if (frontmatter) document.frontmatter = frontmatter
  children.push(...definitionNodes)
  shiftCutPositions(document, cutShifts)
  if (opts.positions !== false) toCodepointPositions(document, rawSource)
  if (inline.hasLeadingImage) promoteBlockImages(children, true)
  document.children = promoteCitationDefinitions(children)
  emitCursorDiagnostics(inline, opts)
  return opts.positions === false ? dropPositions(document) : document
}
