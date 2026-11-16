// The parse5 reading shared by the HTML import modules, and the import state of one document.
import { defaultTreeAdapter, type DefaultTreeAdapterTypes as Html } from 'parse5'
import type { AbbreviationDefNode, Attrs, Block, FootnoteNode, LinkReferenceDefinitionNode } from '../../v2/src/index.ts'
import { attrsOf, finding, type Context } from './kit.ts'

/** C2-H-115: the reserved names that a render with `roundtrip` writes; `data-carve-src` is reserved and never written. */
export const CARRIERS: ReadonlySet<string> = new Set([
  'data-marker', 'data-carve-explicit-id', 'data-carve-generated-id', 'data-carve-ref', 'data-carve-ref-collapsed',
  'data-carve-ref-shortcut', 'data-carve-autolink', 'data-carve-footnote-label', 'data-carve-inline-footnote',
  'data-carve-raw', 'data-carve-abbreviations', 'data-carve-label', 'data-carve-tight', 'data-carve-xref',
  'data-carve-caption-number', 'data-carve-div', 'data-carve-line-block', 'data-carve-src',
])

/** A note of the footnote section, by the id of its item (C2-H-089). */
export interface NoteEntry { item: Html.Element, label?: string, inline: boolean }

export interface HtmlContext extends Context {
  /** True when the input holds a carrier of C2-H-115 outside raw content: it is then read as a `roundtrip` render. */
  roundtrip: boolean
  notes: Map<string, NoteEntry>
  /** The footnotes the references named, in the order of the section. */
  footnotes: FootnoteNode[]
  /** C2-H-114: the abbreviation definitions read from templates, by key. */
  abbreviations: Map<string, AbbreviationDefNode>
  /** C2-H-114: a definition for each reference key, from the destination and title of its first resolved reference. */
  definitions: Map<string, LinkReferenceDefinitionNode>
  /** The ids of the headings and of the sections a render opened at them (C2-H-026). */
  headingIds: Set<string>
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

function location(node: Html.ChildNode): [number | undefined, number | undefined] {
  return [node.sourceCodeLocation?.startOffset, node.sourceCodeLocation?.endOffset]
}

export function at(node: Html.ChildNode): [number | undefined, number | undefined] { return location(node) }

export function degraded(context: Context, node: Html.ChildNode, message: string): void {
  const [start, end] = location(node)
  finding(context, 'import-degraded', node.nodeName, message, start, end)
}

export function unsupported(context: Context, node: Html.ChildNode, message: string): void {
  const [start, end] = location(node)
  finding(context, 'import-unsupported', node.nodeName, message, start, end)
}

/** C2-H-114: a carrier the HTML around it contradicts, or one with a malformed value, is not read. */
export function ignoredCarrier(context: Context, node: Html.Element, name: string, reason: string): void {
  degraded(context, node, `Carrier ${name} ignored: ${reason}`)
}

export function classList(node: Html.Element): string[] {
  const value = attr(node, 'class') ?? ''
  const names: string[] = []
  let start = -1
  for (let index = 0; index <= value.length; index++) {
    const code = index === value.length ? 32 : value.charCodeAt(index)
    const space = code === 32 || (code >= 9 && code <= 13)
    if (space && start >= 0) { names.push(value.slice(start, index)); start = -1 }
    else if (!space && start < 0) start = index
  }
  return names
}

export interface MappedAttrs { attrs?: Attrs, lang?: string, dir?: 'ltr' | 'rtl' | 'auto', data?: Record<string, unknown> }

const ALIGN_STYLES: Readonly<Record<string, string>> = {
  'text-align: left;': 'left', 'text-align: right;': 'right', 'text-align: center;': 'center',
}

/** The authored attributes of `node`: without `omit`, event handlers, and, in a `roundtrip` render, the carriers. */
function isAuthored(context: HtmlContext, name: string, omit: readonly string[]): boolean {
  if (omit.includes(name) || name.startsWith('on') || name === 'lang' || name === 'dir') return false
  return !(context.roundtrip && CARRIERS.has(name))
}

/** The authored attributes of `node`: without `omit`, event handlers, and, in a `roundtrip` render, the carriers. */
export function attrs(context: HtmlContext, node: Html.Element, omit: readonly string[] = [], alignStyle = false): MappedAttrs {
  const entries: [string, string][] = []
  let alignment: 'start' | 'center' | 'end' | 'justify' | undefined
  for (const item of node.attrs) {
    if (!isAuthored(context, item.name, omit)) continue
    const align = item.name === 'style' ? ALIGN_STYLES[item.value] : undefined
    // C2-H-015: the declaration a render writes for an `align` key reads back as the key.
    if (align !== undefined && alignStyle) entries.push(['align', align])
    else entries.push([item.name, item.value])
    if (item.name === 'style' && align === undefined) alignment = styleAlignment(item.value) ?? alignment
  }
  const result: MappedAttrs = languageOf(node)
  const mapped = attrsOf(entries)
  if (mapped) result.attrs = mapped
  if (alignment !== undefined) result.data = { 'carve.style': { alignment } }
  return result
}

function languageOf(node: Html.Element): MappedAttrs {
  const result: MappedAttrs = {}
  const lang = attr(node, 'lang')
  const dir = attr(node, 'dir')
  if (lang) result.lang = lang
  if (dir === 'ltr' || dir === 'rtl' || dir === 'auto') result.dir = dir
  return result
}

function styleAlignment(style: string): 'start' | 'center' | 'end' | 'justify' | undefined {
  for (const declaration of style.split(';')) {
    const colon = declaration.indexOf(':')
    if (colon < 0 || declaration.slice(0, colon).trim().toLowerCase() !== 'text-align') continue
    const value = declaration.slice(colon + 1).trim().toLowerCase()
    if (value === 'left') return 'start'
    if (value === 'right') return 'end'
    if (value === 'center' || value === 'justify') return value
  }
  return undefined
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
