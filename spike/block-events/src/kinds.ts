// Block kinds. Containers come first so that `isLeaf` is one comparison.
export const DOCUMENT = 0
export const QUOTE = 1
export const BULLET_LIST = 2
export const ORDERED_LIST = 3
export const ITEM = 4
export const PARAGRAPH = 5
export const HEADING = 6
export const CODE = 7

export const KIND_NAMES = [
  'document', 'quote', 'bullet_list', 'ordered_list', 'item', 'paragraph', 'heading', 'code',
] as const

export function isLeaf(kind: number): boolean {
  return kind >= PARAGRAPH
}

/**
 * What the block scanner reports. `aux` is the heading level, the bullet
 * character code, the first number of an ordered list or the fence length.
 * A leaf gets one `span` call per content line, as offsets into the source.
 */
export interface BlockSink {
  enter(kind: number, pos: number, aux: number): void
  span(start: number, end: number): void
  exit(kind: number, pos: number): void
}
