// The brace block of a node (C2-W-047 to C2-W-050): the id, the classes, the language, the keys.
import { type AstNode, classesOf, keyValuesOf } from './ast.ts'
import { UNDERSCORE } from './chars.ts'
import { isAsciiLetter, isAsciiNameCharacter, isAsciiPunctuation } from './unicode.ts'

/** C2-I-030: a name is one or more ASCII letters, digits, `_` and `-`. */
export function isName(text: string): boolean {
  if (text.length === 0) return false
  for (let at = 0; at < text.length; at++) if (!isAsciiNameCharacter(text.charCodeAt(at))) return false
  return true
}

/** C2-I-030: a key is an ASCII letter or `_`, then name characters. */
function isKey(text: string): boolean {
  const first = text.charCodeAt(0)
  return isName(text) && (isAsciiLetter(first) || first === UNDERSCORE)
}

/** C2-I-032: an unquoted value has no space, tab, quote, backslash, pipe or closing brace. */
function isUnquoted(value: string): boolean {
  if (value.length === 0) return false
  for (const char of value) if (' \t"\'\\|}'.includes(char)) return false
  return true
}

/**
 * `value` in double quotes (C2-I-033): a quote takes a backslash, and so does a backslash that
 * would otherwise be read as an escape, which is one before ASCII punctuation or the closing quote.
 */
export function quoted(value: string): string {
  let out = '"'
  for (let at = 0; at < value.length; at++) {
    const char = value[at]!
    const next = at + 1 < value.length ? value.charCodeAt(at + 1) : 34
    if (char === '"' || (char === '\\' && isAsciiPunctuation(next))) out += '\\'
    out += char
  }
  return `${out}"`
}

/** C2-W-049, C2-W-050: one key with its value. */
function keyPart(key: string, value: string): string {
  // C2-I-031: a bare key does not start with `_`.
  if (value === '') return key.startsWith('_') ? `${key}=""` : key
  return `${key}=${isUnquoted(value) ? value : quoted(value)}`
}

export interface BlockParts {
  /** What stands before the id: the alignment mark of a cell (C2-W-062). */
  mark?: string
  /** Keys that the tree holds in other fields, written before the keys of `attrs`. */
  keys?: readonly (readonly [string, string])[]
  /** Classes that the opener of the block stands for and that are not written (C2-W-039, C2-W-081). */
  skipClasses?: readonly number[]
}

function classParts(node: AstNode, parts: string[], skip: readonly number[]): void {
  const classes = classesOf(node)
  for (let at = 0; at < classes.length; at++) {
    if (skip.includes(at)) continue
    const name = classes[at]!
    // C2-W-048: a class the `.name` form cannot hold is a quoted `class` key at its place.
    parts.push(isName(name) ? `.${name}` : `class=${quoted(name)}`)
  }
}

function keyParts(node: AstNode, parts: string[], first: readonly (readonly [string, string])[]): void {
  for (const [key, value] of first) parts.push(keyPart(key, value))
  for (const [key, value] of keyValuesOf(node)) if (isKey(key)) parts.push(keyPart(key, value))
}

/** C2-W-048: the brace block of `node`, or the empty string when it has nothing to write. */
export function braceBlock(node: AstNode, extra?: BlockParts): string {
  const parts: string[] = []
  const id = node.attrs?.id
  if (id !== undefined) parts.push(isName(id) ? `#${id}` : `id=${quoted(id)}`)
  classParts(node, parts, extra?.skipClasses ?? [])
  if (node.lang !== undefined) parts.push(`:${node.lang}`)
  keyParts(node, parts, extra?.keys ?? [])
  const mark = extra?.mark ?? ''
  if (mark !== '') parts.unshift(mark)
  return parts.length === 0 ? '' : `{${parts.join(' ')}}`
}
