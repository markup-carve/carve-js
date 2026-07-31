import type { InlineNode } from './ast.js'

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
