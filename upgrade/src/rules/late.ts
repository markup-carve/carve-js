import { ancestor, isInside, quotesOf } from '../blocks.ts'
import { change, type Context, type Visit } from '../context.ts'
import { type Node01 } from '../engines.ts'
import { indentOf, isBlank, lineStart, lineText } from '../source.ts'
import { quotePrefix } from './blank-lines.ts'
import { insideQuotes, quoteDepth } from './lines.ts'

const MESSAGE = 'a line comment that 0.1 ended before the end of its line is written as a braced comment'

/** The row of the host whose closer ended the 0.1 comment (U-399 to U-402), else U-432. */
function hostRow(visit: Visit): string {
  for (let up = visit.parent; up !== null; up = up.parent) {
    const type = up.node.type
    if (type === 'link' || type === 'image') return 'U-399'
    if (type === 'footnote_inline' || type === 'inline_note') return 'U-400'
    if (type === 'underline' || type === 'delete' || type === 'insert' || type === 'highlight') return 'U-401'
    if (type === 'extension' || type === 'inline_extension') return 'U-402'
    if (type === 'paragraph' || type === 'heading') break
  }
  return 'U-432'
}

/** C2-B-169 ends a comment at the cell in both versions. */
function inTable(visit: Visit): boolean {
  for (let up = visit.parent; up !== null; up = up.parent) if (up.node.type === 'table') return true
  return false
}

function escaped(src: string, at: number): boolean {
  let slashes = 0
  while (at - slashes > 0 && src[at - slashes - 1] === '\\') slashes++
  return slashes % 2 === 1
}

/**
 * C2-I-023, C2-I-024: a 0.2 line comment starts only at a line start or after whitespace and takes the
 * rest of its line. 0.1 also ended it at the closer of an open form and read it directly after an
 * opener, so those comments become braced comments (C2-I-025), which 0.2 removes in place.
 */
export function lineComments(ctx: Context): void {
  for (const visit of ctx.visits) {
    const node = visit.node
    if (node.type !== 'comment' || node.block !== false || node.pos === undefined) continue
    const found = earlyComment(ctx.src, node.pos.startOffset, node.pos.endOffset, visit)
    if (found !== null) change(ctx, hostRow(visit), found.from, node.pos.endOffset, `{%${found.text}%}`, MESSAGE)
  }
}

/** The start of the unescaped spaces and tabs before `at`. */
function spacesBefore(src: string, at: number): number {
  let lead = at
  while (lead > 0 && (src[lead - 1] === ' ' || src[lead - 1] === '\t') && !escaped(src, lead - 1)) lead--
  return lead
}

