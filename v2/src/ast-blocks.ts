// The block nodes of the public tree (spec/0.2/ast.md), from the block tree and its inline content.
import {
  AST_VERSION, type Block, type CaptionNode, type CodeBlockNode, type CommentNode, type DefinitionListNode, type DocumentNode,
  type FigureGroupNode, type FigureNode, type FrontmatterNode, type HeadingNode, type Inline, isFieldValue, type LineBlockNode,
  type LineNode, type LinkReferenceDefinitionNode, type ListItemNode, type ListNode, type Marker, type Node, type ParagraphNode,
  type TableNode,
} from './ast.ts'
import { applyAbbreviations } from './ast-abbreviations.ts'
import { type Attributes, emptyAttributes, foldLabel, readAttributeLines, readGluedBlocks, takeKey } from './ast-attributes.ts'
import {
  addText, commentValue, FLOW_HARD_BREAKS, FLOW_PLAIN, type LayoutTrace, leafInlines, lineInlines, noteLeaf, place,
  setAttributes, type TreeContext,
} from './ast-inline.ts'
import { captionChildren, includeNode, linkDefinitionFields, openerTitle } from './ast-lines.ts'
import { delimitedTableNode, tableNode } from './ast-table.ts'
import { DIGIT_0, DIGIT_9, LF, SPACE, STAR } from './chars.ts'
import { scanBlocks } from './blocks.ts'
import { acquireInlineState, releaseInlineState } from './inline-state.ts'
import {
  ABBREVIATION, BULLET_LIST, CAPTION, CODE, COMMENT, COMMENT_BLOCK, DESCRIPTION, DESCRIPTION_LIST, DIV, FLAG_ALPHA,
  FLAG_AUTO, FLAG_BLOCK_MATH, FLAG_DELIMITED, FLAG_FIGURE, FLAG_HARD_BREAKS, FLAG_IMAGE, FLAG_MARKER_ATTRIBUTES,
  FLAG_PAREN, FLAG_QUOTE_FENCE, FLAG_RAW, FLAG_ROMAN, FLAG_STAR, FLAG_TIGHT, FLAG_UPPER, FOOTNOTE, FRONTMATTER,
  DOCUMENT, HEADING, INCLUDE, LINE_BLOCK, LINK_DEFINITION, ORDERED_LIST, PARAGRAPH, QUOTE, TABLE, TERM, THEMATIC_BREAK,
} from './kinds.ts'
import { orderedDelimiter, trimEnd } from './lines.ts'
import { lineFeedAt } from './source.ts'
import { definitionLabel, type OpenerInfo, readOpenerInfo } from './opener.ts'
import { finishPositions, utf8Length } from './positions.ts'
import { acquireState, releaseState } from './state.ts'
import { type BlockNode, buildTree } from './tree.ts'
import { DIV_KINDS, HARD_BREAKS_CLASS, TASK_STATUS } from './tree-tables.ts'
import { isAsciiNameCharacter } from './unicode.ts'

/** A child of the document or of a block container: a block, or a definition or frontmatter, which the document alone takes. */
type DocumentChild = DocumentNode['children'][number]

type DescriptionChild = DefinitionListNode['children'][number]

type BlockBuilder<N extends Node> = (ctx: TreeContext, node: BlockNode, flow: number, attributes: Attributes | null) => N

/** True when each line of `spans` starts one character behind the end of the line before it, at a line feed. */
function isContiguous(src: string, spans: number[]): boolean {
  for (let at = 2; at < spans.length; at += 2) {
    if (spans[at] !== spans[at - 1]! + 1 || src.charCodeAt(spans[at - 1]!) !== LF) return false
  }
  return spans.length > 0
}

/** C2-A-045, C2-A-046: every line of an opaque body with a line break after it. */
function bodyValue(src: string, spans: number[]): string {
  // A body at column 0 with bare line feeds is one piece of the source, which is the usual case.
  if (isContiguous(src, spans)) return `${src.slice(spans[0], spans[spans.length - 1])}\n`
  let value = ''
  for (let at = 0; at < spans.length; at += 2) value += `${src.slice(spans[at], spans[at + 1])}\n`
  return value
}

