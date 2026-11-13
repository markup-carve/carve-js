// Contract 2.2: lists. `+` lines, tightness, marker columns and marker spellings.
import { ancestor, isContainer, isInside, quotesOf } from '../blocks.ts'
import { change, type Context, note, type Visit } from '../context.ts'
import { type Node01 } from '../engines.ts'
import { indentOf, isBlank, lineEnd, lineStart, lineText } from '../source.ts'
import { quotePrefix } from './blank-lines.ts'
import { attributeLinesAbove, bodyOffset, dedentLines, indentLines, insideQuotes, isBlankInQuotes, isGap, removeAttribute } from './lines.ts'

const SPACE = 0x20

/** Offset of the marker of `item` and the offset after it, before the space. */
function markerSpan(ctx: Context, item: Node01): [number, number] {
  let start = item.pos!.startOffset
  while (ctx.src.charCodeAt(start) === SPACE || ctx.src.charCodeAt(start) === 0x09) start++
  let end = start
  while (end < ctx.src.length && ctx.src.charCodeAt(end) > SPACE) end++
  return [start, end]
}

/** Column, from 0, where the content of `item` starts: one past the space after the marker. */
function contentColumn(ctx: Context, item: Node01): number {
  const first = item.children?.[0]?.pos
  if (first !== undefined && first.startLine === item.pos!.startLine) return first.startColumn - 1
  const [, end] = markerSpan(ctx, item)
  return end + 1 - lineStart(ctx.lines, item.pos!.startLine)
}

/** The line between `from` and `to` that holds only a `+`, or 0. */
function plusLine(ctx: Context, from: number, to: number): number {
  for (let line = from; line < to; line++) {
    if (isGap(ctx, line) && insideQuotes(lineText(ctx.lines, line)).trim() === '+') return line
  }
  return 0
}

/** U-014, U-015: a `+` line is text in 0.2 (C2-B-059); a blank line and the body's indent attach the block. */
function plusInBody(ctx: Context, column: number, visit: Visit, line: number): void {
  const child = visit.node
  const id = child.type === 'paragraph' ? 'U-015' : 'U-014'
  const message = '+ line replaced by a blank line, the block indented into its item'
  const text = lineText(ctx.lines, line)
  const keep = quotePrefix(text, quotesOfLine(text))
  change(ctx, id, lineStart(ctx.lines, line) + keep.length, lineEnd(ctx.lines, line), '', message)
  const first = child.pos!.startLine
  // The block is measured after the quote marks of the quotes its host stands in.
  const depth = quotesOf(visit).length
  indentLines(ctx, id, first, child.pos!.endLine, column - bodyOffset(lineText(ctx.lines, first), depth), message, depth)
}

function quotesOfLine(text: string): number {
  let count = 0
  for (let at = 0; at < text.length; at++) {
    if (text[at] === '>') count++
    else if (text[at] !== ' ') break
  }
  return count
}

/** U-016: in a quote the `+` line becomes a marked blank line and the block takes the marks. */
function plusInQuote(ctx: Context, quote: Visit, child: Node01, line: number): void {
  const message = '+ line replaced by a quoted blank line, the block given the quote mark'
  const marks = '>'.repeat(quotesOf(quote).length + 1)
  change(ctx, 'U-016', lineStart(ctx.lines, line), lineEnd(ctx.lines, line), marks, message)
  for (let at = child.pos!.startLine; at <= child.pos!.endLine; at++) {
    const start = lineStart(ctx.lines, at)
    change(ctx, 'U-016', start, start, isBlank(lineText(ctx.lines, at)) ? marks : marks + ' ', message)
  }
}

/** The column where the blocks of the body `visit` stands in start, or -1 where a `+` attaches nothing. */
function bodyColumn(ctx: Context, visit: Visit): number {
  const parent = visit.parent!.node
  if (parent.type === 'list_item') return contentColumn(ctx, parent)
  // A description and a footnote body: the column of the block on the marker line.
  const body = parent.type === 'definition_list' || (parent === ctx.doc && visit.siblings !== ctx.doc.children)
  const first = visit.siblings[0]!.pos
  return body && first !== undefined ? first.startColumn - 1 : -1
}

