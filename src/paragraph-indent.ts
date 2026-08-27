import type { Paragraph } from './ast.js'

/**
 * The paragraphs whose first source line sat ABOVE their container's content
 * column (carve-js#1552).
 */
const aboveContentColumn = new WeakSet<Paragraph>()

/** Record that `para`'s first line sat above its container's content column. */
export function markAboveContentColumn(para: Paragraph): void {
  aboveContentColumn.add(para)
}

/** Whether `para` began at its container's content column. */
export function isAtContentColumn(para: Paragraph): boolean {
  return !aboveContentColumn.has(para)
}
