import type { Attrs, BlockNode, BlockQuote, CodeBlock, Document, HeadingLevel, InlineNode, List, ListItem, Paragraph, Position, Table, TableRow } from '../ast.js'
import { utf8ByteLength } from '../extension/abbr-budget.js'
import { toCodepointPositions } from '../source/source-positions.js'
import { normalizeRefLabel } from '../label-key.js'
import { promoteBlockImages } from '../heading/heading-ids.js'
import { promoteCitationDefinitions } from '../extension/citations.js'
import { mergeAttrs } from '../extension/attribute-merge.js'
import { dropTrailingWhitespace } from './block/parse-block-boundaries.js'
import { commentLineContent } from './block/parse-block-scan-core.js'
import { InlineParseSession } from './inline/parse-inline-session.js'
import type { LinkDef } from './inline/inline-resolution.js'
import { olKindOf, olStartOf, type OlKind } from './list/parse-item-core.js'
import { RE_ORDERED, parseBlockAttributeRun } from './parse-prepass-core.js'

/**
 * An isolated block-cursor experiment. It deliberately fails on syntax that has
 * not been migrated; production entry points never invoke it.
 */
export class UnsupportedCursorSyntax extends Error {}

interface SourceLine { text: string; start: number; number: number }

class Cursor {
  at = 0
  constructor(readonly lines: SourceLine[]) {}
  peek(n = 0): SourceLine | undefined { return this.lines[this.at + n] }
  take(): SourceLine { return this.lines[this.at++]! }
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

function position(first: SourceLine, last: SourceLine, firstColumn = 1, lastColumn = last.text.length + 1): Position {
  return {
    startLine: first.number,
    endLine: last.number,
    startColumn: firstColumn,
    endColumn: lastColumn,
    startOffset: first.start + firstColumn - 1,
    endOffset: last.start + lastColumn - 1,
  }
}

type ContentLine = { line: SourceLine; column: number; text: string }

class CursorInline extends InlineParseSession {
  constructor(private readonly linkDefinitions: Map<string, LinkDef>,
    private readonly abbreviations: Map<string, string>) { super() }
  inlines(parts: ContentLine[]): InlineNode[] {
    const text = dropTrailingWhitespace(parts.map((part) => part.text).join('\n'))
    const first = parts[0]!
    const lineAnchors = parts.map((part) => {
      const anchor = { offset: part.line.start + part.column - 1, column: part.column, line: part.line.number }
      return anchor
    })
    return this.parseInline(text, this.abbreviations, this.linkDefinitions, {
      anchored: true,
      baseOffset: first.line.start + first.column - 1,
      startLine: first.line.number,
      startColumn: first.column,
      ...(parts.length > 1 ? { lineAnchors } : {}),
    })
  }
}

const HEADING = /^(#{1,6}) +(.+)$/
const BULLET = /^( *)([-*]) +(.*)$/
const FENCE = /^(`{3,}|~{3,})([A-Za-z0-9_-]+)?[ \t]*$/
const BREAK = /^(?:-{3,}|\*{3,}|_{3,})[ \t]*$/
const LINK_DEF = /^\[([^\]]+)\]: +(\S+)[ \t]*$/
const ABBR_DEF = /^\*\[([A-Za-z0-9]+)\]: +(?![ \t]*$)([^]+)$/u
const LINE_COMMENT = /^[ \t]*%%/

function closesFence(line: string, marker: string): boolean {
  let count = 0
  while (line[count] === marker[0]) count++
  return count >= marker.length && /^[ \t]*$/.test(line.slice(count))
}

function listMarker(line: string) {
  const ordered = RE_ORDERED.exec(line)
  if (ordered && !ordered[1]!.includes('\t')) {
    return { indent: ordered[1]!.length, ordered: true, raw: ordered[2]!,
      delim: ordered[3] as '.' | ')', bullet: undefined,
      width: ordered[0].length - ordered[4]!.length, content: ordered[4]! }
  }
  const bullet = BULLET.exec(line)
  if (!bullet) return undefined
  return { indent: bullet[1]!.length, ordered: false, raw: undefined,
    delim: undefined, bullet: bullet[2] as '-' | '*',
    width: bullet[0].length - bullet[3]!.length, content: bullet[3]! }
}

function isBlockStart(line: string): boolean {
  return HEADING.test(line) || FENCE.test(line) || BREAK.test(line) || !!listMarker(line) ||
    line.startsWith('>') || line.startsWith('|') || line.startsWith('::') ||
    LINK_DEF.test(line) || ABBR_DEF.test(line) || LINE_COMMENT.test(line) ||
    (line.startsWith('{') && parseBlockAttributeRun(line) !== null)
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

function takeCaption(cursor: Cursor, inline: CursorInline):
  { children: InlineNode[]; line: SourceLine } | undefined {
  const blank = cursor.peek()?.text === '' ? 1 : 0
  const line = cursor.peek(blank)
  const match = line && /^\^ +(.+)$/.exec(line.text)
  if (!match) return undefined
  if (blank) cursor.take()
  cursor.take()
  const column = line.text.length - match[1]!.length + 1
  return { children: inline.inlines([{ line, column, text: match[1]! }]), line }
}

function parseList(cursor: Cursor, inline: CursorInline, first: SourceLine,
  firstMarker: NonNullable<ReturnType<typeof listMarker>>): List {
  type Frame = { list: List; first: SourceLine; last: SourceLine; indent: number;
    ordered: boolean; kind?: OlKind; delim?: '.' | ')'; bullet?: '-' | '*';
    item?: ListItem; itemFirst?: SourceLine; contentColumn?: number; parts: ContentLine[] }
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
      ...(marker.bullet ? { bullet: marker.bullet } : {}), parts: [] }
  }
  const stack = [newFrame(first, firstMarker)]
  const flush = (frame: Frame) => {
    if (!frame.item || !frame.itemFirst || !frame.parts.length) return
    const firstPart = frame.parts[0]!
    const lastPart = frame.parts.at(-1)!
    const para: Paragraph = { type: 'paragraph', children: inline.inlines(frame.parts),
      pos: position(firstPart.line, lastPart.line, firstPart.column) }
    frame.item.children.push(para)
    frame.parts = []
  }
  while (cursor.peek()) {
    const line = cursor.peek()!
    const marker = listMarker(line.text)
    const top = stack.at(-1)!
    if (marker) {
      if (marker.indent < firstMarker.indent) break
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
      flush(current)
      cursor.take()
      const item: ListItem = { type: 'list_item', children: [], pos: position(line, line, marker.indent + 1) }
      current.list.items.push(item)
      current.item = item
      current.itemFirst = line
      current.contentColumn = marker.width + 1
      current.parts = [{ line, column: marker.width + 1, text: marker.content }]
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
        flush(continuationFrame)
        continuationFrame.list.tight = false
      } else if (sibling) target.list.tight = false
      continue
    }
    const contentColumn = top.contentColumn
    if (contentColumn === undefined) break
    const prefix = ' '.repeat(contentColumn - 1)
    if (!line.text.startsWith(prefix)) break
    cursor.take()
    top.parts.push({ line, column: contentColumn, text: line.text.slice(prefix.length) })
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

export function parseCursorPrototype(source: string): Document {
  if (source.includes('\r') || source.includes('\0') || source.charCodeAt(0) === 0xfeff) {
    throw new UnsupportedCursorSyntax('source normalization is not migrated')
  }
  const cursor = new Cursor(scanLines(source))
  const linkDefinitions = new Map<string, LinkDef>()
  const abbreviations = new Map<string, string>()
  let openFence: string | undefined
  for (const line of cursor.lines) {
    if (openFence) {
      if (closesFence(line.text, openFence)) openFence = undefined
      continue
    }
    const fence = FENCE.exec(line.text)
    if (fence) { openFence = fence[1]!; continue }
    const match = LINK_DEF.exec(line.text)
    if (match) linkDefinitions.set(normalizeRefLabel(match[1]!),
      { rawLabel: match[1]!, line: line.number - 1, href: match[2]! })
    const abbr = ABBR_DEF.exec(line.text)
    if (abbr) abbreviations.set(abbr[1]!, dropTrailingWhitespace(abbr[2]!))
  }
  const inline = new CursorInline(linkDefinitions, abbreviations)
  const children: BlockNode[] = []
  const definitionNodes: BlockNode[] = []
  let pendingAttrs: Attrs | null = null
  const emit = (node: BlockNode) => {
    if (node.type !== 'comment' && node.type !== 'abbreviation_def' && pendingAttrs) {
      node.attrs = mergeAttrs(pendingAttrs, node.attrs ?? {})
      pendingAttrs = null
    }
    children.push(node)
  }
  const document: Document = { type: 'document', children, srcByteLength: utf8ByteLength(source) }
  if (cursor.peek()?.text === '---yaml') {
    const open = cursor.take()
    const contents: string[] = []
    while (cursor.peek() && cursor.peek()!.text !== '---') contents.push(cursor.take().text)
    if (!cursor.peek()) throw new UnsupportedCursorSyntax('unclosed frontmatter')
    const close = cursor.take()
    document.frontmatter = { format: 'yaml', content: contents.join('\n'), pos: position(open, close) }
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
    const definition = LINK_DEF.exec(first.text)
    if (definition) {
      cursor.take()
      definitionNodes.push({ type: 'link_reference_definition', label: definition[1]!, href: definition[2]!,
        pos: position(first, first) })
      continue
    }
    const abbreviation = ABBR_DEF.exec(first.text)
    if (abbreviation) {
      cursor.take()
      emit({ type: 'abbreviation_def', abbr: abbreviation[1]!,
        expansion: dropTrailingWhitespace(abbreviation[2]!), pos: position(first, first) })
      continue
    }
    if (LINE_COMMENT.test(first.text)) {
      if (first.text.trimStart().startsWith('%%%')) throw new UnsupportedCursorSyntax('block comment')
      cursor.take()
      emit({ type: 'comment', block: false, content: commentLineContent(first.text),
        pos: position(first, first) })
      continue
    }
    const heading = HEADING.exec(first.text)
    if (heading) {
      cursor.take()
      const column = /^#{1,6} +/.exec(first.text)![0].length + 1
      emit({ type: 'heading', level: heading[1]!.length as HeadingLevel,
        children: inline.inlines([{ line: first, column, text: first.text.slice(column - 1) }]),
        pos: position(first, first) })
      continue
    }
    if (BREAK.test(first.text)) {
      cursor.take()
      emit({ type: 'thematic_break', pos: position(first, first) })
      continue
    }
    const fence = FENCE.exec(first.text)
    if (fence) {
      cursor.take()
      const payload: string[] = []
      while (cursor.peek() && !closesFence(cursor.peek()!.text, fence[1]!)) payload.push(cursor.take().text)
      if (!cursor.peek()) throw new UnsupportedCursorSyntax('unclosed fence')
      const close = cursor.take()
      const block: CodeBlock = { type: 'code_block', content: payload.length ? payload.join('\n') + '\n' : '',
        ...(fence[2] ? { lang: fence[2] } : {}),
        pos: position(first, close) }
      const caption = takeCaption(cursor, inline)
      emit(caption ? { type: 'figure', target: block, caption: caption.children,
        pos: position(first, caption.line) } : block)
      continue
    }
    if (first.text.startsWith('>')) {
      const parts: ContentLine[] = []
      let last = first
      while (cursor.peek()?.text.startsWith('>')) {
        const line = cursor.take()
        const column = line.text.startsWith('> ') ? 3 : 2
        parts.push({ line, column, text: line.text.slice(column - 1) })
        last = line
      }
      const para: Paragraph = { type: 'paragraph', children: inline.inlines(parts),
        pos: position(first, last, parts[0]!.column) }
      const quote: BlockQuote = { type: 'block_quote', children: [para], pos: position(first, last) }
      const caption = takeCaption(cursor, inline)
      emit(caption ? { type: 'figure', target: quote, caption: caption.children,
        pos: position(first, caption.line) } : quote)
      continue
    }
    if (first.text.startsWith('|')) {
      if (!cursor.peek(1)?.text.startsWith('|')) throw new UnsupportedCursorSyntax('table header')
      const table = parseSimpleTable(cursor, inline)
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
      emit(parseList(cursor, inline, first, firstMarker))
      continue
    }
    if (/^(?::::|::)/.test(first.text)) throw new UnsupportedCursorSyntax(`block at line ${first.number}`)
    const parts: ContentLine[] = []
    let last = first
    while (cursor.peek() && cursor.peek()!.text !== '' && (parts.length === 0 || !isBlockStart(cursor.peek()!.text))) {
      if (parts.length === 1 && parts[0]!.text.startsWith('![') && cursor.peek()!.text.startsWith('^ ')) {
        const lead = inline.inlines(parts)
        if (lead.length === 1 && lead[0]?.type === 'image' &&
            lead[0].pos?.startOffset === parts[0]!.line.start &&
            lead[0].pos?.endOffset === parts[0]!.line.start + parts[0]!.line.text.length) break
      }
      const line = cursor.take()
      parts.push({ line, column: 1, text: line.text })
      last = line
    }
    const paragraph: Paragraph = { type: 'paragraph', children: inline.inlines(parts), pos: position(first, last) }
    if (parts.length === 1 && paragraph.children.length === 1 && paragraph.children[0]?.type === 'image') {
      const caption = takeCaption(cursor, inline)
      if (caption) {
        emit({ type: 'figure', target: paragraph.children[0],
          caption: caption.children, pos: position(first, caption.line) })
        continue
      }
      const image = paragraph.children[0]
      if (!image.ref && image.pos?.startColumn === 1 &&
          image.pos.endColumn === first.text.length + 1) {
        emit(image)
        continue
      }
    }
    emit(paragraph)
  }
  children.push(...definitionNodes)
  toCodepointPositions(document, source)
  promoteBlockImages(children, true)
  document.children = promoteCitationDefinitions(children)
  return document
}
