// C2-I-090, C2-I-092: whether `@` or `#` of text in a planned leaf starts a mention or a tag. The name is
// read on the units of text; a name that runs into a mark, an atom or an escape is left to the repair.
import { CHARACTER_CLASSES, CLASS_MENTION } from './inline-tables.ts'
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
