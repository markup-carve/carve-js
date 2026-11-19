// Index: invisible `:index[term]` markers, collected into a sorted list by a `::: index` directive.
import { type Block, type DirectiveNode, type DocumentNode, type Inline, type InlineExtensionNode, type ListNode,
  type Node } from '../ast.ts'
import { plainText } from '../ast-text.ts'
import { DEFAULT_LABELS } from '../option-tables.ts'
import { slugify } from '../slug.ts'
import { type ExtensionBundle, claimDirective, coreInlines, declare, directiveDefinition, freshId, slotRenderer, viewIds,
  walkView } from './apparatus.ts'
import { type ExtensionDefinition, type ExtensionRenderer } from './types.ts'

const MARKER = 'carve.indexTerm'
const INDEX = 'carve.index'
// As 0.1: K index directives each repeat the whole list, so the output of one render is capped.
const BUDGET_BYTES = 1_000_000
const BUDGET_FACTOR = 8

export interface IndexOptions {
  /** The leading words of a back-link's accessible name; the default is the `indexBackref` label, `Back to`. */
  backrefLabel?: string
}

export const indexTermExtension: ExtensionDefinition = {
  name: MARKER, version: '1', matcher: { form: 'inline', name: 'index' }, props: { id: 'string' },
  slots: { term: { kind: 'inline', optional: true } }, children: 'none',
  transform: (claim) => {
    if (claim.form !== 'inline') return null
    // The marker is invisible: it gives no text (C2-H-143), so its fallback is empty.
    const node: InlineExtensionNode = { type: 'inline_extension', name: MARKER, version: '1', children: [], fallback: [] }
    if (claim.children.length > 0) node.slots = { term: claim.children }
    return node
  },
}

export const indexExtension: ExtensionDefinition = directiveDefinition(INDEX)

interface Entry { display: Inline[], ids: string[] }

/** Ascending code point order, independent of the locale, so every implementation sorts alike. */
function byCodePoint(a: string, b: string): number {
  const left = [...a]
  const right = [...b]
  for (let at = 0; at < Math.min(left.length, right.length); at++) {
    const difference = (left[at]?.codePointAt(0) ?? 0) - (right[at]?.codePointAt(0) ?? 0)
    if (difference !== 0) return difference
  }
  return left.length - right.length
}

function utf8Length(text: string): number {
  return new TextEncoder().encode(text).length
}

function backref(id: string, label: string, m: number, total: number): Inline {
  const children: Inline[] = [{ type: 'text', value: '↩' }]
  if (total > 1) children.push({ type: 'superscript', children: [{ type: 'text', value: String(m) }] })
  return { type: 'link', href: `#${id}`, children,
    attrs: { classes: ['index-backref'], keyValues: [['aria-label', total === 1 ? label : `${label} ${m}`]] } }
}

/** One line of the index: the term and a back-link per use, drawn from the budget until it runs out. */
function indexLine(entry: Entry, backrefLabel: string, budget: { left: number }): Inline[] {
  const term = plainText(entry.display)
  const line: Inline[] = [...structuredClone(entry.display), { type: 'text', value: ' ' }]
  for (const [at, id] of entry.ids.entries()) {
    budget.left -= utf8Length(id) + utf8Length(term) + 80
    if (budget.left < 0) break
    if (at > 0) line.push({ type: 'text', value: ' ' })
    // The back-link is named by what it visibly says, the term and its number among several.
    line.push(backref(id, `${backrefLabel} ${term}`, at + 1, entry.ids.length))
  }
  return line
}

function indexList(entries: Map<string, Entry>, backrefLabel: string, budget: { left: number }): ListNode | null {
  const items: ListNode['children'] = []
  for (const slug of [...entries.keys()].sort(byCodePoint)) {
    const entry = entries.get(slug)
    if (entry === undefined) continue
    budget.left -= utf8Length(plainText(entry.display)) + 10
    if (budget.left < 0) break
    items.push({ type: 'list_item', children: [{ type: 'paragraph', children: indexLine(entry, backrefLabel, budget) }] })
    if (budget.left < 0) break
  }
  if (items.length === 0) return null
  return { type: 'list', marker: { kind: 'bullet', char: '-' }, spacing: 'tight', attrs: { classes: ['index'] }, children: items }
}

function indexTransform(view: DocumentNode, backrefLabel: string): DocumentNode {
  const taken = viewIds(view)
  const entries = new Map<string, Entry>()
  walkView(view, (node) => {
    // A marker in a note is not counted: the note may render elsewhere or not at all.
    if (node.type === 'footnote' || node.type === 'inline_footnote') return false
    if (node.type !== 'inline_extension' || node.name !== MARKER) return undefined
    const term = (node.slots?.['term'] ?? []) as Inline[]
    const slug = slugify(plainText(term), 'lower')
    const entry = entries.get(slug) ?? { display: coreInlines(term), ids: [] }
    entries.set(slug, entry)
    const id = freshId(`idx-${slug}-${entry.ids.length + 1}`, taken)
    entry.ids.push(id)
    node.props = { id }
    return false
  })
  if (entries.size === 0) return view
  const budget = { left: Math.max(BUDGET_BYTES, BUDGET_FACTOR * (view.srcByteLength ?? 0)) }
  let claimed = false
  walkView(view, (node) => {
    if (node.type !== 'directive' || node.kind !== 'index') return undefined
    const list = indexList(entries, backrefLabel, budget)
    if (list === null) return false
    claimed = true
    const body: DirectiveNode = structuredClone(node)
    body.children.push(list as Block)
    return claimDirective(INDEX, node, [body])
  })
  if (claimed) declare(view, [indexExtension])
  return view
}

function renderMarker(node: Node): string {
  const id = node.type === 'inline_extension' ? node.props?.['id'] : undefined
  // A marker the transform did not count, as in a note, has no id, so the index never points at it.
  return typeof id === 'string' ? `<span id="${escapeId(id)}" class="index-term"></span>` : '<span class="index-term"></span>'
}

function escapeId(id: string): string {
  return id.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

export const indexTermRenderer: ExtensionRenderer = { version: '1', render: renderMarker, buildTime: renderMarker }
export const indexRenderer: ExtensionRenderer = slotRenderer('body')

/** The provisional standard index extension. */
export function index(options: IndexOptions = {}): ExtensionBundle {
  const backrefLabel = options.backrefLabel ?? DEFAULT_LABELS['indexBackref'] ?? 'Back to'
  return {
    extensions: [indexTermExtension, indexExtension],
    renderers: { [MARKER]: indexTermRenderer, [INDEX]: indexRenderer },
    transforms: [{ name: 'index', transform: (view) => indexTransform(view, backrefLabel) }],
  }
}