function plusLines(ctx: Context, visit: Visit, used: Set<number>): void {
  const above = visit.index > 0 ? visit.siblings[visit.index - 1]!.pos : undefined
  const child = visit.node
  if (above === undefined || visit.parent === null || !isContainer(visit.parent.node)) return
  const line = plusLine(ctx, above.endLine + 1, child.pos!.startLine)
  if (line === 0) return
  if (visit.parent.node.type === 'block_quote') {
    if (visit.parent.node.fenced === true) return
    used.add(line)
    plusInQuote(ctx, visit.parent, child, line)
    return
  }
  const column = bodyColumn(ctx, visit)
  if (column < 0) return
  used.add(line)
  plusInBody(ctx, column, visit, line)
}

/** Whether the line after `line` holds something that stands outside `host`. */
function leavesHost(ctx: Context, host: Visit, line: number): boolean {
  if (line >= ctx.lines.count || isBlank(lineText(ctx.lines, line + 1))) return false
  const next = ctx.blocks.leaf[line + 1]
  if (next === null || next === undefined) return true
  // A marker at an open list's column ends the paragraph by itself (C2-B-015).
  const item = ancestor(next, 'list_item')
  return !isInside(next, host) && (item === null || item.node.pos!.startLine !== line + 1)
}

/**
 * The `+` of a host that 0.1 left empty goes: an item keeps an empty braced comment, because a
 * marker needs content (C2-B-061) and the comment renders nothing (C2-I-025). What follows
 * outside the host gets a blank line, or it would be a lazy line of the host in 0.2.
 */
function emptyFirst(ctx: Context, host: Visit, from: number, text: string): void {
  const line = host.node.pos!.startLine
  const message = '+ of a first block that attaches nothing removed, 0.1 left the container empty'
  change(ctx, 'U-017', from, lineEnd(ctx.lines, line), text, message)
  const outer = host.node.type === 'list_item' ? host.parent! : host
  if (leavesHost(ctx, outer, line)) change(ctx, 'U-017', lineStart(ctx.lines, line + 1), lineStart(ctx.lines, line + 1), '\n', message)
}

/**
 * U-017: an item may start with any block on its marker line (C2-B-057), so the `+` after the
 * marker goes. A paragraph joins the marker line from any column; another block only from the
 * content column, where its later lines already stand.
 */
function plusFirst(ctx: Context, visit: Visit): void {
  const item = visit.node
  const [, markerEnd] = markerSpan(ctx, item)
  const line = item.pos!.startLine
  const end = lineEnd(ctx.lines, line)
  if (ctx.src.slice(markerEnd, end).trim() !== '+') return
  const first = item.children?.[0]
  if (first === undefined) {
    emptyFirst(ctx, visit, end - 1, '{%%}')
    return
  }
  if (first.pos === undefined || first.pos.startLine !== line + 1) return
  const column = markerEnd + 1 - lineStart(ctx.lines, line)
  if (first.type !== 'paragraph' && first.pos.startColumn - 1 !== column) return
  change(ctx, 'U-017', markerEnd + 1, first.pos.startOffset, '', '+ after the marker removed, the block moved to the marker line')
}

/** U-017 in a quote: a `+` after the quote mark attached the first block of the quote. */
function plusFirstInQuote(ctx: Context, visit: Visit): void {
  const quote = visit.node
  const line = quote.pos!.startLine
  const text = lineText(ctx.lines, line)
  const inner = insideQuotes(text)
  if (quote.fenced === true || inner.trim() !== '+' || inner.length === text.length) return
  const plus = lineStart(ctx.lines, line) + text.lastIndexOf('+')
  const first = quote.children?.[0]
  if (first === undefined) {
    emptyFirst(ctx, visit, lineStart(ctx.lines, line) + text.lastIndexOf('>') + 1, '')
    return
  }
  if (first.pos === undefined || first.pos.startLine !== line + 1 || first.type !== 'paragraph') return
  change(ctx, 'U-017', plus, first.pos.startOffset, '', '+ after the quote mark removed, the paragraph moved to the line of the mark')
}

function itemsOf(list: Node01): Node01[] {
  return (list.items ?? []).filter((item) => item.pos !== undefined)
}

