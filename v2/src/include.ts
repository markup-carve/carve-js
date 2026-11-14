// The include directive (C2-B-201 to C2-B-206): its shape on one line, and what its options make of the line.
import { type IncludeNode } from './ast.ts'
import { unescape } from './attributes.ts'
import {
  APOSTROPHE, AT_SIGN, BACKSLASH, BRACE_CLOSE, BRACE_OPEN, COLON, COMMA, DOT, HASH, HYPHEN, PLUS, QUOTE_MARK,
  SLASH, SPACE, UNDERSCORE,
} from './chars.ts'
import { INCLUDE_OPTIONS } from './render-tables.ts'
import { isSpaceOrTab } from './source.ts'
import { isAsciiDigit, isAsciiLetter, isAsciiNameCharacter } from './unicode.ts'

const LEFT_CURLY_QUOTE = 0x201c
const RIGHT_CURLY_QUOTE = '\u201d'
const NONE = -1

/** The parts of a directive as offsets into the source. */
interface Shape {
  /** The path without its quotes, and the code of its opening quote, or 0 for a bare path. */
  pathStart: number
  pathEnd: number
  pathQuote: number
  /** The section name, or NONE. */
  sectionStart: number
  sectionEnd: number
  /** Per option: the key, and the value as written with its quotes. A value that is absent starts at NONE. */
  options: number[]
  /** C2-B-206: a second section. */
  twoSections: boolean
  /** The offset behind the closing braces. */
  end: number
}

/** The parts of an include node (C2-A-181). */
interface IncludeParts {
  path: string
  section: string | null
  options: [string, string][]
  /** The offset behind the closing braces, where the node ends (C2-A-182). */
  end: number
}

function skip(src: string, pos: number, end: number): number {
  while (pos < end && src.charCodeAt(pos) === SPACE) pos++
  return pos
}

/** The offset of the quote that closes the run opened at `pos`, in which a backslash takes the next character, or NONE. */
function closingQuote(src: string, pos: number, end: number): number {
  const quote = src.charCodeAt(pos)
  for (let p = pos + 1; p < end; p++) {
    const code = src.charCodeAt(p)
    if (code === BACKSLASH) p++
    else if (code === quote) return p
  }
  return NONE
}

/** C2-B-202: reads the path at `pos` into `shape` and returns the offset behind it, or NONE for no path and an empty one. */
function readPath(src: string, pos: number, end: number, shape: Shape): number {
  const first = src.charCodeAt(pos)
  let close: number
  if (first === QUOTE_MARK) {
    close = closingQuote(src, pos, end)
  } else if (first === LEFT_CURLY_QUOTE) {
    close = src.indexOf(RIGHT_CURLY_QUOTE, pos + 1)
    if (close >= end) close = NONE
  } else {
    let p = pos
    while (p < end && !endsBarePath(src.charCodeAt(p))) p++
    shape.pathStart = pos
    shape.pathEnd = p
    return p > pos ? p : NONE
  }
  if (close <= pos + 1) return NONE
  shape.pathStart = pos + 1
  shape.pathEnd = close
  shape.pathQuote = first
  return close + 1
}

function endsBarePath(code: number): boolean {
  return code === SPACE || code === HASH || code === AT_SIGN || code === BRACE_CLOSE || code === QUOTE_MARK || code === LEFT_CURLY_QUOTE
}

/** The offset behind the name at `pos`, whose first character passes `first`, or NONE. */
function nameEnd(src: string, pos: number, end: number, first: (code: number) => boolean): number {
  if (pos >= end || !first(src.charCodeAt(pos))) return NONE
  let p = pos + 1
  while (p < end && isAsciiNameCharacter(src.charCodeAt(p))) p++
  return p
}

function startsSection(code: number): boolean {
  return isAsciiLetter(code) || isAsciiDigit(code) || code === UNDERSCORE
}

function startsKey(code: number): boolean {
  return isAsciiLetter(code) || code === UNDERSCORE
}

/** C2-B-204: the offset behind the value at `pos`: a quoted run, or one or more characters up to `@`, `}`, a space or a tab. */
function valueEnd(src: string, pos: number, end: number): number {
  const first = pos < end ? src.charCodeAt(pos) : 0
  if (first === QUOTE_MARK || first === APOSTROPHE) {
    const close = closingQuote(src, pos, end)
    return close === NONE ? NONE : close + 1
  }
  let p = pos
  while (p < end && !endsValue(src.charCodeAt(p))) p++
  return p > pos ? p : NONE
}

function endsValue(code: number): boolean {
  return code === AT_SIGN || code === BRACE_CLOSE || isSpaceOrTab(code)
}

