import type { AnyNode, Attrs, BlockNode, Document, InlineNode } from './ast.js'
import type { CarveExtension } from './extension.js'

/**
 * Map of element type (snake_case, as in carve-php's DefaultAttributesExtension)
 * to the default attributes to apply. A `class` value is merged with any
 * existing classes; any other key is only set when the node does not already
 * have it.
 */
export type DefaultAttributesMap = Record<string, Record<string, string>>

/** Options for the {@link defaultAttributes} extension. */
export interface DefaultAttributesOptions {
  /** Element type (snake_case) -> default attributes. */
  defaults?: DefaultAttributesMap
}

// carve-php uses snake_case node-type names; carve-js uses its own AST `type`
// strings. This maps each carve-php type to the carve-js AST type(s) it targets.
//
// The set mirrors carve-php's ACTUAL behavior, which differs from its docblock:
// carve-php applies a default only when a node's getType() equals the key, and
// its sub-structural nodes (list_item, table_cell, table_row) are rendered
// inline by their parent without a dispatch the extension can catch, so a
// default keyed on them never applies. We exclude those here to match. A php
// `div` default applies to BOTH a bare div and an admonition (carve-php has one
// Div node covering both; carve-js splits them), so `div` maps to both. Emphasis
// kinds map to the carve-js emphasis `type`: `emphasis` -> italic (`/x/`),
// `superscript` -> super (`^x^`), `strike` -> strike (`~x~`).
const TYPE_MAP: Record<string, string[]> = {
  paragraph: ['paragraph'],
  heading: ['heading'],
  code_block: ['code-block'],
  block_quote: ['blockquote'],
  list: ['list'],
  table: ['table'],
  div: ['div', 'admonition'],
  thematic_break: ['thematic-break'],
  link: ['link'],
  image: ['image'],
  span: ['span'],
  code: ['code'],
  footnote: ['footnote'],
  footnote_ref: ['footnote'],
  emphasis: ['italic'],
  strong: ['strong'],
  superscript: ['super'],
  subscript: ['sub'],
  strike: ['strike'],
}

/** Ensure `attrs.order` records a slot once, at first appearance. */
function pushOrder(attrs: Attrs, slot: string): void {
  if (!attrs.order) attrs.order = []
  if (!attrs.order.includes(slot)) attrs.order.push(slot)
}

function mergeClasses(attrs: Attrs, classes: string): void {
  const existing = attrs.classes ?? []
  let changed = false
  for (const cls of classes.split(' ')) {
    const c = cls.trim()
    if (c !== '' && !existing.includes(c)) {
      existing.push(c)
      changed = true
    }
  }
  if (changed) {
    attrs.classes = existing
    pushOrder(attrs, '.class')
  }
}

function applyDefaults(node: AnyNode, defaults: Record<string, string>): void {
  const n = node as { attrs?: Attrs }
  if (!n.attrs) n.attrs = {}
  const attrs = n.attrs
  for (const [name, value] of Object.entries(defaults)) {
    if (name === 'class') {
      mergeClasses(attrs, value)
      continue
    }
    if (name === 'id') {
      if (attrs.id === undefined) {
        attrs.id = value
        pushOrder(attrs, '#id')
      }
      continue
    }
    // Only set a key-value if the node does not already have it (case-sensitive
    // key, matching carve-php's hasAttribute check).
    if (!attrs.keyValues || attrs.keyValues[name] === undefined) {
      attrs.keyValues = { ...(attrs.keyValues ?? {}), [name]: value }
      pushOrder(attrs, name)
    }
  }
}

function visit(node: AnyNode, byType: Map<string, Record<string, string>>): void {
  const defaults = byType.get((node as { type: string }).type)
  if (defaults) applyDefaults(node, defaults)

  // Recurse into every child container the AST exposes.
  const block = node as BlockNode & { children?: AnyNode[] }
  const inline = node as InlineNode & { children?: AnyNode[]; content?: InlineNode[] }
  if (Array.isArray((node as { children?: AnyNode[] }).children)) {
    for (const c of (node as { children: AnyNode[] }).children) visit(c, byType)
  }
  if (Array.isArray((inline as { content?: InlineNode[] }).content)) {
    for (const c of (inline as { content: InlineNode[] }).content) visit(c, byType)
  }
  switch ((node as { type: string }).type) {
    case 'list':
      for (const it of (block as unknown as { items: { children: AnyNode[] }[] }).items)
        for (const c of it.children) visit(c, byType)
      break
    case 'definition-list':
      for (const it of (block as unknown as {
        items: { terms: InlineNode[][]; definitions: BlockNode[][] }[]
      }).items) {
        for (const t of it.terms) for (const c of t) visit(c, byType)
        for (const d of it.definitions) for (const c of d) visit(c, byType)
      }
      break
    case 'table':
      // Visiting each cell applies cell defaults and recurses into the cell's
      // inline children via the generic `children` walk above - no second pass.
      for (const row of (block as unknown as { rows: { cells: AnyNode[] }[] }).rows)
        for (const cell of row.cells) visit(cell, byType)
      break
    case 'figure':
      visit((block as unknown as { target: AnyNode }).target, byType)
      break
    case 'blockquote': {
      const attribution = (block as unknown as { attribution?: InlineNode[] }).attribution
      if (attribution) for (const c of attribution) visit(c, byType)
      break
    }
    default:
      break
  }
}

/**
 * Apply configured default attributes to nodes by type, ported from carve-php's
 * DefaultAttributesExtension. Useful for adding CSS classes, lazy-loading, etc.
 *
 * A `beforeRender` transform. A `class` default is merged with any existing
 * classes; any other attribute is only set when the node does not already
 * carry it. Element types use carve-php's snake_case names (e.g. `code_block`,
 * `block_quote`); the carve-js AST equivalents are bridged via {@link TYPE_MAP}.
 *
 * Coverage matches carve-php's actual behavior: the sub-structural types
 * `list_item`, `table_cell`, and `table_row` are NOT targetable (carve-php does
 * not apply defaults to them either), and a `div` default also covers
 * admonitions. An unknown type key is a no-op.
 *
 * ```ts
 * carveToHtml('![x](a.jpg)', {
 *   extensions: [defaultAttributes({ defaults: { image: { loading: 'lazy' } } })],
 * })
 * // <img src="a.jpg" alt="x" loading="lazy">
 * ```
 */
export function defaultAttributes(opts: DefaultAttributesOptions = {}): CarveExtension {
  const defaults = opts.defaults ?? {}
  const byType = new Map<string, Record<string, string>>()
  for (const [phpType, attrs] of Object.entries(defaults)) {
    const jsTypes = TYPE_MAP[phpType]
    if (!jsTypes) continue // Unknown / non-applicable type (e.g. list_item).
    for (const jsType of jsTypes) byType.set(jsType, attrs)
  }
  return {
    name: 'default-attributes',
    beforeRender(doc: Document): Document {
      if (byType.size === 0) return doc
      for (const c of doc.children) visit(c, byType)
      return doc
    },
  }
}
