// Escaping, the attribute order of C2-H-009 and the filter of C2-H-128.
import { type AstNode } from './ast.ts'
import { addFinding, type Findings } from './diagnostics.ts'
import { DEFAULT_DENIED_SCHEMES } from './option-tables.ts'
import { type Settings } from './options.ts'
import { DROPPED_NAMES, DROPPED_PREFIXES, PROBE_REMOVED, STYLE_PATTERNS, URL_LIST_ATTRIBUTES } from './render-tables.ts'
import { type Resolution } from './resolve.ts'

/** The state of one render. */
export interface Render {
  settings: Settings
  resolution: Resolution
  /** The output, one entry per line. */
  lines: string[]
  losses: Findings
  /** C2-H-163: the `rel` value the profile writes on every link, or the empty string. */
  linkRel: string
  /** Open links around the node that is written (C2-H-081), and open `abbr` spans (C2-H-099). */
  linkDepth: number
  abbrDepth: number
  /** The paragraph that takes the backlinks of the note that is written, and their text (C2-H-091). */
  backlinkHost: AstNode | null
  backlinks: string
}

/** An attribute name and its value. A null value writes the bare name (C2-H-117). */
export type Pair = readonly [string, string | null]

/** What an element adds to the attributes its node carries. */
export interface TagParts {
  /** C2-H-010: written first, in the order given. A structural name replaces an authored key. */
  structural?: Pair[]
  /** The id to write in place of the authored one, or null for none. */
  id?: string | null
  /** C2-H-012: classes before and behind the ones the author wrote. */
  base?: readonly string[]
  last?: readonly string[]
  /** Written behind the authored keys. An authored key of the same name replaces one. */
  generated?: Pair[]
  /** C2-H-015: an `align` key is written as a `text-align` declaration. */
  alignStyle?: boolean
  /** Declarations that follow the authored `style` (C2-H-057). */
  style?: string
  /** C2-H-011: the id stands before the structural attributes, or the class does. */
  idFirst?: boolean
  classFirst?: boolean
  /** The node writes no authored attributes on this element. */
  bare?: boolean
  /** A block element, which carries its source line under `sourceLines` (C2-H-016). */
  block?: boolean
  /** The node of the tree a loss is reported on, where the node given is a copy of it. */
  origin?: AstNode
}

// C2-H-115: the reserved names of the carriers.
const CARRIERS = new Set([
  'data-marker', 'data-carve-explicit-id', 'data-carve-generated-id', 'data-carve-ref', 'data-carve-ref-collapsed',
  'data-carve-autolink', 'data-carve-footnote-label', 'data-carve-inline-footnote', 'data-carve-raw',
  'data-carve-abbreviations', 'data-carve-label', 'data-carve-tight', 'data-carve-xref', 'data-carve-caption-number',
  'data-carve-div', 'data-carve-line-block', 'data-carve-src',
])
const DENIED_BY_DEFAULT: ReadonlySet<string> = new Set(DEFAULT_DENIED_SCHEMES)
const ALIGN_VALUES = ['left', 'right', 'center']
const SPACE_CODE = 32
const GREATER_CODE = 62
const NO_BREAK_SPACE_CODE = 0xa0
const DELETE_CODE = 0x7f
const COLON_CODE = 58
const COMMA_CODE = 44
const BACKSLASH_CODE = 92
const MAX_ESCAPE_DIGITS = 6
const MAX_CODE_POINT = 0x10ffff
const REPLACEMENT = '\ufffd'

/** C2-H-002: the three markup characters and the no-break space. */
export function escapeText(text: string): string {
  let out = ''
  let from = 0
  for (let at = 0; at < text.length; at++) {
    const code = text.charCodeAt(at)
    // Every character that is escaped is one of four; the test keeps the common case to one comparison.
    if (code > GREATER_CODE && code !== NO_BREAK_SPACE_CODE) continue
    const entity = textEntity(code)
    if (entity === '') continue
    out += text.slice(from, at) + entity
    from = at + 1
  }
  return from === 0 ? text : out + text.slice(from)
}

