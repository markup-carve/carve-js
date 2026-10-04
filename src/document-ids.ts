import type { AnyNode, Document } from './ast.js'
import { ALL_OWNED_CHILD_FIELDS } from './owned-child-fields.js'

/**
 * Document id namespace shared by explicit `{#id}` attributes, generated
 * heading ids, and extension-generated ids (tabs, code groups, citations).
 *
 * Spec: extensions contract §2.6 — extension-generated ids MUST be
 * deduplicated against explicit and heading ids with the same next-free-suffix
 * mechanism headings use. Mirrors carve-php's HeadingIdTracker::uniqueId().
 */
export class DocumentIdRegistry {
  /** id -> next 1-based suffix candidate (mirrors carve-php usedIds). */
  private usedIds = new Map<string, number>()
  private parentIds: ReadonlyMap<string, number> | undefined

  /** Reuse authored reservations while isolating each render's generated ids. */
  fork(): DocumentIdRegistry {
    const registry = new DocumentIdRegistry()
    registry.parentIds = this.usedIds
    return registry
  }

  /** Public trees can change between resolution and rendering. */
  matches(ids: ReadonlySet<string>): boolean {
    if (ids.size !== this.usedIds.size) return false
    for (const id of ids) if (!this.usedIds.has(id)) return false
    return true
  }

  private has(id: string): boolean {
    return this.usedIds.has(id) || this.parentIds?.has(id) === true
  }

  /** Reserve an id verbatim (explicit attribute or already-assigned id). */
  reserve(id: string): void {
    if (id !== '' && !this.has(id)) this.usedIds.set(id, 1)
  }

  /**
   * Reserve `baseId` in the namespace, or the next free numeric suffix
   * (`baseId-2`, `-3`, ...) when taken — skipping candidates already reserved
   * by explicit attributes or previously generated ids.
   */
  uniqueId(baseId: string): string {
    if (!this.has(baseId)) {
      this.usedIds.set(baseId, 1)
      return baseId
    }
    let n = this.usedIds.get(baseId) ?? this.parentIds!.get(baseId)!
    let candidate: string
    do {
      n++
      candidate = `${baseId}-${n}`
    } while (this.has(candidate))
    this.usedIds.set(baseId, n)
    this.usedIds.set(candidate, 1)
    return candidate
  }
}

const NO_CHILDREN: readonly string[] = []

/** Explicit cases make new schema node kinds require a traversal review. */
export const DOCUMENT_ID_CHILD_FIELDS = {
  abbreviation: NO_CHILDREN,
  abbreviation_def: NO_CHILDREN,
  admonition: ["children", "title"],
  autolink: NO_CHILDREN,
  block_extension: ["fallback"],
  block_quote: ["children"],
  caption_number: NO_CHILDREN,
  citation: ["locator", "prefix", "suffix"],
  citation_definition: ["children"],
  citation_group: ["items"],
  code: NO_CHILDREN,
  code_block: NO_CHILDREN,
  comment: NO_CHILDREN,
  critic_comment: NO_CHILDREN,
  definition_description: ["children"],
  definition_list: ["items"],
  definition_term: ["children"],
  delete: ["children"],
  directive: ["children", "title"],
  div: ["children"],
  document: ["children"],
  emphasis: ["children"],
  escaped_text: NO_CHILDREN,
  figure: ["caption", "shortCaption", "target"],
  figure_group: ["caption", "children"],
  footnote: ["children"],
  footnote_ref: NO_CHILDREN,
  frontmatter: NO_CHILDREN,
  hard_break: NO_CHILDREN,
  heading: ["children"],
  heading_ref: NO_CHILDREN,
  highlight: ["children"],
  image: NO_CHILDREN,
  inline_extension: ["content"],
  inline_footnote: ["inline"],
  insert: ["children"],
  line_block: ["children"],
  link: ["children"],
  link_reference_definition: NO_CHILDREN,
  list: ["items"],
  list_item: ["children"],
  literal_inline: NO_CHILDREN,
  math: NO_CHILDREN,
  mention: NO_CHILDREN,
  non_breaking_space: NO_CHILDREN,
  paragraph: ["children"],
  raw_block: NO_CHILDREN,
  raw_inline: NO_CHILDREN,
  ruby: ["pairs"],
  section: ["children"],
  small_caps: ["children"],
  smart_punctuation: NO_CHILDREN,
  soft_break: NO_CHILDREN,
  span: ["children"],
  strike: ["children"],
  strong: ["children"],
  subscript: ["children"],
  substitution: ["new", "old"],
  superscript: ["children"],
  symbol: NO_CHILDREN,
  table: ["caption", "rows", "shortCaption"],
  table_cell: ["blocks", "children"],
  table_row: ["cells"],
  tag: NO_CHILDREN,
  text: NO_CHILDREN,
  thematic_break: NO_CHILDREN,
  underline: ["children"],
} satisfies Record<AnyNode['type'], readonly string[]> & Record<string, readonly string[]>
Object.setPrototypeOf(DOCUMENT_ID_CHILD_FIELDS, null)