/** The inline content of the text leaf `node`, with the abbreviations in its text (C2-I-098). */
function leafChildren(ctx: TreeContext, node: BlockNode, flow: number): Inline[] {
  const children = leafInlines(ctx, node.spans!, flow)
  if (ctx.abbreviations.size > 0) applyAbbreviations(ctx, children)
  return children
}

/** True when `children` holds exactly one node for which `test` holds, and besides it only comments and breaks. */
function holdsOnly(children: Inline[], test: (node: Inline) => boolean): boolean {
  let found = 0
  for (const child of children) {
    if (test(child)) found++
    else if (child.type !== 'comment' && child.type !== 'soft_break' && child.type !== 'hard_break') return false
  }
  return found === 1
}

function paragraphNode(ctx: TreeContext, node: BlockNode, flow: number): ParagraphNode {
  const children = leafChildren(ctx, node, flow)
  const out: ParagraphNode = noteLeaf(ctx, { type: 'paragraph', children })
  // C2-A-136, C2-A-184: the mark needs the shape of the line and the one node the inline pass made of it.
  if ((node.exitFlags & FLAG_IMAGE) !== 0 && holdsOnly(children, (child) => child.type === 'image')) out.blockImage = true
  if ((node.exitFlags & FLAG_BLOCK_MATH) !== 0 && holdsOnly(children, (child) => child.type === 'math' && child.display)) {
    out.blockMath = true
  }
  return out
}

function commentNode(ctx: TreeContext, node: BlockNode): CommentNode {
  const out: CommentNode = { type: 'comment', form: 'line', value: commentValue(ctx.src.slice(node.spans![0]! + 2, node.spans![1]), false) }
  return place(ctx, out, node.start, node.end)
}

/** C2-A-074: the body of a comment block, its lines joined by line breaks. */
function commentBlockNode(ctx: TreeContext, node: BlockNode): CommentNode {
  const lines: string[] = []
  const spans = node.spans!
  for (let at = 0; at < spans.length; at += 2) lines.push(ctx.src.slice(spans[at], spans[at + 1]))
  return { type: 'comment', form: 'block', value: lines.join('\n') }
}

/** C2-A-049: the format is the word on the opener, or `yaml`. */
function frontmatterNode(ctx: TreeContext, node: BlockNode): FrontmatterNode {
  const src = ctx.src
  // C2-B-164: the name is glued or stands after one space, and ends at the next space, tab or line end.
  const word = src.charCodeAt(node.start + 3) === SPACE ? node.start + 4 : node.start + 3
  let wordEnd = word
  while (wordEnd < src.length && src.charCodeAt(wordEnd) > SPACE) wordEnd++
  const format = wordEnd > word ? src.slice(word, wordEnd) : 'yaml'
  return { type: 'frontmatter', format, value: bodyValue(src, node.spans!) }
}

function codeNode(ctx: TreeContext, node: BlockNode): Block {
  const src = ctx.src
  if ((node.flags & FLAG_DELIMITED) !== 0) return delimitedTableNode(ctx, node)
  const info = readOpenerInfo(src, node.start + node.aux)
  const word = info.wordStart < 0 ? '' : src.slice(info.wordStart, info.wordEnd)
  const value = bodyValue(src, node.spans!)
  // C2-B-116: `=` and a format name make a raw block, which takes no title and no label (C2-B-122).
  if ((node.flags & FLAG_RAW) !== 0) return { type: 'raw_block', format: word.slice(1), value }
  const out: CodeBlockNode = { type: 'code_block', value }
  if (word !== '') out.syntax = word
  if (info.titleStart >= 0) out.title = [{ type: 'text', value: openerTitle(src, info.titleStart, info.titleEnd) }]
  if (info.labelStart >= 0) out.groupLabel = src.slice(info.labelStart, info.labelEnd)
  return out
}

