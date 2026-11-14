// U-121, C2-I-072: keep a 0.1 text pair from becoming a defined shortcut.
import { childNodes, type Node } from '../../../v2/src/ast.ts'
import { parseTree } from '../../../v2/src/api.ts'
import { change, type Context } from '../context.ts'

function wasText(ctx: Context, start: number): boolean {
  return ctx.visits.some(({ node }) => node.type === 'text' && node.pos !== undefined &&
    node.pos.startOffset <= start && start < node.pos.endOffset)
}

export function shortcuts(ctx: Context): void {
  const stack: Node[] = [parseTree(ctx.src).document]
  while (stack.length > 0) {
    const node = stack.pop()
    if (node === undefined) continue
    if ((node.type === 'link' || node.type === 'image') && node.refForm === 'shortcut' && node.pos !== undefined) {
      const bracket = node.pos.startOffset + (node.type === 'image' ? 1 : 0)
      if (wasText(ctx, bracket) && ctx.src[bracket] === '[') {
        change(ctx, 'U-121', bracket, bracket, '\\', 'shortcut bracket escaped to keep its 0.1 text')
      }
    }
    stack.push(...childNodes(node))
  }
}
