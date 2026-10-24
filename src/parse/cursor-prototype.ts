import type { Attrs, BlockNode, BlockQuote, CodeBlock, DefinitionItem, DefinitionList, Document, HeadingLevel, InlineNode, List, ListItem, Paragraph, Position, Table, TableRow } from '../ast.js'
import type { InlineSource } from '../parse.js'
import { GENERATED_CONTENT_KINDS } from '../ast.js'
import { utf8ByteLength } from '../extension/abbr-budget.js'
import { toCodepointPositions } from '../source/source-positions.js'
import { normalizeRefLabel } from '../label-key.js'
import { promoteBlockImages } from '../heading/heading-ids.js'
import { promoteCitationDefinitions } from '../extension/citations.js'
import { mergeAttrs } from '../extension/attribute-merge.js'
import { dropTrailingWhitespace, readCaptionText } from './block/parse-block-boundaries.js'
import { MAX_NESTING_DEPTH, commentLineContent } from './block/parse-block-scan-core.js'
import { RE_CAPTION, RE_COMMENT_BLOCK_ANY } from './block/parse-quote-core.js'
import { trimNonNbsp } from '../trim-non-nbsp.js'
import { InlineParseSession } from './inline/parse-inline-session.js'
import { inlineSource } from './inline/parse-inline-core.js'
import type { LinkDef } from './inline/inline-resolution.js'
import { olKindOf, olStartOf, type OlKind } from './list/parse-item-core.js'
import { RE_FENCE, RE_HEADING, RE_LINE_BLOCK_OPEN, RE_ORDERED, RE_RAW_FENCE, consumeLooseKey, deriveTableMetadata, extractItemAttr, parseBlockAttributeRun } from './parse-prepass-core.js'
import { Lexer } from './parse-lexer.js'
import { commentBlockHasCloser, parseCommentBlock, parseLineBlockWithHelpers, parseRawBlock, parseTableBlock } from './parse-core.js'
import { delimitedTable, setDelimitedPayloadLines } from '../table/delimited-table.js'

/**
 * An isolated block-cursor experiment. It deliberately fails on syntax that has
 * not been migrated; production entry points never invoke it.
 */
export class UnsupportedCursorSyntax extends Error {}

interface SourceLine { text: string; start: number; number: number; baseColumn?: number }
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
  constructor(readonly lines: SourceLine[], readonly rootSource?: string,
    readonly owner: ContainerOwner = ROOT_OWNER) {}
  peek(n = 0): SourceLine | undefined { return this.lines[this.at + n] }
  take(): SourceLine { return this.lines[this.at++]! }
}

function lexerForCursor(cursor: Cursor): Lexer {
  if (cursor.sharedLexer) return cursor.sharedLexer
  const lexer = cursor.rootSource ? new Lexer(cursor.rootSource) :
    new Lexer(cursor.lines.map((line) => line.text))
  if (!cursor.rootSource) {
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
    if (source.charCodeAt(i) !== 10) continue
    lines.push({ text: source.slice(start, i), start, number: lines.length + 1 })
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
const COLON_OPEN = /^(:{3,})(?: +([A-Za-z0-9][A-Za-z0-9_-]*))?(?: +"([^"]+)")?(?: *\[([A-Za-z0-9_/-]+)\])?[ \t]*$/
const BREAK = /^(?:-{3,}|\*{3,}|_{3,})[ \t]*$/
const LINK_DEF = /^\[(?!\^)([^\]]+)\]: +(\S+)[ \t]*$/
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
  const bullet = BULLET.exec(line)
  if (!bullet) return undefined
  return { indent: bullet[1]!.length, ordered: false, raw: undefined,
    delim: undefined, bullet: bullet[2] as '-' | '*',
    width: bullet[0].length - bullet[3]!.length, content: bullet[3]! }
}

function isBlockStart(line: string): boolean {
  return (line[0] === '#' && RE_HEADING.test(line)) ||
    ((line[0] === '`' || line[0] === '~') && RE_FENCE.test(line)) ||
    RE_RAW_FENCE.test(line) ||
    BREAK.test(line) || !!listMarker(line) ||
    line.startsWith('>') || line.startsWith('|') || line.startsWith('::') ||
    LINK_DEF.test(line) || FOOTNOTE_DEF.test(line) || ABBR_DEF.test(line) || LINE_COMMENT.test(line) ||
    (line.startsWith('{') && parseBlockAttributeRun(line) !== null)
}

