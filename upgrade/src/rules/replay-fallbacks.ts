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
