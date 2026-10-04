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

  /** Reserve an id verbatim (explicit attribute or already-assigned id). */
  reserve(id: string): void {
    if (id !== '' && !this.usedIds.has(id)) this.usedIds.set(id, 1)
  }

  /**
   * Reserve `baseId` in the namespace, or the next free numeric suffix
   * (`baseId-2`, `-3`, ...) when taken — skipping candidates already reserved
   * by explicit attributes or previously generated ids.
   */
  uniqueId(baseId: string): string {
    if (!this.usedIds.has(baseId)) {
      this.usedIds.set(baseId, 1)
      return baseId
    }
    let n = this.usedIds.get(baseId)!
    let candidate: string
    do {
      n++
      candidate = `${baseId}-${n}`
    } while (this.usedIds.has(candidate))
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

export const RECORD_CHILD_FIELDS: readonly string[] = ['terms', 'definitions', 'base', 'annotation']

/** Visit id-bearing AST slots without traversing positions or attribute values. */
export function visitDocumentIds(doc: Document, visit: (id: string) => void): void {
  const stack: unknown[] = [doc]
  const seen = new WeakSet<object>()
  while (stack.length > 0) {
    const value = stack.pop()
    if (!value || typeof value !== 'object' || seen.has(value)) continue
    seen.add(value)
    if (Array.isArray(value)) {
      for (const child of value) stack.push(child)
      continue
    }
    const node = value as Record<string, unknown>
    const type = node['type']
    const id = (node['attrs'] as { id?: unknown } | undefined)?.id
    if (typeof id === 'string') visit(id)
    const fields = typeof type === 'string'
      ? Object.hasOwn(DOCUMENT_ID_CHILD_FIELDS, type)
        ? (DOCUMENT_ID_CHILD_FIELDS as Readonly<Record<string, readonly string[]>>)[type]!
        : ALL_OWNED_CHILD_FIELDS
      : RECORD_CHILD_FIELDS
    for (const field of fields) {
      const child = node[field]
      if (child && typeof child === 'object') stack.push(child)
    }
    if (type === 'heading_ref' && Array.isArray(node['resolvedText'])) stack.push(node['resolvedText'])
    if (type === 'document' || type === 'doc') {
      stack.push(node['trailerBlocks'])
      const defs = node['footnoteDefs'] as Record<string, unknown> | undefined
      if (defs) for (const key in defs) if (Object.hasOwn(defs, key)) stack.push(defs[key])
    } else if (type === 'table') {
      const groups = node['rowGroups'] as {
        bodies?: unknown[]; headAttrs?: { id?: string }; footAttrs?: { id?: string }
      } | undefined
      if (groups?.bodies) stack.push(groups.bodies)
      if (typeof groups?.headAttrs?.id === 'string') visit(groups.headAttrs.id)
      if (typeof groups?.footAttrs?.id === 'string') visit(groups.footAttrs.id)
    }
  }
}

/** Build a render-local namespace for mutable or transformed public trees. */
export function collectDocumentIds(doc: Document): DocumentIdRegistry {
  const registry = new DocumentIdRegistry()
  visitDocumentIds(doc, (id) => registry.reserve(id))
  return registry
}
