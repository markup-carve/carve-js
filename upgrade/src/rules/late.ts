import { change, type Context, type Visit } from '../context.ts'
import { isBlank, lineStart, lineText } from '../source.ts'
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
  const text = src.slice(start + 2, end)
  // A code or math span in the text is read before the braced comment can close.
  if (/%\}|\n|`|\$/u.test(text)) return null
  // 0.1 dropped the spaces before the comment; a braced comment keeps its neighbors, so they go too.
  return { from: lineStart ? start : lead, text }
}

const OPENING = new Set(['(', '[', '{', '=', ':', '“', '‘'])

/** Whether 0.2 opens the straight quote at `at`, read from the character before it (C2-I-104, C2-I-105). */
function opens02(src: string, at: number): boolean {
  if (src[at] === "'" && /[0-9]/u.test(src[at + 1] ?? '')) return false
  const before = src[at - 1]
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
