// Contract 2.8: fences and comment blocks.
import { change, type Context, type Visit } from '../context.ts'
import { type Node01 } from '../engines.ts'
import { indentOf, lineEnd, lineStart, lineText } from '../source.ts'
import { insideQuotes } from './lines.ts'
import { commentShift } from './lists.ts'

const PERCENT = 0x25

/** U-050: the closer of a comment block is a bare run in 0.2 (C2-B-110). */
function commentCloser(ctx: Context, visit: Visit): void {
  const node = visit.node
  const line = node.pos!.endLine
  if (node.block !== true || line === node.pos!.startLine) return
  const text = lineText(ctx.lines, line)
  const marks = text.length - insideQuotes(text).length
  const indent = marks + indentOf(text.slice(marks))
  let at = indent
  while (text.charCodeAt(at) === PERCENT) at++
  const rest = text.slice(at).trim()
  if (at - indent < 3 || rest === '') return
  const start = lineStart(ctx.lines, line)
  const message = 'text after the comment closer moved into the comment'
  // The text goes to the end of the line above, so the closer line keeps its place and its indent.
  // The new line takes the indent U-026 gives the block, or it would leave the item.
  const above = lineEnd(ctx.lines, line - 1)
  change(ctx, 'U-050', above, above, `\n${' '.repeat(commentShift(ctx, visit))}${text.slice(0, indent)}${rest}`, message)
  change(ctx, 'U-050', start + at, lineEnd(ctx.lines, line), '', message)
}

/** U-052: in the body of a line block `%%` is text in 0.2 (C2-B-144); a braced comment renders nothing. */
function commentInLineBlock(ctx: Context, visit: Visit): void {
  const node = visit.node
  if (node.block === true || !ctx.src.startsWith('%%', node.pos!.startOffset)) return
  let inLineBlock = false
  for (let at = visit.parent; at !== null; at = at.parent) inLineBlock ||= at.node.type === 'line_block'
  if (!inLineBlock) return
  const { startOffset: start, endOffset: end } = node.pos!
  change(ctx, 'U-052', start, end, `{% ${ctx.src.slice(start + 2, end).trim()} %}`, 'comment line in a line block written as a braced comment')
}

function runLength(text: string, at: number, code: number): number {
  let end = at
  while (text.charCodeAt(end) === code) end++
  return end - at
}

/** Length of the longest line of `content` that is a bare run of `code`. */
function longestBareRun(content: string, code: number): number {
  let longest = 0
  for (const line of content.split('\n')) {
    const text = line.trim()
    if (text !== '' && runLength(text, 0, code) === text.length) longest = Math.max(longest, text.length)
  }
  return longest
}

/** The prefix of a closer line for the fence that opens at `start`: quote marks kept, a list marker as spaces. */
function closerPrefix(ctx: Context, start: number, line: number): string {
  let out = ''
  for (let at = lineStart(ctx.lines, line); at < start; at++) out += ctx.src[at] === '>' || ctx.src[at] === '\t' ? ctx.src[at]! : ' '
  return out
}

/**
 * U-049: 0.1 refused a closer at another indent and ran the block to the end of its container;
 * 0.2 has no column test (C2-B-109). A longer opener keeps the line in the body, and a closer is
 * added where 0.1 ended the block.
 */
function indentedCloser(ctx: Context, node: Node01): void {
  const { startLine, endLine, startOffset: start } = node.pos!
  const code = ctx.src.charCodeAt(start)
  const length = runLength(ctx.src, start, code)
  if (length < 3 || typeof node.content !== 'string' || (code !== 0x60 && code !== 0x7e)) return
  const last = insideQuotes(lineText(ctx.lines, endLine)).trim()
  const closed = endLine > startLine && runLength(last, 0, code) === last.length && last.length >= length
  const longest = longestBareRun(node.content, code)
  if (closed || longest < length) return
  const run = String.fromCharCode(code).repeat(longest + 1)
  const message = 'fence lengthened past the closer 0.1 refused for its indent, and closed where 0.1 ended it'
  change(ctx, 'U-049', start, start + length, run, message)
  const end = lineEnd(ctx.lines, endLine)
  change(ctx, 'U-049', end, end, '\n' + closerPrefix(ctx, start, startLine) + run, message)
}

/**
 * U-053: 0.1 expanded a tab after the stripped indent of a code line to spaces; 0.2 keeps the
 * bytes (C2-B-004, C2-B-007), so the spaces 0.1 rendered are written.
 */
function tabsInCode(ctx: Context, node: Node01): void {
  const { startLine, endLine } = node.pos!
  const opener = lineText(ctx.lines, startLine)
  const indent = opener.slice(0, indentOf(opener))
  if (typeof node.content !== 'string' || indent === '') return
  const body = node.content.split('\n')
  for (let index = 0; index < body.length && startLine + 1 + index < endLine; index++) {
    const line = startLine + 1 + index
    const text = lineText(ctx.lines, line)
    const lead = indentOf(body[index]!)
    const sourceLead = indentOf(text)
    const tail = text.slice(indent.length, sourceLead)
    if (!text.startsWith(indent) || !tail.includes('\t') || text.slice(sourceLead) !== body[index]!.slice(lead)) continue
    const at = lineStart(ctx.lines, line) + indent.length
    change(ctx, 'U-053', at, at + tail.length, ' '.repeat(lead), 'tab after the stripped indent of a code line written as the spaces 0.1 rendered')
  }
}

export function fences(ctx: Context): void {
  for (const visit of ctx.visits) {
    const node = visit.node
    if (node.pos === undefined) continue
    if (node.type === 'comment') {
      commentCloser(ctx, visit)
      commentInLineBlock(ctx, visit)
    } else if (node.type === 'code_block') {
      indentedCloser(ctx, node)
      tabsInCode(ctx, node)
    }
  }
}