/** Where the braced comment starts and what it holds, for a line comment 0.2 reads otherwise than 0.1. */
function earlyComment(src: string, start: number, end: number, visit: Visit): { from: number; text: string } | null {
  if (src.slice(start, start + 2) !== '%%' || inTable(visit)) return null
  const lead = spacesBefore(src, start)
  const lineStart = lead === 0 || src[lead - 1] === '\n'
  if (src.charCodeAt(start + 2) === 0x25 && lineStart) return null
  const atLineEnd = end >= src.length || src[end] === '\n' || src[end] === '\r'
  if (atLineEnd && (lead < start || lineStart)) return null
  const raw = src.slice(start + 2, end)
  if (/%\}|\n|\\/u.test(raw)) return null
  // A code or math span in the text is read before the braced comment can close, so its opener is escaped.
  const text = raw.replace(/[`$]/gu, '\\$&')
  // 0.1 dropped the spaces before the comment; a braced comment keeps its neighbors, so they go too.
  return { from: lineStart ? start : lead, text }
}

const OPENING = new Set(['(', '[', '{', '=', ':', '“', '‘'])

/** Whether 0.2 opens the straight quote at `at`, read from the character before it (C2-I-104, C2-I-105). */
function opens02(src: string, at: number): boolean {
  if (src[at] === "'" && /[0-9]/u.test(src[at + 1] ?? '')) return false
  const before = src[at - 1]
  if (before === '"' || before === "'") return opens02(src, at - 1)
  return before === undefined || /\s/u.test(before) || OPENING.has(before)
}

/**
 * C2-I-104, C2-I-105: 0.2 reads a straight quote from its neighbors, and where that guess differs from
 * the quote 0.1 printed, the author types the curly character. Approximate; the self-check decides.
 */
export function typedQuotes(ctx: Context): void {
  for (const { node } of ctx.visits) {
    if (node.type !== 'smart_punctuation' || node.pos === undefined || typeof node.glyph !== 'string') continue
    const at = node.pos.startOffset
    const value = ctx.src[at]
    if ((value !== '"' && value !== "'") || node.pos.endOffset !== at + 1) continue
    const opened = String(node.kind).startsWith('left_')
    if (opened === opens02(ctx.src, at)) continue
    change(ctx, 'U-375', at, at + 1, node.glyph, 'straight quote typed as the curly quote 0.1 printed')
  }
}

/**
 * U-433: 0.1 ended a paragraph or a description term at a comment line and read the next line as a
 * new block; 0.2 skips the comment line (C2-B-137), so a blank line above it keeps the 0.1 blocks.
 */
export function commentLineBreaks(ctx: Context): void {
  for (let line = 2; line <= ctx.lines.count; line++) {
    const text = lineText(ctx.lines, line)
    const body = insideQuotes(text).trimStart()
    if (!body.startsWith('%%') || body.startsWith('%%%')) continue
    if (isBlank(insideQuotes(lineText(ctx.lines, line - 1)))) continue
    const at = lineStart(ctx.lines, line)
    change(ctx, 'U-433', at, at, quotePrefix(text, quoteDepth(text)).trimEnd() + '\n',
      'blank line written above the comment line that ended the 0.1 block')
  }
}

const EXPLICIT_MESSAGE = 'a paragraph whose delimiters 0.2 pairs otherwise is written with braced spans and escaped text'
const DELIMITER = /[*/_{}~^=+\-%`[\]!<$|"']/u

interface Planned { start: number; end: number; text: string; entry: string }

/** Escapes every delimiter character of a text node, or false when its source is not its text. */
function escapeText(src: string, node: Node01, out: Planned[]): boolean {
  const { startOffset: start, endOffset: end } = node.pos!
  if (src.slice(start, end) !== node.value) return false
  for (let at = start; at < end; at++) {
    if (DELIMITER.test(src[at]!)) out.push({ start: at, end: at, text: '\\', entry: 'U-273' })
  }
  return true
}

const UNTOUCHED = /^(code|verbatim|math|raw_inline|link|image|span|footnote_reference|symbol|smart_punctuation)$/u
const BREAK = /^(soft_break|hard_break)$/u

/** The edits for one inline node, or false when it is a form the explicit spelling does not cover. */
function explicitNode(src: string, child: Node01, out: Planned[]): boolean {
  const pos = child.pos
  if (pos === undefined) return false
  if (BREAK.test(child.type)) return true
  if (child.type === 'text') return escapeText(src, child, out)
  const span = spanOf(src, child)
  if (span === null) return UNTOUCHED.test(child.type)
  out.push({ start: pos.startOffset, end: pos.startOffset + span.width, text: span.open, entry: span.entry })
  out.push({ start: pos.endOffset - span.width, end: pos.endOffset, text: span.close, entry: span.entry })
  return explicitEdits(src, span.inner, out)
}

/** The edits that spell the inline tree under `node` explicitly: spans braced, text escaped, UNTOUCHED forms kept. */
function explicitEdits(src: string, node: Node01, out: Planned[]): boolean {
  return (node.children ?? []).every((child) => explicitNode(src, child, out))
}

interface Braced { width: number; open: string; close: string; inner: Node01; entry: string }

/** A 0.1 bold italic span, slash and star outside, as nested braced spans. */
function boldItalicSpan(src: string, node: Node01, start: number, end: number): Braced | null {
  const inner = node.children?.length === 1 ? node.children[0]! : null
  if (inner?.type !== 'emphasis' || !src.startsWith('/*', start) || !src.startsWith('*/', end - 2)) return null
  return { width: 2, open: '{*{/', close: '/}*}', inner, entry: 'U-068' }
}

/** The braced spelling of a 0.1 strong, emphasis or underline span with bare delimiters, and the node that holds its content. */
function spanOf(src: string, node: Node01): Braced | null {
  const { startOffset: start, endOffset: end } = node.pos!
  if (node.attrs !== undefined) return null
  if (node.type === 'strong' && node.boldItalic === true) return boldItalicSpan(src, node, start, end)
  const mark = node.type === 'strong' ? '*' : node.type === 'emphasis' ? '/' : node.type === 'underline' ? '_' : null
  if (mark === null || end - start < 2 || src[start] !== mark || src[end - 1] !== mark) return null
  return { width: 1, open: `{${mark}`, close: `${mark}}`, inner: node, entry: 'U-273' }
}

/**
 * C2-I-011, C2-I-049 to C2-I-052: a paragraph of text and plain strong, emphasis and underline spans is written with
 * braced spans and every delimiter character of its text escaped, so 0.2 pairs exactly the spans 0.1 read.
 * It replaces the edits other rules made inside the paragraph; the self-check decides whether it is kept.
 */
export function explicitInline(ctx: Context): void {
  for (const visit of ctx.visits) {
    const node = visit.node
    if (node.type !== 'paragraph' || node.pos === undefined) continue
    const planned: Planned[] = []
    if (!explicitEdits(ctx.src, node, planned) || !planned.some((edit) => edit.text !== '\\')) continue
    const { startOffset: from, endOffset: to } = node.pos
    for (let at = ctx.findings.length - 1; at >= 0; at--) {
      const edit = ctx.findings[at]!.edit
      if (edit !== null && edit.end > from && edit.start < to) ctx.findings.splice(at, 1)
    }
    for (const edit of planned) change(ctx, edit.entry, edit.start, edit.end, edit.text, EXPLICIT_MESSAGE)
  }
}

function columnOf(ctx: Context, visit: Visit): number {
  const { startLine, startOffset } = visit.node.pos!
  return startOffset - lineStart(ctx.lines, startLine)
}

/** The outermost description list that holds `above` and not `below`. */
function leftList(above: Visit, below: Visit): Visit | null {
  let found: Visit | null = null
  for (let at = ancestor(above, 'definition_list'); at !== null; at = ancestor(at, 'definition_list')) {
    if (!isInside(below, at)) found = at
  }
  return found
}

/** The outermost block of `below` that starts on `line` and does not hold `above`. */
function movedBlock(below: Visit, above: Visit, line: number): Visit {
  let block = below
  while (block.parent !== null && block.parent.node.pos?.startLine === line && !isInside(above, block.parent)
    && block.parent.node.type !== 'definition_list') block = block.parent
  return block
}

/** The block that starts on `line` and how far it moves left, when 0.1 ended a description above it. */
function leftOfDescription(ctx: Context, line: number): { block: Visit; shift: number } | null {
  const above = ctx.blocks.leaf[line - 1]
  const below = ctx.blocks.leaf[line]
  if (above == null || below == null || below === above || below.node.pos!.startLine !== line) return null
  const left = quotesOf(above).length > 0 ? null : leftList(above, below)
  if (left === null) return null
  const owner = below.parent?.node.type === 'definition_list' ? below.parent : left
  const shift = indentOf(lineText(ctx.lines, line)) - columnOf(ctx, owner)
  const block = movedBlock(below, above, line)
  // U-204 writes a fence at this column into the description on purpose, so a second run must keep it there.
  return shift > 0 && block.node.type !== 'code_block' ? { block, shift } : null
}

/** The lines from `line` through `last` that are not blank, or none when one of them is indented less than `shift`. */
function shiftedLines(ctx: Context, line: number, last: number, shift: number): number[] {
  const lines: number[] = []
  for (let at = line; at <= last; at++) {
    const text = lineText(ctx.lines, at)
    if (isBlank(text)) continue
    if (!text.startsWith(' '.repeat(shift))) return []
    lines.push(at)
  }
  return lines
}

/**
 * U-435, C2-B-067, C2-B-076: a block indented past a description mark stays in the description in 0.2.
 * Where 0.1 ended the description above it, the block moves to the column of the list that holds it.
 */
export function descriptionColumns(ctx: Context): void {
  for (let line = 2; line <= ctx.lines.count; line++) {
    const found = leftOfDescription(ctx, line)
    if (found === null) continue
    const last = found.block.node.pos!.endLine
    const moved = shiftedLines(ctx, line, last, found.shift)
    for (const at of moved) {
      const start = lineStart(ctx.lines, at)
      change(ctx, 'U-435', start, start + found.shift, '', 'block moved out of the description that 0.1 ended above it')
    }
    if (moved.length > 0) line = last
  }
}

/** The column of the first block of `item` that starts on a line below its marker, or null. */
function bodyColumn(ctx: Context, item: Visit): number | null {
  const marker = item.node.pos!.startLine
  for (const child of (item.node.children ?? []) as Node01[]) {
    if (child.pos === undefined) continue
    if (child.pos.startLine > marker) return child.pos.startOffset - lineStart(ctx.lines, child.pos.startLine)
  }
  return null
}

/**
 * U-436, C2-B-012, C2-B-025: only an open paragraph takes lazy lines in 0.2. A line that 0.1 read into a
 * list item left of the item's column is indented to that column, so the item owns it without one.
 */
export function itemColumns(ctx: Context): void {
  for (const visit of ctx.visits) {
    if (visit.node.type !== 'list_item' || visit.node.pos === undefined || quotesOf(visit).length > 0) continue
    const column = bodyColumn(ctx, visit)
    if (column === null || column === 0) continue
    const { startLine, endLine } = visit.node.pos
    for (let line = startLine + 1; line <= endLine; line++) {
      const text = lineText(ctx.lines, line)
      const indent = indentOf(text)
      if (isBlank(text) || indent >= column || text.slice(0, indent).includes('\t')) continue
      if (ctx.blocks.leaf[line] == null || !isInside(ctx.blocks.leaf[line]!, visit)) continue
      const at = lineStart(ctx.lines, line)
      change(ctx, 'U-436', at, at, ' '.repeat(column - indent), 'line that 0.1 read into the list item indented to its column')
    }
  }
}

/**
 * U-437, C2-B-012, C2-B-024: a paragraph that 0.1 started directly below the text of a list item, outside
 * that item, is a lazy line of the item in 0.2, so a blank line goes above it.
 */
export function itemParagraphBreaks(ctx: Context): void {
  for (let line = 2; line <= ctx.lines.count; line++) {
    const above = ctx.blocks.leaf[line - 1]
    const below = ctx.blocks.leaf[line]
    if (above == null || below == null || above === below || below.node.pos!.startLine !== line) continue
    if (above.node.type !== 'paragraph' || below.node.type !== 'paragraph') continue
    const item = ancestor(above, 'list_item')
    if (item === null || isInside(below, item)) continue
    const shared = quotesOf(above).filter((quote) => isInside(below, quote)).length
    const text = lineText(ctx.lines, line)
    const at = lineStart(ctx.lines, line)
    change(ctx, 'U-437', at, at, quotePrefix(text, shared) + '\n', 'blank line put between the list item text and the paragraph below it')
  }
}
