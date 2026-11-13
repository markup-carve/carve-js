// The block nodes of the public tree (spec/0.2/ast.md), from the block tree and its inline content.
import { type AstNode, AST_VERSION, type Marker } from './ast.ts'
import { applyAbbreviations } from './ast-abbreviations.ts'
import { emptyAttributes, readAttributeLines, readGluedBlocks } from './ast-attributes.ts'
import {
  addText, commentValue, FLOW_HARD_BREAKS, FLOW_PLAIN, inlineNodes, place, setAttributes, type TreeContext,
} from './ast-inline.ts'
import { captionChildren, includeNode, linkDefinitionFields, openerTitle } from './ast-lines.ts'
import { delimitedTableNode, tableNode } from './ast-table.ts'
import { SPACE, STAR } from './chars.ts'
import { type Attributes, foldLabel } from './inline-tree.ts'
import {
  ABBREVIATION, BULLET_LIST, CAPTION, CODE, COMMENT, COMMENT_BLOCK, DESCRIPTION, DESCRIPTION_LIST, DIV, FLAG_ALPHA,
  FLAG_AUTO, FLAG_BLOCK_MATH, FLAG_DELIMITED, FLAG_FIGURE, FLAG_HARD_BREAKS, FLAG_IMAGE, FLAG_MARKER_ATTRIBUTES,
  FLAG_PAREN, FLAG_QUOTE_FENCE, FLAG_RAW, FLAG_ROMAN, FLAG_STAR, FLAG_TIGHT, FLAG_UPPER, FOOTNOTE, FRONTMATTER,
  HEADING, INCLUDE, ITEM, LINE_BLOCK, LINK_DEFINITION, ORDERED_LIST, PARAGRAPH, QUOTE, TABLE, TERM, THEMATIC_BREAK,
} from './kinds.ts'
import { orderedDelimiter } from './lines.ts'
import { definitionLabel, readOpenerInfo } from './opener.ts'
import { finishPositions, utf8Length } from './positions.ts'
import { type BlockNode } from './tree.ts'
import { DIV_KINDS, HARD_BREAKS_CLASS, TASK_STATUS } from './tree-tables.ts'

type BlockBuilder = (ctx: TreeContext, node: BlockNode, flow: number, attributes: Attributes | null) => AstNode

function lineEnd(src: string, pos: number): number {
  const end = src.indexOf('\n', pos)
  return end < 0 ? src.length : end
}

/** C2-A-045, C2-A-046: every line of an opaque body with a line break after it. */
function bodyValue(src: string, spans: number[]): string {
  let value = ''
  for (let at = 0; at < spans.length; at += 2) value += `${src.slice(spans[at], spans[at + 1])}\n`
  return value
}

/** The inline content of a text leaf, with the abbreviations in its text (C2-I-098). */
function leafChildren(ctx: TreeContext, node: BlockNode, flow: number): AstNode[] {
  const children = inlineNodes(ctx, node.inlines ?? [], flow)
  if (ctx.abbreviations.size > 0) applyAbbreviations(ctx, children)
  return children
}

/** True when `children` holds exactly one node for which `test` holds, and besides it only comments and breaks. */
function holdsOnly(children: AstNode[], test: (node: AstNode) => boolean): boolean {
  let found = 0
  for (const child of children) {
    if (test(child)) found++
    else if (child.type !== 'comment' && child.type !== 'soft_break' && child.type !== 'hard_break') return false
  }
  return found === 1
}

function paragraphNode(ctx: TreeContext, node: BlockNode, flow: number): AstNode {
  const out: AstNode = { type: 'paragraph', children: leafChildren(ctx, node, flow) }
  // C2-A-136, C2-A-184: the mark needs the shape of the line and the one node the inline pass made of it.
  if ((node.exitFlags & FLAG_IMAGE) !== 0 && holdsOnly(out.children!, (child) => child.type === 'image')) out.blockImage = true
  if ((node.exitFlags & FLAG_BLOCK_MATH) !== 0 && holdsOnly(out.children!, (child) => child.type === 'math' && child.display === true)) {
    out.blockMath = true
  }
  return out
}

