// Inline kinds. They follow the block kinds, so one event tag names either. Nodes with inline
// children come first, so `isInlineContainer` is one comparison.
import { BRACED_NODES } from './inline-tables.ts'

export const EMPHASIS = 28
export const STRONG = 29
export const UNDERLINE = 30
export const STRIKE = 31
export const HIGHLIGHT = 32
export const SUPERSCRIPT = 33
export const SUBSCRIPT = 34
export const INSERT = 35
export const DELETE = 36
export const BRACKET_SPAN = 37
export const LINK = 38
export const INLINE_FOOTNOTE = 39
export const INLINE_EXTENSION = 40
// The alt text of an image is source, not content (C2-I-074).
export const IMAGE = 41
export const CODE_SPAN = 42
export const LITERAL = 43
export const MATH = 44
export const RAW_INLINE = 45
export const INLINE_COMMENT = 46
export const EDITORIAL = 47
export const AUTOLINK = 48
export const XREF = 49
export const MENTION = 50
export const TAG = 51
export const SYMBOL = 52
export const FOOTNOTE_REF = 53
export const NBSP = 54
export const HARD_BREAK = 55
export const SOFT_BREAK = 56
export const SMART = 57
export const ESCAPE = 58
// Parts of a link, an image or a host. They stand behind the content of their node.
export const DESTINATION = 59
export const TITLE = 60
export const LABEL = 61
export const ATTRIBUTE_BLOCK = 62
// C2-I-128: an inline snippet use, a leaf of one name.
export const SNIPPET_USE_INLINE = 63

export const FIRST_INLINE_KIND = EMPHASIS

export const INLINE_KIND_NAMES = [
  'emphasis', 'strong', 'underline', 'strike', 'highlight', 'superscript', 'subscript', 'insert', 'delete', 'span',
  'link', 'inline_footnote', 'inline_extension', 'image', 'code', 'literal_inline', 'math', 'raw_inline', 'comment',
  'critic_comment', 'autolink', 'xref', 'mention', 'tag', 'symbol', 'footnote_ref', 'non_breaking_space',
  'hard_break', 'soft_break', 'smart_punctuation', 'escape', 'destination', 'title', 'label', 'attributes', 'snippet_use',
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
export const FLAG_SHORTCUT = 4
export const FLAG_DISPLAY = 1
export const FLAG_EMAIL = 1
// Flag of a span event: text the inline pass prints as written, an atom no term matches in (C2-I-035, C2-I-100).
export const FLAG_ATOM = 1

const HOSTS = [
  EMPHASIS, STRONG, UNDERLINE, STRIKE, HIGHLIGHT, SUPERSCRIPT, SUBSCRIPT, INSERT, DELETE, BRACKET_SPAN, LINK,
  INLINE_FOOTNOTE, INLINE_EXTENSION, IMAGE, CODE_SPAN, LITERAL, MATH, AUTOLINK, SYMBOL, FOOTNOTE_REF, EDITORIAL,
]

/** C2-I-036: the kinds an attribute block attaches to. */
export function isHost(kind: number): boolean {
  return HOSTS.includes(kind)
}
