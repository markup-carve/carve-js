// The include directive (C2-B-201 to C2-B-206): its shape on one line, and its valid and invalid options.
import { type IncludeNode, type IncludeOptions, type Node } from './ast.ts'
import { unescape } from './attributes.ts'
import {
  APOSTROPHE, AT_SIGN, BACKSLASH, BRACE_CLOSE, BRACE_OPEN, COLON, COMMA, DIGIT_0, DOT, HASH, HYPHEN, PLUS, QUOTE_MARK,
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
  /** Per option: its `@`, the end of its key, and the value as written with its quotes. A value that is absent starts at NONE. */
  options: number[]
  /** C2-B-206: a second section. */
  twoSections: boolean
  /** The offset behind the closing braces. */
  end: number
}

/** An invalid option of a directive (C2-B-206). */
export interface IncludeProblem {
  start: number
  end: number
  reason: string
}

/** The parts of an include node (C2-A-181). */
interface IncludeParts {
  path: string
  section: string | null
  options: IncludeOptions
  optionSpelling: Record<string, string>
  /** C2-A-181: the invalid options as written, in source order. */
  invalid: string[]
  /** C2-B-206: per invalid option, its source range and why it is invalid. */
  problems: IncludeProblem[]
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
    shape.options.push(pos, keyEnd, NONE, NONE)
    return keyEnd
  }
  const after = valueEnd(src, keyEnd + 1, end)
  if (after !== NONE) shape.options.push(pos, keyEnd, keyEnd + 1, after)
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

/** C2-B-205: an identifier, the shape of a region name. */
export function isIncludeIdentifier(value: string): boolean {
  return isIdentifier(value)
}

function isIdentifier(value: string): boolean {
  return nameEnd(value, 0, value.length, startsKey) === value.length
}

/** `auto`, or a decimal integer with an optional sign. */
const MAX_SHIFT_DIGITS = 9

