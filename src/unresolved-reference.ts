/*
 * One spelling of "this reference never resolved" (PART 9R R1).
 *
 * A reference link or reference image whose label matched no definition
 * degrades to its literal SOURCE: every render target writes the node back out
 * as the author typed it, and the link text that was built for it is discarded
 * rather than written into the document.
 *
 * UNRESOLVED means no destination, not "carries a ref": PART 12 §3a keeps
 * `ref` and `rawRef` on a RESOLVED reference too, so the presence of a ref does
 * not answer the question (carve#596).
 *
 * The predicate lives here because more than the renderers ask it. The
 * footnote-numbering pass has to ask the same question - a note inside text
 * that is discarded is not a reference (PART 9R R2) - and two hand-kept copies
 * of the condition would be free to drift.
 */

import type { InlineNode } from './ast.js'

/** True when `node` is a reference link/image that matched no definition. */
export function isUnresolvedReference(node: InlineNode): boolean {
  if (node.type === 'link') return node.ref !== undefined && !node.href
  if (node.type === 'image') return node.ref !== undefined && !node.src
  return false
}
