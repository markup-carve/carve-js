// The profiles of C2-H-129 and C2-H-163: a node outside the profile is written in its degraded form
// (C2-H-165). The profile is a render option and changes no tree (C2-H-121): the render applies it to the
// resolved tree, writes it, and puts every list back, so resolution has seen the whole tree.
import {
  type Block, type BlockQuoteNode, type CaptionNode, captionOf, DEFINITION_TYPES, type DocumentNode, type ExtensionDeclaration,
  forEachSlot, type HeadingNode, type Inline,
  isBlockParent, isInlineParent, type ListItemNode, type Node, type NodeHandlers, type NodeOfType, type ParagraphNode, type TableCellNode,
  type TableNode, type TableRowNode, titleOf,
} from './ast.ts'
import { blockText as taskBlockText, plainText } from './ast-text.ts'
import { NODE_TABLE } from './ast-validate.ts'
import { addFinding, type Findings } from './diagnostics.ts'
import { passesPolicy } from './html-attributes.ts'
import { includeSource } from './include.ts'
import { type Settings } from './options.ts'
import { type ProfileRule } from './render-tables.ts'
import { type Note, type Resolution } from './resolve.ts'
import { append } from './append.ts'

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
  /** C2-H-163: whether a link the profile keeps is written as the plain text of its children, so nothing in it degrades. */
  writesAsText: (node: Node) => boolean
}

/** What a profile did to a tree for one render. */
export interface ProfileRun {
  /** Accessible names read from task items before their descendants degrade. */
  readonly taskLabels: ReadonlyMap<ListItemNode, string>
  /** The footnote references and inline footnotes that the degraded forms took out. */
  readonly gone: ReadonlySet<Node>
  /** C2-H-177: the targets of the headings that the profile degraded. */
  readonly goneTargets: ReadonlySet<string>
  /** Puts every list the profile changed back as it was. */
  restore(): void
}

// A node of these types renders nothing, so it has no degraded form and stays as it is.
const UNWRITTEN = ['comment', 'frontmatter', ...DEFINITION_TYPES]

const NO_TEXTS: ReadonlyMap<Node, string> = new Map()
// The link text of each resolved cross-reference (C2-H-096), for the render that degrades.
let xrefTexts = NO_TEXTS

// C2-H-165: the nodes with no children whose degraded text, at both levels, is not their plain text by C2-H-143.
const LEAF_TEXT: NodeHandlers<string> = {
  image: (node) => `[img: ${node.alt ?? ''}]`,
  comment: () => '',
  critic_comment: () => '',
  symbol: (node) => `:${node.name}:`,
  xref: (node) => (node.href === undefined ? `</#${node.key}>` : xrefTexts.get(node) ?? ''),
  raw_inline: (node) => node.value,
}

function leafText<T extends keyof NodeOfType>(type: T, node: NodeOfType[T]): string | undefined {
  return LEAF_TEXT[type]?.(node, undefined)
}

/** The text a node leaves inside a block that is degraded as a whole: its plain text by C2-H-143, with the leaf forms. */
function inlineText(node: Inline): string {
  const leaf = leafText(node.type, node)
  if (leaf !== undefined) return leaf
  return isInlineParent(node) && node.type !== 'inline_footnote' ? inlinesText(viewOf(node)) : plainText([node])
}

/** C2-X-032, C2-H-165: a qualified inline extension degrades to the text of its fallback. */
function viewOf(node: Inline & { children: Inline[] }): readonly Inline[] {
  return node.type === 'inline_extension' && node.name.includes('.') ? node.fallback ?? node.children : node.children
}