/** C2-A-069: one `line` per line of the body; an empty line ends a stanza. */
function lineBlockNode(ctx: TreeContext, node: BlockNode): LineBlockNode {
  const spans = node.spans!
  const lines: LineNode[] = []
  for (let at = 0; at < spans.length; at += 2) {
    const children = lineInlines(ctx, spans, at)
    if (ctx.abbreviations.size > 0) applyAbbreviations(ctx, children)
    const line: LineNode = noteLeaf(ctx, { type: 'line', children })
    lines.push(place(ctx, line, spans[at]!, spans[at + 1]!))
  }
  return { type: 'line_block', children: lines }
}

function abbreviationNode(ctx: TreeContext, node: BlockNode): DocumentChild {
  const [key, expansion] = abbreviationParts(ctx.src, node)
  return { type: 'abbreviation_def', expansion, key, namespace: 'abbr' }
}

/** C2-B-084: the label and the expansion of an abbreviation definition. */
function abbreviationParts(src: string, node: BlockNode): [string, string] {
  const [start, end] = definitionLabel(src, node.start)
  return [src.slice(start, end), src.slice(end + 2, node.spans![1]).trim()]
}

function linkDefinitionNode(ctx: TreeContext, node: BlockNode): LinkReferenceDefinitionNode {
  const [start, end] = definitionLabel(ctx.src, node.start)
  return linkDefinitionFields(ctx.src, end + 2, node.spans![1]!, foldLabel(ctx.src.slice(start, end)))
}

const MAX_START_DIGITS = 9

/**
 * C2-B-045: the start value that the `start` key of an attribute line gives a list of `style`, or
 * -1 when its value is none: an unsigned decimal integer, at least 1 on letters and roman numerals.
 */
function startValue(value: string, style: string): number {
  if (value === '' || value.length > MAX_START_DIGITS) return -1
  for (let at = 0; at < value.length; at++) if (value.charCodeAt(at) < DIGIT_0 || value.charCodeAt(at) > DIGIT_9) return -1
  const start = Number(value)
  return start === 0 && style !== '1' ? -1 : start
}

function orderedMarker(node: BlockNode, attributes: Attributes | null): Marker {
  const flags = node.flags
  let style = (flags & FLAG_ROMAN) !== 0 ? 'i' : (flags & FLAG_ALPHA) !== 0 ? 'a' : '1'
  if ((flags & FLAG_UPPER) !== 0) style = style.toUpperCase()
  const marker: Marker = { kind: 'ordered', style, delimiter: (flags & FLAG_PAREN) !== 0 ? ')' : '.' }
  let start = (flags & FLAG_AUTO) === 0 ? node.aux : 1
  // C2-B-045: the attribute decides over the number of the first marker, and is then no key of the list.
  const authored = attributes?.keyValues.find((pair) => pair[0] === 'start')
  const fromKey = authored === undefined ? -1 : startValue(authored[1], style.toLowerCase())
  if (fromKey >= 0) {
    start = fromKey
    takeKey(attributes, 'start')
  }
  // C2-A-058: a start of 1 is omitted, and the bare dot starts at 1.
  if (start !== 1) marker.start = start
  return marker
}

function listNode(ctx: TreeContext, node: BlockNode, flow: number, attributes: Attributes | null): ListNode {
  const bullet: Marker = { kind: 'bullet', char: (node.flags & FLAG_STAR) !== 0 ? '*' : '-' }
  return {
    type: 'list', marker: node.kind === BULLET_LIST ? bullet : orderedMarker(node, attributes),
    spacing: (node.exitFlags & FLAG_TIGHT) !== 0 ? 'tight' : 'loose', children: itemChildren(ctx, node.children!, flow),
  }
}

/** C2-B-101: the brace blocks that abut the marker of an item. */
function markerAttributes(ctx: TreeContext, node: BlockNode): Attributes | null {
  if ((node.flags & FLAG_MARKER_ATTRIBUTES) === 0) return null
  const src = ctx.src
  const end = lineFeedAt(src, node.start)
  const code = src.charCodeAt(node.start)
  const after = code === STAR || src[node.start] === '-' ? node.start + 1 : orderedDelimiter(src, node.start, end) + 1
  const attributes = emptyAttributes()
  readGluedBlocks(src, after, end, attributes)
  return attributes
}