function commentNode(ctx: TreeContext, node: BlockNode): AstNode {
  const out: AstNode = { type: 'comment', form: 'line', value: commentValue(ctx.src.slice(node.spans![0]! + 2, node.spans![1]), false) }
  return place(ctx, out, node.start, node.end)
}

/** C2-A-074: the body of a comment block, its lines joined by line breaks. */
function commentBlockNode(ctx: TreeContext, node: BlockNode): AstNode {
  const lines: string[] = []
  const spans = node.spans!
  for (let at = 0; at < spans.length; at += 2) lines.push(ctx.src.slice(spans[at], spans[at + 1]))
  return { type: 'comment', form: 'block', value: lines.join('\n') }
}

/** C2-A-049: the format is the word on the opener, or `yaml`. */
function frontmatterNode(ctx: TreeContext, node: BlockNode): AstNode {
  const src = ctx.src
  let word = node.start + 3
  if (src.charCodeAt(word) === SPACE) word++
  const name = src.slice(word, word + 4)
  const format = name === 'toml' || name === 'json' ? name : 'yaml'
  return { type: 'frontmatter', format, value: bodyValue(src, node.spans!) }
}

function codeNode(ctx: TreeContext, node: BlockNode): AstNode {
  const src = ctx.src
  if ((node.flags & FLAG_DELIMITED) !== 0) return delimitedTableNode(ctx, node)
  const info = readOpenerInfo(src, node.start + node.aux)
  const word = info.wordStart < 0 ? '' : src.slice(info.wordStart, info.wordEnd)
  const value = bodyValue(src, node.spans!)
  // C2-B-116: `=` and a format name make a raw block, which takes no title and no label (C2-B-122).
  if ((node.flags & FLAG_RAW) !== 0) return { type: 'raw_block', format: word.slice(1), value }
  const out: AstNode = { type: 'code_block', value }
  if (word !== '') out.syntax = word
  if (info.titleStart >= 0) out.title = [{ type: 'text', value: openerTitle(src, info.titleStart, info.titleEnd) }]
  if (info.labelStart >= 0) out.groupLabel = src.slice(info.labelStart, info.labelEnd)
  return out
}

/** C2-A-069: one `line` per line of the body; an empty line ends a stanza. */
function lineBlockNode(ctx: TreeContext, node: BlockNode): AstNode {
  const lines = (node.inlines ?? []).map((line) => {
    const children = inlineNodes(ctx, line.children!, FLOW_PLAIN)
    if (ctx.abbreviations.size > 0) applyAbbreviations(ctx, children)
    return place(ctx, { type: 'line', children }, line.start, line.end)
  })
  return { type: 'line_block', children: lines }
}

function abbreviationNode(ctx: TreeContext, node: BlockNode): AstNode {
  const [key, expansion] = abbreviationParts(ctx.src, node)
  return { type: 'abbreviation_def', expansion, key, namespace: 'abbr' }
}

/** C2-B-084: the label and the expansion of an abbreviation definition. */
function abbreviationParts(src: string, node: BlockNode): [string, string] {
  const [start, end] = definitionLabel(src, node.start)
  return [src.slice(start, end), src.slice(end + 2, node.spans![1]).trim()]
}

function linkDefinitionNode(ctx: TreeContext, node: BlockNode): AstNode {
  const [start, end] = definitionLabel(ctx.src, node.start)
  const out: AstNode = { type: 'link_reference_definition', key: foldLabel(ctx.src.slice(start, end)), namespace: 'link' }
  linkDefinitionFields(ctx.src, end + 2, node.spans![1]!, out)
  return out
}

