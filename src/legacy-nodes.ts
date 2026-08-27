import type { Document, InlineNode } from './ast.js'
import { ownValue, setOwn } from './own-property.js'

/**
 * Rewrite node types this engine no longer emits but may still be handed.
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
    const def = child as unknown as { label?: string; children?: unknown[] }
    // `label` is the PART 12 §7 spelling, and it is the ONLY one read.
    //
    // `id` - the spelling this engine and carve-php published before §7 settled
    // it - used to be accepted here as well as at decode. The decoder now
    // refuses it (markup-carve/carve-js#907, markup-carve/carve#743), and this
    // reader goes with it so the engine gives ONE answer about the field rather
    // than refusing a payload it would have rendered had the caller decoded it
    // themselves. A definition carrying only `id` has no label, so it is dropped
    // by the check below like any other malformed definition, and its reference
    // renders unresolved - which is what a missing definition already means.
    const label = def.label
    // A definition BODY has to be a list of blocks. Adopting anything else puts
    // it where the renderers iterate a body without checking, so a corrupted
    // tree crashed inside the HTML renderer for a document that had already
    // been accepted.
    //
    // Such a node is DROPPED rather than left in `children`: `footnote` is a
    // definition, which renders where its reference appears and never in place,
    // so no renderer has a case for it - leaving it in trades one crash for
    // another ("unknown block footnote"). A reference to it then renders as an
    // unresolved reference, which is what a missing definition already means.
    if (label === undefined || !Array.isArray(def.children)) return false
    // An existing entry wins: the map is this engine's own representation, so a
    // tree carrying both is one it produced and then had nodes added to.
    // OWN-PROPERTY READ AND WRITE: `defs['toString']` answers from
    // `Object.prototype`, so a definition labelled after a prototype key looked
    // like the existing entry that wins here and was dropped, and plain
    // assignment to `__proto__` would not have stored it (carve-js#886).
    if (ownValue(defs, label) === undefined) setOwn(defs, label, def.children)

    return false
  })

  return { ...ast, children, footnoteDefs: defs } as Document
}