function textEntity(code: number): string {
  if (code === 38) return '&amp;'
  if (code === 60) return '&lt;'
  if (code === 62) return '&gt;'
  return code === 0xa0 ? '&nbsp;' : ''
}

function attributeEntity(code: number): string {
  if (code === 34) return '&quot;'
  if (code === 39) return '&apos;'
  return code === 0xa0 ? '' : textEntity(code)
}

/** C2-H-003: the five characters of an attribute value. A no-break space stays the character. */
export function escapeAttribute(text: string): string {
  let out = ''
  let from = 0
  for (let at = 0; at < text.length; at++) {
    const entity = attributeEntity(text.charCodeAt(at))
    if (entity === '') continue
    out += text.slice(from, at) + entity
    from = at + 1
  }
  return from === 0 ? text : out + text.slice(from)
}

/** C2-H-132: a render loss on `node`, or on the document when it is null. */
export function loss(r: Render, node: AstNode | null, code: string, message: string, severity: 'error' | 'warning' = 'warning'): void {
  addFinding(r.losses, node, { code, severity, channel: 'render-loss', message })
}

function isAsciiLetter(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122)
}

function isSchemeCharacter(code: number): boolean {
  return isAsciiLetter(code) || (code >= 48 && code <= 57) || code === 43 || code === 45 || code === 46
}

/** C2-H-159: a character that is removed from a destination before its scheme is read. */
function isProbeRemoved(code: number): boolean {
  if (code > SPACE_CODE && code < DELETE_CODE) return false
  for (const [from, to] of PROBE_REMOVED) if (code >= from && code <= to) return true
  return false
}

/** C2-H-159: the scheme of `url` in lower case, or the empty string when it has none. */
function schemeOf(url: string): string {
  let scheme = ''
  for (let at = 0; at < url.length; at++) {
    const code = url.charCodeAt(at)
    if (isProbeRemoved(code)) continue
    if (code === COLON_CODE) return scheme
    if (scheme === '' ? !isAsciiLetter(code) : !isSchemeCharacter(code)) return ''
    scheme += url[at]!.toLowerCase()
  }
  return ''
}

/** C2-H-160: whether the scheme of `url` passes the URL policy. A URL with no scheme passes. */
export function schemePasses(r: Render, url: string): boolean {
  const scheme = schemeOf(url)
  if (scheme === '') return true
  const settings = r.settings
  return settings.allowed !== null ? settings.allowed.has(scheme) : !settings.denied!.has(scheme)
}

/** C2-H-160: a destination the policy denies is written as the empty string, and the denial is reported on `node`. */
export function destination(r: Render, url: string, node: AstNode): string {
  if (schemePasses(r, url)) return url
  loss(r, node, 'destination-denied', `the destination ${url} is denied by the URL policy`, 'error')
  return ''
}

/** C2-H-161: true when the text of `value[start, end)` before its first colon is a scheme of the default deny list. */
function hasDeniedPrefix(value: string, start: number, end: number): boolean {
  let prefix = ''
  for (let at = start; at < end; at++) {
    const code = value.charCodeAt(at)
    if (code === COLON_CODE) return DENIED_BY_DEFAULT.has(prefix)
    if (!isProbeRemoved(code)) prefix += value[at]!.toLowerCase()
  }
  return false
}

function isAsciiWhitespace(code: number): boolean {
  return code === SPACE_CODE || (code >= 9 && code <= 13 && code !== 11)
}

/** C2-H-161: true when one entry of a list of URLs fails the test. `commas` also separate entries. */
function listHasDeniedPrefix(value: string, commas: boolean): boolean {
  let start = 0
  for (let at = 0; at <= value.length; at++) {
    const code = at < value.length ? value.charCodeAt(at) : SPACE_CODE
    if (!isAsciiWhitespace(code) && !(commas && code === COMMA_CODE)) continue
    if (hasDeniedPrefix(value, start, at)) return true
    start = at + 1
  }
  return false
}

