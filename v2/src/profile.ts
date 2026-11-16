// The profiles of C2-H-129 and C2-H-163: a node outside the profile is written in its degraded form
// (C2-H-165). The profile is a render option and changes no tree (C2-H-121): the render applies it to the
// resolved tree, writes it, and puts every list back, so resolution has seen the whole tree.
import {
  type Block, type BlockQuoteNode, type CaptionNode, captionOf, DEFINITION_TYPES, type DocumentNode, type ExtensionDeclaration,
  forEachSlot, type HeadingNode, type Inline,
  isBlockParent, isInlineParent, type ListItemNode, type Node, type NodeHandlers, type NodeOfType, type ParagraphNode, type TableCellNode,
  type TableNode, type TableRowNode, type TextNode, titleOf,
} from './ast.ts'
import { plainText } from './ast-text.ts'
import { NODE_TABLE } from './ast-validate.ts'
import { addFinding, type Findings } from './diagnostics.ts'
import { includeSource } from './include.ts'
import { type ProfileRule } from './render-tables.ts'
import { type Note, type Resolution } from './resolve.ts'

interface Filter {
  declarations: readonly ExtensionDeclaration[]
  name: string
  rule: ProfileRule
  findings: Findings
  /** Each list the filter changed, with what it held before. */
  undo: [Node[], Node[]][]
  /** The footnote references and inline footnotes inside degraded nodes: they write no reference. */
  gone: Set<Node>
  /** C2-H-177: the `#id` targets of the degraded headings, which write no id. */
  goneTargets: Set<string>
}

