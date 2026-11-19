// The display width of a table segment (C2-W-119): the sum of the widths of its extended
// grapheme clusters by UAX #29, each 2 when it holds a wide or fullwidth code point and 1 otherwise.
// The property values are those of Unicode 18.0.0, whatever the host runtime has.
import { GCB, INCB_CONSONANT, INCB_EXTEND, INCB_LINKER, PICT, WIDE } from './width-data.ts'

const ASCII_END = 0x80
const CR = 1
const LF = 2
const CONTROL = 3
const EXTEND = 4
const ZWJ = 5
const REGIONAL_INDICATOR = 6
const PREPEND = 7
const SPACING_MARK = 8
const L = 9
const V = 10
const T = 11
const LV = 12
const LVT = 13

/** The value of `codePoint` in a sorted range table: the third number of its range, or 1 where a range has two. */
function property(ranges: readonly number[], codePoint: number, stride: 2 | 3): number {
  let low = 0
  let high = ranges.length / stride - 1
  while (low <= high) {
    const middle = (low + high) >>> 1
    const offset = middle * stride
    if (codePoint < ranges[offset]!) high = middle - 1
    else if (codePoint > ranges[offset + 1]!) low = middle + 1
    else return stride === 3 ? ranges[offset + 2]! : 1
  }
  return 0
}

/** What the boundary rules read from the code points before the current one, carried forward. */
interface Context {
  /** The break class of the code point before, or 0 at the start. */
  before: number
  /** The regional indicators that end at the code point before. */
  indicators: number
  /** GB9c: the last code point that is no Indic extender without the linker property is a linker. */
  linker: boolean
  /** GB11: the last code point that is not Extend is pictographic, read before a joiner and at it. */
  pictographic: boolean
  pictographicBeforeJoiner: boolean
}

/** GB6 to GB8: a break inside a Hangul syllable. */
function joinsHangul(before: number, at: number): boolean {
  if (before === L) return at === L || at === V || at === LV || at === LVT
  if (before === LV || before === V) return at === V || at === T
  return (before === LVT || before === T) && at === T
}

function isControl(gcb: number): boolean {
  return gcb === CR || gcb === LF || gcb === CONTROL
}

/** GB9 to GB13: whether the code point joins the cluster before it by what it is or by what came before. */
function joinsCluster(context: Context, codePoint: number, gcb: number): boolean {
  const before = context.before
  // GB9, GB9a, GB9b.
  if (gcb === EXTEND || gcb === ZWJ || gcb === SPACING_MARK || before === PREPEND) return true
  if (context.linker && property(INCB_CONSONANT, codePoint, 2) !== 0) return true
  if (before === ZWJ && context.pictographicBeforeJoiner && property(PICT, codePoint, 2) !== 0) return true
  // GB12, GB13: regional indicators pair from the start of their run.
  return before === REGIONAL_INDICATOR && gcb === REGIONAL_INDICATOR && context.indicators % 2 === 1
}

/** UAX #29: whether a cluster boundary stands before a code point of class `gcb`. */
function breaksBefore(context: Context, codePoint: number, gcb: number): boolean {
  const before = context.before
  // GB3 to GB5.
  if (before === CR && gcb === LF) return false
  if (isControl(before) || isControl(gcb)) return true
  return !joinsHangul(before, gcb) && !joinsCluster(context, codePoint, gcb)
}

function advance(context: Context, codePoint: number, gcb: number): void {
  const linker = property(INCB_LINKER, codePoint, 2) !== 0
  if (linker || property(INCB_EXTEND, codePoint, 2) === 0) context.linker = linker
  context.pictographicBeforeJoiner = context.pictographic
  if (gcb !== EXTEND) context.pictographic = property(PICT, codePoint, 2) !== 0
  context.indicators = gcb === REGIONAL_INDICATOR ? context.indicators + 1 : 0
  context.before = gcb
}

/** The display width of text that holds a code point outside ASCII. */
function wideWidth(text: string): number {
  const context: Context = { before: 0, indicators: 0, linker: false, pictographic: false, pictographicBeforeJoiner: false }
  let width = 0
  let wide = false
  let first = true
  for (const char of text) {
    const codePoint = char.codePointAt(0)!
    const gcb = property(GCB, codePoint, 3)
    if (first || breaksBefore(context, codePoint, gcb)) {
      width += first ? 0 : wide ? 2 : 1
      wide = false
    }
    first = false
    if (property(WIDE, codePoint, 2) !== 0) wide = true
    advance(context, codePoint, gcb)
  }
  return first ? 0 : width + (wide ? 2 : 1)
}

/** C2-W-119: the display width of `text`. */
export function displayWidth(text: string): number {
  for (let at = 0; at < text.length; at++) {
    const code = text.charCodeAt(at)
    // A control character of ASCII is a cluster of its own with width 1, as every other ASCII character; CR LF is one.
    if (code >= ASCII_END || code === 13) return wideWidth(text)
  }
  return text.length
}
