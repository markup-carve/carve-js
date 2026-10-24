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
import { dropTrailingWhitespace, readCaptionText } from './block/parse-block-boundaries.js'
import { MAX_NESTING_DEPTH, commentLineContent } from './block/parse-block-scan-core.js'
import { RE_CAPTION, RE_COMMENT_BLOCK_ANY } from './block/parse-quote-core.js'
import { trimNonNbsp } from '../trim-non-nbsp.js'
import { replaceLoneSurrogates } from '../well-formed.js'
import { InlineParseSession } from './inline/parse-inline-session.js'
import { inlineSource } from './inline/parse-inline-core.js'
import type { LinkDef } from './inline/inline-resolution.js'
import { olKindOf, olStartOf, type OlKind } from './list/parse-item-core.js'
import { RE_ADMONITION_OPEN, RE_BLOCKQUOTE, RE_FENCE, RE_HARDBREAKS_OPEN, RE_HEADING, RE_LINE_BLOCK_OPEN, RE_ORDERED, RE_QUOTE_BLOCK_OPEN, RE_RAW_FENCE, consumeLooseKey, deriveTableMetadata, extractItemAttr, isTableRow, matchLinkDef, parseBlockAttributeRun, probeBlockAttributes } from './parse-prepass-core.js'
import { Lexer, isBlankLine } from './parse-lexer.js'
import type { ParseOptions } from './block/parse-block-scan-core.js'
import { commentBlockHasCloser, parseCommentBlock, parseLineBlockWithHelpers, parseRawBlock, parseTableBlock } from './parse-core.js'
import { delimitedTable, setDelimitedPayloadLines } from '../table/delimited-table.js'

/**
 * An isolated block-cursor experiment. It deliberately fails on syntax that has
 * not been migrated; production entry points never invoke it.
 */
export class UnsupportedCursorSyntax extends Error {}

interface SourceLine { text: string; start: number; number: number; baseColumn?: number; spanEndColumn?: number }
type ContainerKind = 'root' | 'quote' | 'colon' | 'list'
interface ContainerOwner {
  readonly kind: ContainerKind
  readonly inList: boolean
  readonly parent?: ContainerOwner
}
const ROOT_OWNER: ContainerOwner = { kind: 'root', inList: false }

function childOwner(parent: ContainerOwner, kind: Exclude<ContainerKind, 'root'>): ContainerOwner {
  return { kind, inList: kind === 'list' || parent.inList, parent }
}

class Cursor {
  at = 0
  sharedLexer?: Lexer
  fenceCloserSuffix?: { backtick: Uint32Array; tilde: Uint32Array }
  constructor(readonly lines: SourceLine[], readonly rootSource?: string,
    readonly owner: ContainerOwner = ROOT_OWNER) {}
  peek(n = 0): SourceLine | undefined { return this.lines[this.at + n] }
  take(): SourceLine { return this.lines[this.at++]! }
}

function lexerForCursor(cursor: Cursor): Lexer {
  if (cursor.sharedLexer) return cursor.sharedLexer
  const lexer = cursor.rootSource ? new Lexer(cursor.rootSource) :
    new Lexer(cursor.lines.map((line) => line.text))
  if (cursor.rootSource && cursor.lines[0]?.baseColumn === 2) {
    lexer.sourceOffsetMap = cursor.lines.map((line) => line.start)
    lexer.linePrefixWidths = cursor.lines.map((_line, index) => index === 0 ? 1 : 0)
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
  for (let i = 0; i < source.length; i++) {
    const code = source.charCodeAt(i)
    if (code !== 10 && code !== 13) continue
    lines.push({ text: source.slice(start, i), start, number: lines.length + 1 })
    if (code === 13 && source.charCodeAt(i + 1) === 10) i++
    start = i + 1
  }
  if (start < source.length || lines.length === 0) {
    lines.push({ text: source.slice(start), start, number: lines.length + 1 })
  }
  return lines
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

class CursorInline extends InlineParseSession {
  // Image promotion only changes paragraphs whose first inline node is an image.
  hasLeadingImage = false
  constructor(readonly linkDefinitions: Map<string, LinkDef>,
    readonly abbreviations: Map<string, string>) { super() }
  tableInlines(text: string, source?: InlineSource, captionContext = false): InlineNode[] {
    return this.parseInline(text, this.abbreviations, this.linkDefinitions, source, captionContext)
  }
  lineBlockInlines(text: string, source?: InlineSource, captionContext = false): InlineNode[] {
    const previous = this.inLineBlock
    this.inLineBlock = true
    try {
      return this.parseInline(text, this.abbreviations, this.linkDefinitions, source, captionContext)
    } finally {
      this.inLineBlock = previous
    }
  }
  inlines(parts: ContentLine[], captionContext = false): InlineNode[] {
    const text = dropTrailingWhitespace(parts.map((part) => part.text).join('\n'))
    const first = parts[0]!
    const lineAnchors = parts.map((part) => {
      const anchor = { offset: part.line.start + part.column - 1,
        column: (part.line.baseColumn ?? 1) + part.column - 1, line: part.line.number }
      return anchor
    })
    const nodes = this.parseInline(text, this.abbreviations, this.linkDefinitions, {
      anchored: true,
      baseOffset: first.line.start + first.column - 1,
      startLine: first.line.number,
      startColumn: (first.line.baseColumn ?? 1) + first.column - 1,
      ...(parts.length > 1 ? { lineAnchors } : {}),
    }, captionContext)
    if (nodes[0]?.type === 'image') this.hasLeadingImage = true
    return nodes
  }
}

function imageReferenceResolved(image: Extract<InlineNode, { type: 'image' }>, inline: CursorInline): boolean {
  return !image.ref || inline.linkDefinitions.has(normalizeRefLabel(image.ref))
}

const BULLET = /^( *)([-*]) +(.*)$/
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
  return line.startsWith('[') && !line.startsWith('[^') ? matchLinkDef(line) : null
}
const FOOTNOTE_DEF = /^\[\^([^\]]+)\]: +(.*)$/
const ABBR_DEF = /^\*\[([A-Za-z0-9]+)\]: +(?![ \t]*$)([^]+)$/u
const LINE_COMMENT = /^[ \t]*%%/

