// The profiles of C2-H-129 and C2-H-163: a node outside the profile is replaced by its degraded
// form (C2-H-165) before the tree is resolved, so that a reference or a caption that is gone takes no number.
import { type AstNode, childrenOf, DEFINITION_TYPES, INLINE_PARENTS, keyOf, levelOf, pairsOf, valueOf } from './ast.ts'
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
const INLINE_SLOTS = ['title', 'short', 'prefix', 'locator', 'suffix'] as const

/** The text a degraded inline node leaves: its plain text, or the spelling of a node that has none. */
function inlineText(node: AstNode): string {
  switch (node.type) {
    case 'image': return `[img: ${node.alt ?? ''}]`
    case 'footnote_ref': return `[^${keyOf(node)}]`
    case 'comment': return ''
    case 'symbol': return `:${node.name ?? ''}:`
    case 'xref': return `</#${keyOf(node)}>`
    case 'raw_inline': return valueOf(node)
    case 'inline_footnote': return inlinesText(childrenOf(node))
    default: return node.children === undefined ? plainText([node]) : inlinesText(node.children)
  }
}

function inlinesText(nodes: readonly AstNode[]): string {
  let out = ''
  for (const node of nodes) out += inlineText(node)
  return out
}

function joined(nodes: readonly AstNode[], prefix: string): string {
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
function containerText(node: AstNode): string {
  const title = Array.isArray(node.title) ? inlinesText(node.title) : ''
  const rest = [joined(childrenOf(node), ''), node.caption === undefined ? '' : blockText(node.caption)]
  return [title, ...rest].filter((part) => part !== '').join(' ')
}

/** A quote whose blocks leave no text leaves none either. */
function quoteText(node: AstNode): string {
  const text = joined(childrenOf(node), '')
  return text === '' ? '' : `> ${text}`
}

function headingText(node: AstNode): string {
  return `${'#'.repeat(levelOf(node))} ${inlinesText(childrenOf(node))}`
}

function rowText(node: AstNode): string {
  return childrenOf(node).filter((cell) => cell.span === undefined).map(blockText).join(' | ')
}

// C2-H-165: the blocks whose degraded text is not that of their content alone: the mark of the kind stands in it.
const MARKED_TEXT = new Map<string, (node: AstNode) => string>([
  ['heading', headingText],
  ['block_quote', quoteText],
  ['list', (node) => joined(childrenOf(node), '- ')],
  ['thematic_break', () => '---'],
  ['code_block', (node) => withoutLineEnd(valueOf(node))],
  ['raw_block', (node) => withoutLineEnd(valueOf(node))],
  ['table_row', rowText],
  ['include', includeSource],
  ['div', containerText],
])

/** The text a degraded block leaves. */
function blockText(node: AstNode): string {
  const marked = MARKED_TEXT.get(node.type)
  if (marked !== undefined) return marked(node)
  return INLINE_PARENTS.includes(node.type) ? inlinesText(childrenOf(node)) : containerText(node)
}

function textParagraph(text: string): AstNode[] {
  return text === '' ? [] : [{ type: 'paragraph', children: [{ type: 'text', value: text }] }]
}

/** A table keeps one line per row, with a hard break between the rows. */
function tableParagraph(node: AstNode): AstNode[] {
  const out: AstNode[] = []
  for (const group of childrenOf(node)) {
    for (const row of childrenOf(group)) {
      if (row.type !== 'table_row') continue
      if (out.length > 0) out.push({ type: 'hard_break' })
      out.push({ type: 'text', value: blockText(row) })
    }
  }
  return out.length === 0 ? [] : [{ type: 'paragraph', children: out }]
}

/**
 * C2-H-165: the blocks a degraded block becomes. A block with a mark of its kind and a leaf block give one
 * paragraph of their text; any other block that holds blocks gives those blocks in their degraded forms, in order.
 */
function degradedBlocks(node: AstNode): AstNode[] {
  if (node.type === 'table') return tableParagraph(node)
  if (MARKED_TEXT.has(node.type) || INLINE_PARENTS.includes(node.type) || node.children === undefined) {
    return textParagraph(blockText(node))
  }
  const out: AstNode[] = []
  for (const child of childrenOf(node)) if (!UNWRITTEN.includes(child.type)) out.push(...degradedBlocks(child))
  if (node.caption !== undefined) out.push(...degradedBlocks(node.caption))
  return out
}

/** The nodes that stand in place of `node`, none when nothing is left of it. An item stays an item, as its list expects. */
function degraded(node: AstNode, block: boolean): AstNode[] {
  if (!block) {
    const text = inlineText(node)
    return text === '' ? [] : [{ type: 'text', value: text }]
  }
  if (node.type !== 'list_item') return degradedBlocks(node)
  const children: AstNode[] = []
  for (const child of childrenOf(node)) if (!UNWRITTEN.includes(child.type)) children.push(...degradedBlocks(child))
  return children.length === 0 ? [] : [{ type: 'list_item', children }]
}

/** C2-H-163: the deny list of the axis, then its allow list, then the nesting bound. */
function isOutside(filter: Filter, node: AstNode, block: boolean, depth: number): boolean {
  const rule = filter.rule
  const denied = block ? rule.deniedBlock : rule.deniedInline
  if (denied?.includes(node.type) === true) return true
  const allowed = block ? rule.allowedBlock : rule.allowedInline
  if (allowed !== null && !allowed.includes(node.type)) return true
  return rule.maxNesting >= 0 && depth > rule.maxNesting
}

/** Filters one list in place. Its nodes stand `depth` levels below the children of the document. */
function filterList(filter: Filter, list: AstNode[], block: boolean, depth: number): void {
  const kept: AstNode[] = []
  let changed = false
  for (const node of list) {
    if (UNWRITTEN.includes(node.type)) {
      // Kept as it is: a definition still resolves the references to it. The body of a note is
      // filtered where the profile has notes; elsewhere no reference is left to write it.
      if (node.type === 'footnote' && !isOutside(filter, node, block, depth)) filterNode(filter, node, depth + 1)
    } else if (isOutside(filter, node, block, depth)) {
      // C2-H-165: one report for the degraded node; the nodes inside it are not reported again.
      const out = degraded(node, block)
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

/** Filters the lists of `node`, whose nodes stand at `depth`. */
function filterNode(filter: Filter, node: AstNode, depth: number): void {
  if (node.children !== undefined) filterList(filter, node.children, !INLINE_PARENTS.includes(node.type), depth)
  for (const slot of INLINE_SLOTS) {
    const list = node[slot]
    if (Array.isArray(list)) filterList(filter, list, false, depth)
  }
  if (node.caption !== undefined) filterNode(filter, node.caption, depth + 1)
  for (const pair of pairsOf(node)) {
    filterList(filter, pair.base, false, depth)
    filterList(filter, pair.annotation, false, depth)
  }
}

/**
 * C2-H-129: replaces every node of `document` that is outside the profile by its degraded form,
 * in place, and reports each one. The children of the document stand at depth 0, as in 0.1.
 */
export function applyProfile(document: AstNode, name: string, rule: ProfileRule, findings: Findings): void {
  filterNode({ name, rule, findings }, document, 0)
}
