import { change, type Context } from '../context.ts'
import { type Node01 } from '../engines.ts'

function textOnly(node: Node01): boolean {
  return (node.children ?? []).every((child) => child.type === 'text' || child.type === 'soft_break'
    || (child.type === 'emphasis' && textOnly(child)))
}

/** 0.1 also paired the reversed strong/emphasis delimiters beside U-068. */
export function flippedStrong(ctx: Context): void {
  for (const { node } of ctx.visits) {
    if (node.type !== 'strong' || node.pos === undefined || !textOnly(node)
      || !(node.children ?? []).some((child) => child.type === 'emphasis')) continue
    const { startOffset: start, endOffset: end } = node.pos
    if (!ctx.src.startsWith('*/', start) || !ctx.src.startsWith('/*', end - 2)) continue
    const message = 'the reversed strong and emphasis delimiters use an explicit braced span'
    change(ctx, 'U-068', start, start + 2, '{*{/', message)
    change(ctx, 'U-068', end - 2, end, '/}*}', message)
    for (let at = start + 2; at < end - 2; at++) {
      if ((ctx.src[at] === '{' || ctx.src[at] === '}') && ctx.src[at - 1] !== '\\') {
        change(ctx, 'U-068', at, at, '\\', message)
      }
    }
  }
}

/** A deprecated glued header spelling that 0.1 kept as cell text must stay cell text. */
export function literalTableHeader(ctx: Context): void {
  for (const { node } of ctx.visits) {
    if (node.type !== 'table_cell' || node.pos === undefined || node.header === true) continue
    const { startOffset: start, endOffset: end } = node.pos
    const value = ctx.src.slice(start, end)
    const marker = value.indexOf('=~>')
    if (marker < 0 || value.slice(0, marker).trim() !== '') continue
    change(ctx, 'U-168', start + marker, start + marker, '\\',
      'the deprecated glued header spelling is literal cell text in 0.1')
  }
}
