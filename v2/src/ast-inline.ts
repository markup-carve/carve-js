// The inline nodes of the public tree (spec/0.2/ast.md), built straight from the events of the inline pass.
import {
  type Attrs, type DeleteNode, type EmphasisNode, type HighlightNode, type ImageNode, type Inline, type InlineFootnoteNode,
  type InsertNode, type LinkNode, type Node, type SpanNode, type StrikeNode, type StrongNode, type SubscriptNode,
  type SuperscriptNode, type TextNode, type UnderlineNode,
} from './ast.ts'
import { type Attributes, attributeSink, foldLabel, NO_MEMO } from './ast-attributes.ts'
import { readAttributeBlock, unescape } from './attributes.ts'
import { ENTER, EventCursor, SPAN } from './events.ts'
import {
  ATTRIBUTE_BLOCK, AUTOLINK, BRACKET_SPAN, CODE_SPAN, DELETE, DESTINATION, EDITORIAL, EMPHASIS, ESCAPE, FLAG_BRACED,
  FLAG_COLLAPSED, FLAG_DISPLAY, FLAG_EMAIL, FLAG_REFERENCE, FOOTNOTE_REF, HARD_BREAK, HIGHLIGHT, IMAGE, INLINE_COMMENT,
  INLINE_EXTENSION, INLINE_FOOTNOTE, INSERT, isInlineContainer, LABEL, LINK, LITERAL, MATH, MENTION, NBSP, RAW_INLINE,
  SMART, SOFT_BREAK, STRIKE, STRONG, SUBSCRIPT, SUPERSCRIPT, SYMBOL, TAG, TITLE, UNDERLINE, XREF,
} from './inline-kinds.ts'
import { isPlainText, scanInline } from './inline-scan.ts'
import { type InlineState } from './inline-state.ts'
import { SMART_GLYPHS, SMART_KIND_NAMES } from './inline-tables.ts'
import type { BlockNode } from './tree.ts'

/**
 * One open inline node while its events are read. `value` is the text of a node without children
 * and the alt source of an image. `label` is the key of a reference (C2-I-079), and `aux` of a
 * reference is the offset behind its label.
 */
export interface InlineFrame {
  kind: number
  start: number
  end: number
  flags: number
  aux: number
  children: Inline[] | null
  value: string
  /** Set once a span of the source has gone into `value`; each further span joins it behind a line feed. */
  spanned: boolean
  destination: string | null
  title: string | null
  label: string | null
  attributes: Attributes | null
}

/** What the source-layout record reads beside the tree (C2-L-001). Filled only on request. */
export interface LayoutTrace {
  blocks: Map<Node, BlockNode>
  inlines: Map<Node, InlineFrame>
  /** C2-L-020: per text node of a cell, pairs of the offset in its value and the source offset at which a fragment starts. */
  breaks: Map<Node, number[]>
}

/** What a tree build needs besides the nodes: the source, and whether positions are wanted. */
export interface TreeContext {
  src: string
  positions: boolean
  /** The state the inline pass of each content runs in. */
  inline: InlineState
  /** C2-I-118: the number of open containers around the block being built. */
  depth: number
  /** C2-I-098: the expansion of each defined term. The first definition of a term wins (C2-B-085). */
  abbreviations: Map<string, string>
  /** The offset of the own markup of each block that took attribute lines (C2-A-148). */
  markup: Map<Node, number>
  /** The source lines of the text of each heading, as a start and an end per line (C2-I-084). */
  headingSpans: Map<Node, number[]>
  /**
   * Set when an inline node is built that resolution reads: one with an id, a reference, a note or
   * a cross-reference. A leaf asks it after its content is built.
   */
  resolvable: boolean
  /** The leaves whose inline content holds such a node. Resolution walks into no other leaf. */
  resolvableLeaves: Set<Node>
  trace: LayoutTrace | null
}

