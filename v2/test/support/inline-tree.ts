// The block tree with an inline tree per content, for tests in shape notation. The engine builds
// the public tree straight from the events; this reads the same events into nodes that keep every flag.
import { type Attributes, attributeSink, foldLabel } from '../../src/ast-attributes.ts'
import { contentSource } from '../../src/ast-inline.ts'
import { emptyMemo, readAttributeBlock, unescape } from '../../src/attributes.ts'
import { ENTER, EVENT_WIDTH, eventFlags, eventKind, eventType, SPAN } from '../../src/events.ts'
import {
  ATTRIBUTE_BLOCK, DESTINATION, ESCAPE, FLAG_COLLAPSED, IMAGE, isInlineContainer, LABEL, TITLE,
} from '../../src/inline-kinds.ts'
import { isPlainText, scanInline } from '../../src/inline-scan.ts'
import { acquireInlineState, type InlineState, releaseInlineState } from '../../src/inline-state.ts'
import { CAPTION, CELL, DIV, DOCUMENT, HEADING, LINE_BLOCK, PARAGRAPH, TERM } from '../../src/kinds.ts'
import { type BlockNode } from '../../src/tree.ts'
import { parseBlockTree } from '../../src/index.ts'

/** Kinds of the tree that no event has: a run of text, and one line of a line block. */
export const TEXT = 61
export const LINE = 62

/** One node of an inline tree, with the fields the event stream gives it. */
export interface InlineNode {
  kind: number
  start: number
  end: number
  flags: number
  aux: number
  children: InlineNode[] | null
  value: string | null
  destination: string | null
  title: string | null
  label: string | null
  attributes: Attributes | null
}

function createNode(kind: number, start: number, flags: number, aux: number): InlineNode {
  return {
    kind, start, end: start, flags, aux, children: isInlineContainer(kind) ? [] : null,
    value: null, destination: null, title: null, label: null, attributes: null,
  }
}

function textNode(value: string, start: number, end: number): InlineNode {
  const node = createNode(TEXT, start, 0, 0)
  node.value = value
  node.end = end
  return node
}

function addAttributes(src: string, host: InlineNode, start: number, end: number): void {
  host.attributes ??= { id: null, classes: [], lang: null, keyValues: [] }
  readAttributeBlock(src, start, end, emptyMemo(), attributeSink(host.attributes))
}

/** Adds text to the node list: adjacent runs are one text node (C2-A-040). */
function addText(list: InlineNode[], value: string, start: number, end: number): void {
  const last = list.length > 0 ? list[list.length - 1]! : null
  if (last !== null && last.kind === TEXT) {
    last.value += value
    last.end = end
    return
  }
  const node = createNode(TEXT, start, 0, 0)
  node.value = value
  node.end = end
  list.push(node)
}

type ContentReader = (start: number, end: number) => string

/** Closes a part of `host`: it goes into a field of the host. */
function closePart(src: string, node: InlineNode, host: InlineNode, content: ContentReader): void {
  const value = node.value ?? ''
  if (node.kind === LABEL) host.aux = node.end
  if (node.kind === ATTRIBUTE_BLOCK) addAttributes(src, host, node.start, node.end)
  // C2-I-067: a backslash before a parenthesis or a backslash is dropped; most destinations hold none.
  else if (node.kind === DESTINATION) host.destination = value.includes('\\') ? value.replaceAll(/\\([()\\])/g, '$1') : value
  else if (node.kind === TITLE) host.title = unescape(value, 0, value.length)
  // C2-I-072: the label of a collapsed reference is the source of its own text.
  else if ((host.flags & FLAG_COLLAPSED) !== 0) host.label = foldLabel(content(host.start + (host.kind === IMAGE ? 2 : 1), node.start - 1))
  else host.label = foldLabel(value)
}

function isPart(kind: number): boolean {
  return kind === ATTRIBUTE_BLOCK || kind === DESTINATION || kind === TITLE || kind === LABEL
}

