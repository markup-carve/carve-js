// The block nodes of the public tree (spec/0.2/ast.md), from the block tree and its inline content.
import {
  AST_VERSION, type Block, type BlockQuoteNode, type CaptionNode, type CodeBlockNode, type CommentNode, type DefinitionListNode,
  type DocumentNode, type FigureGroupNode, type FrontmatterNode, type HeadingNode, type IncludeNode, type Inline,
  isFieldValue, type LineBlockNode, type LineNode, type LinkReferenceDefinitionNode, type ListItemNode, type ListNode, type Marker,
  type Node, type ParagraphNode, type TableNode,
} from './ast.ts'
import { applyAbbreviations } from './ast-abbreviations.ts'
import { type Attributes, emptyAttributes, foldLabel, readAttributeLines, readGluedBlocks, takeKey } from './ast-attributes.ts'
import {
  addText, commentValue, contentNodes, FLOW_HARD_BREAKS, FLOW_PLAIN, type LayoutTrace, leafInlines, lineInlines, noteLeaf, place,
  setAttributes, type TreeContext,
} from './ast-inline.ts'
import { includeNode, linkDefinitionFields, openerTitle } from './ast-lines.ts'
import { delimitedTableNode, tableNode } from './ast-table.ts'
import { BRACE_OPEN, DIGIT_0, DIGIT_9, LF, PERCENT, SPACE, STAR } from './chars.ts'
import { scanBlocks } from './blocks.ts'
import { acquireInlineState, releaseInlineState } from './inline-state.ts'
import {
  ABBREVIATION, BULLET_LIST, CAPTION, CODE, COMMENT, COMMENT_BLOCK, DESCRIPTION, DESCRIPTION_LIST, DIV, FLAG_ALPHA,
  FLAG_AUTO, FLAG_BLOCK_MATH, FLAG_DELIMITED, FLAG_FIGURE, FLAG_HARD_BREAKS, FLAG_IMAGE, FLAG_MARKER_ATTRIBUTES,
  FLAG_PAREN, FLAG_QUOTE_FENCE, FLAG_RAW, FLAG_ROMAN, FLAG_STAR, FLAG_TIGHT, FLAG_UNCLOSED, FLAG_UPPER, FOOTNOTE, FRONTMATTER,
  HEADING, INCLUDE, isOpaqueLeaf, LINE_BLOCK, LINK_DEFINITION, ORDERED_LIST, PARAGRAPH, QUOTE, TABLE, TERM, THEMATIC_BREAK,
} from './kinds.ts'
import { attributeBlocksEnd, fenceRunLength, isBareRun, orderedDelimiter, skipSpaces, trimEnd } from './lines.ts'
import { lineFeedAt } from './source.ts'
import { definitionLabel, type OpenerInfo, readOpenerInfo } from './opener.ts'
import { addParseFindings, ATTRIBUTE_FALLBACK, TITLE_SYNTAX, UNCLOSED } from './parse-findings.ts'
import { finishPositions, utf8Length } from './positions.ts'
import { DERIVED_TEXT_BYTES, DERIVED_TEXT_FACTOR } from './derived-text.ts'
import { type Findings } from './diagnostics.ts'
import { acquireState, releaseState } from './state.ts'
import { type BlockNode, buildTree } from './tree.ts'
import { DIV_KINDS, HARD_BREAKS_CLASS } from './tree-tables.ts'
import { isAsciiNameCharacter, withoutUnpairedSurrogates } from './unicode.ts'

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
  if (spans.length === 0) return ''
  // A body at column 0 with bare line feeds is one piece of the source, which is the usual case.
  if (isContiguous(src, spans)) return `${src.slice(spans[0], spans[spans.length - 1])}\n`
  const lines: string[] = []
  for (let at = 0; at < spans.length; at += 2) lines.push(src.slice(spans[at], spans[at + 1]))
  return `${lines.join('\n')}\n`
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
  if ((node.exitFlags & FLAG_IMAGE) !== 0 && holdsOnly(children, (child) => child.type === 'image')) out.role = 'image'
  if ((node.exitFlags & FLAG_BLOCK_MATH) !== 0 && holdsOnly(children, (child) => child.type === 'math' && child.display)) {
    out.role = 'math'
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
  // C2-B-164: the name is glued or stands after one space, and ends at the next space, tab or line end; the opener test made it a word.
  const word = src.charCodeAt(node.start + 3) === SPACE ? node.start + 4 : node.start + 3
  let wordEnd = word
  while (wordEnd < src.length && src.charCodeAt(wordEnd) > SPACE) wordEnd++
  const format = wordEnd > word ? src.slice(word, wordEnd) : 'yaml'
  return { type: 'frontmatter', format, value: bodyValue(src, node.spans!) }
}