// How the breaks of a content are read. C2-A-068: every line end of a hard-break block is a hard
// break. C2-A-094: the line end before a continuation fragment is one space of text.
export const FLOW_PLAIN = 0
export const FLOW_HARD_BREAKS = 1
export const FLOW_CELL = 2

const FLOW_KIND_MASK = 3
/** The content was joined from pieces of several lines, so its nodes have no position (C2-A-158). */
export const FLOW_UNPLACED = 4

/**
 * Records the source range of a node. The six integers of C2-A-140 are filled in by
 * `finishPositions`, which reads the two string offsets stored here.
 */
export function place<N extends Node>(ctx: TreeContext, node: N, start: number, end: number): N {
  if (ctx.positions) node.pos = { startLine: 0, endLine: 0, startColumn: 0, endColumn: 0, startOffset: start, endOffset: end }
  return node
}

/** C2-A-032, C2-A-037: the attribute blocks of a node as `attrs` and `lang`. */
export function setAttributes(node: Node, attributes: Attributes | null): void {
  if (attributes === null) return
  const attrs: Attrs = {}
  if (attributes.id !== null) attrs.id = attributes.id
  if (attributes.classes.length > 0) attrs.classes = attributes.classes
  if (attributes.keys.length > 0) attrs.keyValues = attributes.keys
  if (attrs.id !== undefined || attrs.classes !== undefined || attrs.keyValues !== undefined) node.attrs = attrs
  if (attributes.language !== null) node.lang = attributes.language
}

/** C2-A-074: the text of a comment without the one space behind its opener and, for the braced form, before its closer. */
export function commentValue(text: string, braced: boolean): string {
  let value = text.startsWith(' ') ? text.slice(1) : text
  if (!braced) {
    let end = value.length
    while (end > 0 && (value[end - 1] === ' ' || value[end - 1] === '\t')) end--
    return value.slice(0, end)
  }
  if (value.endsWith(' ')) value = value.slice(0, -1)
  return value
}

function referenceForm(node: InlineFrame): 'collapsed' | 'full' {
  return (node.flags & FLAG_COLLAPSED) !== 0 ? 'collapsed' : 'full'
}

/** C2-A-105, C2-A-107: an image, its target direct or by reference. */
function imageNode(node: InlineFrame): ImageNode {
  if ((node.flags & FLAG_REFERENCE) !== 0) {
    return { type: 'image', key: node.label ?? '', namespace: 'link', form: referenceForm(node), alt: node.value }
  }
  const out: ImageNode = { type: 'image', src: node.destination ?? '' }
  if (node.title !== null) out.tooltip = node.title
  out.alt = node.value
  return out
}

/** C2-A-105, C2-A-107: a link, its target direct or by reference. */
function linkNode(node: InlineFrame, children: Inline[]): LinkNode {
  if ((node.flags & FLAG_REFERENCE) !== 0) {
    return { type: 'link', key: node.label ?? '', namespace: 'link', form: referenceForm(node), children }
  }
  const href = node.destination ?? ''
  return node.title === null ? { type: 'link', href, children } : { type: 'link', href, tooltip: node.title, children }
}

type LeafBuilder = (ctx: TreeContext, node: InlineFrame) => Inline