function blankBetween(ctx: Context, items: Node01[]): boolean {
  for (let index = 1; index < items.length; index++) {
    const line = items[index]!.pos!.startLine - 1
    if (isBlankInQuotes(lineText(ctx.lines, line))) return true
  }
  return false
}

/** The attribute line above `list` that holds the key `loose`, or 0. */
function looseLine(ctx: Context, list: Node01): number {
  for (const line of attributeLinesAbove(ctx, list.pos!.startLine)) {
    const text = lineText(ctx.lines, line)
    if (text.includes('{loose}') || text.includes('{loose ') || text.includes(' loose}') || text.includes(' loose ')) return line
  }
  return 0
}

/**
 * U-018, U-020, U-021: in 0.2 a list is loose only when a blank line stands between two of its
 * items (C2-B-062), and the key `loose` does nothing (C2-B-066).
 */
function tightness(ctx: Context, visit: Visit): void {
  const list = visit.node
  const items = itemsOf(list)
  if (list.tight !== false || items.length === 0) return
  const keyLine = looseLine(ctx, list)
  if (items.length === 1) {
    note(ctx, 'U-021', list.pos!.startLine, 'a loose list with one item is tight in 0.2, its first paragraph loses the paragraph element')
    // The key stays an attribute of the list in 0.2 (C2-B-066) and would be written as `loose=""`.
    if (keyLine > 0) removeAttribute(ctx, 'U-020', keyLine, (token) => token === 'loose', 'key loose removed, it does nothing in 0.2 and would be written as an attribute')
    return
  }
  if (blankBetween(ctx, items)) return
  const id = keyLine > 0 ? 'U-020' : 'U-018'
  const message = 'blank line put between two items, which is what makes a list loose in 0.2'
  if (keyLine > 0) removeAttribute(ctx, id, keyLine, (token) => token === 'loose', message)
  const blank = quotePrefix(lineText(ctx.lines, items[1]!.pos!.startLine), quotesOf(visit).length) + '\n'
  for (let index = 1; index < items.length; index++) {
    const at = lineStart(ctx.lines, items[index]!.pos!.startLine)
    change(ctx, id, at, at, blank, message)
    if (id === 'U-018') break
  }
}

function markerColumn(ctx: Context, item: Node01): number {
  return indentOf(lineText(ctx.lines, item.pos!.startLine))
}

/** The list that ends on the line directly above `visit`, when both stand in the same container. */
function listAbove(visit: Visit): Node01 | null {
  const above = visit.index > 0 ? visit.siblings[visit.index - 1] : undefined
  if (above === undefined || above.type !== 'list' || above.pos === undefined) return null
  return above.pos.endLine === visit.node.pos!.startLine - 1 ? above : null
}

/**
 * U-022, U-023: a marker right of its list's column and short of the content column above nests
 * in 0.2 (C2-B-056, C2-B-030), so it moves to the column of the list.
 */
function markerColumns(ctx: Context, visit: Visit): void {
  // Only a list of the document itself: inside a container the columns belong to the container.
  if (visit.parent!.node !== ctx.doc || visit.siblings !== ctx.doc.children) return
  const items = itemsOf(visit.node)
  if (items.length === 0) return
  let base = markerColumn(ctx, items[0]!)
  for (const item of items) base = Math.min(base, markerColumn(ctx, item))
  const above = listAbove(visit)
  const aboveItems = above === null ? [] : itemsOf(above)
  if (aboveItems.length > 0) base = Math.min(base, markerColumn(ctx, aboveItems[0]!))
  for (const item of items) {
    const column = markerColumn(ctx, item)
    if (column <= base) continue
    const id = visit.node.ordered === true && above === null ? 'U-022' : 'U-023'
    dedentLines(ctx, id, item.pos!.startLine, item.pos!.endLine, column - base, 'marker moved to the column of its list')
  }
}

const ROMAN_LETTERS = 'ivxlcdm'
const DIGITS_MAX = 9

function attributeLineFor(ctx: Context, list: Node01, start: number): string {
  const text = lineText(ctx.lines, list.pos!.startLine)
  return `${text.slice(0, indentOf(text))}{start=${start}}\n`
}

