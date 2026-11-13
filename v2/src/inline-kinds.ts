// Inline kinds. They follow the block kinds, so one event tag names either. Nodes with inline
// children come first, so `isInlineContainer` is one comparison.
import { BRACED_NODES } from './inline-tables.ts'

export const EMPHASIS = 26
export const STRONG = 27
export const UNDERLINE = 28
export const STRIKE = 29
export const HIGHLIGHT = 30
export const SUPERSCRIPT = 31
export const SUBSCRIPT = 32
export const INSERT = 33
export const DELETE = 34
export const BRACKET_SPAN = 35
export const LINK = 36
export const INLINE_FOOTNOTE = 37
export const INLINE_EXTENSION = 38
// The alt text of an image is source, not content (C2-I-074).
export const IMAGE = 39
export const CODE_SPAN = 40
export const LITERAL = 41
export const MATH = 42
export const RAW_INLINE = 43
export const INLINE_COMMENT = 44
export const EDITORIAL = 45
export const AUTOLINK = 46
export const XREF = 47
export const MENTION = 48
export const TAG = 49
export const SYMBOL = 50
export const FOOTNOTE_REF = 51
export const NBSP = 52
export const HARD_BREAK = 53
export const SOFT_BREAK = 54
export const SMART = 55
export const ESCAPE = 56
// Parts of a link, an image or a host. They stand behind the content of their node.
export const DESTINATION = 57
export const TITLE = 58
export const LABEL = 59
export const ATTRIBUTE_BLOCK = 60

export const FIRST_INLINE_KIND = EMPHASIS

export const INLINE_KIND_NAMES = [
  'emphasis', 'strong', 'underline', 'strike', 'highlight', 'superscript', 'subscript', 'insert', 'delete', 'span',
  'link', 'inline_footnote', 'inline_extension', 'image', 'code', 'literal_inline', 'math', 'raw_inline', 'comment',
  'critic_comment', 'autolink', 'xref', 'mention', 'tag', 'symbol', 'footnote_ref', 'non_breaking_space',
  'hard_break', 'soft_break', 'smart_punctuation', 'escape', 'destination', 'title', 'label', 'attributes',
] as const

export function isInlineContainer(kind: number): boolean {
  return kind >= EMPHASIS && kind <= INLINE_EXTENSION
}

/** The node kind of each braced mark, in the order of BRACED_MARKS. */
export const BRACED_KINDS: readonly number[] = BRACED_NODES.map(
  (name) => FIRST_INLINE_KIND + (INLINE_KIND_NAMES as readonly string[]).indexOf(name),
)

// Flags of an enter event. The braced form of a delimiter node and of a comment.
export const FLAG_BRACED = 1
// A link or an image written as a reference (C2-I-072), and its collapsed form.
export const FLAG_REFERENCE = 1
export const FLAG_COLLAPSED = 2
export const FLAG_DISPLAY = 1
export const FLAG_EMAIL = 1
// A code, literal-text or math span with no closing run (C2-I-017).
export const FLAG_OPEN_END = 2

const HOSTS = [
  EMPHASIS, STRONG, UNDERLINE, STRIKE, HIGHLIGHT, SUPERSCRIPT, SUBSCRIPT, INSERT, DELETE, BRACKET_SPAN, LINK,
  INLINE_FOOTNOTE, INLINE_EXTENSION, IMAGE, CODE_SPAN, LITERAL, MATH, AUTOLINK, SYMBOL, FOOTNOTE_REF,
]

/** C2-I-036, C2-I-037: the kinds an attribute block attaches to. */
export function isHost(kind: number): boolean {
  return HOSTS.includes(kind)
}
