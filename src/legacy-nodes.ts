import type { Document, InlineNode } from './ast.js'

/**
 * Rewrite node types this engine no longer emits but may still be handed.
 *
 * A serialized AST outlives the version that produced it: it is stored in
 * databases, checked into repositories, and passed between tools. carve-js
 * 0.1.2 published `footnote` for both `[^a]` and `^[…]`, and the split into
 * `footnote_ref` / `inline_footnote` (carve#405) made every one of those trees
 * unrenderable - the renderers threw `unknown inline footnote` rather than
 * degrading.
 *
 * That is a worse break than a consumer switching on the type string, because
 * the consumer is code someone can update and the tree is data someone already
 * has. It also lands on a producer that CANNOT satisfy both spellings at once:
 * pandoc-carve builds a Carve tree for an engine to render, and a type is a
 * single string, so without this it must be released in lockstep or emit
 * something one side rejects.
 *
 * So the legacy name is accepted on INPUT and mapped to whichever split type
 * the node's own shape identifies. It is never produced: `parse` emits only the
 * new types, and this is not a second spelling for authors.
 *
 * Removal trigger: 1.0, where a stored-content compatibility promise gets
 * stated deliberately rather than inherited.
 */
export function normalizeLegacyInline(node: InlineNode): InlineNode {
  if ((node as { type: string }).type !== 'footnote') return node

  // The split encodes in the type what 0.1.2 encoded in the shape: a body means
  // the note was written inline, a label means it points at a definition.
  const legacy = node as unknown as { inline?: unknown }

  return {
    ...(node as object),
    type: Array.isArray(legacy.inline) ? 'inline_footnote' : 'footnote_ref',
  } as InlineNode
}

/**
 * Move block `footnote` definition nodes into the document's `footnoteDefs` map.
 *
 * `footnote` is a BLOCK type in the spec vocabulary, and carve-php puts a
 * definition in the tree as one. This engine keeps definitions in a root-level
 * map instead, so a carve-php tree threw `unknown block footnote` and could not
 * be rendered at all - the other half of the interop break in carve#408, whose
 * first half is that engine refusing this one's map.
 *
 * Which representation is canonical is still open. This is not that decision:
 * it accepts the node form and normalizes to the map this engine already uses,
 * so the exchange PART 12 exists for works either way.
 *
 * A definition's POSITION carries no meaning - both engines render footnotes at
 * the end regardless of where they were written - so hoisting one out of
 * `children` loses nothing.
 */
export function adoptBlockFootnoteDefs(ast: Document): Document {
  const isDef = (n: { type?: string }): boolean => n.type === 'footnote'
  if (!ast.children?.some(isDef)) return ast

  const defs: Record<string, unknown> = { ...(ast.footnoteDefs ?? {}) }
  const children = ast.children.filter((child) => {
    if (!isDef(child)) return true
    const def = child as unknown as { label?: string; id?: string; children?: unknown[] }
    // `label` is the PART 12 §7 spelling; `id` is what this engine and carve-php
    // published before it, and those trees are stored where they cannot be
    // recalled. Accepting both on INPUT is the same concession the legacy
    // `footnote` inline type gets above; only `label` is ever produced.
    const label = def.label ?? def.id
    // An existing entry wins: the map is this engine's own representation, so a
    // tree carrying both is one it produced and then had nodes added to.
    if (label !== undefined && defs[label] === undefined) defs[label] = def.children ?? []

    return false
  })

  return { ...ast, children, footnoteDefs: defs } as Document
}