function itemNode(ctx: TreeContext, node: BlockNode, flow: number): ListItemNode {
  const out: ListItemNode = { type: 'list_item', children: blockChildren(ctx, node.children!, flow) }
  if (node.aux !== 0) {
    const mark = String.fromCharCode(node.aux)
    out.task = { mark, status: TASK_STATUS.get(mark)! }
  }
  setAttributes(out, markerAttributes(ctx, node))
  return out
}

function footnoteNode(ctx: TreeContext, node: BlockNode, flow: number): DocumentChild {
  const [start, end] = definitionLabel(ctx.src, node.start)
  const key = foldLabel(ctx.src.slice(start, end))
  return { type: 'footnote', key, namespace: 'footnote', children: blockChildren(ctx, node.children!, flow) }
}

/** The title and the group label of a div opener (C2-B-120, C2-B-121), each only where it is written. */
interface DivHead {
  title?: Inline[]
  groupLabel?: string
}

function divHead(ctx: TreeContext, info: OpenerInfo): DivHead {
  const head: DivHead = {}
  if (info.titleStart >= 0) head.title = captionChildren(ctx, info.titleStart, info.titleEnd)
  if (info.labelStart >= 0) head.groupLabel = ctx.src.slice(info.labelStart, info.labelEnd)
  return head
}

/** C2-A-066: the node of a named div: an admonition, a directive, or a plain div whose name is its first class. */
function namedDiv(ctx: TreeContext, node: BlockNode, flow: number, attributes: Attributes): Block {
  const src = ctx.src
  const info = readOpenerInfo(src, node.start + node.aux)
  const name = info.wordStart < 0 ? '' : src.slice(info.wordStart, info.wordEnd)
  const kind = name === 'figure' ? undefined : DIV_KINDS.get(name)
  // C2-B-128: the name of a plain div is its first class.
  if (kind === undefined && name !== '') attributes.classes.unshift(name)
  const head = divHead(ctx, info)
  if (kind === 'admonition' && isFieldValue('admonition.kind', name)) {
    return { type: 'admonition', kind: name, ...head, children: blockChildren(ctx, node.children!, flow) }
  }
  if (kind === 'directive' && isFieldValue('directive.kind', name)) {
    return { type: 'directive', kind: name, ...head, children: blockChildren(ctx, node.children!, flow) }
  }
  // C2-A-068: in a hard-break block, written with the opener or with the class, every line end is a hard break.
  const inner = attributes.classes.includes(HARD_BREAKS_CLASS) ? FLOW_HARD_BREAKS : flow
  return { type: 'div', ...head, children: blockChildren(ctx, node.children!, inner) }
}

/** C2-A-066: the node a div opener gives. */
function divNode(ctx: TreeContext, node: BlockNode, flow: number, taken: Attributes | null): Block {
  const attributes = taken ?? emptyAttributes()
  let out: Block
  if ((node.flags & FLAG_QUOTE_FENCE) !== 0) {
    out = { type: 'block_quote', children: blockChildren(ctx, node.children!, flow) }
  } else if ((node.flags & FLAG_FIGURE) !== 0) {
    out = { type: 'figure_group', children: blockChildren(ctx, node.children!, flow) }
  } else if ((node.flags & FLAG_HARD_BREAKS) !== 0) {
    // C2-A-068: the opener form adds the class after the classes the author wrote.
    attributes.classes.push(HARD_BREAKS_CLASS)
    out = { type: 'div', children: blockChildren(ctx, node.children!, FLOW_HARD_BREAKS) }
  } else {
    out = namedDiv(ctx, node, flow, attributes)
  }
  setAttributes(out, attributes)
  return out
}