/** U-024: a lone roman letter is a roman marker in 0.2 (C2-B-042), so the list is respelled from `a`. */
function alphabeticFromRoman(ctx: Context, list: Node01): void {
  const items = itemsOf(list)
  const start = typeof list.start === 'number' ? list.start : 1
  if (list.olType !== 'a' && list.olType !== 'A') return
  if (items.length === 0 || items.length > 26) return
  const [first] = markerSpan(ctx, items[0]!)
  if (!ROMAN_LETTERS.includes(ctx.src[first]!.toLowerCase()) || ctx.src.charCodeAt(first + 1) > 0x40) return
  const message = 'alphabetic list that starts at a roman letter respelled from a, with its start as an attribute'
  const head = lineStart(ctx.lines, list.pos!.startLine)
  change(ctx, 'U-024', head, head, attributeLineFor(ctx, list, start), message)
  const base = list.olType === 'a' ? 0x61 : 0x41
  items.forEach((item, index) => {
    const [at] = markerSpan(ctx, item)
    change(ctx, 'U-024', at, at + 1, String.fromCharCode(base + index), message)
  })
}

/** U-025: an ordered marker has at most nine digits (C2-B-036); the bare dot numbers from `start`. */
function longNumber(ctx: Context, list: Node01): void {
  const items = itemsOf(list)
  if (items.length === 0 || typeof list.start !== 'number') return
  const [start, end] = markerSpan(ctx, items[0]!)
  if (end - start - 1 <= DIGITS_MAX || ctx.src[end - 1] !== '.') return
  const message = 'marker of ten or more digits respelled as a bare dot under a start attribute'
  const head = lineStart(ctx.lines, list.pos!.startLine)
  change(ctx, 'U-025', head, head, attributeLineFor(ctx, list, list.start), message)
  for (const item of items) {
    const [at, markerEnd] = markerSpan(ctx, item)
    change(ctx, 'U-025', at, markerEnd - 1, '', message)
  }
}

/**
 * The spaces U-026 puts before each line of the comment block `visit`: a `%%%` block left of its
 * item's content column, between two items, ends the list in 0.2 (C2-B-142).
 */
export function commentShift(ctx: Context, visit: Visit): number {
  const item = visit.parent
  const child = visit.node
  if (item === null || item.node.type !== 'list_item' || item.siblings[item.index + 1] === undefined) return 0
  if (child.type !== 'comment' || child.block !== true || child.pos!.startLine === item.node.pos!.startLine) return 0
  return Math.max(0, contentColumn(ctx, item.node) - indentOf(lineText(ctx.lines, child.pos!.startLine)))
}

function listNode(ctx: Context, visit: Visit, used: Set<number>): void {
  const node = visit.node
  if (node.pos === undefined) return
  plusLines(ctx, visit, used)
  if (node.type === 'list') {
    tightness(ctx, visit)
    markerColumns(ctx, visit)
    if (node.ordered === true) {
      alphabeticFromRoman(ctx, node)
      longNumber(ctx, node)
    }
  } else if (node.type === 'list_item') {
    plusFirst(ctx, visit)
  } else if (node.type === 'block_quote') {
    plusFirstInQuote(ctx, visit)
  } else if (node.type === 'comment') {
    indentLines(ctx, 'U-026', node.pos.startLine, node.pos.endLine, commentShift(ctx, visit), 'comment block indented into the item above')
  }
}

/** A `+` line that attaches no block: 0.1 rendered nothing for it, 0.2 reads it as text (C2-B-059), so it goes. */
function danglingPlus(ctx: Context, used: Set<number>): void {
  for (let line = 1; line <= ctx.lines.count; line++) {
    if (used.has(line) || !isGap(ctx, line) || lineText(ctx.lines, line).trim() !== '+') continue
    change(ctx, 'U-014', lineStart(ctx.lines, line), lineStart(ctx.lines, line + 1), '', '+ line that attaches no block removed, 0.1 rendered nothing for it')
  }
}

export function lists(ctx: Context): void {
  const used = new Set<number>()
  for (const visit of ctx.visits) listNode(ctx, visit, used)
  danglingPlus(ctx, used)
}
