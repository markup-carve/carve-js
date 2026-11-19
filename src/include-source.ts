// The physical lines of an included file (C2-N-034) and its region markers (C2-N-037 to C2-N-041).
import { BYTE_ORDER_MARK, COMMA, CR, HASH, HYPHEN, PERCENT, QUOTE_MARK, SLASH, STAR, TAB, UNDERSCORE } from './chars.ts'
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

/** C2-B-137, C2-B-217: whether the source line `[start, end)` is a well-formed region marker line of a Carve file. */
export function isRegionMarkerLine(src: string, start: number, end: number): boolean {
  const kind = readMarker(src.slice(start, end), false).kind
  return kind === OPENER || kind === CLOSER
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

/**
 * C2-N-037, C2-N-041: the lines strictly between the markers of the region `name`, or the reason there are none.
 * C2-N-046: a line of a table include that `quoted` marks stands inside a quoted field and is no marker.
 */
export function regionRange(
  text: string, lines: FileLines, name: string, code: boolean, quoted: (index: number) => boolean = () => false,
): LineRange | string {
  const scan: RegionScan = { stack: [], seen: new Set(), range: null }
  for (let index = 0; index < lines.starts.length; index++) {
    if (quoted(index)) continue
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

/** What a line of a table include is (C2-N-046): the start of a record, a line inside a quoted field, or a marker. */
export const RECORD_START = 0
export const RECORD_QUOTED = 1
export const RECORD_MARKER = 2

interface QuoteScan {
  quoted: boolean
  cellStart: boolean
}

/** C2-B-180: the quote state after one line; a quote opens a field only at its start, and a doubled one is one quote. */
function scanQuotes(text: string, start: number, end: number, separator: number, scan: QuoteScan): void {
  for (let at = start; at < end; at++) {
    const code = text.charCodeAt(at)
    if (scan.quoted) {
      if (code !== QUOTE_MARK) continue
      if (text.charCodeAt(at + 1) === QUOTE_MARK && at + 1 < end) at++
      else scan.quoted = false
    } else if (code === separator) {
      scan.cellStart = true
    } else {
      scan.quoted = scan.cellStart && code === QUOTE_MARK
      scan.cellStart = false
    }
  }
}

/** C2-N-046: the kind of each line of a `csv` or `tsv` file; a marker is recognized only outside a quoted field. */
export function recordKinds(text: string, lines: FileLines, tsv: boolean): number[] {
  const separator = tsv ? TAB : COMMA
  const scan: QuoteScan = { quoted: false, cellStart: true }
  const kinds: number[] = []
  for (let index = 0; index < lines.starts.length; index++) {
    if (scan.quoted) {
      kinds.push(RECORD_QUOTED)
    } else if (isMarkerLine(text, lines, index)) {
      kinds.push(RECORD_MARKER)
      continue
    } else {
      kinds.push(RECORD_START)
      scan.cellStart = true
    }
    scanQuotes(text, lines.starts[index]!, lines.ends[index]!, separator, scan)
  }
  return kinds
}

/** A selected region: its text and its 1-based lines in the file, or why the directive refuses it. */
export type RegionResult = { ok: true, text: string, start: number, end: number } | { ok: false, reason: string }

/**
 * C2-N-037 to C2-N-043: region `name` of `text` as an include directive selects it. A code include gets its payload,
 * one line feed after each line, and a Carve include gets the lines as they stand. `start` and `end` are the first and
 * last selected line; an empty region has `end` one less than `start`. Where the directive would report
 * `region_invalid`, `reason` is its reason.
 */
export function includeRegion(text: string, name: string, code: boolean): RegionResult {
  const lines = fileLines(text)
  const range = regionRange(text, lines, name, code)
  if (typeof range === 'string') return { ok: false, reason: range }
  const selected = code ? payloadOf(text, lines, range, () => false)
    : range.from === range.to ? '' : text.slice(lines.starts[range.from], lines.nexts[range.to - 1])
  return { ok: true, text: selected, start: range.from + 1, end: range.to }
}