const LEAVES = new Map<number, LeafBuilder>([
  [CODE_SPAN, (_ctx, node) => ({ type: 'code', value: node.value })],
  [LITERAL, (_ctx, node) => ({ type: 'literal_inline', value: node.value })],
  [EDITORIAL, (_ctx, node) => ({ type: 'critic_comment', value: node.value })],
  [TAG, (_ctx, node) => ({ type: 'tag', name: node.value })],
  [SYMBOL, (_ctx, node) => ({ type: 'symbol', name: node.value })],
  [NBSP, () => ({ type: 'non_breaking_space' })],
  [HARD_BREAK, () => ({ type: 'hard_break' })],
  [MATH, (_ctx, node) => ({ type: 'math', display: (node.flags & FLAG_DISPLAY) !== 0, value: node.value })],
  [RAW_INLINE, (ctx, node) => ({
    type: 'raw_inline', format: ctx.src.slice(node.aux, ctx.src.indexOf('}', node.aux)), value: node.value,
  })],
  [INLINE_COMMENT, (_ctx, node) => {
    const braced = (node.flags & FLAG_BRACED) !== 0
    return { type: 'comment', form: braced ? 'braced' : 'line', value: commentValue(node.value, braced) }
  }],
  // C2-H-079: the destination of an email autolink is `mailto:` and the address; its text is the address.
  [AUTOLINK, (_ctx, node) => {
    const body = node.value
    return (node.flags & FLAG_EMAIL) !== 0 ? { type: 'autolink', href: `mailto:${body}`, text: body } : { type: 'autolink', href: body }
  }],
  [XREF, (_ctx, node) => ({ type: 'xref', key: node.value, namespace: 'heading' })],
  [MENTION, (_ctx, node) => ({ type: 'mention', target: node.value, kind: 'user' })],
  [FOOTNOTE_REF, (_ctx, node) => ({ type: 'footnote_ref', key: foldLabel(node.value), namespace: 'footnote' })],
  [SMART, (ctx, node) => ({
    type: 'smart_punctuation', kind: SMART_KIND_NAMES[node.aux]!, glyph: SMART_GLYPHS[node.aux]!,
    source: ctx.src.slice(node.start, node.end),
  })],
  [IMAGE, (_ctx, node) => imageNode(node)],
])

type PlainParent =
  | EmphasisNode | StrongNode | UnderlineNode | StrikeNode | HighlightNode | SuperscriptNode | SubscriptNode | InsertNode
  | DeleteNode | SpanNode | InlineFootnoteNode

const PLAIN_PARENTS = new Map<number, PlainParent['type']>([
  [EMPHASIS, 'emphasis'], [STRONG, 'strong'], [UNDERLINE, 'underline'], [STRIKE, 'strike'], [HIGHLIGHT, 'highlight'],
  [SUPERSCRIPT, 'superscript'], [SUBSCRIPT, 'subscript'], [INSERT, 'insert'], [DELETE, 'delete'], [BRACKET_SPAN, 'span'],
  [INLINE_FOOTNOTE, 'inline_footnote'],
])

/** A node with inline children: its type is the name of its kind, with the fields of a link and of an extension. */
function parentNode(ctx: TreeContext, node: InlineFrame, children: Inline[]): Inline {
  if (node.kind === LINK) return linkNode(node, children)
  if (node.kind === INLINE_EXTENSION) return { type: 'inline_extension', name: ctx.src.slice(node.start + 1, node.aux), children }
  return { type: PLAIN_PARENTS.get(node.kind)!, children }
}

/** Adds text to `list`: adjacent runs are one text node (C2-A-040). A joined node has no position (C2-A-158). */
export function addText(ctx: TreeContext, list: Inline[], value: string, start: number, end: number): void {
  const last = list.length > 0 ? list[list.length - 1]! : null
  if (last !== null && last.type === 'text') {
    last.value += value
    delete last.pos
    return
  }
  const node: TextNode = { type: 'text', value }
  list.push(start < 0 ? node : place(ctx, node, start, end))
}

/**
 * Adds a run of the inline pass to `list`. A run behind a text node of the pass extends it; behind
 * text with no place in the source (`start` -1, as the space of a cell break), the node has none.
 */
function addRun(ctx: TreeContext, list: Inline[], value: string, start: number, end: number): void {
  const last = list.length > 0 ? list[list.length - 1]! : null
  if (last === null || last.type !== 'text') return addText(ctx, list, value, start, end)
  last.value += value
  if (start < 0) delete last.pos
  else if (last.pos !== undefined) last.pos.endOffset = end
}

function traceBreak(trace: LayoutTrace, text: TextNode, fragment: number): void {
  const breaks = trace.breaks.get(text)
  if (breaks === undefined) trace.breaks.set(text, [text.value.length, fragment])
  else breaks.push(text.value.length, fragment)
}

