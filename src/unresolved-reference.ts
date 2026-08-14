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
 * The predicate lives here because more than one pass asks it. Both resolution
 * seams and every render target had it written out by hand, and PART 9R R2
 * added a sixth caller with a different consequence - a note inside text that
 * is discarded is not a reference - so the condition is stated once rather than
 * kept in step by hand. It has already moved once (carve#596), which is the
 * kind of change six copies survive unevenly.
 *
 * Two arms stay spelled out: the plain-text and terminal writers take the
 * STRUCTURAL image shape rather than an `Image` node, so they carry no `type`
 * for this to key on.
 */

import type { Image, InlineNode, Link } from './ast.js'

/**
 * True when `node` is a reference link/image that matched no definition.
 *
 * Narrowing, because the callers that go on to READ the label need `ref` to be
 * a string: an unresolved reference is exactly one that has a label, so the
 * predicate can say so rather than leave every call site to re-test it.
 */
export function isUnresolvedReference(node: InlineNode): node is (Link | Image) & { ref: string } {
  if (node.type === 'link') return node.ref !== undefined && !node.href
  if (node.type === 'image') return node.ref !== undefined && !node.src
  return false
}