/** C2-B-204: reads the option whose at-sign is at `pos` into `shape` and returns the offset behind it, or NONE. */
function readOption(src: string, pos: number, end: number, shape: Shape): number {
  const keyEnd = nameEnd(src, pos + 1, end, startsKey)
  if (keyEnd === NONE) return NONE
  if (keyEnd >= end || src.charCodeAt(keyEnd) !== COLON) {
    shape.options.push(pos + 1, keyEnd, NONE, NONE)
    return keyEnd
  }
  const after = valueEnd(src, keyEnd + 1, end)
  if (after !== NONE) shape.options.push(pos + 1, keyEnd, keyEnd + 1, after)
  return after
}

/** C2-B-203: reads the section whose `#` is at `pos` and returns the offset behind it, or NONE. */
function readSection(src: string, pos: number, end: number, shape: Shape): number {
  const after = nameEnd(src, pos + 1, end, startsSection)
  if (after === NONE) return NONE
  if (shape.sectionStart !== NONE) shape.twoSections = true
  shape.sectionStart = pos + 1
  shape.sectionEnd = after
  return after
}

/** True when `}}` stands at `pos` with only spaces and tabs behind it on the line. */
function closesAt(src: string, pos: number, end: number): boolean {
  if (pos + 2 > end || src.charCodeAt(pos) !== BRACE_CLOSE || src.charCodeAt(pos + 1) !== BRACE_CLOSE) return false
  let p = pos + 2
  while (p < end && isSpaceOrTab(src.charCodeAt(p))) p++
  return p === end
}

/** C2-B-201: the shape of the directive on the line `[pos, end)`, or null when the line has another shape. */
function readShape(src: string, pos: number, end: number): Shape | null {
  if (pos + 2 > end || src.charCodeAt(pos) !== BRACE_OPEN || src.charCodeAt(pos + 1) !== BRACE_OPEN) return null
  const shape: Shape = {
    pathStart: 0, pathEnd: 0, pathQuote: 0, sectionStart: NONE, sectionEnd: NONE, options: [], twoSections: false, end: 0,
  }
  const pathStart = skip(src, pos + 2, end)
  let p = pathStart === pos + 2 ? NONE : readPath(src, pathStart, end, shape)
  while (p !== NONE) {
    const part = skip(src, p, end)
    const code = part < end ? src.charCodeAt(part) : 0
    if (code === HASH) p = readSection(src, part, end, shape)
    else if (code === AT_SIGN) p = readOption(src, part, end, shape)
    else if (part > p && closesAt(src, part, end)) return { ...shape, end: part + 2 }
    else return null
  }
  return null
}

function isIdentifier(value: string): boolean {
  return nameEnd(value, 0, value.length, startsKey) === value.length
}

/** `auto`, or a decimal integer with an optional sign. */
function isShift(value: string): boolean {
  if (value === 'auto') return true
  const first = value.charCodeAt(0)
  const start = first === PLUS || first === HYPHEN ? 1 : 0
  if (start === value.length) return false
  for (let p = start; p < value.length; p++) if (!isAsciiDigit(value.charCodeAt(p))) return false
  return true
}

function isLanguageCharacter(code: number): boolean {
  return isAsciiNameCharacter(code) || code === PLUS || code === HASH || code === DOT || code === SLASH
}

function isLanguage(value: string): boolean {
  for (let p = 0; p < value.length; p++) if (!isLanguageCharacter(value.charCodeAt(p))) return false
  return value !== ''
}

/** A double-quoted list of names separated by commas: no name is empty, and a backslash takes the next character. */
function isNameList(written: string): boolean {
  if (written.length < 2 || written.charCodeAt(0) !== QUOTE_MARK) return false
  let length = 0
  for (let p = 1; p < written.length - 1; p++) {
    const code = written.charCodeAt(p)
    if (code === COMMA) {
      if (length === 0) return false
      length = 0
      continue
    }
    if (code === BACKSLASH) p++
    length++
  }
  return length > 0
}

// The shapes a parse tells apart. A range is not among them: outside its shape, an option that takes
// one leaves the include node a valid one leaves (C2-B-206), and telling the two apart is the expansion's job.
const SHAPES = new Map<string, (value: string) => boolean>([
  ['identifier', isIdentifier], ['signed_integer_or_auto', isShift], ['language', isLanguage],
])

function isQuote(code: number): boolean {
  return code === QUOTE_MARK || code === APOSTROPHE
}

/** C2-B-204: a value without its quotes and with its escapes read. Quoting only delimits it. */
function valueText(written: string): string {
  return written.length >= 2 && isQuote(written.charCodeAt(0)) ? unescape(written, 1, written.length - 1) : written
}