function headingNode(ctx: TreeContext, node: BlockNode, flow: number): HeadingNode {
  const out: HeadingNode = noteLeaf(ctx, { type: 'heading', level: node.aux, children: leafChildren(ctx, node, flow) })
  // C2-I-084: a reference finds a heading by the folded source of its text, which is read when one looks.
  ctx.headingSpans.set(out, node.spans!)
  return out
}

const BUILDERS = new Map<number, BlockBuilder<Block>>([
  [QUOTE, (ctx, node, flow) => ({ type: 'block_quote', children: blockChildren(ctx, node.children!, flow) })],
  [BULLET_LIST, listNode],
  [ORDERED_LIST, listNode],
  [DESCRIPTION_LIST, (ctx, node, flow) => ({ type: 'definition_list', children: descriptionChildren(ctx, node.children!, flow) })],
  [DIV, divNode],
  [TABLE, (ctx, node) => tableNode(ctx, node, commentNode)],
  [PARAGRAPH, paragraphNode],
  [CODE, codeNode],
  [COMMENT_BLOCK, commentBlockNode],
  [LINE_BLOCK, lineBlockNode],
  [HEADING, headingNode],
  [THEMATIC_BREAK, () => ({ type: 'thematic_break' })],
  [COMMENT, commentNode],
  [INCLUDE, (ctx, node) => includeNode(ctx.src, node.spans![0]!, node.spans![1]!)],
])

// C2-A-052: the block pass opens definitions and the frontmatter at the top level only (C2-B-086, C2-B-164).
const DOCUMENT_BUILDERS = new Map<number, BlockBuilder<DocumentChild>>([
  ...BUILDERS,
  [FOOTNOTE, footnoteNode],
  [FRONTMATTER, frontmatterNode],
  [LINK_DEFINITION, linkDefinitionNode],
  [ABBREVIATION, abbreviationNode],
])

const DESCRIPTION_BUILDERS = new Map<number, BlockBuilder<DescriptionChild>>([
  [TERM, (ctx, node, flow) => noteLeaf(ctx, { type: 'definition_term', children: leafChildren(ctx, node, flow) })],
  [DESCRIPTION, (ctx, node, flow) => ({ type: 'definition_description', children: blockChildren(ctx, node.children!, flow) })],
  [COMMENT, commentNode],
])

/** The kinds that read their attribute lines themselves, because some of the keys are not attributes of the node. */
function readsOwnAttributes(node: BlockNode): boolean {
  return node.kind === TABLE || node.kind === DIV || (node.kind === CODE && (node.flags & FLAG_DELIMITED) !== 0)
}

/** Builds the node of `node` with `build`. C2-I-118: the depth of a content counts the containers around it. */
function buildBlock<N extends Node>(
  ctx: TreeContext, node: BlockNode, flow: number, attributes: Attributes | null, build: BlockBuilder<N>,
): N {
  const container = node.kind > DOCUMENT && node.kind <= DIV
  if (container) ctx.depth++
  const out = build(ctx, node, flow, attributes)
  if (container) ctx.depth--
  return out
}

/** Places the block `out`, built from `node`, unless its builder placed it already. */
function placeBlock<N extends Node>(ctx: TreeContext, out: N, node: BlockNode): N {
  if (out.pos !== undefined) return out
  // C2-A-182: an include directive ends at its closing braces, before the spaces behind them.
  const end = node.kind === INCLUDE ? trimEnd(ctx.src, node.start, node.end) : node.end
  // C2-A-148: a block that took attribute lines starts at the first of them.
  const first = node.attributes?.[0]
  if (first === undefined || !ctx.positions) return place(ctx, out, node.start, end)
  ctx.markup.set(out, node.start)
  return place(ctx, out, first, end)
}

function blockNode<N extends Node>(ctx: TreeContext, node: BlockNode, flow: number, build: BlockBuilder<N>): N {
  const own = readsOwnAttributes(node)
  const attributes = own && node.kind !== DIV ? null : readAttributeLines(ctx.src, node.attributes)
  const out = buildBlock(ctx, node, flow, attributes, build)
  if (!own) setAttributes(out, attributes)
  if (ctx.trace !== null) ctx.trace.blocks.set(out, node)
  return placeBlock(ctx, out, node)
}

