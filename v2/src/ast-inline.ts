// The inline nodes of the public tree (spec/0.2/ast.md), from the inline tree of one content.
import { type AstNode, type Attrs } from './ast.ts'
import {
  AUTOLINK, CODE_SPAN, EDITORIAL, FIRST_INLINE_KIND, FLAG_BRACED, FLAG_COLLAPSED, FLAG_DISPLAY,
  FLAG_EMAIL, FLAG_REFERENCE, FOOTNOTE_REF, HARD_BREAK, IMAGE, INLINE_COMMENT, INLINE_EXTENSION, INLINE_FOOTNOTE,
  INLINE_KIND_NAMES, LINK, LITERAL, MATH, MENTION, NBSP, RAW_INLINE, SMART, SOFT_BREAK, SYMBOL, TAG, XREF,
} from './inline-kinds.ts'
import { SMART_GLYPHS, SMART_KIND_NAMES } from './inline-tables.ts'
import { type Attributes, foldLabel, type InlineNode, TEXT } from './inline-tree.ts'

/** What a tree build needs besides the nodes: the source, and whether positions are wanted. */
export interface TreeContext {
  src: string
  positions: boolean
  /** C2-I-098: the expansion of each defined term. The first definition of a term wins (C2-B-085). */
  abbreviations: Map<string, string>
  /** The offset of the own markup of each block that took attribute lines (C2-A-148). */
  markup: Map<AstNode, number>
  /** The source lines of the text of each heading, as a start and an end per line (C2-I-084). */
  headingSpans: Map<AstNode, number[]>
  /**
   * Set when an inline node is built that resolution reads: one with an id, a reference, a note or
   * a cross-reference. A leaf asks it after its content is built.
   */
  resolvable: boolean
  /** The leaves whose inline content holds such a node. Resolution walks into no other leaf. */
  resolvableLeaves: Set<AstNode>
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
export function place(ctx: TreeContext, node: AstNode, start: number, end: number): AstNode {
  if (ctx.positions) node.pos = { startLine: 0, endLine: 0, startColumn: 0, endColumn: 0, startOffset: start, endOffset: end }
  return node
}

/** C2-A-032, C2-A-037: the attribute blocks of a node as `attrs` and `lang`. */
export function setAttributes(node: AstNode, attributes: Attributes | null): void {
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

/** C2-A-105, C2-A-107: the target of a link or an image, direct or by reference. */
function setTarget(out: AstNode, node: InlineNode, field: 'href' | 'src'): void {
  if ((node.flags & FLAG_REFERENCE) !== 0) {
    out.key = node.label ?? ''
    out.namespace = 'link'
    out.form = (node.flags & FLAG_COLLAPSED) !== 0 ? 'collapsed' : 'full'
    return
  }
  out[field] = node.destination ?? ''
  if (node.title !== null) out.tooltip = node.title
}

type LeafBuilder = (ctx: TreeContext, node: InlineNode) => AstNode

function valueNode(type: string): LeafBuilder {
  return (_ctx, node) => ({ type, value: node.value ?? '' })
}

function nameNode(type: string): LeafBuilder {
  return (_ctx, node) => ({ type, name: node.value ?? '' })
}

const LEAVES = new Map<number, LeafBuilder>([
  [CODE_SPAN, valueNode('code')],
  [LITERAL, valueNode('literal_inline')],
  [EDITORIAL, valueNode('critic_comment')],
  [TAG, nameNode('tag')],
  [SYMBOL, nameNode('symbol')],
  [NBSP, () => ({ type: 'non_breaking_space' })],
  [HARD_BREAK, () => ({ type: 'hard_break' })],
  [SOFT_BREAK, () => ({ type: 'soft_break' })],
  [MATH, (_ctx, node) => ({ type: 'math', display: (node.flags & FLAG_DISPLAY) !== 0, value: node.value ?? '' })],
  [RAW_INLINE, (ctx, node) => ({
    type: 'raw_inline', format: ctx.src.slice(node.aux, ctx.src.indexOf('}', node.aux)), value: node.value ?? '',
  })],
  [INLINE_COMMENT, (_ctx, node) => {
    const braced = (node.flags & FLAG_BRACED) !== 0
    return { type: 'comment', form: braced ? 'braced' : 'line', value: commentValue(node.value ?? '', braced) }
  }],
  // C2-H-079: the destination of an email autolink is `mailto:` and the address; its text is the address.
  [AUTOLINK, (_ctx, node) => {
    const body = node.value ?? ''
    return (node.flags & FLAG_EMAIL) !== 0 ? { type: 'autolink', href: `mailto:${body}`, text: body } : { type: 'autolink', href: body }
  }],
  [XREF, (_ctx, node) => ({ type: 'xref', key: node.value ?? '', namespace: 'heading' })],
  [MENTION, (_ctx, node) => ({ type: 'mention', target: node.value ?? '', kind: 'user' })],
  [FOOTNOTE_REF, (_ctx, node) => ({ type: 'footnote_ref', key: foldLabel(node.value ?? ''), namespace: 'footnote' })],
  [SMART, (ctx, node) => ({
    type: 'smart_punctuation', kind: SMART_KIND_NAMES[node.aux]!, glyph: SMART_GLYPHS[node.aux]!,
    source: ctx.src.slice(node.start, node.end),
  })],
  [IMAGE, (_ctx, node) => {
    const out: AstNode = { type: 'image' }
    setTarget(out, node, 'src')
    out.alt = node.value ?? ''
    return out
  }],
])

/** A node with inline children: its type is the name of its kind, with the fields of a link and of an extension. */
function parentNode(ctx: TreeContext, node: InlineNode, flow: number): AstNode {
  const out: AstNode = { type: INLINE_KIND_NAMES[node.kind - FIRST_INLINE_KIND]! }
  if (node.kind === LINK) setTarget(out, node, 'href')
  if (node.kind === INLINE_EXTENSION) out.name = ctx.src.slice(node.start + 1, node.aux)
  out.children = inlineNodes(ctx, node.children!, flow)
  return out
}

/** Adds text to `list`: adjacent runs are one text node (C2-A-040). */
export function addText(ctx: TreeContext, list: AstNode[], value: string, start: number, end: number): void {
  const last = list.length > 0 ? list[list.length - 1]! : null
  if (last !== null && last.type === 'text') {
    last.value += value
    // The inline tree has joined the runs that are adjacent in the source, so these two are not (C2-A-158).
    delete last.pos
    return
  }
  const node: AstNode = { type: 'text', value }
  list.push(start < 0 ? node : place(ctx, node, start, end))
}

function addBreak(ctx: TreeContext, list: AstNode[], node: InlineNode, flow: number): void {
  const kind = flow & FLOW_KIND_MASK
  if (kind === FLOW_CELL) return addText(ctx, list, ' ', -1, -1)
  const out: AstNode = { type: kind === FLOW_HARD_BREAKS ? 'hard_break' : 'soft_break' }
  list.push((flow & FLOW_UNPLACED) !== 0 ? out : place(ctx, out, node.start, node.end))
}

/** True for a node that resolution reads: it carries an id, or it is a reference, a note or a cross-reference. */
function isResolvable(node: InlineNode): boolean {
  if (node.attributes !== null && node.attributes.id !== null) return true
  return node.kind === XREF || node.kind === FOOTNOTE_REF || node.kind === INLINE_FOOTNOTE || (node.flags & FLAG_REFERENCE) !== 0
}

function addNode(ctx: TreeContext, list: AstNode[], node: InlineNode, flow: number): void {
  const unplaced = (flow & FLOW_UNPLACED) !== 0
  if (node.kind === TEXT) return addText(ctx, list, node.value ?? '', unplaced ? -1 : node.start, node.end)
  if (node.kind === SOFT_BREAK) return addBreak(ctx, list, node, flow)
  if (!ctx.resolvable && isResolvable(node)) ctx.resolvable = true
  const out = node.children !== null ? parentNode(ctx, node, flow) : LEAVES.get(node.kind)!(ctx, node)
  setAttributes(out, node.attributes)
  list.push(unplaced ? out : place(ctx, out, node.start, node.end))
}

/** The public nodes of the inline nodes of one content or of one node with inline children. */
export function inlineNodes(ctx: TreeContext, nodes: InlineNode[], flow: number): AstNode[] {
  const list: AstNode[] = []
  for (const node of nodes) addNode(ctx, list, node, flow)
  return list
}

/**
 * The inline content of the leaf `leaf`, as `inlineNodes` gives it. The leaf is noted when its
 * content holds a node that resolution reads.
 */
export function leafInlines(ctx: TreeContext, leaf: AstNode, nodes: InlineNode[], flow: number): AstNode[] {
  ctx.resolvable = false
  const list = inlineNodes(ctx, nodes, flow)
  if (ctx.resolvable) ctx.resolvableLeaves.add(leaf)
  return list
}
