// Terminal helpers of the ANSI export: display width and the Unicode forms of superscript and subscript.
import { displayWidth as clusterWidth } from '../width.ts'
import { stripBidi } from './common.ts'

/** Columns `text` takes in a terminal; bidirectional controls are dropped from the output, so they take none. */
export function displayWidth(text: string): number {
  return clusterWidth(stripBidi(text))
}

const SUPERSCRIPT: Readonly<Record<string, string>> = {
  0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '+': '⁺', '-': '⁻', '=': '⁼', '(': '⁽', ')': '⁾',
  n: 'ⁿ', i: 'ⁱ',
}

const SUBSCRIPT: Readonly<Record<string, string>> = {
  0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉', '+': '₊', '-': '₋', '=': '₌', '(': '₍', ')': '₎',
  a: 'ₐ', e: 'ₑ', o: 'ₒ', x: 'ₓ',
}

/** Maps each character that has a form in `map`, leaving SGR sequences of styled children intact. */
function mapOutsideSgr(text: string, map: Readonly<Record<string, string>>): string {
  const parts = text.split(/(\x1b\[[0-9;]*m)/u)
  return parts.map((part, at) => (at % 2 === 1 ? part : Array.from(part, (ch) => map[ch] ?? ch).join(''))).join('')
}

export function toSuperscript(text: string): string {
  return mapOutsideSgr(text, SUPERSCRIPT)
}

export function toSubscript(text: string): string {
  return mapOutsideSgr(text, SUBSCRIPT)
}
