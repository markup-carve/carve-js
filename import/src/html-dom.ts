// The parse5 reading shared by the HTML import modules, and the import state of one document.
import { defaultTreeAdapter, type DefaultTreeAdapterTypes as Html } from 'parse5'
import type { AbbreviationDefNode, Attrs, Block, FootnoteNode, LinkReferenceDefinitionNode } from '../../src/index.ts'
import { attrsOf, classNames, finding, isKey, type Context, type HtmlImportCode } from './kit.ts'

/** C2-H-115: the reserved names that a render with `roundtrip` writes; `data-carve-src` is reserved and never written. */
export const CARRIERS: ReadonlySet<string> = new Set([
  'data-marker', 'data-carve-explicit-id', 'data-carve-generated-id', 'data-carve-ref', 'data-carve-ref-collapsed',
  'data-carve-ref-shortcut', 'data-carve-autolink', 'data-carve-footnote-label', 'data-carve-inline-footnote',
  'data-carve-raw', 'data-carve-abbreviations', 'data-carve-label', 'data-carve-tight', 'data-carve-xref',
  'data-carve-caption-number', 'data-carve-div', 'data-carve-line-block', 'data-carve-src', 'data-carve-source-level',
])

/** C2-H-186: the level of a heading before `headingShift` (C2-H-208); only a heading reads it. */
export const SOURCE_LEVEL = 'data-carve-source-level'

/** C2-H-186: the element classes named by the carrier table's Read on column. */
const CARRIER_READ_ON: Readonly<Record<string, readonly string[]>> = {
  'data-marker': ['ul', 'ol'],
  'data-carve-explicit-id': ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'div', 'section'],
  'data-carve-generated-id': ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'div', 'section'],
  'data-carve-ref': ['a', 'img'],
  'data-carve-ref-collapsed': ['a', 'img'],
  'data-carve-ref-shortcut': ['a', 'img'],
  'data-carve-autolink': ['a'],
  'data-carve-footnote-label': ['a', 'li'],
  'data-carve-inline-footnote': ['li'],
  'data-carve-raw': ['span'],
  'data-carve-abbreviations': ['template'],
  'data-carve-label': ['pre'],
  'data-carve-tight': ['ul', 'ol'],
  'data-carve-xref': ['a'],
  'data-carve-caption-number': ['span'],
  'data-carve-div': ['div'],
  'data-carve-line-block': ['div'],
  'data-carve-source-level': ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'div'],
}

export function readsCarrier(node: Html.Element, name: string, heading = false): boolean {
  if (node.tagName === 'div' && (name === SOURCE_LEVEL || name === 'data-carve-explicit-id' || name === 'data-carve-generated-id')) {
    return heading
  }
  return name === 'data-carve-src' || (CARRIER_READ_ON[name]?.includes(node.tagName) ?? false)
}

/** A note of the footnote section, by the id of its item (C2-H-089). */
export interface NoteEntry { item: Html.Element, label?: string, inline: boolean }

export interface HtmlContext extends Context {
  labels: Readonly<Record<string, string>>
  notes: Map<string, NoteEntry>
  /** The footnotes the references named, in the order of the section. */
  footnotes: FootnoteNode[]
  /** C2-H-114: the abbreviation definitions read from templates, by key. */
  abbreviations: Map<string, AbbreviationDefNode>
  /** C2-H-114: a definition for each reference key, from the destination and title of its first resolved reference. */
  definitions: Map<string, LinkReferenceDefinitionNode>
  /** C2-H-198: the keys whose first element is an `<a>` with an `href` of the form `#ID`. */
  anchorKeys: Set<string>
  /** The templates that stand where a render writes them, and the definitions each holds. */
  templates: Map<Html.Element, AbbreviationDefNode[]>
}

export function attr(node: Html.Element, name: string): string | undefined {
  return node.attrs.find(item => item.name === name)?.value
}

export function has(node: Html.Element, name: string): boolean {
  return node.attrs.some(item => item.name === name)
}

