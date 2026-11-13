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
export const TABLE = 9
export const ROW = 10
export const PARAGRAPH = 11
export const TERM = 12
export const CAPTION = 13
export const CODE = 14
export const COMMENT_BLOCK = 15
export const LINE_BLOCK = 16
export const FRONTMATTER = 17
export const HEADING = 18
export const THEMATIC_BREAK = 19
export const COMMENT = 20
export const ATTRIBUTES = 21
export const INCLUDE = 22
export const LINK_DEFINITION = 23
export const ABBREVIATION = 24
export const CELL = 25

export const KIND_NAMES = [
  'document', 'quote', 'bullet_list', 'ordered_list', 'item', 'description_list', 'description', 'footnote', 'div',
  'table', 'row', 'paragraph', 'term', 'caption', 'code', 'comment_block', 'line_block', 'frontmatter', 'heading',
  'thematic_break', 'comment', 'attributes', 'include', 'link_definition', 'abbreviation', 'cell',
] as const

export function isLeaf(kind: number): boolean {
  return kind >= PARAGRAPH
}

export function isList(kind: number): boolean {
  return kind === BULLET_LIST || kind === ORDERED_LIST
}

/** The containers whose prefix is indent past their marker (C2-B-025). */
export function isIndentContainer(kind: number): boolean {
  return kind === ITEM || kind === DESCRIPTION || kind === FOOTNOTE
}

/** The leaves that take lazy lines (C2-B-012, C2-B-069, C2-B-148). */
export function isTextLeaf(kind: number): boolean {
  return kind === PARAGRAPH || kind === TERM || kind === CAPTION
}

/** The leaves whose body is not read and that end at a closer (C2-B-114, C2-B-123, C2-B-162). */
export function isOpaqueLeaf(kind: number): boolean {
  return kind >= CODE && kind <= FRONTMATTER
}

// Flags of the enter event of a list. Together with the kind they are the kind of the list (C2-B-049).
export const FLAG_STAR = 1
export const FLAG_TASK = 2
export const FLAG_PAREN = 4
export const FLAG_ALPHA = 8
export const FLAG_ROMAN = 16
export const FLAG_UPPER = 32
export const LIST_STYLE_MASK = 63
// The first marker of an ordered list has no number. Not part of the list's kind.
export const FLAG_AUTO = 64

// Flags of the enter event of a div (C2-B-124), an item (C2-B-101), a code fence, a row and a cell.
export const FLAG_HARD_BREAKS = 1
export const FLAG_QUOTE_FENCE = 2
export const FLAG_FIGURE = 4
export const FLAG_MARKER_ATTRIBUTES = 1
// A raw block (C2-B-116) and a delimited table (C2-B-180).
export const FLAG_RAW = 1
export const FLAG_DELIMITED = 2
// A continuation row (C2-B-175).
export const FLAG_CONTINUATION = 1
// A header cell, a cell with a brace block in its prefix (C2-B-171) and the span marks (C2-B-172).
export const FLAG_HEADER = 1
export const FLAG_CELL_ATTRIBUTES = 2
export const FLAG_SPAN_LEFT = 4
export const FLAG_SPAN_UP = 8

// Flag of any enter event: the block takes the attribute lines that stand before it (C2-B-091).
export const FLAG_ATTRIBUTES = 128

// Flags of an exit event, the facts set at close (C2-B-191).
export const FLAG_TIGHT = 1
export const FLAG_IMAGE = 2
export const FLAG_UNCLOSED = 4
export const FLAG_MATH = 8
