import type { BlockNode, Document, HeadingLevel, InlineNode, List, ListItem, Paragraph, Position, Table, TableRow } from '../ast.js'
import { utf8ByteLength } from '../extension/abbr-budget.js'
import { toCodepointPositions } from '../source/source-positions.js'
import { normalizeRefLabel } from '../label-key.js'
import { dropTrailingWhitespace } from './block/parse-block-boundaries.js'
import { InlineParseSession } from './inline/parse-inline-session.js'
import type { LinkDef } from './inline/inline-resolution.js'

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
  constructor(private readonly linkDefinitions: Map<string, LinkDef>) { super() }
  inlines(parts: ContentLine[]): InlineNode[] {
    const text = dropTrailingWhitespace(parts.map((part) => part.text).join('\n'))
    const first = parts[0]!
    const lineAnchors = parts.map((part) => {
      const anchor = { offset: part.line.start + part.column - 1, column: part.column, line: part.line.number }
      return anchor
    })
    return this.parseInline(text, new Map(), this.linkDefinitions, {
      anchored: true,
      baseOffset: first.line.start + first.column - 1,
      startLine: first.line.number,
      startColumn: first.column,
      ...(parts.length > 1 ? { lineAnchors } : {}),
    })
  }
}

const HEADING = /^(#{1,6}) +(.+)$/
const LIST = /^( *)(?:(\d+)([.)])|([-*])) +(.*)$/
const FENCE = /^(`{3,}|~{3,})([A-Za-z0-9_-]+)?[ \t]*$/
const BREAK = /^(?:-{3,}|\*{3,}|_{3,})[ \t]*$/
const LINK_DEF = /^\[([^\]]+)\]: +(\S+)[ \t]*$/

function closesFence(line: string, marker: string): boolean {
  let count = 0
  while (line[count] === marker[0]) count++
  return count >= marker.length && /^[ \t]*$/.test(line.slice(count))
}

function listMarker(line: string) {
  const match = LIST.exec(line)
  if (!match) return undefined
  return { indent: match[1]!.length, ordered: !!match[2], start: Number(match[2] ?? 1),
    delim: match[3] as '.' | ')' | undefined, bullet: match[4] as '-' | '*' | undefined,
    width: match[0].length - match[5]!.length, content: match[5]! }
}

function isBlockStart(line: string): boolean {
  return HEADING.test(line) || FENCE.test(line) || BREAK.test(line) || !!listMarker(line) ||
    line.startsWith('>') || line.startsWith('|') || line.startsWith('::') || LINK_DEF.test(line)
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

export function parseCursorPrototype(source: string): Document {
  if (source.includes('\r') || source.includes('\0') || source.charCodeAt(0) === 0xfeff) {
    throw new UnsupportedCursorSyntax('source normalization is not migrated')
  }
  const cursor = new Cursor(scanLines(source))
  const linkDefinitions = new Map<string, LinkDef>()
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
  }
  const inline = new CursorInline(linkDefinitions)
  const children: BlockNode[] = []
  const definitionNodes: BlockNode[] = []
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
    const definition = LINK_DEF.exec(first.text)
    if (definition) {
      cursor.take()
      definitionNodes.push({ type: 'link_reference_definition', label: definition[1]!, href: definition[2]!,
        pos: position(first, first) })
      continue
    }
    const heading = HEADING.exec(first.text)
    if (heading) {
      cursor.take()
      const column = /^#{1,6} +/.exec(first.text)![0].length + 1
      children.push({ type: 'heading', level: heading[1]!.length as HeadingLevel,
        children: inline.inlines([{ line: first, column, text: first.text.slice(column - 1) }]),
        pos: position(first, first) })
      continue
    }
    if (BREAK.test(first.text)) {
      cursor.take()
      children.push({ type: 'thematic_break', pos: position(first, first) })
      continue
    }
    const fence = FENCE.exec(first.text)
    if (fence) {
      cursor.take()
      const payload: string[] = []
      while (cursor.peek() && !closesFence(cursor.peek()!.text, fence[1]!)) payload.push(cursor.take().text)
      if (!cursor.peek()) throw new UnsupportedCursorSyntax('unclosed fence')
      const close = cursor.take()
      children.push({ type: 'code_block', content: payload.length ? payload.join('\n') + '\n' : '',
        ...(fence[2] ? { lang: fence[2] } : {}),
        pos: position(first, close) })
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
      children.push({ type: 'block_quote', children: [para], pos: position(first, last) })
      continue
    }
    if (first.text.startsWith('|')) {
      if (!cursor.peek(1)?.text.startsWith('|')) throw new UnsupportedCursorSyntax('table header')
      children.push(parseSimpleTable(cursor, inline))
      continue
    }
    const firstMarker = listMarker(first.text)
    if (firstMarker) {
      type Frame = { list: List; first: SourceLine; last: SourceLine; indent: number;
        ordered: boolean; delim?: '.' | ')'; bullet?: '-' | '*';
        item?: ListItem; itemFirst?: SourceLine; parts: ContentLine[] }
      const newFrame = (line: SourceLine, marker: NonNullable<ReturnType<typeof listMarker>>): Frame => {
        const list: List = { type: 'list', ordered: marker.ordered, tight: true, items: [] }
        if (marker.ordered && marker.start !== 1) list.start = marker.start
        return { list, first: line, last: line, indent: marker.indent, ordered: marker.ordered,
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
        frame.item.children.unshift(para)
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
          current.parts = [{ line, column: marker.width + 1, text: marker.content }]
          for (const frame of stack) {
            frame.last = line
            if (frame.item && frame.itemFirst) frame.item.pos = position(frame.itemFirst, line, frame.indent + 1)
          }
          continue
        }
        if (line.text === '') break
        const contentColumn = top.parts[0]?.column
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
      children.push(stack[0]!.list)
      continue
    }
    if (/^(?::::|::)/.test(first.text)) throw new UnsupportedCursorSyntax(`block at line ${first.number}`)
    const parts: ContentLine[] = []
    let last = first
    while (cursor.peek() && cursor.peek()!.text !== '' && (parts.length === 0 || !isBlockStart(cursor.peek()!.text))) {
      const line = cursor.take()
      parts.push({ line, column: 1, text: line.text })
      last = line
    }
    children.push({ type: 'paragraph', children: inline.inlines(parts), pos: position(first, last) })
  }
  children.push(...definitionNodes)
  toCodepointPositions(document, source)
  return document
}