/**
 * C2-B-122: further words on the opener do not stop the block from opening. C2-B-105: an attribute block
 * behind a fence language or an admonition name is reported as such; C2-B-225: so is one glued to any name.
 */
function noteFurtherWords(ctx: TreeContext, node: BlockNode, out: Node, info: OpenerInfo): void {
  if (!info.extra) return
  const src = ctx.src
  const lineEnd = lineFeedAt(src, node.start)
  const at = info.extraStart
  const glued = info.wordStart >= 0 && at === info.wordEnd
  const attribute = glued && src.charCodeAt(at) === BRACE_OPEN && attributeBlocksEnd(src, at, lineEnd) > at
  ctx.notes.push({ what: attribute ? ATTRIBUTE_FALLBACK : TITLE_SYNTAX, node: out, block: node, from: at })
}

/**
 * C2-B-122: a raw fence and a sigil div take no title and no label, so each is further words; C2-B-225:
 * so is what is glued to the format, where a brace block is an attribute block. A sigil is no name.
 */
function noteRawWords(ctx: TreeContext, node: BlockNode, out: Node, info: OpenerInfo, named = true): void {
  const title = info.titleStart >= 0 ? info.titleStart - 1 : -1
  const label = info.labelStart >= 0 ? info.labelStart - 1 : -1
  const from = [info.extra ? info.extraStart : -1, title, label].filter((at) => at >= 0)
  if (from.length === 0) return
  const at = Math.min(...from)
  const lineEnd = lineFeedAt(ctx.src, node.start)
  const attribute = named && at === info.wordEnd && ctx.src.charCodeAt(at) === BRACE_OPEN && attributeBlocksEnd(ctx.src, at, lineEnd) > at
  ctx.notes.push({ what: attribute ? ATTRIBUTE_FALLBACK : TITLE_SYNTAX, node: out, block: node, from: at })
}

function codeNode(ctx: TreeContext, node: BlockNode): Block {
  const src = ctx.src
  if ((node.flags & FLAG_DELIMITED) !== 0) return delimitedTableNode(ctx, node)
  const info = readOpenerInfo(src, node.start + node.aux)
  const word = info.wordStart < 0 ? '' : src.slice(info.wordStart, info.wordEnd)
  const value = bodyValue(src, node.spans!)
  // C2-B-116: `=` and a format name make a raw block, which takes no title and no label (C2-B-122).
  if ((node.flags & FLAG_RAW) !== 0) {
    const raw: Block = { type: 'raw_block', format: word.slice(1), value }
    noteRawWords(ctx, node, raw, info)
    return raw
  }
  const out: CodeBlockNode = { type: 'code_block', value }
  noteFurtherWords(ctx, node, out, info)
  if (word !== '') out.syntax = word
  if (info.titleStart >= 0) {
    const value = openerTitle(src, info.titleStart, info.titleEnd)
    const title: Inline = { type: 'text', value }
    if (value === src.slice(info.titleStart, info.titleEnd)) place(ctx, title, info.titleStart, info.titleEnd)
    out.title = [title]
  }
  if (info.labelStart >= 0) out.groupLabel = src.slice(info.labelStart, info.labelEnd)
  if (word !== '') ctx.sourceNames?.set(out, word)
  return out
}

