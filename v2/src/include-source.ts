// The physical lines of an included file (C2-N-034) and its region markers (C2-N-037 to C2-N-041).
import { BYTE_ORDER_MARK, CR, HASH, HYPHEN, PERCENT, SLASH, STAR, TAB, UNDERSCORE } from './chars.ts'
import { isRange } from './include.ts'
import { isAsciiAlphanumeric, isAsciiLetter, isAsciiNameCharacter } from './unicode.ts'

/** C2-N-034: line `i` is `[starts[i], ends[i])` without its line ending; `nexts[i]` is where the line after it starts. */
export interface FileLines {
  starts: number[]
  ends: number[]
  nexts: number[]
}

/**
 * C2-B-010, C2-N-034: a line ends at LF, a CR before that LF is not part of it, a final line ending begins no further
 * line, and a leading U+FEFF is not content, so an empty file and one that holds only U+FEFF have no lines.
 */
export function fileLines(text: string): FileLines {
  const lines: FileLines = { starts: [], ends: [], nexts: [] }
  let start = text.charCodeAt(0) === BYTE_ORDER_MARK ? 1 : 0
  while (start < text.length) {
    const lf = text.indexOf('\n', start)
    const next = lf < 0 ? text.length : lf + 1
    let end = lf < 0 ? text.length : lf
    if (lf >= 0 && end > start && text.charCodeAt(end - 1) === CR) end--
    lines.starts.push(start)
    lines.ends.push(end)
    lines.nexts.push(next)
    start = next
  }
  return lines
}

/** A range of lines by index, `from` included and `to` excluded. */
export interface LineRange {
  from: number
  to: number
}

/** C2-B-205: the two numbers of a range option that the parse already found in shape. */
export function rangeBounds(value: string): [number, number] {
  const dash = value.indexOf('-')
  return [Number(value.slice(0, dash)), Number(value.slice(dash + 1))]
}

/** C2-N-035: the lines of `@lines:N-M`, clipped at the last line, or null when the range starts past it. */
export function lineRange(value: string, count: number): LineRange | null {
  if (!isRange(value)) return null
  const [first, last] = rangeBounds(value)
  return first > count ? null : { from: first - 1, to: Math.min(last, count) }
}

const NOT_MARKER = 0
const MALFORMED = 1
const OPENER = 2
const CLOSER = 3

interface Marker {
  kind: number
  name: string
}

const NO_MARKER: Marker = { kind: NOT_MARKER, name: '' }
const BAD_MARKER: Marker = { kind: MALFORMED, name: '' }

function skipBlanks(line: string, at: number): number {
  while (at < line.length && (line.charCodeAt(at) === 0x20 || line.charCodeAt(at) === TAB)) at++
  return at
}

/** C2-N-038, C2-N-039: where the keyword may start behind a comment opener, and the closer the line must end with. */
function markerBody(line: string, at: number, code: boolean): { at: number, closer: string } | null {
  if (line.startsWith('%%', at)) return line.charCodeAt(at + 2) === PERCENT ? null : { at: at + 2, closer: '' }
  if (!code) return null
  const first = line.charCodeAt(at)
  if ((first === SLASH || first === HYPHEN) && line.charCodeAt(at + 1) === first) return { at: at + 2, closer: '' }
  if (first === SLASH && line.charCodeAt(at + 1) === STAR) return { at: at + 2, closer: '*/' }
  if (line.startsWith('<!--', at)) return { at: at + 4, closer: '-->' }
  return first === HASH ? { at, closer: '' } : null
}

function isNameStart(code: number): boolean {
  return isAsciiLetter(code) || code === UNDERSCORE
}

/** The marker after its keyword at `at`: blanks, an optional name, blanks, the closer, blanks, and nothing else. */
function markerTail(line: string, at: number, closer: string, kind: number): Marker {
  let p = skipBlanks(line, at)
  let name = ''
  if (p > at && p < line.length && isNameStart(line.charCodeAt(p))) {
    const start = p
    while (p < line.length && isAsciiNameCharacter(line.charCodeAt(p))) p++
    name = line.slice(start, p)
    p = skipBlanks(line, p)
  }
  if (closer !== '') {
    if (!line.startsWith(closer, p)) return BAD_MARKER
    p = skipBlanks(line, p + closer.length)
  }
  if (p !== line.length) return BAD_MARKER
  // C2-N-041: an opener names its region.
  return kind === OPENER && name === '' ? BAD_MARKER : { kind, name }
}

/** C2-N-038 to C2-N-040: the region marker on the line, a malformed marker, or none. */
export function readMarker(line: string, code: boolean): Marker {
  const body = markerBody(line, skipBlanks(line, 0), code)
  if (body === null) return NO_MARKER
  const at = skipBlanks(line, body.at)
  const end = line.startsWith('#endregion', at) ? at + 10 : line.startsWith('#region', at) ? at + 7 : -1
  if (end < 0) return NO_MARKER
  // C2-N-040: a keyword run on by a letter, a digit or `_` is no marker; by anything else it is a malformed one.
  const next = line.charCodeAt(end)
  if (isAsciiAlphanumeric(next) || next === UNDERSCORE) return NO_MARKER
  return markerTail(line, end, body.closer, end - at === 10 ? CLOSER : OPENER)
}

/** True when line `index` is a well-formed region marker of a code include (C2-N-046). */
export function isMarkerLine(text: string, lines: FileLines, index: number): boolean {
  const kind = readMarker(text.slice(lines.starts[index], lines.ends[index]), true).kind
  return kind === OPENER || kind === CLOSER
}

/** Why a region selects nothing, as the message of `include-region-invalid` says it. */
export const REGION_MALFORMED = 'has a malformed or unmatched marker in the file'
export const REGION_MISSING = 'is not opened in the file'

interface RegionScan {
  stack: Marker[]
  seen: Set<string>
  range: LineRange | null
}

/** One marker of the scan; returns false where the markers of the file are not well formed (C2-N-041). */
function takeMarker(scan: RegionScan, marker: Marker, index: number, name: string): boolean {
  if (marker.kind === OPENER) {
    if (scan.seen.has(marker.name)) return false
    scan.seen.add(marker.name)
    scan.stack.push({ kind: index, name: marker.name })
    return true
  }
  const open = scan.stack.pop()
  if (open === undefined || (marker.name !== '' && marker.name !== open.name)) return false
  if (open.name === name) scan.range = { from: open.kind + 1, to: index }
  return true
}

/** C2-N-037, C2-N-041: the lines strictly between the markers of the region `name`, or the reason there are none. */
export function regionRange(text: string, lines: FileLines, name: string, code: boolean): LineRange | string {
  const scan: RegionScan = { stack: [], seen: new Set(), range: null }
  for (let index = 0; index < lines.starts.length; index++) {
    const marker = readMarker(text.slice(lines.starts[index], lines.ends[index]), code)
    if (marker.kind === NOT_MARKER) continue
    if (marker.kind === MALFORMED || !takeMarker(scan, marker, index, name)) return REGION_MALFORMED
  }
  if (scan.stack.length > 0) return REGION_MALFORMED
  return scan.range ?? REGION_MISSING
}

/** C2-N-043: the payload of a code include: one line feed after each selected line; a lone CR stays content (C2-B-010). */
export function payloadOf(text: string, lines: FileLines, range: LineRange, skip: (index: number) => boolean): string {
  let payload = ''
  for (let index = range.from; index < range.to; index++) {
    if (skip(index)) continue
    payload += `${text.slice(lines.starts[index], lines.ends[index])}\n`
  }
  return payload
}