export function isElement(node: Html.ChildNode): node is Html.Element { return defaultTreeAdapter.isElementNode(node) }
export function isText(node: Html.ChildNode): node is Html.TextNode { return defaultTreeAdapter.isTextNode(node) }
export function isComment(node: Html.ChildNode): node is Html.CommentNode { return defaultTreeAdapter.isCommentNode(node) }
export function content(node: Html.Element): Html.ChildNode[] { return node.childNodes }
export function elements(node: Html.Element): Html.Element[] { return content(node).filter(isElement) }

export function isBlank(node: Html.ChildNode): boolean {
  return isText(node) && node.value.trim() === ''
}

export function plain(node: Html.ChildNode): string {
  if (isText(node)) return node.value
  if (!isElement(node)) return ''
  return content(node).map(plain).join('')
}

function located(node: Html.ChildNode): Html.ChildNode | undefined {
  if (node.sourceCodeLocation) return node
  let parent = node.parentNode
  while (parent !== null && defaultTreeAdapter.isElementNode(parent)) {
    if (parent.sourceCodeLocation) return parent
    parent = parent.parentNode
  }
  return undefined
}

/** C2-M-081: an element the parser opened without a tag is located at the nearest element it has a location for. */
function location(node: Html.ChildNode): [number | undefined, number | undefined] {
  const found = located(node)?.sourceCodeLocation
  return [found?.startOffset, found?.endOffset]
}

export function at(node: Html.ChildNode): [number | undefined, number | undefined] { return location(node) }

/** C2-M-081: the lower-case tag name, or `#comment`, `#text` or `#doctype`. */
export function foreignType(node: Html.ChildNode): string {
  if (isElement(node)) return node.tagName.toLowerCase()
  if (isText(node)) return '#text'
  return isComment(node) ? '#comment' : '#doctype'
}

export function report(context: Context, node: Html.ChildNode, code: HtmlImportCode, message: string): void {
  const [start, end] = location(node)
  finding(context, code, foreignType(node), message, start, end)
}

/** C2-H-114: a carrier the HTML around it contradicts, or one with a malformed value, is not read (C2-M-009). */
export function ignoredCarrier(context: Context, node: Html.Element, name: string, reason: string): void {
  report(context, node, 'import-carrier-ignored', `Carrier ${name} ignored: ${reason}`)
}

export function classList(node: Html.Element): string[] {
  return classNames(attr(node, 'class') ?? '')
}

/** ASCII letters in lower case, other characters as they are: HTML compares these values without ASCII case. */
export function asciiLower(value: string): string {
  return value.replace(/[A-Z]/gu, letter => letter.toLowerCase())
}

/** C2-M-052 row `dir`: `ltr`, `rtl` or `auto` in any ASCII letter case, kept in lower case. */
export function directionOf(value: string | undefined): 'ltr' | 'rtl' | 'auto' | undefined {
  const dir = value === undefined ? undefined : asciiLower(value)
  return dir === 'ltr' || dir === 'rtl' || dir === 'auto' ? dir : undefined
}

export interface MappedAttrs { attrs?: Attrs, lang?: string, dir?: 'ltr' | 'rtl' | 'auto' }

const ALIGN_VALUES = ['left', 'right', 'center']

/** C2-M-075: the value of `text-align: VALUE;` as C2-H-015 reads it, trimmed and folded, or undefined. */
function alignStyle(style: string | undefined): string | undefined {
  if (style === undefined || !style.startsWith('text-align: ') || !style.endsWith(';')) return undefined
  const value = asciiLower(style.slice('text-align: '.length, -1).replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/g, ''))
  return ALIGN_VALUES.includes(value) ? value : undefined
}


/** C2-M-052, C2-M-054: the attributes dropped wherever they stand, and why; undefined for one the tree can keep. */
export function droppedAttribute(name: string, value: string): string | undefined {
  if (name.startsWith('on')) return 'an event handler'
  if (name === 'srcdoc' || name === 'formaction') return 'a dropped attribute'
  if (name === 'dir') return directionOf(value) === undefined ? 'an invalid direction' : undefined
  return isKey(name) || CARRIERS.has(name) ? undefined : 'a name that is no key'
}

function isAuthored(item: { name: string, value: string }, omit: readonly string[]): boolean {
  if (omit.includes(item.name) || item.name === 'lang' || item.name === 'dir') return false
  return !CARRIERS.has(item.name) && droppedAttribute(item.name, item.value) === undefined
}