/** C2-A-069: one `line` per line of the body; an empty line ends a stanza. */
function lineBlockNode(ctx: TreeContext, node: BlockNode): LineBlockNode {
  const spans = node.spans!
  const lines: (LineNode | CommentNode)[] = []
  const lazyComments = node.lazyComments ?? []
  let lazyAt = 0
  for (let at = 0; at < spans.length; at += 2) {
    const previous = lines[lines.length - 1]
    const lazy = lazyComments[lazyAt] === at
    if (lazy) lazyAt++
    if (lazy && previous?.type === 'line') {
      // C2-B-024: a lazy comment-only line is an inline child at the end of the line above.
      const value = commentValue(ctx.src.slice(spans[at]! + 2, spans[at + 1]), false)
      previous.children.push(place(ctx, { type: 'comment', form: 'line', value } satisfies CommentNode, spans[at]!, spans[at + 1]!))
      if (previous.pos !== undefined) previous.pos.endOffset = spans[at + 1]!
      continue
    }
    const comment = lineBlockComment(ctx, spans, at)
    if (comment !== null) {
      lines.push(comment[0])
      at = comment[1]
      continue
    }
    const children = lineInlines(ctx, spans, at)
    if (ctx.abbreviations.size > 0) applyAbbreviations(ctx, children)
    const line: LineNode = noteLeaf(ctx, { type: 'line', children })
    // C2-A-158: a line with no children has no source character and omits `pos`.
    lines.push(children.length === 0 ? line : place(ctx, line, spans[at]!, spans[at + 1]!))
  }
  const out: LineBlockNode = { type: 'line_block', children: lines }
  noteSigilWords(ctx, node, out)
  return out
}

/**
 * C2-B-123, C2-B-108: a comment block in the body of a line block, which adds no line and ends no stanza: the node
 * and the index of its last span, or null where the span at `at` opens none. Unclosed, it runs to the body's end.
 */
function lineBlockComment(ctx: TreeContext, spans: readonly number[], at: number): [CommentNode, number] | null {
  const src = ctx.src
  const start = skipSpaces(src, spans[at]!, spans[at + 1]!)
  const length = fenceRunLength(src, start, spans[at + 1]!, PERCENT)
  if (length === 0) return null
  const lines: string[] = []
  const tail = skipSpaces(src, start + length, spans[at + 1]!)
  if (tail < spans[at + 1]!) lines.push(src.slice(tail, spans[at + 1]))
  let last = at + 2
  while (last < spans.length && !isBareRun(src, skipSpaces(src, spans[last]!, spans[last + 1]!), spans[last + 1]!, PERCENT, length)) {
    lines.push(src.slice(spans[last], spans[last + 1]))
    last += 2
  }
  const end = Math.min(last, spans.length - 2)
  const out = place(ctx, { type: 'comment', form: 'block', value: lines.join('\n') } satisfies CommentNode, start, spans[end + 1]!)
  return [out, end]
}

/** C2-B-122: what follows the sigil of a sigil div is further words and reported. */
function noteSigilWords(ctx: TreeContext, node: BlockNode, out: Node): void {
  noteRawWords(ctx, node, out, readOpenerInfo(ctx.src, node.start + node.aux), false)
}

function abbreviationNode(ctx: TreeContext, node: BlockNode): DocumentChild {
  const [key, expansion] = abbreviationParts(ctx.src, node)
  return { type: 'abbreviation_def', expansion, key, namespace: 'abbr' }
}

/**
 * C2-B-084: the label and the expansion of an abbreviation definition. Exactly one space follows the
 * colon; the expansion keeps a leading space or tab and drops the spaces and tabs that end the line.
 */
function abbreviationParts(src: string, node: BlockNode): [string, string] {
  const [start, end] = definitionLabel(src, node.start)
  const from = end + 3
  return [src.slice(start, end), src.slice(from, trimEnd(src, from, node.spans![1]!))]
}

function linkDefinitionNode(ctx: TreeContext, node: BlockNode, _flow: number, attributes: Attributes | null): LinkReferenceDefinitionNode {
  const [start, end] = definitionLabel(ctx.src, node.start)
  // The caller applies `attributes` after the build; a definition without attribute lines applies its own block here.
  const merged = attributes ?? emptyAttributes()
  const out = linkDefinitionFields(ctx.src, end + 2, node.spans![1]!, foldLabel(ctx.src.slice(start, end)), merged)
  if (attributes === null) setAttributes(out, merged)
  return out
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
    out.task = { mark }
  }
  setAttributes(out, markerAttributes(ctx, node))
  return out
}

function footnoteNode(ctx: TreeContext, node: BlockNode, flow: number): DocumentChild {
  const [start, end] = definitionLabel(ctx.src, node.start)
  const key = foldLabel(ctx.src.slice(start, end))
  const out: DocumentChild = { type: 'footnote', key, namespace: 'footnote', children: blockChildren(ctx, node.children!, flow) }
  ctx.footnoteBlocks.set(out, node)
  return out
}

