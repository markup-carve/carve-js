// The parts of one-line blocks that the block pass does not read: the title of an opener, the
// fields of a link definition and of an include directive.
import { type IncludeNode, type Inline, type LinkReferenceDefinitionNode } from './ast.ts'
import { contentNodes, FLOW_PLAIN, type TreeContext } from './ast-inline.ts'
import { unescape } from './attributes.ts'
import { readInclude } from './include.ts'
import { quotedEnd, skipSpaces } from './lines.ts'
import { isSpaceOrTab } from './source.ts'

/** The quoted title of a code fence, without its escapes (C2-B-120). */
export function openerTitle(src: string, start: number, end: number): string {
  return unescape(src, start, end)
}

/** The inline content of `[start, end)`, one line of the source: the title of a div, an admonition or a directive. */
export function captionChildren(ctx: TreeContext, start: number, end: number): Inline[] {
  // The title is read at depth 0, whatever blocks are open around it.
  const depth = ctx.depth
  ctx.depth = 0
  const nodes = contentNodes(ctx, [start, end], 0, 2, false, FLOW_PLAIN)
  ctx.depth = depth
  return nodes
}

/** C2-B-083: the link definition of `key`, with the destination and the optional quoted title behind its colon. */
export function linkDefinitionFields(src: string, pos: number, end: number, key: string): LinkReferenceDefinitionNode {
  let p = skipSpaces(src, pos, end)
  const start = p
  while (p < end && !isSpaceOrTab(src.charCodeAt(p)) && src[p] !== '"') p++
  const out: LinkReferenceDefinitionNode = { type: 'link_reference_definition', key, namespace: 'link', href: src.slice(start, p) }
  p = skipSpaces(src, p, end)
  if (p >= end || src[p] !== '"') return out
  const after = quotedEnd(src, p, end)
  if (after >= 0) out.title = unescape(src, p + 1, after - 1)
  return out
}

/** C2-A-181: the node of the include directive on the line `[start, end)`, which the block pass found to be one. */
export function includeNode(src: string, start: number, end: number): IncludeNode {
  const parts = readInclude(src, start, end)!
  const out: IncludeNode = { type: 'include', path: parts.path }
  if (parts.section !== null) out.section = parts.section
  if (parts.options.length > 0) out.options = parts.options
  return out
}