function closesFence(line: string, marker: string): boolean {
  let count = 0
  while (line[count] === marker[0]) count++
  return count >= marker.length && /^[ \t]*$/.test(line.slice(count))
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
    return { indent, ordered: marker === '.',
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
  const itemAttr = extractItemAttr(line)
  const ordered = RE_ORDERED.exec(itemAttr?.stripped ?? line)
  if (ordered && !ordered[1]!.includes('\t')) {
    const markerWidth = ordered[0].length - ordered[4]!.length
    const attrWidth = itemAttr ? line.length - itemAttr.stripped.length : 0
    return { indent: ordered[1]!.length, ordered: true, raw: ordered[2]!,
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
  return { indent: bullet[1]!.length, ordered: false, raw: undefined,
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
  return isBlockStart(line)
}

function interruptsParagraphAtCursor(cursor: Cursor): boolean {
  const line = cursor.peek()!.text
  if (cursor.owner.kind === 'root' && line[0] === '{' && !parseBlockAttributeRun(line)) {
    const lexer = lexerForCursor(cursor)
    lexer.pos = cursor.at
    if (probeBlockAttributes(lexer)) return true
  }
  if (cursor.owner.kind === 'root' && (line[0] === '`' || line[0] === '~')) {
    const marker = fenceOpen(line)?.marker ?? RE_RAW_FENCE.exec(line)?.[1]
    if (marker && !hasLaterFenceCloser(cursor, marker)) return false
  }
  return interruptsParagraph(line, cursor.owner)
}

function hasLaterFenceCloser(cursor: Cursor, marker: string): boolean {
  if (!cursor.fenceCloserSuffix) {
    const backtick = new Uint32Array(cursor.lines.length + 1)
    const tilde = new Uint32Array(cursor.lines.length + 1)
    for (let i = cursor.lines.length - 1; i >= 0; i--) {
      backtick[i] = backtick[i + 1]!
      tilde[i] = tilde[i + 1]!
      const line = cursor.lines[i]!.text
      const char = line[0]
      if (char !== '`' && char !== '~') continue
      let run = 0
      while (line[run] === char) run++
      if (!/^[ \t]*$/.test(line.slice(run))) continue
      if (char === '`') backtick[i] = Math.max(backtick[i]!, run)
      else tilde[i] = Math.max(tilde[i]!, run)
    }
    cursor.fenceCloserSuffix = { backtick, tilde }
  }
  const runs = marker[0] === '`' ? cursor.fenceCloserSuffix.backtick : cursor.fenceCloserSuffix.tilde
  return runs[cursor.at + 1]! >= marker.length
}

function mayContinueQuoteLazily(follower: string | undefined, innerLast: string | undefined): boolean {
  if (!follower || !innerLast || follower.startsWith('^ ')) return false
  let finalBlock = innerLast.trimStart()
  while (finalBlock.startsWith('>')) {
    finalBlock = finalBlock.slice(finalBlock[1] === ' ' ? 2 : 1).trimStart()
  }
  if (finalBlock === '' || (isBlockStart(finalBlock) && !finalBlock.startsWith(':: '))) return false
  return !interruptsParagraph(follower, ROOT_OWNER)
}

function plainQuoteText(line: string): boolean {
  return /^(?:[\p{L}\p{N}]|\\#)/u.test(line) && !line.includes('\t') && !isBlockStart(line)
}

function nestedQuoteParagraphText(text: string): boolean {
  let inner = text
  while (inner.startsWith('>')) inner = inner.slice(inner[1] === ' ' ? 2 : 1)
  return plainQuoteText(inner)
}

function listContinuationPrefix(line: string, base: number): number {
  let column = base
  while (line[column] === ' ') column++
  const block = line.slice(column)
  return column > base && (block.startsWith('>') || RE_HEADING.test(block)) ? column : base
}

function matchedShiftedFencePrefix(cursor: Cursor, line: string, base: number): number {
  let shifted = base
  while (line[shifted] === ' ') shifted++
  const opener = shifted > base ? fenceOpen(line.slice(shifted)) : null
  if (!opener) return base
  const baseSpaces = ' '.repeat(base)
  const shiftedSpaces = ' '.repeat(shifted)
  for (let i = cursor.at + 1; i < cursor.lines.length; i++) {
    const candidate = cursor.lines[i]!.text
    if (candidate && !candidate.startsWith(baseSpaces)) break
    if (candidate.startsWith(shiftedSpaces) && closesFence(candidate.slice(shifted), opener.marker)) {
      return shifted
    }
  }
  return base
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
  const addRow = (line: SourceLine, isHeader: boolean) => {
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
        column: tableLexer.lineStartColumn(capIndex) + within,
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
      needsCanonicalReader ||= /\|[ \t]*[<^][ \t]*\||\|[ \t]*\{/.test(cursor.peek(row)!.text)
      row++
    }
    return needsCanonicalReader ? parseCanonicalTableWithExistingRules(cursor, inline) :
      parseSimpleTable(cursor, inline)
  }
  const headed = first.text.startsWith('|=')
  if (!first.text.startsWith('|') ||
      (!headed && cursor.at > 0 && cursor.lines[cursor.at - 1]?.text !== '' &&
        (cursor.owner.kind !== 'root' ||
          listMarker(cursor.lines[cursor.at - 1]!.text) !== undefined ||
          cursor.lines[cursor.at - 1]!.text.startsWith('>')))) {
    throw new UnsupportedCursorSyntax('canonical table header')
  }
  const table = parseCanonicalTableWithExistingRules(cursor, inline)
  if (cursor.owner.inList && isBlankLine(cursor.peek()?.text ?? '') &&
      isBlankLine(cursor.peek(1)?.text ?? '') &&
      RE_CAPTION.test(cursor.peek(2)?.text ?? '')) {
    throw new UnsupportedCursorSyntax('list table caption gap')
  }
  if (!headed && cursor.peek()?.text && !isBlockStart(cursor.peek()!.text)) {
    throw new UnsupportedCursorSyntax('data table paragraph follower')
  }
  if (!headed && cursor.peek()?.text === '' &&
      (listMarker(cursor.peek(1)?.text ?? '') || cursor.peek(1)?.text.startsWith('>'))) {
    throw new UnsupportedCursorSyntax('data table container follower')
  }
  return table
}

function parseSimpleDefinitionList(cursor: Cursor, inline: CursorInline,
  commentOpeners: ReadonlySet<number> | undefined): DefinitionList {
  const first = cursor.peek()!
  let end = cursor.at
  let mayWrapDefinition = false
  while (end < cursor.lines.length) {
    const text = cursor.lines[end]!.text
    const term = /^:: +\S.*$/.test(text)
    const definition = /^: +\S.*$/.test(text)
    if (term || definition) {
      if (text !== text.trimEnd()) throw new UnsupportedCursorSyntax('definition list trailing whitespace')
      mayWrapDefinition = definition && !/^: +\+[ \t]*$/.test(text)
      end++
      continue
    }
    if (mayWrapDefinition && /^ {0,3}[A-Za-z0-9]/.test(text) && text === text.trimEnd() &&
        (!cursor.lines[end + 1] || cursor.lines[end + 1]!.text === '')) {
      end++
    } else if (mayWrapDefinition && text === '+' &&
        plainQuoteText(cursor.lines[end + 1]?.text ?? '') &&
        (!cursor.lines[end + 2] || cursor.lines[end + 2]!.text === '')) {
      end += 2
      mayWrapDefinition = false
    }
    break
  }
  if (end === cursor.at || (cursor.lines[end] && cursor.lines[end]!.text !== '' &&
      !commentOpeners?.has(cursor.lines[end]!.start))) {
    throw new UnsupportedCursorSyntax('definition list body')
  }
  let next = end
  while (cursor.lines[next]?.text === '') next++
  const follower = cursor.lines[next]?.text
  if (follower && (/^[ \t+:]/.test(follower) || follower.startsWith('::'))) {
    throw new UnsupportedCursorSyntax('definition list continuation')
  }
  const items: DefinitionItem[] = []
  type CompleteSpans = DefinitionItem & {
    termSpans: Position[]; definitionLines: number[]; definitionSpans: Position[] }
  let current: CompleteSpans | undefined
  let last = first
  while (cursor.at < end) {
    const line = cursor.take()
    const term = /^:: +(\S.*)$/.exec(line.text)
    const definition = /^: +(\S.*)$/.exec(line.text)
    if (term) {
      if (!current || current.definitions.length) {
        current = { terms: [], definitions: [], termSpans: [], definitionLines: [], definitionSpans: [] }
        items.push(current)
      }
      const column = line.text.length - term[1]!.length + 1
      current.terms.push(inline.inlines([{ line, column, text: term[1]! }]))
      current.termSpans.push(position(line, line))
    } else if (definition && current) {
      const column = line.text.length - definition[1]!.length + 1
      const blockBody = isBlockStart(definition[1]!)
      const parts: ContentLine[] = [{ line, column, text: definition[1]! }]
      let definitionLast = line
      if (cursor.at < end && cursor.peek()!.text !== '+' &&
          !/^(?:::|:) +\S/.test(cursor.peek()!.text)) {
        const follower = cursor.take()
        const followerColumn = /^ */.exec(follower.text)![0].length + 1
        parts.push({ line: follower, column: followerColumn,
          text: follower.text.slice(followerColumn - 1) })
        definitionLast = follower
      }
      if (blockBody && parts.length > 1) throw new UnsupportedCursorSyntax('definition block body')
      const blocks = blockBody ? parseBlocks(new Cursor([{
        text: definition[1]!, start: line.start + column - 1,
        number: line.number, baseColumn: (line.baseColumn ?? 1) + column - 1,
      }], undefined, childOwner(cursor.owner, 'colon')), inline, [], 1, false) :
        [{ type: 'paragraph' as const, children: inline.inlines(parts),
          pos: position(line, definitionLast, column) }]
      current.definitions.push(blocks)
      current.definitionLines.push(line.number)
      current.definitionSpans.push(position(line, line))
      last = definitionLast
    } else if (line.text === '+' && current?.definitions.length && cursor.at < end) {
      const follower = cursor.take()
      const paragraph: Paragraph = { type: 'paragraph',
        children: inline.inlines([{ line: follower, column: 1, text: follower.text }]),
        pos: position(follower, follower) }
      current.definitions.at(-1)!.push(paragraph)
      last = follower
    } else throw new UnsupportedCursorSyntax('definition list body')
    if (term) last = line
  }
  return { type: 'definition_list', items, pos: position(first, last) }
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
  return { children: inline.inlines([{ line, column, text: match[1]! }], true), line }
}

function takeQuoteCaption(cursor: Cursor, inline: CursorInline, quote: BlockQuote):
  { children: InlineNode[]; line: SourceLine } | undefined {
  return quote.children.length ? takeCaption(cursor, inline) : undefined
}

function parseParagraphAtCursor(cursor: Cursor, inline: CursorInline): BlockNode {
  const first = cursor.peek()!
  const parts: ContentLine[] = []
  let last = first
  const literalColonOpener = /^:{3,}(?: *\t| +\{)/.test(first.text)
  while (cursor.peek() && !isBlankLine(cursor.peek()!.text) &&
      (parts.length === 0 || (!interruptsParagraphAtCursor(cursor) &&
        !(parts.length === 1 && parts[0]!.text.trim() === '+' && listMarker(cursor.peek()!.text))) ||
        literalColonOpener && /^:{3,}[ \t]*$/.test(cursor.peek()!.text))) {
    if (parts.length === 1 && parts[0]!.text.startsWith('![') && cursor.peek()!.text.startsWith('^ ')) {
      const lead = inline.inlines(parts)
      if (lead.length === 1 && lead[0]?.type === 'image' &&
          imageReferenceResolved(lead[0], inline) &&
          lead[0].pos?.startOffset === parts[0]!.line.start &&
          lead[0].pos?.endOffset === parts[0]!.line.start + parts[0]!.line.text.length) break
    }
    if (parts.length === 1 && parts[0]!.text.startsWith('$$') &&
        RE_CAPTION.test(cursor.peek()!.text)) {
      const lead = inline.inlines(parts)
      if (lead.length === 1 && lead[0]?.type === 'math' && lead[0].display) break
    }
    const line = cursor.take()
    const column = /^[ \t]*/.exec(line.text)![0].length + 1
    parts.push({ line, column, text: line.text.slice(column - 1) })
    last = line
  }
  const paragraph: Paragraph = { type: 'paragraph', children: inline.inlines(parts),
    pos: position(first, last, parts[0]!.column, last.text.replace(/[ \t]+$/, '').length + 1) }
  if (parts.length === 1 && paragraph.children.length === 1 && paragraph.children[0]?.type === 'image') {
    const image = paragraph.children[0]
    const caption = imageReferenceResolved(image, inline) ? takeCaption(cursor, inline) : undefined
    if (caption) return { type: 'figure', target: image,
      caption: caption.children, pos: position(first, caption.line) }
    if (!image.ref && image.pos?.startColumn === 1 &&
        image.pos.endColumn === first.text.length + 1) return image
  }
  if (paragraph.children.length === 1 && paragraph.children[0]?.type === 'math' &&
      paragraph.children[0].display) {
    const caption = takeCaption(cursor, inline)
    if (caption) return { type: 'figure', target: paragraph,
      caption: caption.children, pos: position(first, caption.line) }
  }
  return paragraph
}

function parseRawAtCursor(cursor: Cursor): BlockNode {
  if (cursor.owner.inList && cursor.at === 0) {
    throw new UnsupportedCursorSyntax('marker-line raw block')
  }
  const first = cursor.peek()!
  const lexer = lexerForCursor(cursor)
  lexer.pos = cursor.at
  const raw = parseRawBlock(lexer)
  if (cursor.owner.kind === 'quote' && lexer.pos === cursor.lines.length &&
      cursor.lines.at(-1)?.text === '') {
    throw new UnsupportedCursorSyntax('quote raw block boundary')
  }
  cursor.at = lexer.pos
  raw.pos = position(first, cursor.lines[cursor.at - 1] ?? first)
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
  return block
}

function parseNestedCommentAtCursor(cursor: Cursor, run: number): BlockNode | undefined {
  const lexer = lexerForCursor(cursor)
  lexer.pos = cursor.at
  if (!commentBlockHasCloser(lexer, run)) return undefined
  if (cursor.owner.inList && (cursor.at === 0 || cursor.peek()?.text[0] !== '%')) {
    throw new UnsupportedCursorSyntax('list comment source ownership')
  }
  const first = cursor.peek()!
  const comment = parseCommentBlock(lexer)
  if (cursor.owner.inList && cursor.lines.slice(cursor.at, lexer.pos).some((line) => line.text === '')) {
    throw new UnsupportedCursorSyntax('list comment blank ownership')
  }
  cursor.at = lexer.pos
  comment.pos = position(first, cursor.lines[cursor.at - 1] ?? first)
  return comment
}

function isListGapBlockStart(text: string, body: SourceLine[]): boolean {
  if (ABBR_DEF.test(text)) return false
  if (!RE_CAPTION.test(text)) return isBlockStart(text)
  let only: string | undefined
  for (const line of body) {
    if (line.text === '') continue
    if (only !== undefined) return true
    only = line.text
  }
  return only === undefined || only.startsWith('![') || only.startsWith('$$') || isBlockStart(only)
}

function rejectAmbiguousNestedPlus(marker: ReturnType<typeof listMarker>): void {
  if (marker && marker.indent > 0 && /^\+[ \t]*$/.test(marker.content)) {
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

function rejectBelowColumnMarkerAfterComment(marker: ReturnType<typeof listMarker>,
  frame: { indent: number; contentColumn?: number; body: SourceLine[] }): void {
  if (!marker || frame.contentColumn === undefined) return
  if (marker.indent > frame.indent && marker.indent < frame.contentColumn - 1 &&
      RE_COMMENT_BLOCK_ANY.test(frame.body.at(-1)?.text ?? '')) {
    throw new UnsupportedCursorSyntax('marker after list comment')
  }
}

function rejectListQuoteBoundary(body: SourceLine[], line: SourceLine): void {
  if (body.at(-1)?.text.startsWith('>') &&
      mayContinueQuoteLazily(line.text, body.at(-1)?.text)) {
    throw new UnsupportedCursorSyntax('quote continuation across list boundary')
  }
}

function takeSimpleFirstBlockListPlus(cursor: Cursor, marker: NonNullable<ReturnType<typeof listMarker>>,
  depth: number, contentColumn: number): { line: SourceLine; prefix: number } | undefined {
  if (depth !== 0 || marker.indent !== 0 || marker.content !== '+') return undefined
  const follower = cursor.peek()
  if (!follower) return undefined
  const after = cursor.peek(1)
  const prefix = ' '.repeat(contentColumn - 1)
  const atContentColumn = prefix.length > 0 && follower.text.startsWith(prefix)
  if (!(plainQuoteText(follower.text) ||
      (atContentColumn && plainQuoteText(follower.text.slice(prefix.length))))) return undefined
  if (after && !isBlankLine(after.text) && listMarker(after.text)?.indent !== 0) return undefined
  cursor.take()
  return { line: follower, prefix: atContentColumn ? prefix.length : 0 }
}

function isUnattachedRootFirstBlock(marker: NonNullable<ReturnType<typeof listMarker>>,
  taskWidth: number, next: SourceLine | undefined, depth: number): boolean {
  if (depth !== 0 || marker.indent !== 0 || marker.content.slice(taskWidth) !== '+') return false
  return next === undefined || isBlankLine(next.text) ||
    (listMarker(next.text)?.indent ?? Number.POSITIVE_INFINITY) <= marker.indent
}

function isFenceMarkerContinuation(marker: ReturnType<typeof listMarker>, fenceMarker: string | undefined,
  contentColumn: number | undefined, text: string): boolean {
  return marker !== undefined && fenceMarker !== undefined && contentColumn !== undefined &&
    text.startsWith(' '.repeat(contentColumn - 1))
}

function isTaskMarkerContent(content: string, ordered: boolean): boolean {
  return !ordered && /^\[([ xX_>?-])\] /.test(content)
}

function takeTaskMarker(item: ListItem, content: string, ordered: boolean): number {
  if (ordered) return 0
  const task = /^\[([ xX_>?-])\] /.exec(content)
  if (!task) return 0
  item.checked = task[1]!.toLowerCase() === 'x'
  if (task[1] !== ' ' && task[1]!.toLowerCase() !== 'x') item.taskState = task[1] as TaskState
  return task[0].length
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

function startsNestedListAfterLongBlankRun(blanks: number,
  marker: ReturnType<typeof listMarker>, rootIndent: number): boolean {
  return blanks >= 3 && marker !== undefined && marker.indent > rootIndent
}

function mayFoldNestedListParagraph(cursor: Cursor,
  top: { indent: number; ordered: boolean; delim?: '.' | ')'; bullet?: '-' | '*'; taskList: boolean;
    body: SourceLine[]; fenceMarker: string | undefined }, stackLength: number, depth: number): boolean {
  if (depth !== 0 || stackLength < 2 || top.fenceMarker ||
      !plainQuoteText(cursor.peek()!.text) || !plainQuoteText(top.body.at(-1)?.text ?? '')) return false
  const next = listMarker(cursor.peek(1)?.text ?? '')
  return next !== undefined && next.indent === top.indent && sameListKind(next, top)
}

function isBelowListMarkerColumn(marker: NonNullable<ReturnType<typeof listMarker>>,
  top: { indent: number; contentColumn?: number; fenceMarker: string | undefined; body: SourceLine[] },
  depth: number, lineNumber: number): boolean {
  return depth === 0 && !top.fenceMarker && top.contentColumn !== undefined &&
    marker.indent > top.indent && marker.indent < top.contentColumn - 1 &&
    top.body.at(-1)?.number === lineNumber - 1 && plainQuoteText(top.body.at(-1)?.text ?? '')
}

function markerCannotNestAfterBlank(marker: ReturnType<typeof listMarker>,
  top: { indent: number; contentColumn?: number }): boolean {
  return marker !== undefined && top.contentColumn !== undefined &&
    marker.indent > top.indent && marker.indent < top.contentColumn - 1
}

function updateListFrameEnds(frames: Array<{ last: SourceLine; indent: number;
  item?: ListItem; itemFirst?: SourceLine }>, line: SourceLine,
listSpan: (from: SourceLine, to: SourceLine, column: number) => Position): void {
  for (const frame of frames) {
    frame.last = line
    if (frame.item && frame.itemFirst) frame.item.pos = listSpan(frame.itemFirst, line, frame.indent + 1)
  }
}

function parseList(cursor: Cursor, inline: CursorInline, definitionNodes: BlockNode[], depth: number,
  first: SourceLine, firstMarker: NonNullable<ReturnType<typeof listMarker>>): List {
  const listSpan = (from: SourceLine, to: SourceLine, column: number): Position =>
    position(from, to, depth === 0 && from.baseColumn === undefined &&
      column === firstMarker.indent + 1 ? 1 : column, contentEndColumn(to))
  type Frame = { list: List; first: SourceLine; last: SourceLine; indent: number;
    ordered: boolean; taskList: boolean; kind?: OlKind; delim?: '.' | ')'; bullet?: '-' | '*';
    item?: ListItem; itemFirst?: SourceLine; contentColumn?: number;
    fenceMarker: string | undefined; fencePrefix: number | undefined; body: SourceLine[];
    blankBeforeInvisible: boolean }
  const newFrame = (line: SourceLine, marker: NonNullable<ReturnType<typeof listMarker>>): Frame => {
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
    return { list, first: line, last: line, indent: marker.indent, ordered: marker.ordered,
      taskList: isTaskMarkerContent(marker.content, marker.ordered),
      ...(kind ? { kind } : {}),
      ...(marker.delim ? { delim: marker.delim } : {}),
      ...(marker.bullet ? { bullet: marker.bullet } : {}), fenceMarker: undefined,
      fencePrefix: undefined, body: [], blankBeforeInvisible: false }
  }
  const stack = [newFrame(first, firstMarker)]
  const applyInvisibleTail = (frame: Frame): void => {
    if (frame.blankBeforeInvisible) frame.list.tight = false
    frame.blankBeforeInvisible = false
  }
  const flush = (frame: Frame) => {
    if (!frame.item || !frame.body.length) return
    frame.item.children.push(...parseBlocks(
      new Cursor(frame.body, undefined, childOwner(cursor.owner, 'list')),
      inline, definitionNodes, depth + 1, false))
    frame.body = []
  }
  const appendBody = (frame: Frame, line: SourceLine, prefix: number) => {
    const text = line.text.slice(prefix)
    const previous = frame.body.at(-1)?.text ?? ''
    if (frame.blankBeforeInvisible && text !== '' && !LINE_COMMENT.test(text) &&
        LINE_COMMENT.test(previous) && !RE_COMMENT_BLOCK_ANY.test(previous)) {
      frame.list.tight = false
      frame.blankBeforeInvisible = false
    }
    frame.body.push(prefix === 0 ? line : { text, start: line.start + prefix, number: line.number,
      baseColumn: (line.baseColumn ?? 1) + prefix })
    if (frame.fenceMarker) {
      if (closesFence(text, frame.fenceMarker)) {
        frame.fenceMarker = undefined
        frame.fencePrefix = undefined
      }
    } else {
      const marker = RE_RAW_FENCE.exec(text)?.[1] ?? fenceOpen(text)?.marker
      if (marker) {
        frame.fenceMarker = marker
        frame.fencePrefix = prefix
      }
    }
  }
  while (cursor.peek()) {
    const line = cursor.peek()!
    const marker = listMarker(line.text)
    rejectAmbiguousNestedPlus(marker)
    const top = stack.at(-1)!
    rejectBelowColumnMarkerAfterComment(marker, top)
    if (line.text === '+' && top.item) {
      if (depth !== 0 || top.indent !== 0 || top.fenceMarker) {
        throw new UnsupportedCursorSyntax('nested list continuation')
      }
      const next = cursor.peek(1)
      const after = cursor.peek(2)
      if (!next || next.text === '' || next.text[0] === ' ' || next.text[0] === '\t' ||
          isBlockStart(next.text) ||
          (after && after.text !== '' && !listMarker(after.text))) {
        throw new UnsupportedCursorSyntax('multiline list continuation')
      }
      cursor.take()
      flush(top)
      cursor.take()
      appendBody(top, next, 0)
      top.last = next
      if (top.itemFirst) top.item.pos = listSpan(top.itemFirst, next, top.indent + 1)
      continue
    }
    if (isFenceMarkerContinuation(marker, top.fenceMarker, top.contentColumn, line.text)) {
      cursor.take()
      appendBody(top, line, top.contentColumn! - 1)
      top.last = line
      if (top.item && top.itemFirst) top.item.pos = listSpan(top.itemFirst, line, top.indent + 1)
      continue
    }
    if (marker) {
      if (isBelowListMarkerColumn(marker, top, depth, line.number)) {
        cursor.take()
        appendBody(top, line, 0)
        updateListFrameEnds(stack, line, listSpan)
        continue
      }
      if (marker.indent < firstMarker.indent) break
      if (marker.indent > top.indent && top.contentColumn !== undefined &&
          top.body.length > 0 && listMarker(top.body[0]!.text) &&
          line.text.startsWith(' '.repeat(top.contentColumn - 1))) {
        cursor.take()
        appendBody(top, line, top.contentColumn - 1)
        top.last = line
        if (top.item && top.itemFirst) top.item.pos = listSpan(top.itemFirst, line, top.indent + 1)
        continue
      }
      while (stack.length > 1 && marker.indent < stack.at(-1)!.indent) {
        const done = stack.pop()!
        flush(done)
        done.list.pos = listSpan(done.first, done.last, done.indent + 1)
      }
      const host = stack.at(-1)!
      if (marker.indent > host.indent) {
        if (!host.item) break
        flush(host)
        const nested = newFrame(line, marker)
        host.item.children.push(nested.list)
        stack.push(nested)
      } else if (!sameListKind(marker, host)) {
        break
      }
      const current = stack.at(-1)!
      applyInvisibleTail(current)
      flush(current)
      cursor.take()
      const item: ListItem = { type: 'list_item', children: [], pos: listSpan(line, line, marker.indent + 1) }
      const taskWidth = takeTaskMarker(item, marker.content, marker.ordered)
      if ('attrs' in marker) item.attrs = marker.attrs
      current.list.items.push(item)
      current.item = item
      current.itemFirst = line
      current.contentColumn = ('continuationWidth' in marker ? marker.continuationWidth : marker.width) + 1
      current.body = []
      current.fenceMarker = undefined
      current.fencePrefix = undefined
      appendBody(current, line, marker.width + taskWidth)
      const firstBlock = takeSimpleFirstBlockListPlus(cursor, marker, depth, current.contentColumn)
      const refusedFirstBlock = !firstBlock && isUnattachedRootFirstBlock(marker, taskWidth, cursor.peek(), depth)
      const spanLine = refusedFirstBlock ? { ...line, spanEndColumn: marker.width + 1 } : line
      if (refusedFirstBlock) current.body = []
      if (firstBlock) {
        current.body = []
        appendBody(current, firstBlock.line, firstBlock.prefix)
        current.last = firstBlock.line
        item.pos = listSpan(line, firstBlock.line, marker.indent + 1)
      }
      updateListFrameEnds(stack, firstBlock?.line ?? spanLine, listSpan)
      continue
    }
    if (line.text === '') {
      let blanks = 0
      while (cursor.peek(blanks)?.text === '') blanks++
      const next = cursor.peek(blanks)!
      if (top.fenceMarker && next && top.contentColumn !== undefined &&
          next.text.startsWith(' '.repeat(top.contentColumn - 1))) {
        for (let i = 0; i < blanks; i++) appendBody(top, cursor.take(), 0)
        continue
      }
      if (endsListBlankRun(blanks, next, firstMarker.indent)) break
      const nextMarker = listMarker(next.text)
      if (markerCannotNestAfterBlank(nextMarker, top)) break
      if (startsNestedListAfterLongBlankRun(blanks, nextMarker, firstMarker.indent)) {
        while (stack.length > 1) {
          const done = stack.pop()!
          flush(done)
          done.list.pos = listSpan(done.first, done.last, done.indent + 1)
        }
        for (let i = 0; i < blanks; i++) cursor.take()
        continue
      }
      const target = nextMarker && stack.find((frame) => frame.indent === nextMarker.indent)
      const sibling = nextMarker && target && sameListKind(nextMarker, target)
      const nested = nextMarker && nextMarker.indent > top.indent
      const continuationFrame = !nextMarker ? [...stack].reverse().find((frame) =>
        frame.contentColumn !== undefined &&
        next.text.startsWith(' '.repeat(frame.contentColumn - 1))) : undefined
      rejectRaisedColonContinuation(next.text, continuationFrame)
      if (!sibling && !nested && !continuationFrame) break
      for (let i = 0; i < blanks; i++) cursor.take()
      if (continuationFrame) {
        while (stack.at(-1) !== continuationFrame) {
          const done = stack.pop()!
          flush(done)
          done.list.pos = listSpan(done.first, done.last, done.indent + 1)
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
        let blockText = next.text.slice(listContinuationPrefix(next.text, prefixLength))
        while (parseBlockAttributeRun(blockText)) {
          lookahead++
          const following = cursor.peek(lookahead)
          if (!following?.text.startsWith(' '.repeat(prefixLength))) break
          blockText = following.text.slice(listContinuationPrefix(following.text, prefixLength))
        }
        if (LINE_COMMENT.test(blockText)) continuationFrame.blankBeforeInvisible = true
        if (!nestedContinuation && !isListGapBlockStart(blockText, continuationFrame.body)) {
          continuationFrame.list.tight = false
        }
      } else if (sibling) target.list.tight = false
      continue
    }
    const contentColumn = top.contentColumn
    if (contentColumn === undefined) break
    const prefix = ' '.repeat(contentColumn - 1)
    if (mayFoldNestedListParagraph(cursor, top, stack.length, depth)) {
      cursor.take()
      appendBody(top, line, 0)
      updateListFrameEnds(stack, line, listSpan)
      continue
    }
    if (!line.text.startsWith(prefix)) {
      rejectListQuoteBoundary(top.body, line)
      break
    }
    let bodyPrefix = prefix.length
    if (top.fenceMarker && top.fencePrefix !== undefined && top.fencePrefix > bodyPrefix) {
      if (!line.text.startsWith(' '.repeat(top.fencePrefix))) {
        throw new UnsupportedCursorSyntax('shifted fence continuation')
      }
      bodyPrefix = top.fencePrefix
    } else if (!top.fenceMarker && line.text[bodyPrefix] === ' ' && stack.length === 1 &&
        !listMarker(top.body[0]?.text ?? '')) {
      bodyPrefix = matchedShiftedFencePrefix(cursor, line.text, bodyPrefix)
    }
    cursor.take()
    appendBody(top, line, bodyPrefix === prefix.length && !top.fenceMarker ?
      listContinuationPrefix(line.text, bodyPrefix) : bodyPrefix)
    updateListFrameEnds(stack, line, listSpan)
  }
  for (let i = stack.length - 1; i >= 0; i--) {
    const frame = stack[i]!
    flush(frame)
    frame.list.pos = listSpan(frame.first, frame.last, frame.indent + 1)
  }
  return stack[0]!.list
}

function parseQuote(cursor: Cursor, inline: CursorInline, definitionNodes: BlockNode[], depth: number): BlockQuote {
  const first = cursor.peek()!
  if (first.text === '> +' && depth === 0) {
    const follower = cursor.peek(1)
    const after = cursor.peek(2)
    if (follower && plainQuoteText(follower.text) &&
        (!after || isBlankLine(after.text))) {
      cursor.take()
      cursor.take()
      return { type: 'block_quote',
        children: parseBlocks(new Cursor([follower], undefined, childOwner(cursor.owner, 'quote')),
          inline, definitionNodes, depth + 1, false),
        pos: position(first, follower, 1, contentEndColumn(follower)) }
    }
  }
  const body: SourceLine[] = []
  let last = first
  let plainParagraph = true
  while (cursor.peek()) {
    const line = cursor.peek()!
    if (line.text[0] === '>' && RE_BLOCKQUOTE.test(line.text)) {
      cursor.take()
      const prefix = line.text.startsWith('> ') ? 2 : 1
      const text = line.text.slice(prefix)
      body.push({ text, start: line.start + prefix,
        number: line.number, baseColumn: (line.baseColumn ?? 1) + prefix })
      plainParagraph &&= nestedQuoteParagraphText(text)
      last = line
      continue
    }
    if (!cursor.owner.inList && plainParagraph &&
        (plainQuoteText(line.text) || listMarker(line.text)) &&
        mayContinueQuoteLazily(line.text, body.at(-1)?.text)) {
      body.push(cursor.take())
      last = line
      continue
    }
    break
  }
  if (body.at(-1)?.text.trim() === '+' && cursor.peek()?.text.startsWith('|')) {
    throw new UnsupportedCursorSyntax('quote continuation into table')
  }
  if (mayContinueQuoteLazily(cursor.peek()?.text, body.at(-1)?.text)) {
    throw new UnsupportedCursorSyntax('lazy quote continuation')
  }
  return { type: 'block_quote',
    children: parseBlocks(new Cursor(body, undefined, childOwner(cursor.owner, 'quote')),
      inline, definitionNodes, depth + 1, false),
    pos: position(first, last, 1, contentEndColumn(last)) }
}

function takeColonBody(cursor: Cursor, openerLength: number): SourceLine[] {
  const body: SourceLine[] = []
  const closer = new RegExp(`^:{${openerLength}}[ \t]*$`)
  const nestedClosers: RegExp[] = []
  while (cursor.peek()) {
    const text = cursor.peek()!.text
    if ((nestedClosers.at(-1) ?? closer).test(text)) {
      if (nestedClosers.length === 0) break
      nestedClosers.pop()
      body.push(cursor.take())
      continue
    }
    const nested = COLON_OPEN.exec(text) ?? RE_LINE_BLOCK_OPEN.exec(text)
    if (nested) {
      if (nested[2] === 'figure' || nested[2] === 'list-table') {
        throw new UnsupportedCursorSyntax('nested specialized colon container')
      }
      nestedClosers.push(new RegExp(`^:{${nested[1]!.length}}[ \t]*$`))
    } else if (text.startsWith(':::')) throw new UnsupportedCursorSyntax('nested colon container')
    body.push(cursor.take())
  }
  if (!cursor.peek() && body.some((line) => RE_FENCE.test(line.text))) {
    throw new UnsupportedCursorSyntax('unclosed colon literal ownership')
  }
  return body
}

function takeFenceCloseAtCursor(cursor: Cursor, first: SourceLine, payload: SourceLine[]): SourceLine {
  if (cursor.peek()) return cursor.take()
  if (cursor.owner.kind === 'root' && /^(?:`{3,}|~{3,})$/.test(first.text) &&
      (first.number === 1 || isBlankLine(cursor.lines[first.number - 2]?.text))) {
    return payload.at(-1) ?? first
  }
  throw new UnsupportedCursorSyntax('unclosed fence')
}

function takeSimpleFootnote(cursor: Cursor, inline: CursorInline, first: SourceLine,
  footnote: RegExpExecArray, footnoteDefs: Record<string, BlockNode[]> | undefined,
  footnoteDefPos: Record<string, Position> | undefined): void {
  let nextIndex = 1
  while (cursor.peek(nextIndex)?.text === '') nextIndex++
  const next = cursor.peek(nextIndex)?.text
  const hasBodyLine = next?.startsWith('  ') || next?.startsWith('\t')
  const separated = hasBodyLine && nextIndex === 2
  let bodyLength = 0
  if (hasBodyLine) {
    while (cursor.peek(nextIndex + bodyLength)?.text.startsWith('  ') &&
      plainQuoteText(cursor.peek(nextIndex + bodyLength)!.text.slice(2))) bodyLength++
  }
  if (!footnote[2] || (footnote[2] !== '{empty}' && isBlockStart(footnote[2])) ||
      (hasBodyLine && (nextIndex > 2 || footnote[2] === '{empty}' ||
      bodyLength === 0 ||
      (cursor.peek(nextIndex + bodyLength) && cursor.peek(nextIndex + bodyLength)!.text !== '')))) {
    throw new UnsupportedCursorSyntax('nested or multiline footnote definition')
  }
  cursor.take()
  if (separated) cursor.take()
  const continuation: SourceLine[] = []
  for (let i = 0; i < bodyLength; i++) continuation.push(cursor.take())
  const plusFollower = cursor.peek()?.text === '+' ? cursor.peek(1) : undefined
  if (footnote[2] === '{empty}' && plusFollower) {
    throw new UnsupportedCursorSyntax('empty footnote continuation')
  }
  const attached = plusFollower && plainQuoteText(plusFollower.text) &&
    (!cursor.peek(2) || isBlankLine(cursor.peek(2)!.text)) ? plusFollower : undefined
  if (attached) { cursor.take(); cursor.take() }
  const label = footnote[1]!
  if (!footnoteDefs || !footnoteDefPos || Object.hasOwn(footnoteDefs, label)) return
  const bodyIndent = /^[ \t]*/.exec(footnote[2]!)![0].length
  const column = first.text.length - footnote[2]!.length + bodyIndent + 1
  const parts: ContentLine[] = [{ line: first, column, text: footnote[2]!.slice(bodyIndent) }]
  if (!separated) for (const line of continuation) {
    parts.push({ line, column: 3, text: line.text.slice(2) })
  }
  const bodyLast = continuation.at(-1) ?? first
  const last = attached ?? bodyLast
  const body: Paragraph = { type: 'paragraph', children: inline.inlines(parts),
    pos: position(first, separated ? first : bodyLast, column) }
  const separateBody: Paragraph | undefined = separated && continuation.length ? { type: 'paragraph',
    children: inline.inlines(continuation.map((line) => ({ line, column: 3, text: line.text.slice(2) }))),
    pos: position(continuation[0]!, continuation.at(-1)!, 3) } : undefined
  const attachedBody: Paragraph | undefined = attached ? { type: 'paragraph',
    children: inline.inlines([{ line: attached, column: 1, text: attached.text }]),
    pos: position(attached, attached) } : undefined
  Object.defineProperty(footnoteDefs, label, { value: footnote[2] === '{empty}' ? [] :
    attachedBody ? separateBody ? [body, separateBody, attachedBody] : [body, attachedBody] :
      separateBody ? [body, separateBody] : [body],
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
  const body = takeColonBody(cursor, sigil.width)
  const close = cursor.peek() ? cursor.take() : body.at(-1) ?? first
  const inner = parseBlocks(new Cursor(body, undefined, childOwner(cursor.owner,
    sigil.kind === 'quote' ? 'quote' : 'colon')), inline, definitionNodes, depth + 1, false)
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
  if (!atDocumentLevel) return null
  const lexer = lexerForCursor(cursor)
  lexer.pos = cursor.at
  const wrapped = probeBlockAttributes(lexer)
  if (!wrapped) return null
  for (let i = 0; i < wrapped.count; i++) cursor.take()
  return wrapped.attrs
}

function parseBlocks(cursor: Cursor, inline: CursorInline, definitionNodes: BlockNode[],
  depth = 0, atDocumentLevel = true, footnoteDefs?: Record<string, BlockNode[]>,
  footnoteDefPos?: Record<string, Position>, commentOpeners?: Set<number>,
  colonDepth = 0): BlockNode[] {
  if (depth >= MAX_NESTING_DEPTH) throw new UnsupportedCursorSyntax('container nesting limit')
  const children: BlockNode[] = []
  let pendingAttrs: Attrs | null = null
  const emit = (input: BlockNode) => {
    let node = input
    if (node.type !== 'comment' && node.type !== 'abbreviation_def' && pendingAttrs) {
      node.attrs = mergeAttrs(pendingAttrs, node.attrs ?? {})
      pendingAttrs = null
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
    if (isBlankLine(first.text)) { cursor.take(); continue }
    const attrs = takeBlockAttrsAtCursor(cursor, atDocumentLevel)
    if (attrs) {
      pendingAttrs = pendingAttrs ? mergeAttrs(pendingAttrs, attrs) : attrs
      continue
    }
    const footnote = FOOTNOTE_DEF.exec(first.text)
    if (footnote) {
      if (!atDocumentLevel) {
        throw new UnsupportedCursorSyntax('nested or multiline footnote definition')
      }
      takeSimpleFootnote(cursor, inline, first, footnote, footnoteDefs, footnoteDefPos)
      continue
    }
    const definition = rootLinkDef(first.text)
    if (definition) {
      if (!atDocumentLevel) throw new UnsupportedCursorSyntax('nested link definition')
      cursor.take()
      if (inline.linkDefinitions.get(normalizeRefLabel(definition.label))?.line === first.number - 1) {
        definitionNodes.push({ type: 'link_reference_definition', label: definition.label, href: definition.href,
          ...(definition.title !== undefined ? { title: unescapeAttrValue(definition.title) } : {}),
          ...(definition.attrText !== null ? { attrs: parseAttrs(definition.attrText) } : {}),
          pos: position(first, first) })
      }
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
      if ((!atDocumentLevel || children.at(-1)?.type === 'list') &&
          first.text.trimStart().startsWith('%%%')) {
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
      emit(parseRawAtCursor(cursor))
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
      const close = takeFenceCloseAtCursor(cursor, first, payloadLines)
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
      emit(parseList(cursor, inline, definitionNodes, depth, first, firstMarker))
      continue
    }
    const sigilFence = matchSigilFence(first.text)
    if (sigilFence) {
      emit(parseSigilFence(cursor, inline, definitionNodes, depth, sigilFence))
      continue
    }
    const simpleColon = COLON_OPEN.exec(first.text)
    const colon = simpleColon ??
      (first.text.includes('\t') ? RE_ADMONITION_OPEN.exec(first.text) : null)
    if (colon) {
      if ((!atDocumentLevel && colonDepth === 0 && cursor.owner.kind !== 'quote') ||
          colon[2] === 'figure' || colon[2] === 'list-table' || colon[2] === 'references') {
        throw new UnsupportedCursorSyntax('nested or specialized colon container')
      }
      cursor.take()
      const body = takeColonBody(cursor, colon[1]!.length)
      if (colon[2] === undefined && body.some((line) => ABBR_DEF.test(line.text))) {
        throw new UnsupportedCursorSyntax('abbreviation inside bare container')
      }
      const close = cursor.peek() ? cursor.take() : body.at(-1) ?? first
      const children = parseBlocks(new Cursor(body, undefined, childOwner(cursor.owner, 'colon')),
        inline, definitionNodes, depth + 1, false,
        undefined, undefined, undefined, colonDepth + 1)
      const kind = colon[2]
      const pos = position(first, close)
      if (colon[3] && kind === undefined) throw new UnsupportedCursorSyntax('bare div title')
      if (colon[4] && kind && GENERATED_CONTENT_KINDS.has(kind)) {
        throw new UnsupportedCursorSyntax('directive label')
      }
      const titleText = simpleColon ? colon[3] : colon[3]?.slice(1, -1)
      const title = titleText ? inline.inlines([{ line: first,
        column: first.text.indexOf('"') + 2, text: titleText }]) : undefined
      const label = simpleColon ? colon[4] : colon[4]?.slice(1, -1)
      const node: BlockNode = kind === undefined ? { type: 'div', children,
        ...(label ? { label } : {}), pos } :
        GENERATED_CONTENT_KINDS.has(kind) ?
          { type: 'directive', kind, children, ...(title ? { title } : {}), pos } :
          { type: 'admonition', kind, children, ...(title ? { title } : {}),
            ...(label ? { label } : {}), pos }
      emit(node)
      continue
    }
    if (/^:: +\S/.test(first.text) && atDocumentLevel) {
      emit(parseSimpleDefinitionList(cursor, inline, commentOpeners))
      continue
    }
    if (/^::[ \t]*$/.test(first.text)) {
      emit(parseParagraphAtCursor(cursor, inline))
      continue
    }
    if (/^(?::::|::)/.test(first.text) && !/^:{3,}(?: *\t| +\{)/.test(first.text)) {
      throw new UnsupportedCursorSyntax(`block at line ${first.number}`)
    }
    emit(parseParagraphAtCursor(cursor, inline))
  }
  return children
}

export function parseCursorPrototype(source: string, opts: ParseOptions = {}): Document {
  if (opts.extensions?.length || opts.onUnclosedContainer || opts.onUnclosedCodeFence ||
      opts.onRefusedContinuationMarker || opts.onInvalidContainerMetadata ||
      opts.onDanglingBlockAttributes) {
    throw new UnsupportedCursorSyntax('parser options and callbacks are not migrated')
  }
  const rawSource = source
  const rawByteLength = utf8ByteLength(source)
  const strippedBom = source.charCodeAt(0) === 0xfeff
  if (strippedBom) source = source.slice(1)
  if (source.includes('\0')) source = source.replace(/\0/g, '�')
  source = replaceLoneSurrogates(source)
  const lines = scanLines(source)
  if (strippedBom) for (let i = 0; i < lines.length; i++) {
    lines[i]!.start++
    if (i === 0) lines[i]!.baseColumn = 2
  }
  const cursor = new Cursor(lines, source)
  const commentOpeners = source.includes('%%%') ? commentOpenersWithCloser(cursor.lines) : new Set<number>()
  const linkDefinitions = new Map<string, LinkDef>()
  const abbreviations = new Map<string, string>()
  let openFence: string | undefined
  let openComment: number | undefined
  for (const line of cursor.lines) {
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
    if (fence) { openFence = fence.marker; continue }
    const comment = RE_COMMENT_BLOCK_ANY.exec(line.text)
    if (comment && commentOpeners.has(line.start)) {
      openComment = comment[1]!.length
      continue
    }
    const match = rootLinkDef(line.text)
    if (match) linkDefinitions.set(normalizeRefLabel(match.label),
      { rawLabel: match.label, line: line.number - 1, href: match.href,
        ...(match.title !== undefined ? { title: unescapeAttrValue(match.title) } : {}),
        ...(match.attrText !== null ? { attrs: parseAttrs(match.attrText) } : {}) })
    const abbr = ABBR_DEF.exec(line.text)
    if (abbr) abbreviations.set(abbr[1]!, dropTrailingWhitespace(abbr[2]!))
  }
  const inline = new CursorInline(linkDefinitions, abbreviations)
  const definitionNodes: BlockNode[] = []
  const footnoteDefs: Record<string, BlockNode[]> = {}
  const footnoteDefPos: Record<string, Position> = {}
  let frontmatter: Document['frontmatter']
  if (source.startsWith('---')) {
    const lexer = lexerForCursor(cursor)
    lexer.defaultFrontmatterFormat = opts.defaultFrontmatterFormat ?? 'yaml'
    lexer.consumeFrontmatter()
    cursor.at = lexer.pos
    frontmatter = lexer.frontmatter
  }
  const children = parseBlocks(cursor, inline, definitionNodes, 0, true, footnoteDefs, footnoteDefPos,
    commentOpeners)
  const document: Document = { type: 'document', children, srcByteLength: rawByteLength }
  if (Object.keys(footnoteDefs).length) {
    document.footnoteDefs = footnoteDefs
    document.footnoteDefPos = footnoteDefPos
  }
  if (frontmatter) document.frontmatter = frontmatter
  children.push(...definitionNodes)
  if (opts.positions !== false) toCodepointPositions(document, rawSource)
  if (inline.hasLeadingImage) promoteBlockImages(children, true)
  document.children = promoteCitationDefinitions(children)
  return opts.positions === false ? dropPositions(document) : document
}
