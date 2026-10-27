import type { Paragraph } from '../../ast.js'

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

/** The paragraphs whose second line folded in from below their container's column. */
const secondLineLazy = new WeakSet<Paragraph>()

/** Record that `para`'s second line was lazy text from below its container's column. */
export function markSecondLineLazy(para: Paragraph): void {
  secondLineLazy.add(para)
}

/** Whether `para`'s second line folded in from below its container's column. */
export function hasLazySecondLine(para: Paragraph): boolean {
  return secondLineLazy.has(para)
}

/** Paragraphs whose second source line begins a caption at the host column. */
const captionAtContentColumn = new WeakSet<Paragraph>()

export function markCaptionAtContentColumn(para: Paragraph): void {
  captionAtContentColumn.add(para)
}

export function hasCaptionAtContentColumn(para: Paragraph): boolean {
  return captionAtContentColumn.has(para)
}