/**
 * The authored attributes of `node`: without `omit`, the reserved names (C2-H-186) and the names C2-M-052 drops, which
 * the audit of the document reports. With `alignStyle`, an exact alignment declaration is the key `align`, and an
 * `align` attribute beside it is dropped and reported, since the declaration wins in a browser (C2-M-075).
 */
function reportUnreadCarrier(context: HtmlContext, node: Html.Element, name: string, heading: boolean): void {
  if (!CARRIERS.has(name) || readsCarrier(node, name, heading)) return
  ignoredCarrier(context, node, name, name === SOURCE_LEVEL ? 'the element is no heading' : 'the element does not read this carrier')
}

export function attrs(
  context: HtmlContext, node: Html.Element, omit: readonly string[] = [], alignStyled = false, heading = false,
): MappedAttrs {
  const styled = alignStyled && alignStyle(attr(node, 'style')) !== undefined
  const entries: [string, string][] = []
  for (const item of node.attrs) {
    reportUnreadCarrier(context, node, item.name, heading)
    if (!isAuthored(item, omit)) continue
    if (styled && item.name === 'align') {
      report(context, node, 'import-attribute-dropped', 'An align attribute beside a text-align declaration dropped')
      continue
    }
    const align = item.name === 'style' && alignStyled ? alignStyle(item.value) : undefined
    entries.push(align === undefined ? [item.name, item.value] : ['align', align])
  }
  const result: MappedAttrs = languageOf(node)
  const mapped = attrsOf(entries)
  if (mapped) result.attrs = mapped
  return result
}

function languageOf(node: Html.Element): MappedAttrs {
  const result: MappedAttrs = {}
  const lang = attr(node, 'lang')
  const dir = directionOf(attr(node, 'dir'))
  if (lang) result.lang = lang
  if (dir !== undefined) result.dir = dir
  return result
}

/** The attributes of `mapped` with the classes `drop` removed, as the renderer adds them to every element of a kind. */
export function withoutClasses(mapped: MappedAttrs, drop: readonly string[]): MappedAttrs {
  const classes = mapped.attrs?.classes?.filter(name => !drop.includes(name))
  if (mapped.attrs === undefined || classes === undefined) return mapped
  const next: Attrs = { ...mapped.attrs }
  if (classes.length > 0) next.classes = classes
  else delete next.classes
  const result: MappedAttrs = { ...mapped }
  if (Object.keys(next).length > 0) result.attrs = next
  else delete result.attrs
  return result
}

/** The attributes of `mapped` without the keys `drop`, which the renderer derives from the node. */
export function withoutKeys(mapped: MappedAttrs, drop: readonly string[]): MappedAttrs {
  const keyValues = mapped.attrs?.keyValues?.filter(([key]) => !drop.includes(key))
  if (mapped.attrs === undefined || keyValues === undefined) return mapped
  const next: Attrs = { ...mapped.attrs }
  if (keyValues.length > 0) next.keyValues = keyValues
  else delete next.keyValues
  const result: MappedAttrs = { ...mapped }
  if (Object.keys(next).length > 0) result.attrs = next
  else delete result.attrs
  return result
}

export type BlockReader = (node: Html.ChildNode, context: HtmlContext) => Block[]

function isFormatChar(code: number, first: boolean): boolean {
  const letter = (code >= 65 && code <= 90) || (code >= 97 && code <= 122)
  return first ? letter : letter || (code >= 48 && code <= 57) || code === 45 || code === 95
}

/** C2-B-225: an ASCII letter, then ASCII letters, digits, `_` and `-`. */
export function isRawFormat(value: string): boolean {
  if (value === '') return false
  for (let index = 0; index < value.length; index++) if (!isFormatChar(value.charCodeAt(index), index === 0)) return false
  return true
}

/** C2-H-186: a span whose `data-carve-raw` is read: a raw format name, only text inside, and no other attribute. */
export function isRawSpan(node: Html.Element): boolean {
  const format = attr(node, 'data-carve-raw')
  return node.tagName === 'span' && format !== undefined && isRawFormat(format) && node.attrs.length === 1 && content(node).every(isText)
}
