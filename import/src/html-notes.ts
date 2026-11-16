// The footnote section of a render (C2-H-089 to C2-H-093), and the carriers that say whether a document is a `roundtrip` render.
import { type DefaultTreeAdapterTypes as Html } from 'parse5'
import { foldLabel } from '../../v2/src/index.ts'
import {
  attr, CARRIERS, content, elements, has, ignoredCarrier, isBlank, isElement, isRawSpan, isText, type HtmlContext, type NoteEntry,
} from './html-dom.ts'

export function isFootnoteSection(node: Html.Element): boolean {
  return attr(node, 'role') === 'doc-endnotes' || attr(node, 'class')?.split(' ').includes('footnotes') === true
}

/** True when an element outside raw content carries a reserved name (C2-H-115); a template counts by its own carrier. */
export function holdsCarrier(nodes: Html.ChildNode[]): boolean {
  const pending = [...nodes]
  while (pending.length > 0) {
    const node = pending.pop()
    if (node === undefined || !isElement(node)) continue
    if (node.attrs.some(item => CARRIERS.has(item.name))) return true
    if (!isRawSpan(node)) pending.push(...content(node))
  }
  return false
}

function isBacklink(node: Html.ChildNode): boolean {
  return isElement(node) && node.tagName === 'a' && attr(node, 'role') === 'doc-backlink'
}

/** C2-H-091: the backlinks a render adds to the last paragraph of a note, or as a paragraph of their own. */
function dropBacklinks(item: Html.Element): void {
  const last = elements(item).at(-1)
  if (last?.tagName !== 'p') return
  const nodes = last.childNodes
  let end = nodes.length
  while (end > 0) {
    const node = nodes[end - 1]
    if (node === undefined || !(isBacklink(node) || (isText(node) && node.value === ' '))) break
    end--
  }
  if (end === nodes.length || !nodes.slice(end).some(isBacklink)) return
  if (end > 0 && !nodes.slice(0, end).every(node => isText(node) && node.value.trim() === '')) {
    last.childNodes = nodes.slice(0, end)
    return
  }
  item.childNodes = item.childNodes.filter(node => node !== last)
}

/** C2-H-186: why a note's `data-carve-inline-footnote` is not read, or undefined when it is. */
function inlineFault(item: Html.Element, referenced: boolean): string | undefined {
  if (has(item, 'data-carve-footnote-label')) return 'the note also carries a footnote key'
  if (!referenced) return 'no reference points to the note'
  const blocks = content(item).filter(node => !isBlank(node))
  const single = blocks.length <= 1 && blocks.every(node => isElement(node) && node.tagName === 'p')
  return single ? undefined : 'the note holds more than one paragraph'
}

function noteEntry(item: Html.Element, referenced: boolean, context: HtmlContext): NoteEntry {
  const label = attr(item, 'data-carve-footnote-label')
  const inline = has(item, 'data-carve-inline-footnote')
  const fault = inline ? inlineFault(item, referenced) : undefined
  if (fault !== undefined) ignoredCarrier(context, item, 'data-carve-inline-footnote', fault)
  if (label !== undefined && (label === '' || foldLabel(label) !== label || inline)) {
    ignoredCarrier(context, item, 'data-carve-footnote-label', inline ? 'the note is also an inline footnote' : 'the key is not folded')
    return { item, inline: false }
  }
  return { item, ...(label !== undefined ? { label } : {}), inline: inline && fault === undefined }
}

/** Records the notes of every footnote section, and the ids of the headings, before the references to them are read. */
export function collectNotes(nodes: Html.ChildNode[], context: HtmlContext): void {
  const pending = [...nodes]
  const sections: Html.Element[] = []
  const referenced = new Set<string>()
  while (pending.length > 0) {
    const node = pending.pop()
    if (node === undefined || !isElement(node) || isRawSpan(node)) continue
    if (node.tagName === 'section' && isFootnoteSection(node)) sections.push(node)
    else recordIds(node, context, referenced)
    // A note can hold the reference to another note.
    pending.push(...content(node))
  }
  for (const section of sections) collectSection(section, referenced, context)
}

function recordIds(node: Html.Element, context: HtmlContext, referenced: Set<string>): void {
  const id = attr(node, 'id')
  if (id !== undefined && isHeadingElement(node)) context.headingIds.add(id)
  const href = attr(node, 'href')
  if (node.tagName === 'a' && href?.startsWith('#') === true && attr(node, 'role') === 'doc-noteref') referenced.add(href.slice(1))
}

const HEADING_TAGS = ['section', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']

function isHeadingElement(node: Html.Element): boolean {
  return HEADING_TAGS.includes(node.tagName) || attr(node, 'role') === 'heading'
}

function collectSection(node: Html.Element, referenced: Set<string>, context: HtmlContext): void {
  const list = elements(node).find(child => child.tagName === 'ol')
  for (const item of list === undefined ? [] : elements(list).filter(child => child.tagName === 'li')) {
    const id = attr(item, 'id')
    if (context.roundtrip) dropBacklinks(item)
    if (id !== undefined && id !== '') context.notes.set(id, noteEntry(item, referenced.has(id), context))
  }
}
