// The parts of one-line blocks that the block pass does not read: the title of an opener, the
// fields of a link definition and of an include directive.
import { type IncludeNode, type Inline, type LinkReferenceDefinitionNode } from './ast.ts'
import { contentNodes, FLOW_PLAIN, type TreeContext } from './ast-inline.ts'
import { unescape } from './attributes.ts'
import { APOSTROPHE, QUOTE_MARK } from './chars.ts'
import { readInclude } from './include.ts'
import { definitionDestinationEnd, quotedEnd, skipSpaces } from './lines.ts'

/** The quoted title of a code fence, without its escapes (C2-B-120). */
export function openerTitle(src: string, start: number, end: number): string {
  return unescape(src, start, end)
}

/** The inline content of `[start, end)`, one line of the source: the title of a div, an admonition or a directive. */
export function captionChildren(ctx: TreeContext, start: number, end: number): Inline[] {
  // C2-B-190, C2-I-118: the title counts the blocks around it and the div itself.
  return contentNodes(ctx, [start, end], 0, 2, false, FLOW_PLAIN)
}

/** C2-B-083: the link definition of `key`, with the destination and the optional quoted title behind its colon. */
export function linkDefinitionFields(src: string, pos: number, end: number, key: string): LinkReferenceDefinitionNode {
  const start = skipSpaces(src, pos, end)
  const p = definitionDestinationEnd(src, start, end)
  const out: LinkReferenceDefinitionNode = { type: 'link_reference_definition', key, namespace: 'link', href: src.slice(start, p) }
  const quote = p + 1 < end ? src.charCodeAt(p + 1) : 0
  if (quote !== QUOTE_MARK && quote !== APOSTROPHE) return out
  const after = quotedEnd(src, p + 1, end, quote)
  if (after >= 0) out.title = unescape(src, p + 2, after - 1)
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