/** C2-A-081: a caption holds one paragraph; the first bare `#` of its text is the number mark (C2-B-150). */
function captionNode(ctx: TreeContext, node: BlockNode, flow: number): CaptionNode {
  // The mark is found in the source of the text, so the text is placed also where no position is asked for.
  const placed = ctx.positions ? ctx : { ...ctx, positions: true }
  const paragraph: ParagraphNode = noteLeaf(placed, { type: 'paragraph', children: leafChildren(placed, node, flow) })
  markCaptionNumber(ctx, paragraph.children)
  if (!ctx.positions) dropPositions(paragraph.children)
  place(ctx, paragraph, node.spans![0]!, node.end)
  const out: CaptionNode = { type: 'caption', children: [paragraph] }
  if (ctx.trace !== null) ctx.trace.blocks.set(out, node)
  return place(ctx, out, node.start, node.end)
}

function dropPositions(nodes: readonly Node[]): void {
  for (const node of nodes) {
    delete node.pos
    if ('children' in node) dropPositions(node.children)
  }
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
    if (index + 1 === value.length || !isAsciiNameCharacter(value.charCodeAt(index + 1))) return index
  }
  return -1
}

/** Splits the first top-level text node that holds the mark around a `caption_number` node. */
function markCaptionNumber(ctx: TreeContext, children: Inline[]): void {
  for (let at = 0; at < children.length; at++) {
    const child = children[at]!
    if (child.type !== 'text') continue
    const value = child.value
    const start = child.pos?.startOffset ?? -1
    // A text node with no position was merged from pieces, and its source is not at hand: it holds no mark.
    const index = start < 0 ? -1 : numberMarkIndex(ctx.src, start, value)
    if (index < 0) continue
    const parts: Inline[] = []
    if (index > 0) addText(ctx, parts, value.slice(0, index), -1, -1)
    parts.push({ type: 'caption_number' })
    if (index + 1 < value.length) addText(ctx, parts, value.slice(index + 1), -1, -1)
    children.splice(at, 1, ...parts)
    return
  }
}

/** C2-A-082, C2-A-183: attaches a caption to the block above it, through the comments between them. */
/** A table or a figure group takes the caption itself, with the comments before it as its last children. */
function captionHost(target: TableNode | FigureGroupNode, comments: CommentNode[], caption: CaptionNode): void {
  for (const comment of comments) target.children.push(comment)
  target.caption = caption
  if (target.pos !== undefined && caption.pos !== undefined) target.pos.endOffset = caption.pos.endOffset
}

const DOCUMENT_ONLY = ['footnote', 'link_reference_definition', 'abbreviation_def', 'citation_definition', 'frontmatter']

function isBlock(node: DocumentChild): node is Block {
  return !DOCUMENT_ONLY.includes(node.type)
}

/** `list` holds blocks, and at the top level also definitions, to which no caption attaches (C2-B-147). */
function attachCaption(ctx: TreeContext, list: DocumentChild[], caption: CaptionNode): void {
  let at = list.length - 1
  while (at >= 0 && list[at]!.type === 'comment') at--
  const target = list[at]
  if (target === undefined || !isBlock(target)) return
  const comments: CommentNode[] = []
  for (const node of list.splice(at + 1)) if (node.type === 'comment') comments.push(node)
  if (target.type === 'table' || target.type === 'figure_group') return captionHost(target, comments, caption)
  list[at] = figureOf(ctx, target, comments, caption)
}

/** The figure that holds `target`, the comments behind it and the caption. */
function figureOf(ctx: TreeContext, target: Block, comments: CommentNode[], caption: CaptionNode): FigureNode {
  const figure: FigureNode = { type: 'figure', children: [target, ...comments], caption }
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
  return figure
}

