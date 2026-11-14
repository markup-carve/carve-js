// The profiles of C2-H-129 and C2-H-163: a node outside the profile is replaced by its degraded
// form (C2-H-165) before the tree is resolved, so that a reference or a caption that is gone takes no number.
import {
  type Block, type BlockQuoteNode, captionOf, DEFINITION_TYPES, type DocumentNode, handle, type HeadingNode, type Inline,
  isBlockParent, isInlineParent, type ListItemNode, type Node, type NodeHandlers, type ParagraphNode, type TableCellNode,
  type TableNode, type TableRowNode, type TextNode, titleOf,
} from './ast.ts'
import { plainText } from './ast-text.ts'
import { addFinding, type Findings } from './diagnostics.ts'
import { includeSource } from './include.ts'
import { type ProfileRule } from './render-tables.ts'

interface Filter {
  name: string
  rule: ProfileRule
  findings: Findings
}

// A node of these types renders nothing, so it has no degraded form and stays as it is.
const UNWRITTEN = ['comment', 'frontmatter', ...DEFINITION_TYPES]

// The inline nodes whose degraded text is not their plain text.
const SPELLED_TEXT: NodeHandlers<string> = {
  image: (node) => `[img: ${node.alt ?? ''}]`,
  footnote_ref: (node) => `[^${node.key}]`,
  comment: () => '',
  symbol: (node) => `:${node.name}:`,
  xref: (node) => `</#${node.key}>`,
  raw_inline: (node) => node.value,
  inline_footnote: (node) => inlinesText(node.children),
}

/** The text a degraded inline node leaves: its plain text, or the spelling of a node that has none. */
function inlineText(node: Inline): string {
  const spelled = handle(SPELLED_TEXT, node.type, node, undefined)
  if (spelled !== undefined) return spelled
  return isInlineParent(node) ? inlinesText(node.children) : plainText([node])
}

function inlinesText(nodes: readonly Inline[]): string {
  let out = ''
  for (const node of nodes) out += inlineText(node)
  return out
}

function joined(nodes: readonly Node[], prefix: string): string {
  const parts: string[] = []
  for (const node of nodes) {
    const text = UNWRITTEN.includes(node.type) ? '' : blockText(node)
    if (text !== '') parts.push(prefix + text)
  }
  return parts.join(' ')
}

function withoutLineEnd(value: string): string {
  return value.endsWith('\n') ? value.slice(0, -1) : value
}

/** The text of the title and of the blocks of a container, joined by spaces. */
function containerText(node: Node): string {
  const title = titleOf(node)
  const caption = captionOf(node)
  const rest = ['children' in node ? joined(node.children, '') : '', caption === undefined ? '' : blockText(caption)]
  return [title === undefined ? '' : inlinesText(title), ...rest].filter((part) => part !== '').join(' ')
}

/** A quote whose blocks leave no text leaves none either. */
function quoteText(node: BlockQuoteNode): string {
  const text = joined(node.children, '')
  return text === '' ? '' : `> ${text}`
}

function headingText(node: HeadingNode): string {
  return `${'#'.repeat(node.level)} ${inlinesText(node.children)}`
}

function rowText(node: TableRowNode): string {
  return node.children.filter((cell) => cell.span === undefined).map(blockText).join(' | ')
}

// C2-H-165: the blocks whose degraded text is not that of their content alone: the mark of the kind stands in it.
const MARKED_TEXT: NodeHandlers<string> = {
  heading: headingText,
  block_quote: quoteText,
  list: (node) => joined(node.children, '- '),
  thematic_break: () => '---',
  code_block: (node) => withoutLineEnd(node.value),
  raw_block: (node) => withoutLineEnd(node.value),
  table_row: rowText,
  include: includeSource,
  div: containerText,
}

/** The text a degraded block leaves. */
function blockText(node: Node): string {
  const marked = handle(MARKED_TEXT, node.type, node, undefined)
  if (marked !== undefined) return marked
  return isInlineParent(node) ? inlinesText(node.children) : containerText(node)
}

function textParagraph(text: string): ParagraphNode[] {
  return text === '' ? [] : [{ type: 'paragraph', children: [{ type: 'text', value: text }] }]
}

/** A table keeps one line per row, with a hard break between the rows. */
function tableParagraph(node: TableNode): ParagraphNode[] {
  const out: Inline[] = []
  for (const group of node.children) {
    if (group.type === 'comment') continue
    for (const row of group.children) {
      if (row.type !== 'table_row') continue
      if (out.length > 0) out.push({ type: 'hard_break' })
      out.push({ type: 'text', value: rowText(row) })
    }
  }
  return out.length === 0 ? [] : [{ type: 'paragraph', children: out }]
}

/**
 * C2-H-165: the blocks a degraded block becomes. A block with a mark of its kind and a leaf block give one
 * paragraph of their text; any other block that holds blocks gives those blocks in their degraded forms, in order.
 */