/** The block-level text of `nodes`; `texts` gives the link texts of the cross-references where the caller has them. */
export function inlinesText(nodes: readonly Inline[], texts?: ReadonlyMap<Node, string>): string {
  const outer = xrefTexts
  if (texts !== undefined) xrefTexts = texts
  try {
    let out = ''
    for (const node of nodes) out += inlineText(node)
    return out
  } finally {
    xrefTexts = outer
  }
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
  const caption = degradedCaption(node)
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

/**
 * The caption a degraded block writes after its own text (C2-H-165): that of a captioned leaf, and that of an
 * unexpanded include, which C2-N-074 writes as a degraded block's caption.
 */
function degradedCaption(node: Node): CaptionNode | undefined {
  return node.type === 'include' && node.children === undefined ? node.caption : captionedLeaf(node)
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
  if (node.type === 'line_block') return textParagraph(joined(node.children, ''))
  const caption = degradedCaption(node)
  if (caption !== undefined) return [...textParagraph(ownText(node)), ...degradedBlocks(caption)]
  if (node.type in MARKED_TEXT || isInlineParent(node) || !('children' in node)) return textParagraph(blockText(node))
  const out: ParagraphNode[] = []
  // C2-H-165: a block extension gives the blocks of its fallback.
  const blocks: readonly Node[] = node.type === 'block_extension' ? node.fallback : node.children
  for (const child of blocks) if (!UNWRITTEN.includes(child.type)) append(out, degradedBlocks(child))
  const groupCaption = captionOf(node)
  if (groupCaption !== undefined) append(out, degradedBlocks(groupCaption))
  return out
}

/** C2-H-165: the inline form of a degraded inline node, which every node inside it at any depth takes too. */
function inlineForm(node: Inline): string {
  const leaf = leafText(node.type, node)
  if (leaf !== undefined) return leaf
  if (node.type === 'footnote_ref') return `[^${node.key}]`
  if (isInlineParent(node)) {
    let out = ''
    for (const child of viewOf(node)) out += inlineForm(child)
    return out
  }
  return plainText([node])
}

function degradedInline(node: Inline): Inline[] {
  // C2-H-165, C2-H-019: an editorial comment gives no text and still counts as a comment of its paragraph.
  if (node.type === 'critic_comment') return [{ type: 'comment', form: 'braced', value: node.value }]
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
  for (const child of node.children) if (!UNWRITTEN.includes(child.type)) append(children, degradedBlocks(child))
  const item: ListItemNode = { type: 'list_item', children }
  if (node.pos !== undefined) item.pos = node.pos
  return [item]
}

/** C2-H-163: the deny list of the axis, then its allow list, then the nesting bound. */
/** C2-H-163: whether the profile `rule` admits nodes of `type`, the bound of nesting aside. */
export function admitsType(rule: ProfileRule, type: string, block: boolean): boolean {
  if ((block ? rule.deniedBlock : rule.deniedInline)?.includes(type) === true) return false
  const allowed = block ? rule.allowedBlock : rule.allowedInline
  return allowed === null || allowed.includes(type)
}

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

function degradationMessage(filter: Filter, node: Node, block: boolean): string {
  if (!admitsType(filter.rule, node.type, block)) {
    return `Degraded a construct the profile "${filter.name}" does not allow: ${node.type}.`
  }
  return `Degraded ${node.type} because it exceeds the nesting limit of profile "${filter.name}"; ` +
    'move it to a shallower level or use a profile that permits the depth.'
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
      const message = degradationMessage(filter, node, block)
      const entry = { code: 'profile-construct-degraded', severity: 'warning', channel: 'render-loss', message } as const
      addFinding(filter.findings, node, entry)
      noteGone(filter, node)
      for (const part of out) kept.push(part)
      changed = true
      continue
    } else if (!filter.writesAsText(node)) {
      filterNode(filter, node, depth + 1)
    }
    kept.push(node)
  }
  if (!changed) return
  filter.undo.push([list, [...list]])
  list.length = 0
  for (const node of kept) list.push(node)
}

/** C2-H-163: a resolved link whose destination fails the URL policy; an unresolved reference keeps its brackets. */
function isDeniedLink(node: Node, policy: Pick<Settings, 'allowed' | 'denied'>): boolean {
  if (node.type !== 'link' || (node.key !== undefined && node.href === undefined)) return false
  return !passesPolicy(policy, node.href ?? '')
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
export function applyProfile(
  document: DocumentNode, name: string, rule: ProfileRule, findings: Findings, texts: ReadonlyMap<Node, string>,
  policy: Pick<Settings, 'allowed' | 'denied'>,
): ProfileRun {
  const taskLabels = new Map<ListItemNode, string>()
  const collectTasks = (node: Node): void => {
    if (node.type === 'list_item' && node.task !== undefined) taskLabels.set(node, taskBlockText(node.children))
    forEachSlot(node, (nodes) => { for (const child of nodes) collectTasks(child) }, undefined, document.extensions ?? [])
  }
  collectTasks(document)
  const filter: Filter = {
    name, rule, findings, declarations: document.extensions ?? [], undo: [], gone: new Set(), goneTargets: new Set(),
    writesAsText: (node) => name === 'comment' && isDeniedLink(node, policy),
  }
  xrefTexts = texts
  try {
    filterNode(filter, document, 0)
  } finally {
    xrefTexts = NO_TEXTS
  }
  return {
    taskLabels,
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

/** The references that stand in the note `note` itself, each inline footnote taken as a reference and not entered. */
function referencesIn(node: Node, out: Node[]): void {
  forEachSlot(node, (nodes) => {
    for (const child of nodes) {
      if (child.type === 'footnote_ref' || child.type === 'inline_footnote') out.push(child)
      if (child.type !== 'inline_footnote') referencesIn(child, out)
    }
  })
}

/** The note that each reference id stands in; a reference in the body has none. */
function referenceOwners(resolution: Resolution): Map<string, Note> {
  const owners = new Map<string, Note>()
  for (const note of resolution.notes) {
    const references: Node[] = []
    const body = note.definition ?? note.inline
    if (body !== null) referencesIn(body, references)
    for (const reference of references) {
      const id = resolution.refIds.get(reference)
      if (id !== undefined) owners.set(id, note)
    }
  }
  return owners
}

/**
 * C2-H-094: the notes that are written, from the body outward: a note with a reference that is written, which is one
 * the degraded forms left that stands in the body or in a note that is written.
 */
function writtenNotes(resolution: Resolution, goneIds: ReadonlySet<string>): Note[] {
  const owners = referenceOwners(resolution)
  const written = new Set<Note>()
  const isWritten = (id: string): boolean => {
    if (goneIds.has(id)) return false
    const owner = owners.get(id)
    return owner === undefined || written.has(owner)
  }
  for (let grew = true; grew;) {
    grew = false
    for (const note of resolution.notes) {
      if (written.has(note) || !note.refIds.some(isWritten)) continue
      written.add(note)
      grew = true
    }
  }
  const notes: Note[] = []
  for (const note of resolution.notes) if (written.has(note)) notes.push({ ...note, refIds: note.refIds.filter(isWritten) })
  return notes
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
  return { ...resolution, notes: writtenNotes(resolution, goneIds), goneTargets }
}