function listNode(ctx: TreeContext, node: BlockNode, flow: number): AstNode {
  const flags = node.flags
  let marker: Marker
  if (node.kind === BULLET_LIST) {
    marker = { kind: 'bullet', char: (flags & FLAG_STAR) !== 0 ? '*' : '-' }
  } else {
    let style = (flags & FLAG_ROMAN) !== 0 ? 'i' : (flags & FLAG_ALPHA) !== 0 ? 'a' : '1'
    if ((flags & FLAG_UPPER) !== 0) style = style.toUpperCase()
    marker = { kind: 'ordered', style, delimiter: (flags & FLAG_PAREN) !== 0 ? ')' : '.' }
    // C2-A-058: a start of 1 is omitted, and the bare dot starts at 1.
    if ((flags & FLAG_AUTO) === 0 && node.aux !== 1) marker.start = node.aux
  }
  return {
    type: 'list', marker, spacing: (node.exitFlags & FLAG_TIGHT) !== 0 ? 'tight' : 'loose',
    children: blockChildren(ctx, node.children!, flow),
  }
}

/** C2-B-101: the brace blocks that abut the marker of an item. */
function markerAttributes(ctx: TreeContext, node: BlockNode): Attributes | null {
  if ((node.flags & FLAG_MARKER_ATTRIBUTES) === 0) return null
  const src = ctx.src
  const end = lineEnd(src, node.start)
  const code = src.charCodeAt(node.start)
  const after = code === STAR || src[node.start] === '-' ? node.start + 1 : orderedDelimiter(src, node.start, end) + 1
  const attributes = emptyAttributes()
  readGluedBlocks(src, after, end, attributes)
  return attributes
}

function itemNode(ctx: TreeContext, node: BlockNode, flow: number): AstNode {
  const out: AstNode = { type: 'list_item', children: blockChildren(ctx, node.children!, flow) }
  if (node.aux !== 0) {
    const mark = String.fromCharCode(node.aux)
    out.task = { mark, status: TASK_STATUS.get(mark)! }
  }
  setAttributes(out, markerAttributes(ctx, node))
  return out
}

function footnoteNode(ctx: TreeContext, node: BlockNode, flow: number): AstNode {
  const [start, end] = definitionLabel(ctx.src, node.start)
  return { type: 'footnote', key: foldLabel(ctx.src.slice(start, end)), namespace: 'footnote', children: blockChildren(ctx, node.children!, flow) }
}

/** C2-A-066: the node a div opener gives, before its children. */
function divShell(ctx: TreeContext, node: BlockNode, attributes: Attributes): AstNode {
  const src = ctx.src
  if ((node.flags & FLAG_QUOTE_FENCE) !== 0) return { type: 'block_quote' }
  if ((node.flags & FLAG_FIGURE) !== 0) return { type: 'figure_group' }
  if ((node.flags & FLAG_HARD_BREAKS) !== 0) {
    // C2-A-068: the opener form adds the class after the classes the author wrote.
    attributes.classes.push(HARD_BREAKS_CLASS)
    return { type: 'div' }
  }
  const info = readOpenerInfo(src, node.start + node.aux)
  const name = info.wordStart < 0 ? '' : src.slice(info.wordStart, info.wordEnd)
  const kind = name === 'figure' ? undefined : DIV_KINDS.get(name)
  const out: AstNode = kind === undefined ? { type: 'div' } : { type: kind, kind: name }
  // C2-B-128: the name of a plain div is its first class.
  if (kind === undefined && name !== '') attributes.classes.unshift(name)
  if (info.titleStart >= 0) out.title = captionChildren(ctx, info.titleStart, info.titleEnd)
  if (info.labelStart >= 0) out.groupLabel = src.slice(info.labelStart, info.labelEnd)
  return out
}

function divNode(ctx: TreeContext, node: BlockNode, flow: number, taken: Attributes | null): AstNode {
  const attributes = taken ?? emptyAttributes()
  const out = divShell(ctx, node, attributes)
  // C2-A-068: in a hard-break block, written with the opener or with the class, every line end is a hard break.
  const inner = out.type === 'div' && attributes.classes.includes(HARD_BREAKS_CLASS) ? FLOW_HARD_BREAKS : flow
  out.children = blockChildren(ctx, node.children!, inner)
  setAttributes(out, attributes)
  return out
}

