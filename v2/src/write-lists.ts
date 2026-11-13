// The markers of a list (C2-W-042 to C2-W-045) and whether two lists would read as one (C2-W-028).
import { type AstNode } from './ast.ts'
import { type Writer } from './write-state.ts'

/** C2-B-036: a number marker has at most nine digits, and a roman numeral at most nine letters. */
const MAX_MARKER_LENGTH = 9
const MAX_DECIMAL = 999999999
const MAX_ROMAN = 3999
const LETTERS = 26
/** The values of the one-letter roman numerals, which an alphabetic list reads as letters (C2-B-042). */
const ROMAN_LETTERS = [1, 5, 10, 50, 100, 500, 1000]
const ROMAN_PLACES: readonly (readonly [number, string])[] = [
  [1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i'],
]

export interface ListMarkers {
  /** The marker of each item, without the space behind it. */
  markers: string[]
  /** C2-B-045: the start value that no first marker can carry, for the attribute line. */
  start: string | null
}

function roman(value: number): string {
  let out = ''
  let rest = value
  for (const [amount, letters] of ROMAN_PLACES) {
    while (rest >= amount) {
      out += letters
      rest -= amount
    }
  }
  return out
}

/** The marker text of `value` in a letter style, or null where the marker grammar cannot hold it (C2-B-036). */
function letterMarker(style: string, value: number): string | null {
  const lower = style.toLowerCase()
  let text: string | null = null
  if (lower === 'a') text = value >= 1 && value <= LETTERS ? String.fromCharCode(96 + value) : null
  else if (value >= 1 && value <= MAX_ROMAN) text = roman(value)
  if (text === null || text.length > MAX_MARKER_LENGTH) return null
  return style === lower ? text : text.toUpperCase()
}

/** C2-B-042: whether a first marker of `value` would be read as the other letter style. */
function readsAsOtherStyle(style: string, value: number): boolean {
  const lower = style.toLowerCase()
  if (lower === 'a') return value === 9
  return value !== 1 && ROMAN_LETTERS.includes(value)
}

/** C2-W-045: letters or numerals in sequence; a value that no marker holds is the first value of the style. */
function letterMarkers(style: string, delimiter: string, start: number, count: number): ListMarkers {
  const first = letterMarker(style, start)
  const moved = first === null || readsAsOtherStyle(style, start)
  const from = moved ? 1 : start
  const markers: string[] = []
  for (let at = 0; at < count; at++) markers.push(`${letterMarker(style, from + at) ?? letterMarker(style, 1)!}${delimiter}`)
  return { markers, start: moved ? String(start) : null }
}

/** C2-W-044: a decimal list with written numbers. Only the first marker carries a value (C2-B-041). */
function numberedMarkers(delimiter: string, start: number, count: number): ListMarkers {
  const moved = start > MAX_DECIMAL
  const from = moved ? 1 : start
  const markers: string[] = []
  for (let at = 0; at < count; at++) markers.push(`${from + at > MAX_DECIMAL ? 1 : from + at}${delimiter}`)
  return { markers, start: moved ? String(start) : null }
}

function decimalMarkers(w: Writer, node: AstNode, delimiter: string, start: number, count: number): ListMarkers {
  // C2-L-031: a bare `)` is no marker. C2-L-030: with no fact a list with the period takes the bare dot.
  const bare = delimiter === '.' && (w.facts?.get(node)?.bare ?? true)
  if (!bare && !(start > MAX_DECIMAL && delimiter === '.')) return numberedMarkers(delimiter, start, count)
  return { markers: new Array<string>(count).fill('.'), start: start === 1 ? null : String(start) }
}

/** The markers of the items of `node`, and the start value for its attribute line. */
export function listMarkers(w: Writer, node: AstNode): ListMarkers {
  const count = node.children?.length ?? 0
  const marker = node.marker
  if (marker?.kind !== 'ordered') return { markers: new Array<string>(count).fill(marker?.char ?? '-'), start: null }
  const style = marker.style ?? '1'
  const delimiter = marker.delimiter ?? '.'
  const start = marker.start ?? 1
  return style === '1' ? decimalMarkers(w, node, delimiter, start, count) : letterMarkers(style, delimiter, start, count)
}

function isUpper(style: string): boolean {
  return style !== style.toLowerCase()
}

function sameOrderedKind(a: AstNode, b: AstNode): boolean {
  const first = a.marker?.style ?? '1'
  const second = b.marker?.style ?? '1'
  if ((a.marker?.delimiter ?? '.') !== (b.marker?.delimiter ?? '.')) return false
  // C2-B-038, C2-B-039: a single letter is a sibling in a list of the other letter style.
  return first === second || (first !== '1' && second !== '1' && isUpper(first) === isUpper(second))
}

/** C2-B-049, C2-B-053: whether the list `b` directly after the list `a` would continue it. */
export function sameListKind(a: AstNode, b: AstNode): boolean {
  if (a.type === 'definition_list') return b.type === 'definition_list'
  if (a.type !== 'list' || b.type !== 'list' || a.marker?.kind !== b.marker?.kind) return false
  return sameTaskKind(a, b) && (a.marker?.kind === 'ordered' ? sameOrderedKind(a, b) : a.marker?.char === b.marker?.char)
}

/** C2-B-049: an item matches a list also in being a task item or not. */
function sameTaskKind(a: AstNode, b: AstNode): boolean {
  const last = a.children?.[a.children.length - 1]
  return (last?.task === undefined) === (b.children?.[0]?.task === undefined)
}