function hexValue(code: number): number {
  if (code >= 48 && code <= 57) return code - 48
  const lower = code | 32
  return lower >= 97 && lower <= 102 ? lower - 87 : -1
}

/** C2-H-162: the character a CSS escape at `at`, behind the backslash, stands for, and the offset behind the escape. */
function cssEscape(value: string, at: number): [string, number] {
  let code = 0
  let p = at
  while (p < value.length && p - at < MAX_ESCAPE_DIGITS && hexValue(value.charCodeAt(p)) >= 0) code = code * 16 + hexValue(value.charCodeAt(p++))
  if (p === at) {
    // A backslash before a line break stands for nothing, and before any other character for that character.
    const next = value[at] ?? ''
    return [next === '\n' ? '' : next, at + 1]
  }
  // One whitespace character behind the digits belongs to the escape.
  if (p < value.length && isAsciiWhitespace(value.charCodeAt(p))) p++
  return [code === 0 || code > MAX_CODE_POINT ? REPLACEMENT : String.fromCodePoint(code), p]
}

/** C2-H-162: `value` with its CSS escapes decoded, its whitespace removed and its ASCII letters in lower case. */
function cssProbe(value: string): string {
  let decoded = ''
  for (let at = 0; at < value.length;) {
    if (value.charCodeAt(at) !== BACKSLASH_CODE) {
      decoded += value[at++]!
      continue
    }
    const [char, next] = cssEscape(value, at + 1)
    decoded += char
    at = next
  }
  let compact = ''
  for (const char of decoded) if (char.trim() !== '') compact += char.toLowerCase()
  return compact
}

function hasDangerousCss(value: string): boolean {
  const probe = cssProbe(value)
  return STYLE_PATTERNS.some((pattern) => probe.includes(pattern))
}

/** C2-H-161, C2-H-162: the value of an authored key as it is written, which is empty when it fails a test. */
function keyValue(name: string, value: string): string {
  const commas = URL_LIST_ATTRIBUTES.get(name)
  if (commas === undefined ? hasDeniedPrefix(value, 0, value.length) : listHasDeniedPrefix(value, commas)) return ''
  return name === 'style' && hasDangerousCss(value) ? '' : value
}

/** C2-H-161: event handlers and the injection sinks are not written, whatever their value. */
function isBlockedName(name: string): boolean {
  return DROPPED_NAMES.includes(name) || DROPPED_PREFIXES.some((prefix) => name.startsWith(prefix))
}

function withDeclaration(style: string, declaration: string): string {
  const authored = style.trim()
  if (authored === '') return declaration
  return `${authored}${authored.endsWith(';') ? '' : ';'} ${declaration}`
}

/** The attributes of one element as they are collected: no name twice, compared without regard to case (C2-H-013). */
class AttributeList {
  text = ''
  private readonly used = new Set<string>()

  has(name: string): boolean {
    return this.used.has(name.toLowerCase())
  }

  claim(name: string): void {
    this.used.add(name.toLowerCase())
  }

  add(name: string, value: string | null): void {
    if (this.has(name)) return
    this.claim(name)
    this.text += value === null ? ` ${name}` : ` ${name}="${escapeAttribute(value)}"`
  }
}

function addClasses(list: AttributeList, node: AstNode | null, parts: TagParts): void {
  const authored = parts.bare === true ? [] : node?.attrs?.classes ?? []
  // A class that occurs twice is written once, at its first place, as in 0.1.
  const classes = new Set([...(parts.base ?? []), ...authored, ...(parts.last ?? [])])
  if (classes.size > 0) list.add('class', [...classes].join(' '))
}