function mayContinueQuoteLazily(follower: string | undefined, innerLast: string | undefined): boolean {
  if (!follower || !innerLast || follower.startsWith('^ ')) return false
  let finalBlock = innerLast.trimStart()
  while (finalBlock.startsWith('>')) {
    finalBlock = finalBlock.slice(finalBlock[1] === ' ' ? 2 : 1).trimStart()
  }
  if (finalBlock === '' || (isBlockStart(finalBlock) && !finalBlock.startsWith(':: '))) return false
  return !isBlockStart(follower)
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
  if (cursor.owner.inList) throw new UnsupportedCursorSyntax('list table source mapping')
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
  const gfm = second?.startsWith('|') && /^\|(?:[ \t]*:?-{3,}:?[ \t]*\|)+$/.test(second)
  if (gfm) return parseSimpleTable(cursor, inline)
  const headed = first.text.startsWith('|=')
  if (!first.text.startsWith('|') ||
      (!headed && cursor.at > 0 && cursor.lines[cursor.at - 1]?.text !== '')) {
    throw new UnsupportedCursorSyntax('canonical table header')
  }
  const table = parseCanonicalTableWithExistingRules(cursor, inline)
  if (!headed && cursor.peek()?.text && !isBlockStart(cursor.peek()!.text)) {
    throw new UnsupportedCursorSyntax('data table paragraph follower')
  }
  if (!headed && cursor.peek()?.text === '' &&
      (listMarker(cursor.peek(1)?.text ?? '') || cursor.peek(1)?.text.startsWith('>'))) {
    throw new UnsupportedCursorSyntax('data table container follower')
  }
  return table
}