function isShift(value: string): boolean {
  if (value === 'auto') return true
  const first = value.charCodeAt(0)
  const start = first === PLUS || first === HYPHEN ? 1 : 0
  // C2-B-205: one to nine digits, as a list marker holds (C2-B-219).
  if (start === value.length || value.length - start > MAX_SHIFT_DIGITS) return false
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

/** C2-A-181: a double-quoted column name list, with backslash escapes removed. */
function nameList(written: string): string[] | null {
  if (written.length < 2 || written.charCodeAt(0) !== QUOTE_MARK) return null
  const names: string[] = []
  let name = ''
  for (let p = 1; p < written.length - 1; p++) {
    const code = written.charCodeAt(p)
    if (code === COMMA) {
      if (name === '') return null
      names.push(name)
      name = ''
    } else if (code === BACKSLASH && p + 1 < written.length - 1) {
      name += written[++p]
    } else {
      name += written[p]
    }
  }
  if (name === '') return null
  names.push(name)
  return names
}

/** The offset behind the decimal number at `pos` that has no leading zero, or NONE. */
function numberEnd(value: string, pos: number): number {
  if (pos >= value.length || !isAsciiDigit(value.charCodeAt(pos)) || value.charCodeAt(pos) === DIGIT_0) return NONE
  let p = pos + 1
  while (p < value.length && isAsciiDigit(value.charCodeAt(p))) p++
  return p
}

/** C2-B-205: `N-M`, two decimal numbers without a leading zero, the first at least 1 and not greater than the second. */
export function isRange(value: string): boolean {
  const dash = numberEnd(value, 0)
  if (dash === NONE || value.charCodeAt(dash) !== HYPHEN || numberEnd(value, dash + 1) !== value.length) return false
  const first = value.slice(0, dash)
  const last = value.slice(dash + 1)
  return first.length < last.length || (first.length === last.length && first <= last)
}

function isQuote(code: number): boolean {
  return code === QUOTE_MARK || code === APOSTROPHE
}

/** C2-B-204: a value without its quotes and with its escapes read. Quoting only delimits it. */
function valueText(written: string): string {
  return written.length >= 2 && isQuote(written.charCodeAt(0)) ? unescape(written, 1, written.length - 1) : written
}

/** C2-B-205: `cols` takes a range or a double-quoted list of names, so for it alone the quotes are part of the shape. */
function isColumns(written: string): boolean {
  return written.charCodeAt(0) === QUOTE_MARK ? nameList(written) !== null : isRange(written)
}

/** C2-B-205: whether the value as written has the shape of the option. */
function hasShape(shape: string, written: string): boolean {
  switch (shape) {
    case 'range': return isRange(valueText(written))
    case 'range_or_names': return isColumns(written)
    case 'identifier': return isIdentifier(valueText(written))
    case 'signed_integer_or_auto': return isShift(valueText(written))
    default: return isLanguage(valueText(written))
  }
}

/** Why an include option is invalid (C2-B-206), as the message of `include-option-invalid` says it. */
export const INCLUDE_KEY_UNKNOWN = 'has a key that is not an include option'
export const INCLUDE_VALUE_MISSING = 'needs a value'
export const INCLUDE_VALUE_SHAPE = 'has a value outside the shape of its key'
export const INCLUDE_KEY_REPEATED = 'repeats a key that stands earlier in the directive'

/** C2-B-206: why the option `key` with the value `written` (null for none) is invalid, or null when it is valid. */
export function optionProblem(key: string, written: string | null, repeated: boolean): string | null {
  const rule = INCLUDE_OPTIONS.get(key)
  if (rule === undefined) return INCLUDE_KEY_UNKNOWN
  if (repeated) return INCLUDE_KEY_REPEATED
  if (written === null) return rule.needsValue ? INCLUDE_VALUE_MISSING : null
  // An empty quoted value counts as none where a value is needed, and is outside every shape.
  if (valueText(written) === '' && rule.needsValue) return INCLUDE_VALUE_MISSING
  return hasShape(rule.value, written) ? null : INCLUDE_VALUE_SHAPE
}

/** C2-A-181: one decoded option value. */
export function decodedOption(key: string, written: string | null): string | string[] | number | true {
  if (written === null) return key === 'code' ? true : ''
  if (key === 'cols') return nameList(written) ?? valueText(written)
  const text = valueText(written)
  return key === 'shift' && text !== 'auto' ? Number(text) : text
}

function optionValue(options: IncludeOptions | undefined, key: string): string | string[] | number | true | undefined {
  if (options === undefined) return undefined
  switch (key) {
    case 'lines': return options.lines
    case 'region': return options.region
    case 'rows': return options.rows
    case 'cols': return options.cols
    case 'shift': return options.shift
    case 'code': return options.code
    default: return undefined
  }
}

interface OptionValues {
  options: IncludeOptions
  spelling: Record<string, string>
  problems: IncludeProblem[]
}

function optionValues(src: string, shape: Shape): OptionValues {
  const first = new Map<string, string | null>()
  const seen = new Set<string>()
  const problems: IncludeProblem[] = []
  const options = shape.options
  for (let at = 0; at < options.length; at += 4) {
    const key = src.slice(options[at]! + 1, options[at + 1])
    const written = options[at + 2] === NONE ? null : src.slice(options[at + 2], options[at + 3])
    // C2-B-206: a key that stood earlier makes the option invalid, whether or not the earlier one was valid.
    const reason = optionProblem(key, written, seen.has(key))
    if (reason === null) first.set(key, written)
    else problems.push({ start: options[at]!, end: written === null ? options[at + 1]! : options[at + 3]!, reason })
    seen.add(key)
  }
  const values: IncludeOptions = {}
  const spelling: Record<string, string> = {}
  for (const key of INCLUDE_OPTIONS.keys()) {
    if (!first.has(key)) continue
    const written = first.get(key) ?? null
    Object.assign(values, { [key]: decodedOption(key, written) })
    if (written !== null) spelling[key] = written
  }
  return { options: values, spelling, problems }
}

/** The include directive on the line `[pos, end)`, or null when the line has another shape (C2-B-201, C2-B-203, C2-B-206). */
export function readInclude(src: string, pos: number, end: number): IncludeParts | null {
  const shape = readShape(src, pos, end)
  if (shape === null || shape.twoSections) return null
  const values = optionValues(src, shape)
  // C2-B-202: a double-quoted path has its escapes read, and a path in curly quotes is read as written.
  const path = shape.pathQuote === QUOTE_MARK ? unescape(src, shape.pathStart, shape.pathEnd) : src.slice(shape.pathStart, shape.pathEnd)
  const section = shape.sectionStart === NONE ? null : src.slice(shape.sectionStart, shape.sectionEnd)
  const invalid = values.problems.map((problem) => src.slice(problem.start, problem.end))
  return { path, section, options: values.options, optionSpelling: values.spelling, invalid, problems: values.problems, end: shape.end }
}

/**
 * C2-N-072 (open point 3 of the Includes document): whether the own attributes of `node` act. Those of an include are
 * inert: no anchor, no duplicate, no reservation. Only the copy in the child of a code include acts.
 */
export function attributesAct(node: Node): boolean {
  return node.type !== 'include'
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
function includeOption(name: string, value: string | string[] | number | true, spelling?: string): string {
  if (value === true) return `@${name}`
  if (spelling !== undefined && JSON.stringify(decodedOption(name, spelling)) === JSON.stringify(value)) {
    return `@${name}:${spelling}`
  }
  if (Array.isArray(value)) {
    const names = value.map((part) => part.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll(',', '\\,'))
    return `@${name}:"${names.join(',')}"`
  }
  const text = String(value)
  if (text === '') return `@${name}`
  return `@${name}:${isBareValue(text) ? text : quoted(text)}`
}

// C2-W-058: the current 0.2 writer rank, ahead of this engine's shared spec pin.
const OPTION_ORDER: readonly string[] = ['code', 'lines', 'region', 'rows', 'cols', 'shift']

/**
 * C2-W-058, C2-A-181: the field of `node` that its spelling `source` does not read back: a typed option outside its
 * shape reads as invalid, and an invalid entry can read as valid or as another entry. Null where both read back.
 */
export function unreadField(node: IncludeNode, source: string): 'options' | 'invalid' | null {
  const parts = readInclude(source, 0, source.length)
  if (parts === null) return 'invalid'
  for (const name of OPTION_ORDER) {
    if (JSON.stringify(optionValue(parts.options, name)) !== JSON.stringify(optionValue(node.options, name))) return 'options'
  }
  const invalid = node.invalid ?? []
  return parts.invalid.length === invalid.length && parts.invalid.every((entry, at) => entry === invalid[at]) ? null : 'invalid'
}

/** C2-W-058, C2-H-133, C2-H-171: the one spelling of an include directive, which the writer writes and the renderer shows. */
export function includeSource(node: IncludeNode, spelling?: Record<string, string>): string {
  const path = node.path
  const parts = [isBarePath(path) ? path : quoted(path)]
  if (node.section !== undefined) parts.push(`#${node.section}`)
  for (const name of OPTION_ORDER) {
    const value = optionValue(node.options, name)
    if (value !== undefined) parts.push(includeOption(name, value, spelling?.[name]))
  }
  // C2-H-133, C2-W-058: the invalid options as the tree holds them, after the valid ones.
  for (const entry of node.invalid ?? []) parts.push(entry)
  return `{{ ${parts.join(' ')} }}`
}