/** The title and the group label of a div opener (C2-B-120, C2-B-121), each only where it is written. */
interface DivHead {
  title?: Inline[]
  groupLabel?: string
}

function divHead(ctx: TreeContext, info: OpenerInfo): DivHead {
  const head: DivHead = {}
  if (info.titleStart >= 0) {
    // C2-B-120: the title is an inline content of one line, in which `%%` after whitespace starts a line comment.
    const title = contentNodes(ctx, [info.titleStart, info.titleEnd], 0, 2, true, FLOW_PLAIN)
    // C2-I-098: the title of a div is inline flow.
    if (ctx.abbreviations.size > 0) applyAbbreviations(ctx, title)
    head.title = title
  }
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
  let out: Block
  if (kind === 'admonition' && isFieldValue('admonition.kind', name)) {
    out = { type: 'admonition', kind: name, ...head, children: blockChildren(ctx, node.children!, flow) }
  } else if (kind === 'directive' && isFieldValue('directive.kind', name)) {
    out = { type: 'directive', kind: name, ...head, children: blockChildren(ctx, node.children!, flow) }
  } else {
    // C2-A-068: in a hard-break block, written with the opener or with the class, every line end is a hard break.
    const inner = attributes.classes.includes(HARD_BREAKS_CLASS) ? FLOW_HARD_BREAKS : flow
    out = { type: 'div', ...head, children: blockChildren(ctx, node.children!, inner) }
  }
  noteFurtherWords(ctx, node, out, info)
  if (name !== '') ctx.sourceNames?.set(out, name)
  return out
}

/** C2-A-066: the node a div opener gives. */
function divNode(ctx: TreeContext, node: BlockNode, flow: number, taken: Attributes | null): Block {
  const attributes = taken ?? emptyAttributes()
  let out: Block
  if ((node.flags & FLAG_QUOTE_FENCE) !== 0) {
    out = { type: 'block_quote', children: blockChildren(ctx, node.children!, flow) }
    noteSigilWords(ctx, node, out)
  } else if ((node.flags & FLAG_FIGURE) !== 0) {
    out = { type: 'figure_group', children: blockChildren(ctx, node.children!, flow) }
    noteFurtherWords(ctx, node, out, readOpenerInfo(ctx.src, node.start + node.aux))
  } else if ((node.flags & FLAG_HARD_BREAKS) !== 0) {
    // C2-A-068: the opener form adds the class after the classes the author wrote.
    attributes.classes.push(HARD_BREAKS_CLASS)
    out = { type: 'div', children: blockChildren(ctx, node.children!, FLOW_HARD_BREAKS) }
    noteSigilWords(ctx, node, out)
  } else {
    out = namedDiv(ctx, node, flow, attributes)
  }
  setAttributes(out, attributes)
  return out
}

function includeBlock(ctx: TreeContext, node: BlockNode): IncludeNode {
  const out = includeNode(ctx.src, node.spans![0]!, node.spans![1]!)
  ctx.includes.push(out)
  return out
}

function headingNode(ctx: TreeContext, node: BlockNode, flow: number): HeadingNode {
  return noteLeaf(ctx, { type: 'heading', level: node.aux, children: leafChildren(ctx, node, flow) })
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
  [INCLUDE, includeBlock],
])

// C2-A-052: the block pass opens definitions and the frontmatter at the top level only (C2-B-081, C2-B-164).
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

/**
 * C2-A-154: a div with no closer ends after its last child that has a position, or after its opener line,
 * also where the closer of an outer div ended it.
 */
function unclosedEnd(src: string, out: Node, node: BlockNode): number {
  const children = 'children' in out && Array.isArray(out.children) ? out.children : []
  for (let at = children.length - 1; at >= 0; at--) {
    const pos = children[at]?.pos
    if (pos !== undefined) return pos.endOffset
  }
  const lineEnd = src.indexOf('\n', node.start)
  return lineEnd < 0 || lineEnd > node.end ? node.end : lineEnd
}

/** Places the block `out`, built from `node`, unless its builder placed it already. */
function placeBlock<N extends Node>(ctx: TreeContext, out: N, node: BlockNode): N {
  if (out.pos !== undefined) return out
  const end = node.kind === DIV && (node.exitFlags & FLAG_UNCLOSED) !== 0 ? unclosedEnd(ctx.src, out, node) : node.end
  // C2-A-148: a block that took attribute lines starts at the first of them.
  const first = node.attributes?.[0]
  if (first === undefined || !ctx.positions) return place(ctx, out, node.start, end)
  // Counted here, in string offsets: `pos` holds UTF-8 byte offsets once positions finish.
  ctx.markup.set(out, lineCount(ctx.src, first, node.start) - 1)
  return place(ctx, out, first, end)
}

