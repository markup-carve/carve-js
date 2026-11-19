// C2-I-090, C2-I-092: whether `@` or `#` of text in a planned leaf starts a mention or a tag. The name is
// read on the units of text; a name that runs into a mark, an atom or an escape is left to the repair.
import {
  CHARACTER_CLASSES, CLASS_EXTENSION_FIRST, CLASS_EXTENSION_REST, CLASS_MENTION, CLASS_SYMBOL_FIRST, CLASS_SYMBOL_REST,
} from './inline-tables.ts'
import { type Leaf, TEXT } from './write-plan-model.ts'

const DOT = 46
const HYPHEN = 45
export const NO_NAME = 0
export const NAME = 1
export const UNKNOWN = 2

function isNameCharacter(code: number): boolean {
  return code >= 0 && code < 128 && (CHARACTER_CLASSES[code]! & CLASS_MENTION) !== 0
}

function isAsciiLetter(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122)
}

/** A dot inside a name: not its first character, not behind another dot, and before a character of the name. */
function isInnerDot(leaf: Leaf, at: number, start: number): boolean {
  return leaf.codes[at] === DOT && at !== start && leaf.codes[at - 1] !== DOT && isNameCharacter(leaf.codes[at + 1] ?? -1)
}

/** NAME where a name with a letter follows the sigil at `at`, NO_NAME where none does, UNKNOWN otherwise. */
export function sigilName(leaf: Leaf, at: number): number {
  const start = at + 1
  let end = start
  let letters = false
  for (; end < leaf.codes.length; end++) {
    const value = leaf.codes[end]!
    if (leaf.kinds[end] !== TEXT) {
      if (isNameCharacter(value) || value === DOT) return UNKNOWN
      break
    }
    if (isNameCharacter(value)) letters ||= isAsciiLetter(value)
    else if (!isInnerDot(leaf, end, start)) break
  }
  // A trailing hyphen or dot is text behind the name.
  while (end > start && (leaf.codes[end - 1] === HYPHEN || leaf.codes[end - 1] === DOT)) end--
  return end > start && letters ? NAME : NO_NAME
}

function inClass(code: number, mask: number): boolean {
  return code >= 0 && code < 128 && (CHARACTER_CLASSES[code]! & mask) !== 0
}

/** The end of the run of `mask` from `at` over units of text, or -1 where the run reaches a unit of another kind. */
function textRunEnd(leaf: Leaf, at: number, mask: number): number {
  let end = at
  while (inClass(leaf.codes[end] ?? -1, mask)) {
    if (leaf.kinds[end] !== TEXT) return -1
    end++
  }
  return end
}

/**
 * C2-I-093, C2-I-094: what a colon of text after a boundary starts: NAME for a symbol, NO_NAME for nothing or
 * an inline extension of text, whose bracket is paired later, UNKNOWN for a name that runs into a node.
 */
export function colonName(leaf: Leaf, at: number): number {
  const first = leaf.codes[at + 1] ?? -1
  if (inClass(first, CLASS_EXTENSION_FIRST)) {
    const end = textRunEnd(leaf, at + 2, CLASS_EXTENSION_REST)
    if (end < 0 || (leaf.codes[end] === 91 && leaf.kinds[end] !== TEXT)) return UNKNOWN
    // The bracket pairs in write-plan-brackets.ts, which escapes the colon where the extension forms.
    if (leaf.codes[end] === 91) {
      leaf.extensions.set(end, at)
      return NO_NAME
    }
  }
  if (!inClass(first, CLASS_SYMBOL_FIRST)) return NO_NAME
  if (leaf.kinds[at + 1] !== TEXT) return UNKNOWN
  const end = textRunEnd(leaf, at + 2, CLASS_SYMBOL_REST)
  if (end < 0) return UNKNOWN
  return leaf.codes[end] === 58 && leaf.codes[end - 1] !== HYPHEN ? NAME : NO_NAME
}
