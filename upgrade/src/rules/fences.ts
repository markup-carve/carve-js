// Contract 2.8: fences and comment blocks.
import { change, type Context, type Visit } from '../context.ts'
import { type Node01 } from '../engines.ts'
import { indentOf, lineEnd, lineStart, lineText } from '../source.ts'

const PERCENT = 0x25

/** U-050: the closer of a comment block is a bare run in 0.2 (C2-B-110). */
function commentCloser(ctx: Context, node: Node01): void {
  const line = node.pos!.endLine
  if (node.block !== true || line === node.pos!.startLine) return
  const text = lineText(ctx.lines, line)
  const indent = indentOf(text)
  let at = indent
  while (text.charCodeAt(at) === PERCENT) at++
  const rest = text.slice(at).trim()
  if (at - indent < 3 || rest === '') return
  const run = text.slice(0, at)
  const start = lineStart(ctx.lines, line)
  change(ctx, 'U-050', start, lineEnd(ctx.lines, line), `${text.slice(0, indent)}${rest}\n${run}`, 'text after the comment closer moved into the comment')
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

export function fences(ctx: Context): void {
  for (const visit of ctx.visits) {
    if (visit.node.type !== 'comment' || visit.node.pos === undefined) continue
    commentCloser(ctx, visit.node)
    commentInLineBlock(ctx, visit)
  }
}