function addBreak(ctx: TreeContext, list: Inline[], node: InlineFrame, flow: number): void {
  const kind = flow & FLOW_KIND_MASK
  if (kind === FLOW_CELL) {
    addText(ctx, list, ' ', -1, -1)
    const text = list[list.length - 1]
    if (ctx.trace !== null && text?.type === 'text') traceBreak(ctx.trace, text, node.end)
    return
  }
  const out: Inline = kind === FLOW_HARD_BREAKS ? { type: 'hard_break' } : { type: 'soft_break' }
  list.push((flow & FLOW_UNPLACED) !== 0 ? out : place(ctx, out, node.start, node.end))
}

/** True for a node that resolution reads: it carries an id, or it is a reference, a note or a cross-reference. */
function isResolvable(node: InlineFrame): boolean {
  if (node.attributes !== null && node.attributes.id !== null) return true
  return node.kind === XREF || node.kind === FOOTNOTE_REF || node.kind === INLINE_FOOTNOTE || (node.flags & FLAG_REFERENCE) !== 0
}

/** Adds the public node of the closed frame `node` to `list`. */
function addNode(ctx: TreeContext, list: Inline[], node: InlineFrame, flow: number): void {
  if (node.kind === SOFT_BREAK) return addBreak(ctx, list, node, flow)
  if (!ctx.resolvable && isResolvable(node)) ctx.resolvable = true
  const out = node.children !== null ? parentNode(ctx, node, node.children) : LEAVES.get(node.kind)!(ctx, node)
  setAttributes(out, node.attributes)
  if (ctx.trace !== null) ctx.trace.inlines.set(out, node)
  list.push((flow & FLOW_UNPLACED) !== 0 ? out : place(ctx, out, node.start, node.end))
}

function isPart(kind: number): boolean {
  return kind === ATTRIBUTE_BLOCK || kind === DESTINATION || kind === TITLE || kind === LABEL
}

/** The source of `[start, end)` without the prefixes of the lines it crosses: its parts inside `spans`, joined by line feeds. */
export function contentSource(src: string, spans: number[], start: number, end: number): string {
  const lines: string[] = []
  for (let at = 0; at < spans.length; at += 2) {
    const from = Math.max(start, spans[at]!)
    const to = Math.min(end, spans[at + 1]!)
    if (from < to) lines.push(src.slice(from, to))
  }
  return lines.join('\n')
}

/** C2-I-067: a backslash before a parenthesis or a backslash is dropped; most destinations hold none. */
function destinationValue(value: string): string {
  return value.includes('\\') ? value.replaceAll(/\\([()\\])/g, '$1') : value
}

/** Closes a part of `host`: it goes into a field of the host. */
function closePart(ctx: TreeContext, spans: number[], node: InlineFrame, host: InlineFrame): void {
  const value = node.value
  if (node.kind === LABEL) host.aux = node.end
  if (node.kind === ATTRIBUTE_BLOCK) {
    host.attributes ??= { id: null, classes: [], language: null, keys: [] }
    readAttributeBlock(ctx.src, node.start, node.end, NO_MEMO, attributeSink(host.attributes))
  } else if (node.kind === DESTINATION) {
    host.destination = destinationValue(value)
  } else if (node.kind === TITLE) {
    host.title = unescape(value, 0, value.length)
  } else if ((host.flags & FLAG_COLLAPSED) !== 0) {
    // C2-I-072: the label of a collapsed reference is the source of its own text.
    host.label = foldLabel(contentSource(ctx.src, spans, host.start + (host.kind === IMAGE ? 2 : 1), node.start - 1))
  } else {
    host.label = foldLabel(value)
  }
}

function openFrame(kind: number, start: number, flags: number, aux: number): InlineFrame {
  return {
    kind, start, end: start, flags, aux, children: isInlineContainer(kind) ? [] : null,
    value: '', spanned: false, destination: null, title: null, label: null, attributes: null,
  }
}

