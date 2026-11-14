// U-120, C2-B-046: keep the 0.1 text of a box after an ordered marker.
import { change, type Context, type Visit } from '../context.ts'
import { type Node01 } from '../engines.ts'
import { lineEnd } from '../source.ts'

const BOX_MARKS = ' xX_/!->?'

function boxAt(ctx: Context, at: number, line: number): number | null {
  if (ctx.src[at] !== '[' || ctx.src[at + 2] !== ']') return null
  if (!BOX_MARKS.includes(ctx.src[at + 1] ?? '') || ctx.src[at + 3] !== ' ') return null
  return at + 4 < lineEnd(ctx.lines, line) ? at : null
}

function itemBox(ctx: Context, item: Node01): number | null {
  const position = item.pos
  const first = item.children?.[0]
  if (position === undefined || first?.type !== 'paragraph') return null
  const text = first.children?.[0]
  if (text?.type !== 'text' || text.pos === undefined || text.pos.startLine !== position.startLine) return null
  return boxAt(ctx, text.pos.startOffset, position.startLine)
}

function isOrderedItem(visit: Visit): boolean {
  return visit.node.type === 'list_item' && visit.parent?.node.type === 'list' && visit.parent.node.ordered === true
}

export function orderedTasks(ctx: Context): void {
  for (const visit of ctx.visits) {
    if (!isOrderedItem(visit)) continue
    const at = itemBox(ctx, visit.node)
    if (at === null) continue
    change(ctx, 'U-120', at, at, '\\', 'ordered task box escaped to keep its 0.1 text')
  }
}
