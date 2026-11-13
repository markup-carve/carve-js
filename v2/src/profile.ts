// The profiles of C2-H-129 and C2-H-163: a node outside the profile is replaced by its degraded
// form before the tree is resolved, so that a reference or a caption that is gone takes no number.
// The specification does not state the degraded forms; they follow the 0.1 engine.
import { type AstNode, DEFINITION_TYPES, INLINE_PARENTS } from './ast.ts'
import { plainText } from './ast-text.ts'
import { addFinding, type Findings } from './diagnostics.ts'
import { type ProfileRule } from './render-tables.ts'

interface Filter {
  name: string
  rule: ProfileRule
  findings: Findings
}

// A node of these types renders nothing, so it has no degraded form and stays as it is.
const UNWRITTEN = ['comment', 'frontmatter', ...DEFINITION_TYPES]
const INLINE_SLOTS = ['title', 'short', 'prefix', 'locator', 'suffix'] as const
const MAX_HEADING_MARKS = 6

/** The text a degraded inline node leaves: its plain text, or the spelling of a node that has none. */
function inlineText(node: AstNode): string {
  switch (node.type) {
    case 'image': return `[img: ${node.alt ?? ''}]`
    case 'footnote_ref': return `[^${node.key ?? ''}]`
    case 'symbol': return `:${node.name ?? ''}:`
    case 'xref': return `</#${node.key ?? ''}>`
    case 'raw_inline': return node.value ?? ''
    case 'inline_footnote': return inlinesText(node.children ?? [])
    default: return node.children === undefined ? plainText([node]) : inlinesText(node.children)
  }
}

function inlinesText(nodes: AstNode[]): string {
  let out = ''
  for (const node of nodes) out += inlineText(node)
  return out
}

function joined(nodes: AstNode[], prefix: string): string {
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
  const rest = [joined(node.children ?? [], ''), node.caption === undefined ? '' : blockText(node.caption)]
  return [title, ...rest].filter((part) => part !== '').join(' ')
}

function headingText(node: AstNode): string {
  return `${'#'.repeat(Math.min(node.level ?? 1, MAX_HEADING_MARKS))} ${inlinesText(node.children ?? [])}`
}

function rowText(node: AstNode): string {
  return (node.children ?? []).filter((cell) => cell.span === undefined).map(blockText).join(' | ')
}

// The blocks whose degraded text is not that of their content alone: the mark of the kind stands in it, as 0.1 wrote it.
const MARKED_TEXT = new Map<string, (node: AstNode) => string>([
  ['heading', headingText],
  ['block_quote', (node) => `> ${joined(node.children ?? [], '')}`],
  ['list', (node) => joined(node.children ?? [], '- ')],
  ['thematic_break', () => '---'],
  ['code_block', (node) => withoutLineEnd(node.value ?? '')],
  ['raw_block', (node) => withoutLineEnd(node.value ?? '')],
  ['table_row', rowText],
  ['include', (node) => `{{ ${node.path ?? ''} }}`],
])

/** The text a degraded block leaves. */
function blockText(node: AstNode): string {
  const marked = MARKED_TEXT.get(node.type)
  if (marked !== undefined) return marked(node)
  return INLINE_PARENTS.includes(node.type) ? inlinesText(node.children ?? []) : containerText(node)
}

/** The inline content of the paragraph a degraded block becomes: a table keeps one line per row. */
function degradedInlines(node: AstNode): AstNode[] {
  if (node.type !== 'table') {
    const text = blockText(node)
    return text === '' ? [] : [{ type: 'text', value: text }]
  }
  const out: AstNode[] = []
  for (const group of node.children ?? []) {
    for (const row of group.children ?? []) {
      if (row.type !== 'table_row') continue
      if (out.length > 0) out.push({ type: 'hard_break' })
      out.push({ type: 'text', value: blockText(row) })
    }
  }
  return out
}

/** The node that stands in place of `node`, or null when nothing is left of it. An item stays an item, as its list expects. */
function degraded(node: AstNode, block: boolean): AstNode | null {
  if (!block) return { type: 'text', value: inlineText(node) }
  const children = degradedInlines(node)
  if (children.length === 0) return null
  const paragraph: AstNode = { type: 'paragraph', children }
  return node.type === 'list_item' ? { type: 'list_item', children: [paragraph] } : paragraph
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
  let kept = 0
  for (const node of list) {
    let out: AstNode | null = node
    if (UNWRITTEN.includes(node.type)) {
      // Kept as it is: a definition still resolves the references to it. The body of a note is
      // filtered where the profile has notes; elsewhere no reference is left to write it.
      if (node.type === 'footnote' && !isOutside(filter, node, block, depth)) filterNode(filter, node, depth + 1)
    } else if (isOutside(filter, node, block, depth)) {
      out = degraded(node, block)
      const message = `Degraded a construct the profile "${filter.name}" does not allow: ${node.type}`
      addFinding(filter.findings, out, { code: 'profile-construct-degraded', severity: 'warning', channel: 'render-loss', message })
    } else {
      filterNode(filter, node, depth + 1)
    }
    if (out !== null) list[kept++] = out
  }
  list.length = kept
}

/** Filters the lists of `node`, whose nodes stand at `depth`. */
function filterNode(filter: Filter, node: AstNode, depth: number): void {
  if (node.children !== undefined) filterList(filter, node.children, !INLINE_PARENTS.includes(node.type), depth)
  for (const slot of INLINE_SLOTS) {
    const list = node[slot]
    if (Array.isArray(list)) filterList(filter, list, false, depth)
  }
  if (node.caption !== undefined) filterNode(filter, node.caption, depth + 1)
  for (const pair of node.pairs ?? []) {
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
