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

const BULLETS = '-*+'

/** The closing brace of the attribute block that opens at `at`, skipping braces inside quoted values, or -1. */
function blockEnd(src: string, at: number): number {
  let quote = ''
  for (let index = at + 1; index < src.length && src[index] !== '\n'; index++) {
    const character = src[index]!
    if (quote !== '') { if (character === quote) quote = ''; continue }
    if (character === '"' || character === "'") quote = character
    else if (character === '}') return index
  }
  return -1
}

/** Where the spaces behind a bullet start and the box begins, for a 0.1 task item with more than one space between. */
function wideBoxGap(ctx: Context, node: Node01): { from: number; to: number } | null {
  const marker = node.pos!.startOffset
  if (!BULLETS.includes(ctx.src[marker] ?? '')) return null
  // An attribute block glued to the bullet stands before the spaces (C2-B-046 counts them after it).
  const glued = ctx.src[marker + 1] === '{' ? blockEnd(ctx.src, marker + 1) : marker
  if (glued < 0 || glued >= lineEnd(ctx.lines, node.pos!.startLine)) return null
  let at = glued + 1
  while (ctx.src[at] === ' ') at++
  return at - glued >= 3 && boxAt(ctx, at, node.pos!.startLine) !== null ? { from: glued + 2, to: at } : null
}

/** U-434, C2-B-046: 0.1 read a box after a run of spaces behind a bullet; 0.2 reads it only directly after one space. */
export function taskBoxSpacing(ctx: Context): void {
  for (const visit of ctx.visits) {
    const { node } = visit
    if (node.type !== 'list_item' || typeof node.checked !== 'boolean' || node.pos === undefined) continue
    if (visit.parent?.node.type !== 'list' || visit.parent.node.ordered === true) continue
    const gap = wideBoxGap(ctx, node)
    if (gap !== null) change(ctx, 'U-434', gap.from, gap.to, '', 'spaces between the bullet and the task box reduced to one')
  }
}
