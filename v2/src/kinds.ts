// Block kinds. Containers come first, so `isLeaf` is one comparison.
export const DOCUMENT = 0
export const QUOTE = 1
export const BULLET_LIST = 2
export const ORDERED_LIST = 3
export const ITEM = 4
export const DESCRIPTION_LIST = 5
export const DESCRIPTION = 6
export const FOOTNOTE = 7
export const DIV = 8
export const PARAGRAPH = 9
export const TERM = 10
export const CAPTION = 11
export const CODE = 12
export const COMMENT_BLOCK = 13
export const LINE_BLOCK = 14
export const FRONTMATTER = 15
export const HEADING = 16
export const THEMATIC_BREAK = 17
export const COMMENT = 18
export const ATTRIBUTES = 19
export const INCLUDE = 20
export const LINK_DEFINITION = 21
export const ABBREVIATION = 22

export const KIND_NAMES = [
  'document', 'quote', 'bullet_list', 'ordered_list', 'item', 'description_list', 'description', 'footnote', 'div',
  'paragraph', 'term', 'caption', 'code', 'comment_block', 'line_block', 'frontmatter', 'heading',
  'thematic_break', 'comment', 'attributes', 'include', 'link_definition', 'abbreviation',
] as const

export function isLeaf(kind: number): boolean {
  return kind >= PARAGRAPH
}

export function isList(kind: number): boolean {
  return kind === BULLET_LIST || kind === ORDERED_LIST
}

/** The containers whose prefix is indent past their marker (C2-B-023). */
export function isIndentContainer(kind: number): boolean {
  return kind === ITEM || kind === DESCRIPTION || kind === FOOTNOTE
}

/** The leaves that take lazy lines (C2-B-011, C2-B-057, C2-B-103). */
export function isTextLeaf(kind: number): boolean {
  return kind === PARAGRAPH || kind === TERM || kind === CAPTION
}

/** The leaves whose body is not read and that end at a closer (C2-B-084, C2-B-087, C2-B-112). */
export function isOpaqueLeaf(kind: number): boolean {
  return kind >= CODE && kind <= FRONTMATTER
}

// Flags of the enter event of a list. Together with the kind they are the kind of the list (C2-B-041).
export const FLAG_STAR = 1
export const FLAG_TASK = 2
export const FLAG_PAREN = 4
export const FLAG_ALPHA = 8
export const FLAG_ROMAN = 16
export const FLAG_UPPER = 32
export const LIST_STYLE_MASK = 63
// The first marker of an ordered list has no number. Not part of the list's kind.
export const FLAG_AUTO = 64

// Flags of the enter event of a div (C2-B-088) and of an item (C2-B-079).
export const FLAG_HARD_BREAKS = 1
export const FLAG_QUOTE_FENCE = 2
export const FLAG_FIGURE = 4
export const FLAG_MARKER_ATTRIBUTES = 1

// Flag of any enter event: the block takes the attribute lines that stand before it (C2-B-069).
export const FLAG_ATTRIBUTES = 128

// Flags of an exit event, the facts set at close (C2-B-132).
export const FLAG_TIGHT = 1
export const FLAG_IMAGE = 2
export const FLAG_UNCLOSED = 4