function blockNode<N extends Node>(ctx: TreeContext, node: BlockNode, flow: number, build: BlockBuilder<N>): N {
  const own = readsOwnAttributes(node)
  const attributes = own && node.kind !== DIV ? null : readAttributeLines(ctx.src, node.attributes)
  const out = build(ctx, node, flow, attributes)
  if (!own) setAttributes(out, attributes)
  // C2-B-111, C2-B-163: a fence, a comment block, a div, a line block or frontmatter that ends without its closer.
  if ((node.exitFlags & FLAG_UNCLOSED) !== 0 && (node.kind === DIV || isOpaqueLeaf(node.kind))) {
    ctx.notes.push({ what: UNCLOSED, node: out, block: node, from: 0 })
  }
  if (ctx.trace !== null) ctx.trace.blocks.set(out, node)
  return placeBlock(ctx, out, node)
}

/** C2-A-081: a caption holds one paragraph; the first bare `#` of its text is the number mark (C2-B-207). */
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

/**
 * The source offset of the caption number mark in the value of a top-level text node that starts at
 * `start` in the source, or -1. `found` takes its index in the value.
 */
function numberMarkOffset(src: string, start: number, value: string, found: { at: number }): number {
  let at = start
  for (let index = 0; index < value.length; index++, at++) {
    // C2-A-041: an escaped character is part of the text, and `\#` is no mark.
    const escaped = src[at] === '\\' && src[at + 1] === value[index]
    if (escaped) at++
    if (escaped || value[index] !== '#') continue
    // A character that starts no tag name follows it, or nothing does.
    if (index + 1 === value.length || !isAsciiNameCharacter(value.charCodeAt(index + 1))) {
      found.at = index
      return at
    }
  }
  return -1
}

/**
 * Splits the first top-level text node that holds the mark around a `caption_number` node. The text
 * on either side is one slice of the source, so it keeps a position (C2-A-138); the number spans its mark (C2-A-158).
 */
function markCaptionNumber(ctx: TreeContext, children: Inline[]): void {
  for (let at = 0; at < children.length; at++) {
    const child = children[at]!
    if (child.type !== 'text') continue
    const value = child.value
    const pos = child.pos
    // A text node with no position was merged from pieces, and its source is not at hand: it holds no mark.
    const index = { at: -1 }
    const mark = pos === undefined ? -1 : numberMarkOffset(ctx.src, pos.startOffset, value, index)
    if (pos === undefined || mark < 0) continue
    const parts: Inline[] = []
    if (index.at > 0) addText(ctx, parts, value.slice(0, index.at), pos.startOffset, mark)
    parts.push(place(ctx, { type: 'caption_number' }, mark, mark + 1))
    if (index.at + 1 < value.length) addText(ctx, parts, value.slice(index.at + 1), mark + 1, pos.endOffset)
    children.splice(at, 1, ...parts)
    return
  }
}

/** C2-A-154: a block that carries a caption ends where its caption ends. */
function takeCaption(target: CaptionedBlock, caption: CaptionNode): void {
  target.caption = caption
  if (target.pos !== undefined && caption.pos !== undefined) target.pos.endOffset = caption.pos.endOffset
}

type CaptionedBlock = TableNode | FigureGroupNode | ParagraphNode | CodeBlockNode | BlockQuoteNode | IncludeNode

const DOCUMENT_ONLY = ['footnote', 'link_reference_definition', 'abbreviation_def', 'citation_definition', 'frontmatter']

function isBlock(node: DocumentChild): node is Block {
  return !DOCUMENT_ONLY.includes(node.type)
}

/**
 * C2-A-082, C2-A-183: the block above takes the caption in its own slot and keeps its attributes. A table or a figure
 * group takes the comments between it and the caption as its last children; behind a code block, which holds no
 * children, they stay its siblings after it, inside its span (C2-A-145). `list` holds blocks, and at the top level
 * also definitions, to which no caption attaches (C2-B-147).
 */