export const RECORD_CHILD_FIELDS: readonly string[] = ['terms', 'definitions', 'base', 'annotation']

/** Visit id-bearing AST slots without traversing positions or attribute values. */
export function visitDocumentIds(doc: Document, visit: (id: string) => void): void {
  const stack: unknown[] = [doc]
  const seen = new Set<object>()
  const singletonEdges = new Set<object>([doc])
  const pushChild = (child: unknown): void => {
    if (!child || typeof child !== 'object') return
    if (!Array.isArray(child)) {
      if (singletonEdges.has(child)) return
      singletonEdges.add(child)
    }
    stack.push(child)
  }
  while (stack.length > 0) {
    const value = stack.pop()
    if (!value || typeof value !== 'object') continue
    if (Array.isArray(value)) {
      if (seen.has(value)) continue
      seen.add(value)
      for (const child of value) {
        if (child && typeof child === 'object') {
          const node = child as { type?: string; attrs?: unknown }
          if (node.attrs === undefined && node.type !== 'heading_ref' && typeof node.type === 'string' &&
              (DOCUMENT_ID_CHILD_FIELDS as Readonly<Record<string, readonly string[]>>)[node.type] === NO_CHILDREN) continue
          stack.push(child)
        }
      }
      continue
    }
    const node = value as Record<string, unknown>
    const type = node['type']
    const fields = typeof type === 'string'
      ? (DOCUMENT_ID_CHILD_FIELDS as Readonly<Record<string, readonly string[]>>)[type] ?? ALL_OWNED_CHILD_FIELDS
      : RECORD_CHILD_FIELDS
    // Array edges are checked when popped. Record checks avoid repeat visits
    // to singleton owners and host-defined kinds reached through arrays.
    if (type === 'figure' || type === 'block_extension' || fields === ALL_OWNED_CHILD_FIELDS) {
      if (seen.has(value)) continue
      seen.add(value)
    }
    const id = (node['attrs'] as { id?: unknown } | undefined)?.id
    if (typeof id === 'string') visit(id)
    for (const field of fields) {
      const child = node[field]
      if (Array.isArray(child)) stack.push(child)
      else pushChild(child)
    }
    if (type === 'heading_ref' && Array.isArray(node['resolvedText'])) stack.push(node['resolvedText'])
    if (type === 'document' || type === 'doc') {
      pushChild(node['trailerBlocks'])
      const defs = node['footnoteDefs'] as Record<string, unknown> | undefined
      if (defs) for (const key in defs) if (Object.hasOwn(defs, key)) pushChild(defs[key])
    } else if (type === 'table') {
      const groups = node['rowGroups'] as {
        bodies?: unknown[]; headAttrs?: { id?: string }; footAttrs?: { id?: string }
      } | undefined
      if (groups?.bodies) pushChild(groups.bodies)
      if (typeof groups?.headAttrs?.id === 'string') visit(groups.headAttrs.id)
      if (typeof groups?.footAttrs?.id === 'string') visit(groups.footAttrs.id)
    }
  }
}

const resolvedNamespaces = new WeakMap<Document, DocumentIdRegistry>()

/** The resolution pass has already reserved authored ids and heading ids. */
export function rememberDocumentIds(doc: Document, registry: DocumentIdRegistry): void {
  resolvedNamespaces.set(doc, registry)
}

/** Normalization can copy the document root without changing its namespace. */
export function inheritDocumentIds(source: Document, target: Document): void {
  if (source === target) return
  const registry = resolvedNamespaces.get(source)
  if (registry) resolvedNamespaces.set(target, registry)
}

/** Validate mutable trees and reuse reservations without copying their map. */
export function collectDocumentIds(doc: Document): DocumentIdRegistry {
  const cached = resolvedNamespaces.get(doc)
  if (cached) {
    const ids = new Set<string>()
    visitDocumentIds(doc, (id) => { if (id !== '') ids.add(id) })
    if (cached.matches(ids)) return cached.fork()
    const registry = new DocumentIdRegistry()
    for (const id of ids) registry.reserve(id)
    return registry
  }
  const registry = new DocumentIdRegistry()
  visitDocumentIds(doc, (id) => registry.reserve(id))
  return registry
}
