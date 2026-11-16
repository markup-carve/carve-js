// C2-W-078, C2-W-095: a smart punctuation node of a planned leaf is written as its source. It reads
// back as itself where its neighbors do not lengthen its run and, for a quote, where they give the
// direction its kind names (C2-I-104 to C2-I-117). Every other place is left to the repair.
import { type Node } from './ast.ts'
import { APOSTROPHE_WORDS, CHARACTER_CLASSES, CLASS_QUOTE_CLOSES_BEFORE, CLASS_QUOTE_OPENS_AFTER } from './inline-tables.ts'
import { isBoundarySpace, isWordCharacter, NO_CHARACTER } from './unicode.ts'
import { ATOM, CLOSE, type Leaf, OPEN, TEXT, undecide } from './write-plan-model.ts'

const EN_DASH = 0x2013
const EM_DASH = 0x2014
const LEFT_SINGLE = 0x2018
const LEFT_DOUBLE = 0x201c
const HYPHEN = 45
const SLASH = 47
const LF = 10
const LOWER_A = 97
const NO_BREAK_SPACE = 0xa0
const LONGEST_WORD = 6
// The characters that a run of smart punctuation can continue with (data/smart-punctuation.json).
const RUN_CHARACTERS = '!+-.<=>()'

function inClass(code: number, mask: number): boolean {
  return code >= 0 && code < 128 && (CHARACTER_CLASSES[code]! & mask) !== 0
}

function isDash(code: number): boolean {
  return code === HYPHEN || code === EN_DASH || code === EM_DASH
}

/** C2-I-104, C2-I-106: the reader's test of `quoteOpens` in typography.ts. */
function quoteOpens(previous: number, next: number): boolean {
  if (isBoundarySpace(previous) || previous === LEFT_SINGLE || previous === LEFT_DOUBLE) return true
  if (!isDash(previous) && !inClass(previous, CLASS_QUOTE_OPENS_AFTER)) return false
  if (!isDash(previous) && previous !== SLASH) return true
  return !isBoundarySpace(next) && !inClass(next, CLASS_QUOTE_CLOSES_BEFORE)
}

function isSurrogate(code: number): boolean {
  return code >= 0xd800 && code < 0xe000
}

function lastCodePoint(text: string | undefined): number | null {
  if (text === undefined || text === '') return null
  const code = text.charCodeAt(text.length - 1)
  return isSurrogate(code) ? text.codePointAt(text.length - 2) ?? null : code
}

/** C2-I-026: a braced comment counts as nothing for the neighbors of a quote. */
function isBracedComment(leaf: Leaf, at: number): boolean {
  const owner = leaf.owners[at]
  return leaf.kinds[at] === ATOM && owner?.type === 'comment' && owner.form === 'braced'
}

/**
 * What the reader sees before the unit behind a mark or an atom: the glyph of a quote, the start of a content, a
 * break, a no-break space, and behind any other node that closed, a word character (`afterNode` in inline-emit.ts).
 */
function previousOfNode(leaf: Leaf, at: number): number | null {
  const owner = leaf.owners[at]
  const kind = leaf.kinds[at]
  if (kind === ATOM && owner?.type === 'smart_punctuation') return lastCodePoint(owner.glyph)
  // C2-I-104: the content of a node starts with no character before it.
  if (kind === OPEN) return NO_CHARACTER
  if (kind === CLOSE) return LOWER_A
  if (kind !== ATOM || owner === undefined || owner.type === 'comment') return null
  if (owner.type === 'non_breaking_space') return NO_BREAK_SPACE
  return owner.type === 'soft_break' || owner.type === 'hard_break' ? LF : LOWER_A
}

/** The code point of text that ends at unit `at`, the edge of the leaf, what a node leaves before it, or null. */
function previousOf(leaf: Leaf, from: number): number | null {
  let at = from
  while (at >= 0 && isBracedComment(leaf, at)) at--
  if (at < 0) return NO_CHARACTER
  if (leaf.kinds[at] !== TEXT) return previousOfNode(leaf, at)
  const code = leaf.codes[at]!
  if (!isSurrogate(code)) return code
  const high = leaf.codes[at - 1]
  if (code < 0xdc00 || high === undefined || high < 0xd800 || high >= 0xdc00 || leaf.kinds[at - 1] !== TEXT) return null
  return (high - 0xd800) * 0x400 + code - 0xdc00 + 0x10000
}

/** The code point the reader sees at unit `at`, which is the source a mark or an atom is written as, or the edge. */
function nextOf(leaf: Leaf, from: number): number | null {
  let at = from
  while (at < leaf.codes.length && isBracedComment(leaf, at)) at++
  if (at >= leaf.codes.length) return NO_CHARACTER
  const code = leaf.codes[at]!
  if (!isSurrogate(code)) return code
  const low = leaf.codes[at + 1]
  if (code >= 0xdc00 || low === undefined || low < 0xdc00 || low >= 0xe000) return null
  return (code - 0xd800) * 0x400 + low - 0xdc00 + 0x10000
}

/** C2-I-107: whether an apostrophe word may start at `at`; the leaf is left to the repair there. */
function mayStartWord(leaf: Leaf, at: number): boolean {
  let end = at
  while (end - at <= LONGEST_WORD && isAsciiLetter(leaf.codes[end] ?? -1)) end++
  return end > at && APOSTROPHE_WORDS.includes(String.fromCharCode(...leaf.codes.slice(at, end)).toLowerCase())
}

function isAsciiLetter(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122)
}

/** C2-I-105 to C2-I-109: the kind a single quote at `at` reads as, with the open state of the leaf, or null. */
function singleKind(leaf: Leaf, at: number, previous: number, next: number): string | null {
  if (next >= 48 && next <= 57) return 'right_single_quote'
  if (!quoteOpens(previous, next)) {
    if (!isWordCharacter(previous) || !isWordCharacter(next)) leaf.singleQuoteOpen = false
    return 'right_single_quote'
  }
  if (mayStartWord(leaf, at + 1)) return null
  if (leaf.singleQuoteOpen && isWordCharacter(next)) return 'right_single_quote'
  leaf.singleQuoteOpen = true
  return 'left_single_quote'
}

function isRunCharacter(code: number): boolean {
  return code >= 0 && code < 128 && RUN_CHARACTERS.includes(String.fromCharCode(code))
}

/** Whether the smart punctuation `node`, written at `[at, end)`, reads back as itself. */
function readsBack(leaf: Leaf, at: number, end: number, node: Node): boolean {
  if (node.type !== 'smart_punctuation') return false
  const previous = previousOf(leaf, at - 1)
  const next = nextOf(leaf, end)
  if (previous === null || next === null) return false
  const source = node.source
  if (source === '"') return (quoteOpens(previous, next) ? 'left_double_quote' : 'right_double_quote') === node.kind
  if (source === '\'') return !leaf.inlineFootnote && singleKind(leaf, at, previous, next) === node.kind
  return !isRunCharacter(previous) && !isRunCharacter(next)
}

/** C2-W-078: the smart punctuation atoms of the leaf read back as themselves. */
export function checkSmart(leaf: Leaf, at: number, node: Node): void {
  let end = at
  while (end < leaf.codes.length && leaf.kinds[end] === ATOM && leaf.owners[end] === node) end++
  if (!readsBack(leaf, at, end, node)) undecide(leaf, 'smart punctuation')
}
