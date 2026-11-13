// Escaping, the attribute order of C2-H-009 and the filter of C2-H-128.
import { type AstNode } from './ast.ts'
import { type Settings } from './options.ts'
import { type Diagnostic, type Resolution } from './resolve.ts'

/** The state of one render. */
export interface Render {
  settings: Settings
  resolution: Resolution
  /** The output, one entry per line. */
  lines: string[]
  losses: Diagnostic[]
  /** The titled admonitions written so far, for their label ids. */
  admonitions: number
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
}

// C2-H-115: the reserved names of the carriers.
const CARRIERS = new Set([
  'data-marker', 'data-carve-explicit-id', 'data-carve-generated-id', 'data-carve-ref', 'data-carve-ref-collapsed',
  'data-carve-autolink', 'data-carve-footnote-label', 'data-carve-inline-footnote', 'data-carve-raw',
  'data-carve-abbreviations', 'data-carve-label', 'data-carve-tight', 'data-carve-xref', 'data-carve-caption-number',
  'data-carve-div', 'data-carve-line-block', 'data-carve-src',
])
const BLOCKED_NAMES = new Set(['srcdoc', 'formaction'])
const CSS_NEEDLES = ['expression(', 'url(', '@import', 'behavior:', '-moz-binding']
const ALIGN_VALUES = ['left', 'right', 'center']
const SPACE_CODE = 32
const DELETE_CODE = 0x7f
const C1_END = 0x9f

/** C2-H-002: the three markup characters and the no-break space. */
export function escapeText(text: string): string {
  let out = ''
  let from = 0
  for (let at = 0; at < text.length; at++) {
    const entity = textEntity(text.charCodeAt(at))
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

export function loss(r: Render, code: string, message: string, severity: 'error' | 'warning' = 'warning'): void {
  r.losses.push({ code, severity, channel: 'render-loss', message })
}

function isSchemeCharacter(code: number): boolean {
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 43 || code === 45 || code === 46
}

/** A reader drops control characters and whitespace before it reads a scheme, so they are skipped here. */
function isIgnoredInScheme(code: number): boolean {
  return code <= SPACE_CODE || (code >= DELETE_CODE && code <= C1_END) || code === 0xa0 || code === 0x2028 || code === 0x2029
}

/** The scheme of `url` in lower case, or the empty string when it has none. */
function schemeOf(url: string): string {
  let scheme = ''
  for (let at = 0; at < url.length; at++) {
    const code = url.charCodeAt(at)
    if (code === 58) return scheme === '' || !/[a-z]/.test(scheme[0]!) ? '' : scheme
    if (isIgnoredInScheme(code)) continue
    if (!isSchemeCharacter(code)) return ''
    scheme += url[at]!.toLowerCase()
  }
  return ''
}

/** C2-H-128: whether the scheme of `url` passes the URL policy. A URL with no scheme passes. */
export function schemePasses(r: Render, url: string): boolean {
  const scheme = schemeOf(url)
  if (scheme === '') return true
  const settings = r.settings
  return settings.allowed !== null ? settings.allowed.has(scheme) : !settings.denied!.has(scheme)
}

/** C2-H-082: a destination the policy denies is written as the empty string, and the denial is reported. */
export function destination(r: Render, url: string): string {
  if (schemePasses(r, url)) return url
  loss(r, 'destination-denied', `the destination ${url} is denied by the URL policy`, 'error')
  return ''
}

function hasDangerousCss(value: string): boolean {
  let compact = ''
  for (const char of value) if (char.trim() !== '') compact += char.toLowerCase()
  return CSS_NEEDLES.some((needle) => compact.includes(needle))
}

/** The value of an authored key as it is written: blanked when it holds a denied scheme or a URL function in a style. */
function keyValue(r: Render, name: string, value: string): string {
  if (!schemePasses(r, value)) return ''
  return name === 'style' && hasDangerousCss(value) ? '' : value
}

/** C2-H-128: event handlers and the injection sinks are removed whatever their value. */
function isBlockedName(name: string): boolean {
  return name.startsWith('on') || BLOCKED_NAMES.has(name)
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

function addKeys(r: Render, list: AttributeList, keys: [string, string][], parts: TagParts): void {
  const declarations = styleDeclarations(keys, parts)
  const hasStyle = keys.some(([key]) => key.toLowerCase() === 'style')
  for (const [key, value] of keys) {
    const name = key.toLowerCase()
    if (isBlockedName(name) || list.has(name)) continue
    if (r.settings.roundtrip && CARRIERS.has(name)) {
      loss(r, 'carrier-attribute-dropped', `the attribute ${key} has the name of a carrier`)
    } else if (name === 'style') {
      list.add(key, declarations === '' ? keyValue(r, name, value) : withDeclaration(keyValue(r, name, value), declarations))
    } else if (name === 'align' && parts.alignStyle === true && ALIGN_VALUES.includes(value)) {
      if (!hasStyle) list.add('style', declarations)
    } else {
      list.add(key, keyValue(r, name, value))
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
  addKeys(r, list, authored?.attrs?.keyValues ?? [], parts)
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
