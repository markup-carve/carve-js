// A source given as bytes (C2-B-218): decoded as UTF-8 by the WHATWG decoder, each maximal subpart of an ill-formed
// sequence read as one U+FFFD, with every offset counted in the source bytes, and kept as bytes by a layout (C2-L-056).
import { forEachSlot, type Node } from './ast.ts'
import { append } from './append.ts'

const STRICT = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
const LENIENT = new TextDecoder('utf-8', { ignoreBOM: true })
const REPLACEMENT_BYTES = 3
const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** The text of a source and, for bytes that are not well-formed UTF-8, those bytes and where each U+FFFD stands. */
export interface SourceText {
  text: string
  /** Null for a string and for well-formed bytes, whose offsets the text counts as they stand. */
  bytes: Uint8Array | null
  /** For each replaced subpart, the offset of its U+FFFD in the UTF-8 of the text and the source bytes it spans. */
  replaced: [number, number][]
}

/** The continuation bytes a lead byte needs, or 0 for a byte that starts no sequence. */
function continuations(lead: number): number {
  if (lead >= 0xc2 && lead <= 0xdf) return 1
  if (lead >= 0xe0 && lead <= 0xef) return 2
  return lead >= 0xf0 && lead <= 0xf4 ? 3 : 0
}

/** The bounds of the second byte that keep the sequence short of overlong forms, surrogates and past U+10FFFF. */
function secondBounds(lead: number): [number, number] {
  if (lead === 0xe0) return [0xa0, 0xbf]
  if (lead === 0xed) return [0x80, 0x9f]
  if (lead === 0xf0) return [0x90, 0xbf]
  return lead === 0xf4 ? [0x80, 0x8f] : [0x80, 0xbf]
}

/** The length of the well-formed sequence at `at`, or the negative length of the maximal subpart it starts. */
function sequenceAt(bytes: Uint8Array, at: number): number {
  const lead = bytes[at] ?? 0
  if (lead < 0x80) return 1
  const need = continuations(lead)
  if (need === 0) return -1
  const [low, high] = secondBounds(lead)
  for (let index = 1; index <= need; index++) {
    const byte = bytes[at + index] ?? -1
    if (byte < (index === 1 ? low : 0x80) || byte > (index === 1 ? high : 0xbf)) return -index
  }
  return need + 1
}

/** C2-B-218: the text of a source; a string is read as it stands. */
export function sourceText(input: string | Uint8Array): SourceText {
  if (typeof input === 'string') return { text: input, bytes: null, replaced: [] }
  try {
    return { text: STRICT.decode(input), bytes: null, replaced: [] }
  } catch {
    const replaced: [number, number][] = []
    let decoded = 0
    for (let at = 0; at < input.length;) {
      const length = sequenceAt(input, at)
      if (length < 0) replaced.push([decoded, -length])
      decoded += length < 0 ? REPLACEMENT_BYTES : length
      at += Math.abs(length)
    }
    return { text: LENIENT.decode(input), bytes: input, replaced }
  }
}

/** For each replaced subpart, how many more bytes the text holds than the source up to and including it. */
function cumulativeShifts(replaced: readonly [number, number][]): number[] {
  const shifts: number[] = []
  let shift = 0
  for (const [, length] of replaced) shifts.push(shift += REPLACEMENT_BYTES - length)
  return shifts
}

/** The source byte offset of the UTF-8 offset `offset` of the text; `shifts` comes from `cumulativeShifts`. */
function sourceOffset(replaced: readonly [number, number][], shifts: readonly number[], offset: number): number {
  let low = 0
  let high = replaced.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (replaced[middle]![0] < offset) low = middle + 1
    else high = middle
  }
  return low === 0 ? offset : offset - shifts[low - 1]!
}

/** C2-B-218: every position of the top-level source counts its bytes; positions in an included file are left as they are. */
export function mapPositions(source: SourceText, document: Node): void {
  if (source.bytes === null) return
  const { replaced } = source
  const shifts = cumulativeShifts(replaced)
  const pending: Node[] = [document]
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    const pos = node.pos
    if (pos !== undefined && pos.file === undefined) {
      pos.startOffset = sourceOffset(replaced, shifts, pos.startOffset)
      pos.endOffset = sourceOffset(replaced, shifts, pos.endOffset)
    }
    forEachSlot(node, (nodes) => { append(pending, nodes) })
  }
}

/** C2-L-056: the bytes in the base64 alphabet of RFC 4648, section 4, with padding. */
export function base64(bytes: Uint8Array): string {
  let out = ''
  for (let at = 0; at < bytes.length; at += 3) {
    const bits = (bytes[at] ?? 0) << 16 | (bytes[at + 1] ?? 0) << 8 | (bytes[at + 2] ?? 0)
    const digits = Math.min(4, bytes.length - at + 1)
    for (let digit = 0; digit < 4; digit++) out += digit < digits ? BASE64[bits >> (18 - 6 * digit) & 63] : '='
  }
  return out
}
