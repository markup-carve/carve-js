// U-120, C2-B-046: keep the 0.1 text of a box after an ordered marker.
import { change, type Context } from '../context.ts'
import { lineEnd } from '../source.ts'

const BOX_MARKS = ' xX_/!->?'

export function orderedTasks(ctx: Context): void {
  for (const visit of ctx.visits) {
    if (visit.node.type !== 'list_item' || visit.parent?.node.type !== 'list' || visit.parent.node.ordered !== true) continue
    const item = visit.node
    const position = item.pos
    const first = item.children?.[0]
    const text = first?.children?.[0]
    const at = text?.pos?.startOffset
    if (first?.type !== 'paragraph' || text?.type !== 'text' || at === undefined) continue
    if (position === undefined || text.pos?.startLine !== position.startLine || ctx.src[at] !== '[' || ctx.src[at + 2] !== ']') continue
    if (!BOX_MARKS.includes(ctx.src[at + 1] ?? '') || ctx.src[at + 3] !== ' ') continue
    if (at + 4 >= lineEnd(ctx.lines, position.startLine)) continue
    change(ctx, 'U-120', at, at, '\\', 'ordered task box escaped to keep its 0.1 text')
  }
}