/** The declarations that follow the authored style: the alignment of C2-H-015 and those the element gives. */
function styleDeclarations(keys: [string, string][], parts: TagParts): string {
  let declarations = parts.style ?? ''
  if (parts.alignStyle !== true) return declarations
  for (const [key, value] of keys) {
    if (key.toLowerCase() === 'align' && ALIGN_VALUES.includes(value)) declarations = `text-align: ${value};`
  }
  return declarations
}

function addKeys(r: Render, list: AttributeList, keys: [string, string][], parts: TagParts, origin: AstNode | null): void {
  const declarations = styleDeclarations(keys, parts)
  const hasStyle = keys.some(([key]) => key.toLowerCase() === 'style')
  for (const [key, value] of keys) {
    const name = key.toLowerCase()
    if (isBlockedName(name) || list.has(name)) continue
    if (r.settings.roundtrip && CARRIERS.has(name)) {
      loss(r, origin, 'carrier-attribute-dropped', `the attribute ${key} has the name of a carrier`)
    } else if (name === 'style') {
      list.add(key, declarations === '' ? keyValue(name, value) : withDeclaration(keyValue(name, value), declarations))
    } else if (name === 'align' && parts.alignStyle === true && ALIGN_VALUES.includes(value)) {
      if (!hasStyle) list.add('style', declarations)
    } else {
      list.add(key, keyValue(name, value))
    }
  }
  if (declarations !== '') list.add('style', declarations)
}

/** The id an element writes: the one its parts name, or the authored one. */
function writtenId(node: AstNode | null, parts: TagParts): string | undefined {
  if (parts.id !== undefined) return parts.id ?? undefined
  return parts.bare === true ? undefined : node?.attrs?.id
}

/** C2-H-016: the source line of a block element, or null. */
function sourceLine(r: Render, node: AstNode | null, parts: TagParts): string | null {
  if (!r.settings.sourceLines || parts.block !== true || node?.pos === undefined) return null
  return String(node.pos.startLine)
}

/** The authored parts behind the id: the classes, the language and the keys. */
function addAuthored(r: Render, list: AttributeList, node: AstNode | null, parts: TagParts): void {
  const authored = parts.bare === true ? null : node
  addClasses(list, node, parts)
  if (authored?.lang !== undefined) list.add('lang', authored.lang)
  const keys = authored?.attrs?.keyValues
  if (keys !== undefined || parts.style !== undefined) addKeys(r, list, keys ?? [], parts, parts.origin ?? node)
}

/** C2-H-009: the attributes of one element, each with a leading space. */
export function attributes(r: Render, node: AstNode | null, parts: TagParts): string {
  const list = new AttributeList()
  const id = writtenId(node, parts)
  if (parts.idFirst === true && id !== undefined) list.add('id', id)
  if (parts.classFirst === true) addClasses(list, node, parts)
  for (const [name, value] of parts.structural ?? []) list.add(name, value)
  // The source line is structural, so it replaces an authored key, and it is written last.
  const line = sourceLine(r, node, parts)
  if (line !== null) list.claim('data-source-line')
  if (id !== undefined) list.add('id', id)
  addAuthored(r, list, node, parts)
  for (const [name, value] of parts.generated ?? []) list.add(name, value)
  if (line !== null) list.text += ` data-source-line="${line}"`
  return list.text
}

/** C2-H-139: the attribute block of an unresolved reference as text, in the fixed order. */
export function attributeBlockText(node: AstNode): string {
  const parts: string[] = []
  if (node.attrs?.id !== undefined) parts.push(`#${node.attrs.id}`)
  for (const name of node.attrs?.classes ?? []) parts.push(`.${name}`)
  if (node.lang !== undefined) parts.push(`:${node.lang}`)
  for (const [key, value] of node.attrs?.keyValues ?? []) parts.push(keyText(key, value))
  return parts.length === 0 ? '' : `{${parts.join(' ')}}`
}

function keyText(key: string, value: string): string {
  if (value === '') return key
  const plain = !/[\s"'\\|}]/.test(value)
  return plain ? `${key}=${value}` : `${key}="${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
}