/** The nodes of `nodes`, each made by its builder in `builders`, with each caption attached to the block above it. */
function buildChildren<N extends DocumentChild>(
  ctx: TreeContext, nodes: BlockNode[], flow: number, builders: ReadonlyMap<number, BlockBuilder<N>>,
): N[] {
  const list: N[] = []
  for (const node of nodes) {
    if (node.kind === CAPTION) attachCaption(ctx, list, captionNode(ctx, node, flow))
    else list.push(blockNode(ctx, node, flow, builders.get(node.kind)!))
  }
  return list
}

function blockChildren(ctx: TreeContext, nodes: BlockNode[], flow: number): Block[] {
  return buildChildren(ctx, nodes, flow, BUILDERS)
}

function itemChildren(ctx: TreeContext, nodes: BlockNode[], flow: number): ListItemNode[] {
  return nodes.map((node) => blockNode(ctx, node, flow, itemNode))
}

function descriptionChildren(ctx: TreeContext, nodes: BlockNode[], flow: number): DescriptionChild[] {
  return nodes.map((node) => blockNode(ctx, node, flow, DESCRIPTION_BUILDERS.get(node.kind)!))
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

/** What a parse knows of the tree it built, which resolution reads beside the tree. */
export interface ParseFacts {
  /** C2-I-084: the folded source of the text of a heading of the tree, or undefined for a node that is none. */
  headingSource: (heading: Node) => string | undefined
  /** The leaves with inline content that holds an id, a reference, a note or a cross-reference. */
  resolvableLeaves: ReadonlySet<Node>
  /** C2-H-172: whether the inline content of the source holds a bidirectional control. */
  bidi: boolean
}

/** The output of the parse stage: the tree before resolution (C2-A-106) and what the parse knows of it. */
export interface ParsedTree {
  readonly document: DocumentNode
  /** Null for a supplied tree, of which nothing is known. */
  readonly facts: ParseFacts | null
}

function headingSource(src: string, spans: number[] | undefined): string | undefined {
  if (spans === undefined) return undefined
  const lines: string[] = []
  for (let at = 0; at < spans.length; at += 2) lines.push(src.slice(spans[at], spans[at + 1]))
  return foldLabel(lines.join('\n'))
}

/** `source` is the source as given, of which offsets count the bytes; `ctx.src` is the text that was read. */
function buildDocument(ctx: TreeContext, root: BlockNode, source: string): ParsedTree {
  const src = ctx.src
  const children = buildChildren(ctx, root.children!, FLOW_PLAIN, DOCUMENT_BUILDERS)
  const document: DocumentNode = { type: 'document', astVersion: AST_VERSION, children }
  if (ctx.positions) {
    document.srcByteLength = utf8Length(source)
    finishPositions(document, source)
  }
  const facts: ParseFacts = {
    headingSource: (heading) => headingSource(src, ctx.headingSpans.get(heading)), resolvableLeaves: ctx.resolvableLeaves,
    bidi: ctx.inline.bidi,
  }
  return { document, facts }
}

/**
 * The public tree of `src` before resolution, built from the events of the block pass and of the
 * inline pass of each content. `abbreviations` replaces the terms the source defines, for a source
 * that is one block of a larger document (C2-W-089). `trace` takes what the source-layout record reads (C2-L-001).
 */
export function buildSource(
  src: string, positions: boolean, abbreviations: Map<string, string> | null = null, trace: LayoutTrace | null = null,
): ParsedTree {
  // C2-B-218: U+0000 is read as U+FFFD. Both are one UTF-16 unit, so every string offset stays.
  const text = src.includes('\0') ? src.replaceAll('\0', '\uFFFD') : src
  const blocks = acquireState()
  const inline = acquireInlineState()
  inline.bidi = false
  try {
    scanBlocks(blocks, text)
    const root = buildTree(blocks.events, blocks.eventLength)
    const ctx: TreeContext = {
      src: text, positions, inline, depth: 0, abbreviations: abbreviations ?? collectAbbreviations(text, root), markup: new Map(),
      headingSpans: new Map(), resolvable: false, resolvableLeaves: new Set(), trace,
    }
    return buildDocument(ctx, root, src)
  } finally {
    releaseInlineState(inline)
    releaseState(blocks)
  }
}