/** What a profile did to a tree for one render. */
export interface ProfileRun {
  /** The footnote references and inline footnotes that the degraded forms took out. */
  readonly gone: ReadonlySet<Node>
  /** C2-H-177: the targets of the headings that the profile degraded. */
  readonly goneTargets: ReadonlySet<string>
  /** Puts every list the profile changed back as it was. */
  restore(): void
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

function spelledText<T extends keyof NodeOfType>(type: T, node: NodeOfType[T]): string | undefined {
  return SPELLED_TEXT[type]?.(node, undefined)
}

/** The text a degraded inline node leaves: its plain text, or the spelling of a node that has none. */
function inlineText(node: Inline): string {
  const spelled = spelledText(node.type, node)
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
  include: (node) => includeSource(node),
  // A degraded admonition or directive keeps its title, as a div does.
  div: containerText,
  admonition: containerText,
  directive: containerText,
}

function markedText<T extends keyof NodeOfType>(type: T, node: NodeOfType[T]): string | undefined {
  return MARKED_TEXT[type]?.(node, undefined)
}

/** The text a degraded block leaves; a captioned block leaves the text of its caption behind its own (C2-H-165). */
function blockText(node: Node): string {
  const caption = captionedLeaf(node)
  if (caption === undefined) return ownText(node)
  return [ownText(node), blockText(caption)].filter((part) => part !== '').join(' ')
}

function ownText(node: Node): string {
  const marked = markedText(node.type, node)
  if (marked !== undefined) return marked
  return isInlineParent(node) ? inlinesText(node.children) : containerText(node)
}

/** C2-A-082: the caption of an image paragraph, a math block, a code block or a quote, which HTML writes as a `<figure>`. */
function captionedLeaf(node: Node): CaptionNode | undefined {
  return node.type === 'paragraph' || node.type === 'code_block' || node.type === 'block_quote' ? node.caption : undefined
}

function textParagraph(text: string): ParagraphNode[] {
  return text === '' ? [] : [{ type: 'paragraph', children: [{ type: 'text', value: text }] }]
}

/** A table keeps one line per row, with a hard break between the rows. C2-H-165: a table that leaves no text is dropped. */
function tableParagraph(node: TableNode): ParagraphNode[] {
  const out: Inline[] = []
  let text = false
  for (const group of node.children) {
    if (group.type === 'comment') continue
    for (const row of group.children) {
      if (row.type !== 'table_row') continue
      if (out.length > 0) out.push({ type: 'hard_break' })
      const value = rowText(row)
      if (value !== '') text = true
      out.push({ type: 'text', value })
    }
  }
  return text ? [{ type: 'paragraph', children: out }] : []
}

/**
 * C2-H-165: the blocks a degraded block becomes. A block with a mark of its kind and a leaf block give one
 * paragraph of their text; any other block that holds blocks gives those blocks in their degraded forms, in order.
 */
function degradedBlocks(node: Node): ParagraphNode[] {
  // C2-H-165: a table keeps its caption, with its number, as a paragraph below its rows.
  if (node.type === 'table') return [...tableParagraph(node), ...(node.caption === undefined ? [] : degradedBlocks(node.caption))]
  const caption = captionedLeaf(node)
  if (caption !== undefined) return [...textParagraph(ownText(node)), ...degradedBlocks(caption)]
  if (node.type in MARKED_TEXT || isInlineParent(node) || !('children' in node)) return textParagraph(blockText(node))
  const out: ParagraphNode[] = []
  for (const child of node.children) if (!UNWRITTEN.includes(child.type)) out.push(...degradedBlocks(child))
  const groupCaption = captionOf(node)
  if (groupCaption !== undefined) out.push(...degradedBlocks(groupCaption))
  return out
}

/** The backtick run that fences `value`: one longer than the longest run in it (C2-I-015). */
function fenceOf(value: string): string {
  let longest = 0
  let run = 0
  for (let at = 0; at < value.length; at++) {
    run = value.charCodeAt(at) === 96 ? run + 1 : 0
    if (run > longest) longest = run
  }
  return '`'.repeat(longest + 1)
}

/** A verbatim value in its code span form behind `prefix`, padded where C2-I-016 would take a space or a backtick would join the run. */
function fenced(prefix: string, value: string): string {
  const fence = fenceOf(value)
  const edge = value.startsWith('`') || value.endsWith('`') || (value.startsWith(' ') && value.endsWith(' ') && value.trim() !== '')
  const pad = edge ? ' ' : ''
  return `${prefix}${fence}${pad}${value}${pad}${fence}`
}

// C2-H-165: an inline node with no children, outside the profile itself, is written as its source text.
const SOURCE_TEXT: NodeHandlers<string> = {
  math: (node) => fenced(node.display ? '$$' : '$', node.value),
  autolink: (node) => `<${node.text ?? node.href}>`,
  raw_inline: (node) => `${fenced('', node.value)}{=${node.format}}`,
  code: (node) => fenced('', node.value),
  literal_inline: (node) => fenced('!', node.value),
  tag: (node) => `#${node.name}`,
  // C2-H-165 names "a comment"; an editorial comment is read as one, as C2-H-143 lists both as giving nothing.
  critic_comment: () => '',
}

function sourceText<T extends keyof NodeOfType>(type: T, node: NodeOfType[T]): string | undefined {
  return SOURCE_TEXT[type]?.(node, undefined)
}

/** C2-H-165: the inline form of a degraded inline node, which every node inside it at any depth takes too. */
function inlineForm(node: Inline): string {
  const source = sourceText(node.type, node)
  if (source !== undefined) return source
  if (isInlineParent(node)) {
    let out = ''
    for (const child of node.children) out += inlineForm(child)
    return out
  }
  return spelledText(node.type, node) ?? plainText([node])
}

function degradedInline(node: Inline): TextNode[] {
  const text = inlineForm(node)
  return text === '' ? [] : [{ type: 'text', value: text }]
}

/** Notes the footnote references and inline footnotes inside the degraded node `node`. */
function noteGone(filter: Filter, node: Node): void {
  if (node.type === 'footnote_ref' || node.type === 'inline_footnote') filter.gone.add(node)
  if (node.type === 'heading') {
    const id = node.attrs?.id ?? node.generatedId
    if (id !== undefined) filter.goneTargets.add(`#${id}`)
  }
  forEachSlot(node, (nodes) => {
    for (const child of nodes) noteGone(filter, child)
  }, undefined, filter.declarations)
}

/** An item stays an item, as its list expects. C2-H-166: it keeps its `<li>`, so its source line stays (C2-H-016). */
function degradedItem(node: ListItemNode): ListItemNode[] {
  const children: Block[] = []
  for (const child of node.children) if (!UNWRITTEN.includes(child.type)) children.push(...degradedBlocks(child))
  if (children.length === 0) return []
  const item: ListItemNode = { type: 'list_item', children }
  if (node.pos !== undefined) item.pos = node.pos
  return [item]
}

/** C2-H-163: the deny list of the axis, then its allow list, then the nesting bound. */
function isOutside(filter: Filter, node: Node, block: boolean, depth: number): boolean {
  const rule = filter.rule
  // C2-H-163: a captioned block is tested as its `<figure>`, a type that no allow list names.
  const type = block && captionedLeaf(node) !== undefined ? 'figure' : node.type
  const denied = block ? rule.deniedBlock : rule.deniedInline
  if (denied?.includes(type) === true) return true
  const allowed = block ? rule.allowedBlock : rule.allowedInline
  if (allowed !== null && !allowed.includes(type)) return true
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
      // C2-H-165: one report for the degraded node, which stays in the tree; the nodes inside it are not reported again.
      const out = degrade(node)
      const message = `Degraded a construct the profile "${filter.name}" does not allow: ${node.type}`
      const entry = { code: 'profile-construct-degraded', severity: 'warning', channel: 'render-loss', message } as const
      addFinding(filter.findings, node, entry)
      noteGone(filter, node)
      for (const part of out) kept.push(part)
      changed = true
      continue
    } else {
      filterNode(filter, node, depth + 1)
    }
    kept.push(node)
  }
  if (!changed) return
  filter.undo.push([list, [...list]])
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

