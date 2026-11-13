// Block kinds. Containers come first, so `isLeaf` is one comparison.
export const DOCUMENT = 0
export const QUOTE = 1
export const BULLET_LIST = 2
export const ORDERED_LIST = 3
export const ITEM = 4
export const PARAGRAPH = 5
export const HEADING = 6
export const CODE = 7
export const THEMATIC_BREAK = 8
export const COMMENT = 9

export const KIND_NAMES = [
  'document', 'quote', 'bullet_list', 'ordered_list', 'item',
  'paragraph', 'heading', 'code', 'thematic_break', 'comment',
] as const

export function isLeaf(kind: number): boolean {
  return kind >= PARAGRAPH
}

export function isList(kind: number): boolean {
  return kind === BULLET_LIST || kind === ORDERED_LIST
}

// Flags of an enter event. Together with the kind they are the kind of a list (C2-B-041).
export const FLAG_STAR = 1
export const FLAG_TASK = 2
export const FLAG_PAREN = 4
// The first marker of the list has no number. Not part of the list's kind.
export const FLAG_AUTO = 8

// Flag of the exit event of a list (C2-B-132).
export const FLAG_TIGHT = 1
