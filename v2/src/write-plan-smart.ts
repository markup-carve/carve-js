// C2-W-078, C2-W-095: a smart punctuation node of a planned leaf is written as its source. It reads
// back as itself where its neighbors do not lengthen its run and, for a quote, where they give the
// direction its kind names (C2-I-104 to C2-I-117). Every other place is left to the repair.
import { type Node } from './ast.ts'
import { CHARACTER_CLASSES, CLASS_QUOTE_CLOSES_BEFORE, CLASS_QUOTE_OPENS_AFTER } from './inline-tables.ts'
import { isBoundarySpace, NO_CHARACTER } from './unicode.ts'
import { ATOM, type Leaf, TEXT, undecide } from './write-plan-model.ts'

const EN_DASH = 0x2013
const EM_DASH = 0x2014
const LEFT_SINGLE = 0x2018
const LEFT_DOUBLE = 0x201c
const HYPHEN = 45
const SLASH = 47
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

/** The unit at `at` beside an atom: the edge of the leaf, a unit of text, or null where it is anything else. */
function neighbor(leaf: Leaf, at: number): number | null {
  if (at < 0 || at >= leaf.codes.length) return NO_CHARACTER
  if (leaf.kinds[at] !== TEXT) return null
  const code = leaf.codes[at]!
  return code >= 0xd800 && code < 0xe000 ? null : code
}

/** The kind a straight quote reads as between `previous` and `next`, or null where that takes more than its neighbors. */
function quoteKind(source: string, previous: number, next: number): string | null {
  if (source === '"') return quoteOpens(previous, next) ? 'left_double_quote' : 'right_double_quote'
  if (next >= 48 && next <= 57) return 'right_single_quote'
  if (!quoteOpens(previous, next)) return 'right_single_quote'
  // C2-I-107, C2-I-108: an opening single quote depends on the word behind it and on the quotes before it.
  return null
}

/** Whether the smart punctuation `node`, written at `[at, end)`, reads back as itself. */
function readsBack(leaf: Leaf, at: number, end: number, node: Node): boolean {
  if (node.type !== 'smart_punctuation') return false
  const previous = neighbor(leaf, at - 1)
  const next = neighbor(leaf, end)
  if (previous === null || next === null) return false
  const source = node.source
  if (source === '"' || source === '\'') return quoteKind(source, previous, next) === node.kind
  return !RUN_CHARACTERS.includes(String.fromCharCode(previous)) && !RUN_CHARACTERS.includes(String.fromCharCode(next))
}

/** C2-W-078: the smart punctuation atoms of the leaf read back as themselves. */
export function checkSmart(leaf: Leaf, at: number, node: Node): void {
  let end = at
  while (end < leaf.codes.length && leaf.kinds[end] === ATOM && leaf.owners[end] === node) end++
  if (!readsBack(leaf, at, end, node)) undecide(leaf, 'smart punctuation')
}