function addSpan(src: string, root: InlineNode[], top: InlineNode | null, start: number, end: number): void {
  if (top === null || top.children !== null) return addText(top === null ? root : top.children!, src.slice(start, end), start, end)
  top.value = top.value === null ? src.slice(start, end) : `${top.value}\n${src.slice(start, end)}`
}

function closeNode(src: string, node: InlineNode, host: InlineNode | null, list: InlineNode[], content: ContentReader): void {
  // C2-A-041: an escape is no node. Its character is text.
  if (node.kind === ESCAPE) addText(list, node.value ?? '', node.start, node.end)
  else if (isPart(node.kind)) closePart(src, node, host!, content)
  else list.push(node)
}

/**
 * Builds the inline nodes of one content from the first `length` ints of its events. `content`
 * gives the source of a range without the prefixes of the lines it crosses.
 */
export function buildInlineTree(src: string, events: Int32Array, length: number, content: ContentReader): InlineNode[] {
  const root: InlineNode[] = []
  const open: InlineNode[] = []
  let top: InlineNode | null = null
  for (let at = 0; at < length; at += EVENT_WIDTH) {
    const tag = events[at]!
    const a = events[at + 1]!
    const b = events[at + 2]!
    const type = eventType(tag)
    if (type === ENTER) {
      top = createNode(eventKind(tag), a, eventFlags(tag), b)
      open.push(top)
    } else if (type === SPAN) {
      addSpan(src, root, top, a, b)
    } else {
      const node = open.pop()!
      node.end = a
      top = open.length > 0 ? open[open.length - 1]! : null
      closeNode(src, node, top, top === null ? root : top.children!, content)
    }
  }
  return root
}

/** A node of the block tree with the inline nodes of its content. */
export interface TreeNode extends Omit<BlockNode, 'children'> {
  children: TreeNode[] | null
  inlines: InlineNode[] | null
}

function hasInlineContent(kind: number): boolean {
  return kind === PARAGRAPH || kind === HEADING || kind === TERM || kind === CAPTION || kind === CELL
}

/** The inline nodes of the content `spans[from..to)` of a leaf. */
function contentInlines(
  state: InlineState, src: string, spans: number[], from: number, to: number, depth: number, lineComments: boolean,
): InlineNode[] {
  const start = spans[from]!
  const end = spans[from + 1]!
  if (to - from === 2 && isPlainText(src, start, end)) return [textNode(src.slice(start, end), start, end)]
  scanInline(state, src, spans, from, to, depth, lineComments)
  return buildInlineTree(src, state.events, state.eventLength, (start, end) => contentSource(src, spans, start, end))
}

/** C2-B-130, C2-B-144: each line of a line block is a content of its own, and `%%` is text in it. */
function lineInlines(state: InlineState, src: string, spans: number[], depth: number): InlineNode[] {
  const lines: InlineNode[] = []
  for (let at = 0; at < spans.length; at += 2) {
    const line = createNode(LINE, spans[at]!, 0, 0)
    line.end = spans[at + 1]!
    line.children = contentInlines(state, src, spans, at, at + 2, depth, false)
    lines.push(line)
  }
  return lines
}

/** Reads the inline content of every text leaf and cell below `node`. `depth` is the number of open containers around it (C2-I-118). */
function readInlines(state: InlineState, src: string, node: TreeNode, depth: number): void {
  node.inlines = null
  if (node.children !== null) {
    const inner = node.kind > DOCUMENT && node.kind <= DIV ? depth + 1 : depth
    for (const child of node.children) readInlines(state, src, child, inner)
  } else if (hasInlineContent(node.kind)) {
    node.inlines = contentInlines(state, src, node.spans!, 0, node.spans!.length, depth, true)
  } else if (node.kind === LINE_BLOCK) {
    node.inlines = lineInlines(state, src, node.spans!, depth)
  }
}

/** The block tree of `src` with the inline content of every text leaf and cell. */
export function parseTree(src: string): TreeNode {
  const root = parseBlockTree(src) as TreeNode
  const state = acquireInlineState()
  try {
    readInlines(state, src, root, 0)
    return root
  } finally {
    releaseInlineState(state)
  }
}