function attachCaption(list: DocumentChild[], caption: CaptionNode): void {
  let at = list.length - 1
  while (at >= 0 && list[at]!.type === 'comment') at--
  const target = list[at]
  if (target === undefined || !isBlock(target)) return
  if (target.type === 'table' || target.type === 'figure_group') {
    for (const node of list.splice(at + 1)) if (node.type === 'comment') target.children.push(node)
    takeCaption(target, caption)
  } else if (target.type === 'paragraph' || target.type === 'code_block' || target.type === 'block_quote') {
    takeCaption(target, caption)
  } else if (target.type === 'include' && target.options?.code !== undefined) {
    // C2-B-147, C2-N-073: a code include takes a caption, which its expansion gives to its child.
    takeCaption(target, caption)
  }
}

/** The nodes of `nodes`, each made by its builder in `builders`, with each caption attached to the block above it. */
function buildChildren<N extends DocumentChild>(
  ctx: TreeContext, nodes: BlockNode[], flow: number, builders: ReadonlyMap<number, BlockBuilder<N>>,
): N[] {
  const list: N[] = []
  for (const node of nodes) {
    if (node.kind === CAPTION) attachCaption(list, captionNode(ctx, node, flow))
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

/** C2-I-125: definition keys are block facts available to the inline pass, even when defined later. */
function collectLinkKeys(src: string, root: BlockNode): Set<string> | null {
  let keys: Set<string> | null = null
  for (const child of root.children!) {
    if (child.kind !== LINK_DEFINITION) continue
    const [start, end] = definitionLabel(src, child.start)
    keys ??= new Set()
    keys.add(foldLabel(src.slice(start, end)))
  }
  return keys
}

/** C2-N-054: the link keys of a file and of the files around it, which decide what forms a reference. */
function withOuterKeys(own: ReadonlySet<string> | null, outer: ReadonlySet<string> | null): ReadonlySet<string> | null {
  if (outer === null) return own
  if (own === null) return outer
  return new Set([...own, ...outer])
}

/** What a parse knows of the tree it built, which resolution reads beside the tree. */
export interface ParseFacts {
  sourceNames: ReadonlyMap<Node, string> | null
  /** The leaves with inline content that holds an id, a reference, a note or a cross-reference. */
  resolvableLeaves: ReadonlySet<Node>
  /** C2-H-172: whether the inline content of the source holds a bidirectional control. */
  bidi: boolean
  /** The findings of the parse channel that the tree builder noted, added to `findings` with their messages. */
  addFindings: (findings: Findings) => void
  /** C2-B-085: the number of source lines of a footnote definition of the tree, or 0 for a node that is none. */
  footnoteLines: (node: Node) => number
  /** C2-H-062: the line of the own markup of a block that took attribute lines, behind them (C2-A-148). */
  markupLine: (node: Node) => number | undefined
  /** The include nodes of the tree in tree order (C2-N-018). */
  includes: readonly IncludeNode[]
  /** C2-N-023, C2-N-054: the terms and the link keys the source was read with, which a file it includes reads too. */
  scope: OuterScope
}

/** C2-N-023, C2-N-054: what an included file reads of the files around it: their terms and their link keys. */
export interface OuterScope {
  abbreviations: ReadonlyMap<string, string>
  linkKeys: ReadonlySet<string> | null
}

/** The output of the parse stage: the tree before resolution (C2-A-106) and what the parse knows of it. */
export interface ParsedTree {
  readonly document: DocumentNode
  /** Null for a supplied tree, of which nothing is known. */
  readonly facts: ParseFacts | null
  /** C2-H-201: the source the tree was parsed from, or its byte length, which a parse without positions does not record. */
  readonly source?: string | number
}

/** The number of lines from `start` to `end`. */
function lineCount(src: string, start: number, end: number): number {
  let count = 1
  for (let p = src.indexOf('\n', start); p >= 0 && p < end; p = src.indexOf('\n', p + 1)) count++
  return count
}

/**
 * C2-I-084: `text` read as inline content of its own, in which no reference resolves, as the heading lookup reads a
 * stored key. An opener left unclosed is text (C2-I-119).
 */
export function inlineContent(text: string): Inline[] {
  const inline = acquireInlineState()
  inline.bidi = false
  inline.definitions = new Set()
  try {
    const ctx: TreeContext = {
      src: text, positions: false, inline, abbreviations: new Map(), abbreviationBytesLeft: 0,
      abbreviationCosts: new Map(), markup: new Map(), resolvable: false,
      resolvableLeaves: new Set(), trace: null, notes: [], footnoteBlocks: new Map(), sourceNames: null, includes: [],
    }
    return contentNodes(ctx, [0, text.length], 0, 2, true, FLOW_PLAIN)
  } finally {
    releaseInlineState(inline)
  }
}

/** `source` is the source as given, of which offsets count the bytes; `ctx.src` is the text that was read. */
function buildDocument(ctx: TreeContext, root: BlockNode, source: string, sourceByteLength: number): ParsedTree {
  const src = ctx.src
  const children = buildChildren(ctx, root.children!, FLOW_PLAIN, DOCUMENT_BUILDERS)
  const document: DocumentNode = { type: 'document', astVersion: AST_VERSION, children }
  document.srcByteLength = sourceByteLength
  if (ctx.positions) {
    finishPositions(document, source)
  }
  const facts: ParseFacts = {
    sourceNames: ctx.sourceNames,
    resolvableLeaves: ctx.resolvableLeaves,
    bidi: ctx.inline.bidi,
    addFindings: (findings) => addParseFindings(src, ctx.notes, findings),
    footnoteLines: (node) => {
      const block = ctx.footnoteBlocks.get(node)
      return block === undefined ? 0 : lineCount(src, block.start, block.end)
    },
    markupLine: (node) => {
      const lines = ctx.markup.get(node)
      const pos = node.pos
      return lines === undefined || pos === undefined ? undefined : pos.startLine + lines
    },
    includes: ctx.includes,
    scope: { abbreviations: ctx.abbreviations, linkKeys: ctx.inline.definitions },
  }
  return { document, facts }
}

/** C2-I-098: a byte input counts its own bytes, not those of its decoded text. */
function sourceBytes(src: string, byteLength: number | null | undefined): number {
  return byteLength ?? utf8Length(src)
}

/**
 * The public tree of `src` before resolution, built from the events of the block pass and of the
 * inline pass of each content. `abbreviations` replaces the terms the source defines, for a source
 * that is one block of a larger document (C2-W-089). `trace` takes what the source-layout record reads (C2-A-003).
 * `byteLength` is the length of a byte input the text was decoded from.
 */
export function buildSource(
  src: string, positions: boolean, abbreviations: Map<string, string> | null = null, trace: LayoutTrace | null = null,
  collectSourceNames = false, linkKeys: ReadonlySet<string> | null = null, outer: OuterScope | null = null,
  frontmatterOpens = true, byteLength?: number | null,
): ParsedTree {
  // C2-B-218: U+0000 and an unpaired surrogate are read as U+FFFD. All are one UTF-16 unit, so every string offset stays.
  const text = withoutUnpairedSurrogates(src.includes('\0') ? src.replaceAll('\0', '\uFFFD') : src)
  const sourceByteLength = sourceBytes(src, byteLength)
  const blocks = acquireState()
  blocks.frontmatterOpens = frontmatterOpens
  const inline = acquireInlineState()
  inline.bidi = false
  try {
    scanBlocks(blocks, text)
    const root = buildTree(blocks.events, blocks.eventLength, text, compactTrace(trace))
    const own = linkKeys ?? collectLinkKeys(text, root)
    inline.definitions = outer === null ? own : withOuterKeys(own, outer.linkKeys)
    const terms = abbreviations ?? collectAbbreviations(text, root)
    if (outer !== null) for (const [term, expansion] of outer.abbreviations) if (!terms.has(term)) terms.set(term, expansion)
    const ctx: TreeContext = {
      src: text, positions, inline, abbreviations: terms,
      abbreviationBytesLeft: Math.max(DERIVED_TEXT_BYTES, DERIVED_TEXT_FACTOR * sourceByteLength),
      abbreviationCosts: new Map(), markup: new Map(),
      resolvable: false, resolvableLeaves: new Set(), trace, notes: [], footnoteBlocks: new Map(),
      sourceNames: collectSourceNames ? new Map() : null, includes: [],
    }
    return buildDocument(ctx, root, src, sourceByteLength)
  } finally {
    releaseInlineState(inline)
    releaseState(blocks)
  }
}

function compactTrace(trace: LayoutTrace | null): boolean {
  return trace?.compactTables === true
}