function headingNode(ctx: TreeContext, node: BlockNode, flow: number): AstNode {
  const out: AstNode = { type: 'heading', level: node.aux, children: leafChildren(ctx, node, flow) }
  // C2-I-084: a reference finds a heading by the folded source of its text.
  const lines: string[] = []
  for (let at = 0; at < node.spans!.length; at += 2) lines.push(ctx.src.slice(node.spans![at], node.spans![at + 1]))
  ctx.headingSources.set(out, foldLabel(lines.join('\n')))
  return out
}

function container(type: string): BlockBuilder {
  return (ctx, node, flow) => ({ type, children: blockChildren(ctx, node.children!, flow) })
}

function textLeaf(type: string): BlockBuilder {
  return (ctx, node, flow) => ({ type, children: leafChildren(ctx, node, flow) })
}

const BUILDERS = new Map<number, BlockBuilder>([
  [QUOTE, container('block_quote')],
  [BULLET_LIST, listNode],
  [ORDERED_LIST, listNode],
  [ITEM, itemNode],
  [DESCRIPTION_LIST, container('definition_list')],
  [DESCRIPTION, container('definition_description')],
  [FOOTNOTE, footnoteNode],
  [DIV, divNode],
  [TABLE, (ctx, node) => tableNode(ctx, node, commentNode)],
  [PARAGRAPH, paragraphNode],
  [TERM, textLeaf('definition_term')],
  [CODE, codeNode],
  [COMMENT_BLOCK, commentBlockNode],
  [LINE_BLOCK, lineBlockNode],
  [FRONTMATTER, frontmatterNode],
  [HEADING, headingNode],
  [THEMATIC_BREAK, () => ({ type: 'thematic_break' })],
  [COMMENT, commentNode],
  [INCLUDE, (ctx, node) => includeNode(ctx.src, node.spans![0]!, node.spans![1]!)],
  [LINK_DEFINITION, linkDefinitionNode],
  [ABBREVIATION, abbreviationNode],
])

/** The kinds that read their attribute lines themselves, because some of the keys are not attributes of the node. */
function readsOwnAttributes(node: BlockNode): boolean {
  return node.kind === TABLE || node.kind === DIV || (node.kind === CODE && (node.flags & FLAG_DELIMITED) !== 0)
}

function blockNode(ctx: TreeContext, node: BlockNode, flow: number): AstNode {
  const own = readsOwnAttributes(node)
  const attributes = own && node.kind !== DIV ? null : readAttributeLines(ctx.src, node.attributes)
  const out = BUILDERS.get(node.kind)!(ctx, node, flow, attributes)
  if (!own) setAttributes(out, attributes)
  if (out.pos !== undefined) return out
  // C2-A-148: a block that took attribute lines starts at the first of them.
  if (node.attributes === null || node.attributes.length === 0 || !ctx.positions) return place(ctx, out, node.start, node.end)
  ctx.markup.set(out, node.start)
  return place(ctx, out, node.attributes[0]!, node.end)
}

/** C2-A-081: a caption holds one paragraph; the first bare `#` of its text is the number mark (C2-B-150). */
function captionNode(ctx: TreeContext, node: BlockNode, flow: number): AstNode {
  // The mark is found in the source of the text, so the text is placed also where no position is asked for.
  const paragraph: AstNode = { type: 'paragraph', children: leafChildren(ctx.positions ? ctx : { ...ctx, positions: true }, node, flow) }
  markCaptionNumber(ctx, paragraph.children!)
  if (!ctx.positions) dropPositions(paragraph.children!)
  place(ctx, paragraph, node.spans![0]!, node.end)
  return place(ctx, { type: 'caption', children: [paragraph] }, node.start, node.end)
}

function dropPositions(nodes: AstNode[]): void {
  for (const node of nodes) {
    delete node.pos
    if (node.children !== undefined) dropPositions(node.children)
  }
}

function isNameCharacter(code: number): boolean {
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95 || code === 45
}