/**
 * Filters the lists of `node`, whose nodes stand at `depth`: every slot that holds nodes (C2-A-024),
 * the fallback and the named slots of an extension included, which the renderer writes too.
 */
function isBlockSlot(node: Node, step: string, nodes: readonly Node[]): boolean {
  if (step === 'longDescription' || step === 'metadata/abstract' || step.startsWith('metadata/headers/') ||
    step.startsWith('metadata/footers/') || (node.type === 'block_extension' && step === 'fallback')) return true
  return (step.startsWith('metadata/fields/') || step.startsWith('slots/')) && nodes[0] !== undefined &&
    NODE_TABLE.BLOCKS.includes(nodes[0].type)
}

function filterNode(filter: Filter, node: Node, depth: number): void {
  forEachSlot(node, (nodes, step, single) => {
    // The slots are the node's own lists; the walk hands them on read-only, and the filter edits them in place.
    const list = nodes as Node[]
    if (step === 'children') filterChildren(filter, node, depth)
    else if (single) filterNode(filter, list[0]!, depth + 1)
    else if (step === 'pairs' || step === 'columns') for (const child of list) filterNode(filter, child, depth + 1)
    else if (isBlockSlot(node, step, nodes)) {
      filterList<Block>(filter, list as Block[], true, depth, degradedBlocks)
    }
    else filterList<Inline>(filter, list as Inline[], false, depth, degradedInline)
  }, undefined, filter.declarations)
}

/**
 * C2-H-129: replaces every node of `document` that is outside the profile by its degraded form,
 * in place, and reports each one. The children of the document stand at depth 0, as in 0.1. The
 * render calls `restore` when it has written the tree (C2-H-121).
 */
export function applyProfile(document: DocumentNode, name: string, rule: ProfileRule, findings: Findings): ProfileRun {
  const filter: Filter = {
    name, rule, findings, declarations: document.extensions ?? [], undo: [], gone: new Set(), goneTargets: new Set(),
  }
  filterNode(filter, document, 0)
  return {
    gone: filter.gone,
    goneTargets: filter.goneTargets,
    restore: () => {
      // The lists are put back from the last change on, so a list inside a degraded part comes back before its parent.
      for (const [list, before] of [...filter.undo].reverse()) {
        list.length = 0
        for (const node of before) list.push(node)
      }
    },
  }
}

/**
 * The resolution as the render sees it under a profile: a note keeps its number, and only the
 * references that the degraded forms left write a backlink. A note with none writes nothing.
 */
export function liveResolution(resolution: Resolution, gone: ReadonlySet<Node>, goneTargets: ReadonlySet<string>): Resolution {
  if (gone.size === 0 && goneTargets.size === 0) return resolution
  const goneIds = new Set<string>()
  for (const node of gone) {
    const id = resolution.refIds.get(node)
    if (id !== undefined) goneIds.add(id)
  }
  const notes: Note[] = []
  for (const note of resolution.notes) {
    const refIds = note.refIds.filter((id) => !goneIds.has(id))
    if (refIds.length > 0) notes.push({ ...note, refIds })
  }
  return { ...resolution, notes, goneTargets }
}