function parseSimpleDefinitionList(cursor: Cursor, inline: CursorInline): DefinitionList {
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
    }
    break
  }
  if (end === cursor.at || (cursor.lines[end] && cursor.lines[end]!.text !== '')) {
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
      if (isBlockStart(definition[1]!)) throw new UnsupportedCursorSyntax('definition block body')
      const parts: ContentLine[] = [{ line, column, text: definition[1]! }]
      let definitionLast = line
      if (cursor.at < end && !/^(?:::|:) +\S/.test(cursor.peek()!.text)) {
        const follower = cursor.take()
        const followerColumn = /^ */.exec(follower.text)![0].length + 1
        parts.push({ line: follower, column: followerColumn,
          text: follower.text.slice(followerColumn - 1) })
        definitionLast = follower
      }
      current.definitions.push([{ type: 'paragraph',
        children: inline.inlines(parts),
        pos: position(line, definitionLast, column) }])
      current.definitionLines.push(line.number)
      current.definitionSpans.push(position(line, line))
      last = definitionLast
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
  while (cursor.peek() && cursor.peek()!.text !== '' &&
      (parts.length === 0 || !isBlockStart(cursor.peek()!.text))) {
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
  if (cursor.owner.inList) throw new UnsupportedCursorSyntax('list comment source ownership')
  const first = cursor.peek()!
  const comment = parseCommentBlock(lexer)
  cursor.at = lexer.pos
  comment.pos = position(first, cursor.lines[cursor.at - 1] ?? first)
  return comment
}

function isListGapBlockStart(text: string, body: SourceLine[]): boolean {
  if (!RE_CAPTION.test(text)) return isBlockStart(text)
  let only: string | undefined
  for (const line of body) {
    if (line.text === '') continue
    if (only !== undefined) return true
    only = line.text
  }
  return only === undefined || only.startsWith('![') || only.startsWith('$$') || isBlockStart(only)
}

function parseList(cursor: Cursor, inline: CursorInline, definitionNodes: BlockNode[], depth: number,
  first: SourceLine, firstMarker: NonNullable<ReturnType<typeof listMarker>>): List {
  type Frame = { list: List; first: SourceLine; last: SourceLine; indent: number;
    ordered: boolean; kind?: OlKind; delim?: '.' | ')'; bullet?: '-' | '*';
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
    frame.body.push({ text, start: line.start + prefix, number: line.number,
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
    const top = stack.at(-1)!
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
      if (top.itemFirst) top.item.pos = position(top.itemFirst, next, top.indent + 1)
      continue
    }
    if (marker && top.fenceMarker && top.contentColumn !== undefined &&
        line.text.startsWith(' '.repeat(top.contentColumn - 1))) {
      cursor.take()
      appendBody(top, line, top.contentColumn - 1)
      top.last = line
      if (top.item && top.itemFirst) top.item.pos = position(top.itemFirst, line, top.indent + 1)
      continue
    }
    if (marker) {
      if (marker.indent < firstMarker.indent) break
      if (marker.indent > top.indent && top.contentColumn !== undefined &&
          top.body.length > 0 && listMarker(top.body[0]!.text) &&
          line.text.startsWith(' '.repeat(top.contentColumn - 1))) {
        cursor.take()
        appendBody(top, line, top.contentColumn - 1)
        top.last = line
        if (top.item && top.itemFirst) top.item.pos = position(top.itemFirst, line, top.indent + 1)
        continue
      }
      while (stack.length > 1 && marker.indent < stack.at(-1)!.indent) {
        const done = stack.pop()!
        flush(done)
        done.list.pos = position(done.first, done.last, done.indent + 1)
      }
      const host = stack.at(-1)!
      if (marker.indent > host.indent) {
        if (!host.item) break
        flush(host)
        const nested = newFrame(line, marker)
        host.item.children.push(nested.list)
        stack.push(nested)
      } else if (marker.ordered !== host.ordered || marker.delim !== host.delim || marker.bullet !== host.bullet) {
        break
      }
      const current = stack.at(-1)!
      applyInvisibleTail(current)
      flush(current)
      cursor.take()
      const item: ListItem = { type: 'list_item', children: [], pos: position(line, line, marker.indent + 1) }
      const task = /^\[([ xX-])\] /.exec(marker.content)
      if (task) {
        item.checked = task[1]!.toLowerCase() === 'x'
        if (task[1] === '-') item.taskState = '-'
      }
      if ('attrs' in marker) item.attrs = marker.attrs
      current.list.items.push(item)
      current.item = item
      current.itemFirst = line
      current.contentColumn = ('continuationWidth' in marker ? marker.continuationWidth : marker.width) + 1
      current.body = []
      current.fenceMarker = undefined
      current.fencePrefix = undefined
      appendBody(current, line, marker.width + (task ? task[0].length : 0))
      for (const frame of stack) {
        frame.last = line
        if (frame.item && frame.itemFirst) frame.item.pos = position(frame.itemFirst, line, frame.indent + 1)
      }
      continue
    }
    if (line.text === '') {
      let blanks = 0
      while (cursor.peek(blanks)?.text === '') blanks++
      const next = cursor.peek(blanks)
      if (top.fenceMarker && next && top.contentColumn !== undefined &&
          next.text.startsWith(' '.repeat(top.contentColumn - 1))) {
        for (let i = 0; i < blanks; i++) appendBody(top, cursor.take(), 0)
        continue
      }
      if (blanks >= 3 || !next) break
      const nextMarker = listMarker(next.text)
      const target = nextMarker && stack.find((frame) => frame.indent === nextMarker.indent)
      const sibling = nextMarker && target && nextMarker.ordered === target.ordered &&
        nextMarker.delim === target.delim && nextMarker.bullet === target.bullet
      const nested = nextMarker && nextMarker.indent > top.indent
      const continuationFrame = !nextMarker ? [...stack].reverse().find((frame) =>
        frame.contentColumn !== undefined &&
        next.text.startsWith(' '.repeat(frame.contentColumn - 1))) : undefined
      if (!sibling && !nested && !continuationFrame) break
      for (let i = 0; i < blanks; i++) cursor.take()
      if (continuationFrame) {
        while (stack.at(-1) !== continuationFrame) {
          const done = stack.pop()!
          flush(done)
          done.list.pos = position(done.first, done.last, done.indent + 1)
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
    if (!line.text.startsWith(prefix)) break
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
    for (const frame of stack) {
      frame.last = line
      if (frame.item && frame.itemFirst) frame.item.pos = position(frame.itemFirst, line, frame.indent + 1)
    }
  }
  for (let i = stack.length - 1; i >= 0; i--) {
    const frame = stack[i]!
    flush(frame)
    frame.list.pos = position(frame.first, frame.last, frame.indent + 1)
  }
  return stack[0]!.list
}

function parseQuote(cursor: Cursor, inline: CursorInline, definitionNodes: BlockNode[], depth: number): BlockQuote {
  const first = cursor.peek()!
  const body: SourceLine[] = []
  let last = first
  let plainParagraph = true
  while (cursor.peek()) {
    const line = cursor.peek()!
    if (line.text.startsWith('>')) {
      cursor.take()
      const prefix = line.text.startsWith('> ') ? 2 : 1
      const text = line.text.slice(prefix)
      body.push({ text, start: line.start + prefix,
        number: line.number, baseColumn: (line.baseColumn ?? 1) + prefix })
      plainParagraph &&= nestedQuoteParagraphText(text)
      last = line
      continue
    }
    if (!cursor.owner.inList && plainParagraph && plainQuoteText(line.text) &&
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
    pos: position(first, last) }
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
  if (!cursor.peek()) throw new UnsupportedCursorSyntax('unclosed colon container')
  return body
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
    if (first.text === '') { cursor.take(); continue }
    const attrs = first.text.startsWith('{') ? parseBlockAttributeRun(first.text) : null
    if (attrs) {
      cursor.take()
      pendingAttrs = pendingAttrs ? mergeAttrs(pendingAttrs, attrs) : attrs
      continue
    }
    const footnote = FOOTNOTE_DEF.exec(first.text)
    if (footnote) {
      let nextIndex = 1
      while (cursor.peek(nextIndex)?.text === '') nextIndex++
      const next = cursor.peek(nextIndex)?.text
      if (!atDocumentLevel || !footnote[2] || next?.startsWith('  ') || next?.startsWith('\t')) {
        throw new UnsupportedCursorSyntax('nested or multiline footnote definition')
      }
      cursor.take()
      const label = footnote[1]!
      if (footnoteDefs && footnoteDefPos && !Object.hasOwn(footnoteDefs, label)) {
        const column = first.text.length - footnote[2]!.length + 1
        const body: Paragraph = { type: 'paragraph',
          children: inline.inlines([{ line: first, column, text: footnote[2]! }]),
          pos: position(first, first, column) }
        Object.defineProperty(footnoteDefs, label, { value: footnote[2] === '{empty}' ? [] : [body],
          enumerable: true, configurable: true, writable: true })
        Object.defineProperty(footnoteDefPos, label, { value: position(first, first),
          enumerable: true, configurable: true, writable: true })
      }
      continue
    }
    const definition = LINK_DEF.exec(first.text)
    if (definition) {
      if (!atDocumentLevel) throw new UnsupportedCursorSyntax('nested link definition')
      cursor.take()
      definitionNodes.push({ type: 'link_reference_definition', label: definition[1]!, href: definition[2]!,
        pos: position(first, first) })
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
        pos: position(first, first) })
      continue
    }
    const heading = first.text[0] === '#' ? RE_HEADING.exec(first.text) : null
    if (heading) {
      cursor.take()
      const column = /^#{1,6} +/.exec(first.text)![0].length + 1
      emit({ type: 'heading', level: heading[1]!.length as HeadingLevel,
        children: inline.inlines([{ line: first, column,
          text: heading[3] ? first.text.slice(column - 1) : heading[2]! }]),
        pos: position(first, first) })
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
      if (!cursor.peek()) throw new UnsupportedCursorSyntax('unclosed fence')
      const close = cursor.take()
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
    if (first.text.startsWith('>')) {
      const quote = parseQuote(cursor, inline, definitionNodes, depth)
      const caption = takeQuoteCaption(cursor, inline, quote)
      emit(caption ? { type: 'figure', target: quote, caption: caption.children,
        pos: position(first, caption.line) } : quote)
      continue
    }
    if (first.text.startsWith('|')) {
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
    const colon = COLON_OPEN.exec(first.text)
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
      const close = cursor.take()
      const children = parseBlocks(new Cursor(body, undefined, childOwner(cursor.owner, 'colon')),
        inline, definitionNodes, depth + 1, false,
        undefined, undefined, undefined, colonDepth + 1)
      const kind = colon[2]
      const pos = position(first, close)
      if (colon[3] && kind === undefined) throw new UnsupportedCursorSyntax('bare div title')
      if (colon[4] && kind && GENERATED_CONTENT_KINDS.has(kind)) {
        throw new UnsupportedCursorSyntax('directive label')
      }
      const title = colon[3] ? inline.inlines([{ line: first,
        column: first.text.indexOf('"') + 2, text: colon[3] }]) : undefined
      const label = colon[4]
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
      emit(parseSimpleDefinitionList(cursor, inline))
      continue
    }
    if (/^(?::::|::)/.test(first.text)) throw new UnsupportedCursorSyntax(`block at line ${first.number}`)
    emit(parseParagraphAtCursor(cursor, inline))
  }
  return children
}

export function parseCursorPrototype(source: string): Document {
  if (source.includes('\r') || source.includes('\0') || source.charCodeAt(0) === 0xfeff) {
    throw new UnsupportedCursorSyntax('source normalization is not migrated')
  }
  const cursor = new Cursor(scanLines(source), source)
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
    const match = LINK_DEF.exec(line.text)
    if (match) linkDefinitions.set(normalizeRefLabel(match[1]!),
      { rawLabel: match[1]!, line: line.number - 1, href: match[2]! })
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
    lexer.consumeFrontmatter()
    cursor.at = lexer.pos
    frontmatter = lexer.frontmatter
  }
  const children = parseBlocks(cursor, inline, definitionNodes, 0, true, footnoteDefs, footnoteDefPos,
    commentOpeners)
  const document: Document = { type: 'document', children, srcByteLength: utf8ByteLength(source) }
  if (Object.keys(footnoteDefs).length) {
    document.footnoteDefs = footnoteDefs
    document.footnoteDefPos = footnoteDefPos
  }
  if (frontmatter) document.frontmatter = frontmatter
  children.push(...definitionNodes)
  toCodepointPositions(document, source)
  if (inline.hasLeadingImage) promoteBlockImages(children, true)
  document.children = promoteCitationDefinitions(children)
  return document
}