/** The index of the caption number mark in the value of a top-level text node that starts at `start` in the source, or -1. */
function numberMarkIndex(src: string, start: number, value: string): number {
  let at = start
  for (let index = 0; index < value.length; index++, at++) {
    // C2-A-041: an escaped character is part of the text, and `\#` is no mark.
    const escaped = src[at] === '\\' && src[at + 1] === value[index]
    if (escaped) at++
    if (escaped || value[index] !== '#') continue
    // A character that starts no tag name follows it, or nothing does.
    if (index + 1 === value.length || !isNameCharacter(value.charCodeAt(index + 1))) return index
  }
  return -1
}

/** Splits the first top-level text node that holds the mark around a `caption_number` node. */
function markCaptionNumber(ctx: TreeContext, children: AstNode[]): void {
  for (let at = 0; at < children.length; at++) {
    const child = children[at]!
    if (child.type !== 'text') continue
    const value = child.value!
    const start = child.pos?.startOffset ?? -1
    // A text node with no position was merged from pieces, and its source is not at hand: it holds no mark.
    const index = start < 0 ? -1 : numberMarkIndex(ctx.src, start, value)
    if (index < 0) continue
    const parts: AstNode[] = []
    if (index > 0) addText(ctx, parts, value.slice(0, index), -1, -1)
    parts.push({ type: 'caption_number' })
    if (index + 1 < value.length) addText(ctx, parts, value.slice(index + 1), -1, -1)
    children.splice(at, 1, ...parts)
    return
  }
}

/** C2-A-082, C2-A-183: attaches a caption to the block above it, through the comments between them. */
function attachCaption(ctx: TreeContext, list: AstNode[], caption: AstNode): void {
  let at = list.length - 1
  while (at >= 0 && list[at]!.type === 'comment') at--
  if (at < 0) return
  const target = list[at]!
  const comments = list.splice(at + 1)
  if (target.type === 'table' || target.type === 'figure_group') {
    for (const comment of comments) target.children!.push(comment)
    target.caption = caption
    if (target.pos !== undefined && caption.pos !== undefined) target.pos.endOffset = caption.pos.endOffset
    return
  }
  const figure: AstNode = { type: 'figure', children: [target, ...comments], caption }
  // The attribute line above a captioned block applies to the figure.
  if (target.attrs !== undefined) figure.attrs = target.attrs
  if (target.lang !== undefined) figure.lang = target.lang
  delete target.attrs
  delete target.lang
  if (target.pos !== undefined && caption.pos !== undefined) {
    figure.pos = { ...target.pos, endOffset: caption.pos.endOffset }
    // C2-A-148: the block inside starts at its own markup, behind the attribute lines the figure took.
    target.pos.startOffset = ctx.markup.get(target) ?? target.pos.startOffset
  }
  list[at] = figure
}

function blockChildren(ctx: TreeContext, nodes: BlockNode[], flow: number): AstNode[] {
  const list: AstNode[] = []
  for (const node of nodes) {
    if (node.kind === CAPTION) attachCaption(ctx, list, captionNode(ctx, node, flow))
    else list.push(blockNode(ctx, node, flow))
  }
  return list
}

/** C2-B-085: the first definition of a term wins. */
function collectAbbreviations(src: string, root: BlockNode): Map<string, string> {
  const terms = new Map<string, string>()
  for (const child of root.children!) {
    if (child.kind !== ABBREVIATION) continue
    const [key, expansion] = abbreviationParts(src, child)
    if (!terms.has(key)) terms.set(key, expansion)
  }
  return terms
}

export interface BuiltTree {
  document: AstNode
  /** The folded source of the text of each heading, which resolution reads (C2-I-084). */
  headingSources: Map<AstNode, string>
}

/** The public tree of `src` from its block tree, whose inline content has been read. */
export function buildDocument(src: string, root: BlockNode, positions: boolean): BuiltTree {
  const ctx: TreeContext = { src, positions, abbreviations: collectAbbreviations(src, root), markup: new Map(), headingSources: new Map() }
  const document: AstNode = { type: 'document', astVersion: AST_VERSION, children: blockChildren(ctx, root.children!, FLOW_PLAIN) }
  if (positions) {
    document.srcByteLength = utf8Length(src)
    finishPositions(document, src)
  }
  return { document, headingSources: ctx.headingSources }
}