/** The start of a run of text in `flow`: none for a content joined from pieces (C2-A-158). */
function runStart(flow: number, start: number): number {
  return (flow & FLOW_UNPLACED) !== 0 ? -1 : start
}

/** Closes the frame `node` at `end` into `list`, the children of its parent `host` or the root. */
function closeFrame(ctx: TreeContext, spans: number[], node: InlineFrame, host: InlineFrame | null, list: Inline[], flow: number): void {
  // C2-A-041: an escape is no node. Its character is text.
  if (node.kind === ESCAPE) addRun(ctx, list, node.value, runStart(flow, node.start), node.end)
  else if (isPart(node.kind)) closePart(ctx, spans, node, host!)
  else addNode(ctx, list, node, flow)
}

/** Adds the source `[start, end)` to the open leaf `top`, or as a run of text to the list it belongs to. */
function addSpan(ctx: TreeContext, root: Inline[], top: InlineFrame | null, start: number, end: number, flow: number): void {
  const text = ctx.src.slice(start, end)
  if (top === null) return addRun(ctx, root, text, runStart(flow, start), end)
  if (top.children !== null) return addRun(ctx, top.children, text, runStart(flow, start), end)
  top.value = top.spanned ? `${top.value}\n${text}` : text
  top.spanned = true
}

/** Builds the public nodes of one content from the events of its inline pass. */
function buildFromEvents(ctx: TreeContext, spans: number[], flow: number): Inline[] {
  const { events, eventLength } = ctx.inline
  const root: Inline[] = []
  const open: InlineFrame[] = []
  let top: InlineFrame | null = null
  for (const event = new EventCursor(events, eventLength); event.more(); event.next()) {
    const type = event.type()
    if (type === ENTER) {
      top = openFrame(event.kind(), event.start(), event.flags(), event.aux())
      open.push(top)
    } else if (type === SPAN) {
      addSpan(ctx, root, top, event.start(), event.end(), flow)
    } else {
      const node = open.pop()!
      node.end = event.end()
      top = open.length > 0 ? open[open.length - 1]! : null
      closeFrame(ctx, spans, node, top, top === null ? root : top.children!, flow)
    }
  }
  return root
}

/**
 * C2-I-001: the public nodes of the content `spans[from..to)`. `lineComments` is false where `%%`
 * is text (C2-B-130, C2-B-144).
 */
export function contentNodes(ctx: TreeContext, spans: number[], from: number, to: number, lineComments: boolean, flow: number): Inline[] {
  // One line of plain text is one text node, with no pass over it.
  if (to - from === 2 && isPlainText(ctx.src, spans[from]!, spans[from + 1]!)) {
    const list: Inline[] = []
    addText(ctx, list, ctx.src.slice(spans[from], spans[from + 1]), runStart(flow, spans[from]!), spans[from + 1]!)
    return list
  }
  scanInline(ctx.inline, ctx.src, spans, from, to, ctx.depth, lineComments)
  return buildFromEvents(ctx, spans, flow)
}

/**
 * The inline content of a leaf whose lines are `spans`. `ctx.resolvable` tells afterwards whether
 * it holds a node that resolution reads; `noteLeaf` notes the leaf then.
 */
export function leafInlines(ctx: TreeContext, spans: number[], flow: number): Inline[] {
  ctx.resolvable = false
  return contentNodes(ctx, spans, 0, spans.length, true, flow)
}

/** C2-B-130, C2-B-144: line `at` of a line block is a content of its own, and `%%` is text in it. */
export function lineInlines(ctx: TreeContext, spans: number[], at: number): Inline[] {
  ctx.resolvable = false
  return contentNodes(ctx, spans, at, at + 2, false, FLOW_PLAIN)
}

/** Notes `leaf` when the content just built for it holds a node that resolution reads. */
export function noteLeaf<N extends Node>(ctx: TreeContext, leaf: N): N {
  if (ctx.resolvable) ctx.resolvableLeaves.add(leaf)
  return leaf
}
