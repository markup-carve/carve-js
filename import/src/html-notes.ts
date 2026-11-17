// The footnote section of a render (C2-H-089 to C2-H-093).
import { type DefaultTreeAdapterTypes as Html } from 'parse5'
import { foldLabel } from '../../v2/src/index.ts'
import {
  attr, classList, content, elements, has, ignoredCarrier, isBlank, isElement, isRawSpan, isText, type HtmlContext, type NoteEntry,
} from './html-dom.ts'
import { append } from '../../v2/src/append.ts'

export function isFootnoteSection(node: Html.Element): boolean {
  return attr(node, 'role') === 'doc-endnotes' || attr(node, 'class')?.split(' ').includes('footnotes') === true
}

/** C2-M-063: the backlink of a note, as a render and as GitHub write it. */
export function isBacklink(node: Html.ChildNode): boolean {
  if (!isElement(node) || node.tagName !== 'a') return false
  return attr(node, 'role') === 'doc-backlink' || has(node, 'data-footnote-backref') || classList(node).includes('footnote-backref')
}

function withoutTrailingSpaces(node: Html.ChildNode | undefined): void {
  if (node === undefined || !isText(node)) return
  let end = node.value.length
  while (end > 0 && (node.value[end - 1] === ' ' || node.value[end - 1] === '\t')) end--
  node.value = node.value.slice(0, end)
}

/** C2-H-091: the backlinks a render adds to the last paragraph of a note, or as a paragraph of their own. */
function dropBacklinks(item: Html.Element): void {
  const last = elements(item).at(-1)
  if (last?.tagName !== 'p') return
  const nodes = last.childNodes
  let end = nodes.length
  while (end > 0) {
    const node = nodes[end - 1]
    if (node === undefined || !(isBacklink(node) || (isText(node) && node.value.trim() === ''))) break
    end--
  }
  if (end === nodes.length || !nodes.slice(end).some(isBacklink)) return
  if (end > 0 && !nodes.slice(0, end).every(node => isText(node) && node.value.trim() === '')) {
    last.childNodes = nodes.slice(0, end)
    withoutTrailingSpaces(last.childNodes.at(-1))
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

function noteEntry(item: Html.Element, references: Set<string | undefined> | undefined, context: HtmlContext): NoteEntry {
  const referenced = references !== undefined
  const label = attr(item, 'data-carve-footnote-label')
  const inline = has(item, 'data-carve-inline-footnote')
  const fault = inline ? inlineFault(item, referenced) : undefined
  if (fault !== undefined) ignoredCarrier(context, item, 'data-carve-inline-footnote', fault)
  if (label !== undefined && (label === '' || foldLabel(label) !== label || inline)) {
    ignoredCarrier(context, item, 'data-carve-footnote-label', inline ? 'the note is also an inline footnote' : 'the key is not folded')
    return { item, inline: false }
  }
  // C2-H-186: a reference that carries another key makes the carriers of both disagree, and neither is read.
  if (label !== undefined && [...references ?? []].some(key => key !== undefined && key !== label)) {
    ignoredCarrier(context, item, 'data-carve-footnote-label', 'a reference to the note carries another key')
    return { item, inline: false }
  }
  return { item, ...(label !== undefined ? { label } : {}), inline: inline && fault === undefined }
}

/** Records the notes of every footnote section before the references to them are read. */
export function collectNotes(nodes: Html.ChildNode[], context: HtmlContext): void {
  const pending = [...nodes]
  const sections: Html.Element[] = []
  const referenced = new Map<string, Set<string | undefined>>()
  while (pending.length > 0) {
    const node = pending.pop()
    if (node === undefined || !isElement(node) || isRawSpan(node)) continue
    if (node.tagName === 'section' && isFootnoteSection(node)) sections.push(node)
    else recordReference(node, referenced)
    // A note can hold the reference to another note.
    append(pending, content(node))
  }
  for (const section of sections) collectSection(section, referenced, context)
}

function recordReference(node: Html.Element, referenced: Map<string, Set<string | undefined>>): void {
  const href = attr(node, 'href')
  if (node.tagName !== 'a' || href?.startsWith('#') !== true || attr(node, 'role') !== 'doc-noteref') return
  const keys = referenced.get(href.slice(1)) ?? new Set<string | undefined>()
  keys.add(attr(node, 'data-carve-footnote-label'))
  referenced.set(href.slice(1), keys)
}

function collectSection(node: Html.Element, referenced: Map<string, Set<string | undefined>>, context: HtmlContext): void {
  const list = elements(node).find(child => child.tagName === 'ol')
  for (const item of list === undefined ? [] : elements(list).filter(child => child.tagName === 'li')) {
    const id = attr(item, 'id')
    dropBacklinks(item)
    if (id !== undefined && id !== '') context.notes.set(id, noteEntry(item, referenced.get(id), context))
  }
}