function degradedBlocks(node: Node): ParagraphNode[] {
  if (node.type === 'table') return tableParagraph(node)
  if (node.type in MARKED_TEXT || isInlineParent(node) || !('children' in node)) return textParagraph(blockText(node))
  const out: ParagraphNode[] = []
  for (const child of node.children) if (!UNWRITTEN.includes(child.type)) out.push(...degradedBlocks(child))
  const caption = captionOf(node)
  if (caption !== undefined) out.push(...degradedBlocks(caption))
  return out
}

function degradedInline(node: Inline): TextNode[] {
  const text = inlineText(node)
  return text === '' ? [] : [{ type: 'text', value: text }]
}

/** An item stays an item, as its list expects. */
function degradedItem(node: ListItemNode): ListItemNode[] {
  const children: Block[] = []
  for (const child of node.children) if (!UNWRITTEN.includes(child.type)) children.push(...degradedBlocks(child))
  return children.length === 0 ? [] : [{ type: 'list_item', children }]
}

/** C2-H-163: the deny list of the axis, then its allow list, then the nesting bound. */
function isOutside(filter: Filter, node: Node, block: boolean, depth: number): boolean {
  const rule = filter.rule
  const denied = block ? rule.deniedBlock : rule.deniedInline
  if (denied?.includes(node.type) === true) return true
  const allowed = block ? rule.allowedBlock : rule.allowedInline
  if (allowed !== null && !allowed.includes(node.type)) return true
  return rule.maxNesting >= 0 && depth > rule.maxNesting
}

/**
 * Filters one list in place. Its nodes stand `depth` levels below the children of the document.
 * `degrade` gives the nodes that replace one outside the profile; `block` names the axis of the list.
 */
function filterList<N extends Node>(filter: Filter, list: N[], block: boolean, depth: number, degrade: (node: N) => N[]): void {
  const kept: N[] = []
  let changed = false
  for (const node of list) {
    if (UNWRITTEN.includes(node.type)) {
      // Kept as it is: a definition still resolves the references to it. The body of a note is
      // filtered where the profile has notes; elsewhere no reference is left to write it.
      if (node.type === 'footnote' && !isOutside(filter, node, block, depth)) filterNode(filter, node, depth + 1)
    } else if (isOutside(filter, node, block, depth)) {
      // C2-H-165: one report for the degraded node; the nodes inside it are not reported again.
      const out = degrade(node)
      const message = `Degraded a construct the profile "${filter.name}" does not allow: ${node.type}`
      const entry = { code: 'profile-construct-degraded', severity: 'warning', channel: 'render-loss', message } as const
      addFinding(filter.findings, out[0] ?? null, entry)
      for (const part of out) kept.push(part)
      changed = true
      continue
    } else {
      filterNode(filter, node, depth + 1)
    }
    kept.push(node)
  }
  if (!changed) return
  list.length = 0
  for (const node of kept) list.push(node)
}

/** A member keeps its place: every profile allows the members of the constructs it allows. */
function keep<N extends Node>(node: N): N[] {
  return [node]
}

/** C2-H-129: filters the children of `node`, whose nodes stand at `depth`, by the kind of list they make. */
function filterChildren(filter: Filter, node: Node, depth: number): void {
  if (isInlineParent(node)) filterList<Inline>(filter, node.children, false, depth, degradedInline)
  else if (node.type === 'list') filterList(filter, node.children, true, depth, degradedItem)
  else if (node.type === 'document') filterList<DocumentNode['children'][number]>(filter, node.children, true, depth, degradedBlocks)
  else if (isBlockParent(node)) filterList<Block>(filter, node.children, true, depth, degradedBlocks)
  else if (node.type === 'table_cell') filterList<TableCellNode['children'][number]>(filter, node.children, true, depth, degradedBlocks)
  else if ('children' in node) filterList<Node>(filter, node.children, true, depth, keep)
}

/** Filters the lists of `node`, whose nodes stand at `depth`: its children, its inline slots, its caption and its ruby pairs. */
function filterNode(filter: Filter, node: Node, depth: number): void {
  filterChildren(filter, node, depth)
  const title = titleOf(node)
  if (title !== undefined) filterList<Inline>(filter, title, false, depth, degradedInline)
  if (node.type === 'caption' && node.short !== undefined) filterList<Inline>(filter, node.short, false, depth, degradedInline)
  if (node.type === 'citation') {
    for (const slot of [node.prefix, node.locator, node.suffix]) {
      if (slot !== undefined) filterList<Inline>(filter, slot, false, depth, degradedInline)
    }
  }
  const caption = captionOf(node)
  if (caption !== undefined) filterNode(filter, caption, depth + 1)
  if (node.type !== 'ruby') return
  for (const pair of node.pairs) {
    filterList<Inline>(filter, pair.base, false, depth, degradedInline)
    filterList<Inline>(filter, pair.annotation, false, depth, degradedInline)
  }
}

/**
 * C2-H-129: replaces every node of `document` that is outside the profile by its degraded form,
 * in place, and reports each one. The children of the document stand at depth 0, as in 0.1.
 */
export function applyProfile(document: DocumentNode, name: string, rule: ProfileRule, findings: Findings): void {
  filterNode({ name, rule, findings }, document, 0)
}
