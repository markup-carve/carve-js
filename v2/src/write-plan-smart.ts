// C2-W-078, C2-W-095: a smart punctuation node of a planned leaf is written as its source. It reads
// back as itself where its neighbors do not lengthen its run and, for a quote, where the neighbor before
// it gives the direction its kind names (C2-I-104, C2-I-105, C2-I-111 to C2-I-117). Every other place is
// left to the repair.
import { type Node } from './ast.ts'
import { smartGlyph } from './ast-text.ts'
import { CHARACTER_CLASSES, CLASS_QUOTE_OPENS_AFTER } from './inline-tables.ts'
import { isAsciiDigit, isBoundarySpace, NO_CHARACTER } from './unicode.ts'
import { ATOM, CLOSE, type Leaf, OPEN, TEXT, undecide } from './write-plan-model.ts'

const LEFT_SINGLE = 0x2018
const LEFT_DOUBLE = 0x201c
const LF = 10
const LOWER_A = 97
const NO_BREAK_SPACE = 0xa0
// The characters that a run of smart punctuation can continue with (data/smart-punctuation.json).
const RUN_CHARACTERS = '!+-.<=>()'

function inClass(code: number, mask: number): boolean {
  return code >= 0 && code < 128 && (CHARACTER_CLASSES[code]! & mask) !== 0
}

/** C2-I-104: the reader's test of `quoteOpens` in typography.ts, from the neighbor before alone. */
function quoteOpens(previous: number): boolean {
  return isBoundarySpace(previous) || previous === LEFT_SINGLE || previous === LEFT_DOUBLE || inClass(previous, CLASS_QUOTE_OPENS_AFTER)
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
  if (kind === ATOM && owner?.type === 'smart_punctuation') return lastCodePoint(smartGlyph(owner))
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

/** C2-I-105: before an ASCII digit a single quote is the apostrophe; a digit written by a node is left to the repair. */
function singleKind(leaf: Leaf, end: number, previous: number, next: number): string | null {
  const digit = isAsciiDigit(next)
  if (digit && end < leaf.kinds.length && leaf.kinds[end] !== TEXT) return null
  return quoteOpens(previous) && !digit ? 'left_single_quote' : 'right_single_quote'
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
  if (source === '"') return (quoteOpens(previous) ? 'left_double_quote' : 'right_double_quote') === node.kind
  if (source === '\'') return singleKind(leaf, end, previous, next) === node.kind
  return !isRunCharacter(previous) && !isRunCharacter(next)
}

/** C2-W-078: the smart punctuation atoms of the leaf read back as themselves. */
export function checkSmart(leaf: Leaf, at: number, node: Node): void {
  let end = at
  while (end < leaf.codes.length && leaf.kinds[end] === ATOM && leaf.owners[end] === node) end++
  if (!readsBack(leaf, at, end, node)) undecide(leaf, 'smart punctuation')
}