/** C2-B-205: what the table makes of one option: `valid`, `include_node` or `paragraph`. `written` is null for no value. */
function optionVerdict(key: string, written: string | null): string {
  const rule = INCLUDE_OPTIONS.get(key)
  // C2-B-206: a key that is not one of the six.
  if (rule === undefined) return 'paragraph'
  if (written === null) return rule.withoutValue
  const shape = SHAPES.get(rule.value)
  return shape === undefined || shape(valueText(written)) ? 'valid' : rule.outsideShape
}

/** The options of `shape` as pairs in the order of C2-A-181, or null when one of them makes the line a paragraph (C2-B-206). */
/** C2-A-181: the value an option keeps. A list of column names keeps its quotes. */
function keptValue(key: string, written: string | null): string {
  if (written === null) return ''
  return key === 'cols' && isNameList(written) ? written : valueText(written)
}

function optionPairs(src: string, shape: Shape): [string, string][] | null {
  const values = new Map<string, string>()
  const options = shape.options
  for (let at = 0; at < options.length; at += 4) {
    const key = src.slice(options[at], options[at + 1])
    const written = options[at + 2] === NONE ? null : src.slice(options[at + 2], options[at + 3])
    const repeated = values.has(key)
    const verdict = repeated ? INCLUDE_OPTIONS.get(key)?.repeated : optionVerdict(key, written)
    if (verdict === 'paragraph' || verdict === undefined) return null
    // C2-A-181: a repeated option keeps the first one.
    if (!repeated) values.set(key, keptValue(key, written))
  }
  const pairs: [string, string][] = []
  for (const key of INCLUDE_OPTIONS.keys()) {
    const value = values.get(key)
    if (value !== undefined) pairs.push([key, value])
  }
  return pairs
}

/**
 * The include directive on the line `[pos, end)`, or null when the line is none: it has another
 * shape (C2-B-201), or it holds what C2-B-206 reads as a paragraph.
 */
export function readInclude(src: string, pos: number, end: number): IncludeParts | null {
  const shape = readShape(src, pos, end)
  if (shape === null || shape.twoSections) return null
  const options = optionPairs(src, shape)
  if (options === null) return null
  // C2-B-202: a double-quoted path has its escapes read, and a path in curly quotes is read as written.
  const path = shape.pathQuote === QUOTE_MARK ? unescape(src, shape.pathStart, shape.pathEnd) : src.slice(shape.pathStart, shape.pathEnd)
  const section = shape.sectionStart === NONE ? null : src.slice(shape.sectionStart, shape.sectionEnd)
  return { path, section, options, end: shape.end }
}

/** C2-W-058: a value in double quotes, with a backslash before a quote and a backslash. */
function quoted(value: string): string {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
}

/** C2-B-202, C2-W-058: whether `path` is written bare, which holds where it reads back as the same path. */
function isBarePath(path: string): boolean {
  if (path === '') return false
  for (let at = 0; at < path.length; at++) if (endsBarePath(path.charCodeAt(at))) return false
  return true
}

/**
 * C2-B-204, C2-H-171: whether an option value is written bare. A bare value holds no space, tab, `@` or `}`, and
 * does not start with a quote, which would open a quoted value.
 */
function isBareValue(value: string): boolean {
  if (isQuote(value.charCodeAt(0))) return false
  for (let at = 0; at < value.length; at++) if (endsValue(value.charCodeAt(at))) return false
  return true
}

/** One option of a directive: the key alone for no value, and a value quoted where the bare form does not hold it. */
function includeOption(name: string, value: string): string {
  // C2-A-181: a part of a supplied tree that is no option is kept as its text.
  if (name === '') return value
  if (value === '') return `@${name}`
  // C2-A-181: a list of column names keeps the quotes it was written in.
  const bare = (name === 'cols' && value.startsWith('"')) || isBareValue(value)
  return `@${name}:${bare ? value : quoted(value)}`
}

const OPTION_ORDER: readonly string[] = [...INCLUDE_OPTIONS.keys()]

function optionRank(name: string): number {
  const rank = OPTION_ORDER.indexOf(name)
  return rank < 0 ? OPTION_ORDER.length : rank
}

/** C2-W-058, C2-H-133, C2-H-171: the one spelling of an include directive, which the writer writes and the renderer shows. */
export function includeSource(node: IncludeNode): string {
  const path = node.path
  const parts = [isBarePath(path) ? path : quoted(path)]
  if (node.section !== undefined) parts.push(`#${node.section}`)
  // C2-W-058: the six options in the order of the directive grammar, then the others in the order of the node.
  const options = [...(node.options ?? [])].sort((a, b) => optionRank(a[0]) - optionRank(b[0]))
  for (const [name, value] of options) parts.push(includeOption(name, value))
  return `{{ ${parts.join(' ')} }}`
}
