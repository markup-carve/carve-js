// C2-I-073, C2-I-096, C2-I-124: whether `<` of a planned leaf opens an autolink or a cross-reference.
// The test reads the codes of the leaf as the reader reads source: a backslash the writer puts in
// front of a unit is no URL character, so an escape inside the body ends it.
import {
  CHARACTER_CLASSES, CLASS_EMAIL_DOMAIN, CLASS_EMAIL_LAST, CLASS_EMAIL_LOCAL, CLASS_SCHEME_FIRST, CLASS_SCHEME_REST, CLASS_URL_BODY,
} from './inline-tables.ts'
import { isUrlCharacter } from './unicode.ts'
import { type Leaf } from './write-plan-model.ts'

const GREATER = 62
const SPACE = 32
const LF = 10
const AT_SIGN = 64
const COLON = 58
const DOT = 46
const SLASH = 47
const HASH = 35

function inClass(code: number, mask: number): boolean {
  return code >= 0 && code < 128 && (CHARACTER_CLASSES[code]! & mask) !== 0
}

function codeAt(leaf: Leaf, at: number): number {
  return at < leaf.codes.length ? leaf.codes[at]! : -1
}

function runEnd(leaf: Leaf, at: number, mask: number): number {
  let end = at
  while (inClass(codeAt(leaf, end), mask)) end++
  return end
}

/** C2-I-073, C2-I-122: a scheme, a colon and URL characters up to `>`. */
function isUrl(leaf: Leaf, at: number): boolean {
  if (!inClass(codeAt(leaf, at), CLASS_SCHEME_FIRST)) return false
  let end = runEnd(leaf, at + 1, CLASS_SCHEME_REST)
  if (codeAt(leaf, end) !== COLON) return false
  const body = ++end
  for (;;) {
    const code = codeAt(leaf, end)
    if (code < 0) return false
    if (code < 128 ? !inClass(code, CLASS_URL_BODY) : !isUrlCharacter(code)) break
    end++
  }
  return end > body && codeAt(leaf, end) === GREATER
}

/** C2-I-123: a local part, an at-sign, a domain that ends in a dot and letters, and `>`. */
function isEmail(leaf: Leaf, at: number): boolean {
  const sign = runEnd(leaf, at, CLASS_EMAIL_LOCAL)
  if (sign === at || codeAt(leaf, sign) !== AT_SIGN) return false
  const close = runEnd(leaf, sign + 1, CLASS_EMAIL_DOMAIN)
  if (codeAt(leaf, close) !== GREATER) return false
  let label = close
  while (label > sign + 1 && inClass(codeAt(leaf, label - 1), CLASS_EMAIL_LAST)) label--
  return label < close && label > sign + 2 && codeAt(leaf, label - 1) === DOT
}

/** C2-I-096: `</#`, an id without `>`, a space or a line break, and `>`. */
function isCrossReference(leaf: Leaf, at: number): boolean {
  if (codeAt(leaf, at + 1) !== SLASH || codeAt(leaf, at + 2) !== HASH || at < leaf.angleFailEnd) return false
  let end = at + 3
  for (let code = codeAt(leaf, end); code >= 0 && code !== GREATER && code !== SPACE && code !== LF; code = codeAt(leaf, end)) end++
  // No opener before `end` finds a closer either, as in the reader.
  if (codeAt(leaf, end) !== GREATER) leaf.angleFailEnd = end
  return end > at + 3 && codeAt(leaf, end) === GREATER
}

/** Whether the `<` at `at` opens an autolink or a cross-reference. */
export function opensAngleAtom(leaf: Leaf, at: number): boolean {
  return isCrossReference(leaf, at) || isUrl(leaf, at + 1) || isEmail(leaf, at + 1)
}
