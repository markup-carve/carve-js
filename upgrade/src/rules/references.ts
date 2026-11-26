// What 0.1 does with a reference: shared by the inline rewrites and the escapes.
import { isInside } from '../blocks.ts'
import { type Context, type Visit } from '../context.ts'

/** The text of `visits[from]` as a reader sees it: the values of the leaves under it. */
export function plainText(visits: Visit[], from: number): string {
  const top = visits[from]!
  let text = ''
  for (let at = from + 1; at < visits.length && isInside(visits[at]!, top); at++) {
    const value = visits[at]!.node.value
    if (typeof value === 'string') text += value
    else if (visits[at]!.node.type === 'soft_break') text += ' '
  }
  return text
}

export function headingTexts(ctx: Context): Set<string> {
  const texts = new Set<string>()
  ctx.visits.forEach((visit, index) => {
    if (visit.node.type === 'heading') texts.add(plainText(ctx.visits, index))
  })
  return texts
}

/**
 * Whether the link at `visits[index]` is a reference 0.1 left unresolved and wrote as typed. The
 * 0.1 tree gives a resolved definition its `href`; the collapsed form also finds a heading.
 */
export function isUnresolved(ctx: Context, index: number, headings: Set<string>): boolean {
  const link = ctx.visits[index]!.node
  if (link.type !== 'link' || link.href !== '' || typeof link.ref !== 'string' || typeof link.rawRef !== 'string') return false
  return !(link.rawRef.endsWith('[]') && headings.has(plainText(ctx.visits, index)))
}
