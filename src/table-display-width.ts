import { GCB, WIDE, PICT, INCB_CONSONANT, INCB_LINKER, INCB_EXTEND } from './table-unicode-18-data.js'

function property(ranges: readonly number[], codePoint: number, stride: 2 | 3): number {
  let low = 0
  let high = Math.floor(ranges.length / stride) - 1
  while (low <= high) {
    const mid = (low + high) >>> 1
    const offset = mid * stride
    if (codePoint < ranges[offset]!) high = mid - 1
    else if (codePoint > ranges[offset + 1]!) low = mid + 1
    else return stride === 3 ? ranges[offset + 2]! : 1
  }
  return 0
}

const [CR, LF, CONTROL, EXTEND, ZWJ, RI, PREPEND, SPACING_MARK, L, V, T, LV, LVT] =
  [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]

interface Character {
  text: string
  gcb: number
  pict: boolean
  consonant: boolean
  linker: boolean
  indicExtend: boolean
}

function characters(text: string): Character[] {
  return Array.from(text, (char) => {
    const codePoint = char.codePointAt(0)!
    return {
      text: char,
      gcb: property(GCB, codePoint, 3),
      pict: property(PICT, codePoint, 2) !== 0,
      consonant: property(INCB_CONSONANT, codePoint, 2) !== 0,
      linker: property(INCB_LINKER, codePoint, 2) !== 0,
      indicExtend: property(INCB_EXTEND, codePoint, 2) !== 0,
    }
  })
}

/**
 * Context each boundary rule reads from the characters before it, carried
 * forward once so no rule rescans the text (carve-js#3143).
 */
interface Context {
  /** Regional indicators ending at this character. */
  riRun: number
  /** GB9c: the last character that is not a non-linker Indic extender is a linker. */
  linkerBefore: boolean
  /** GB11: the last character that is not Extend is Extended_Pictographic. */
  pictBefore: boolean
}

function contexts(chars: Character[]): Context[] {
  const out: Context[] = []
  let riRun = 0
  let linkerBefore = false
  let pictBefore = false
  for (const char of chars) {
    riRun = char.gcb === RI ? riRun + 1 : 0
    if (!(char.indicExtend && !char.linker)) linkerBefore = char.linker
    if (char.gcb !== EXTEND) pictBefore = char.pict
    out.push({ riRun, linkerBefore, pictBefore })
  }
  return out
}

function breakBefore(chars: Character[], context: Context[], index: number): boolean {
  const left = chars[index - 1]!
  const right = chars[index]!
  const a = left.gcb
  const b = right.gcb
  if (a === CR && b === LF) return false // GB3
  if (a === CR || a === LF || a === CONTROL) return true // GB4
  if (b === CR || b === LF || b === CONTROL) return true // GB5
  if (a === L && [L, V, LV, LVT].includes(b)) return false // GB6
  if ((a === LV || a === V) && (b === V || b === T)) return false // GB7
  if ((a === LVT || a === T) && b === T) return false // GB8
  if (b === EXTEND || b === ZWJ || b === SPACING_MARK) return false // GB9, GB9a
  if (a === PREPEND) return false // GB9b
  if (right.consonant && context[index - 1]!.linkerBefore) return false // GB9c
  if (right.pict && a === ZWJ && index >= 2 && context[index - 2]!.pictBefore) return false // GB11
  if (a === RI && b === RI && context[index - 1]!.riRun % 2 === 1) return false // GB12, GB13
  return true // GB999
}

/** Unicode 18.0.0 extended grapheme clusters. */
export function tableGraphemeClusters(text: string): string[] {
  const chars = characters(text)
  if (chars.length === 0) return []
  const context = contexts(chars)
  const clusters: string[] = []
  let current = ''
  for (let i = 0; i < chars.length; i++) {
    if (i > 0 && breakBefore(chars, context, i)) {
      clusters.push(current)
      current = ''
    }
    current += chars[i]!.text
  }
  clusters.push(current)
  return clusters
}

/** Unicode 18.0.0 grapheme width for CARVE-P11-071. */
export function tableDisplayWidth(text: string): number {
  let width = 0
  for (const cluster of tableGraphemeClusters(text)) {
    width += Array.from(cluster).some(char => property(WIDE, char.codePointAt(0)!, 2) !== 0) ? 2 : 1
  }
  return width
}
