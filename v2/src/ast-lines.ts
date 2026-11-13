// The parts of one-line blocks that the block pass does not read: the title of an opener, the
// fields of a link definition and of an include directive.
import { type AstNode } from './ast.ts'
import { FLOW_PLAIN, inlineNodes, type TreeContext } from './ast-inline.ts'
import { unescape } from './attributes.ts'
import { scanInline } from './inline-scan.ts'
import { acquireInlineState, releaseInlineState } from './inline-state.ts'
import { buildInlineTree } from './inline-tree.ts'
import { readInclude } from './include.ts'
import { quotedEnd, skipSpaces } from './lines.ts'
import { isSpaceOrTab } from './source.ts'

/** The quoted title of a code fence, without its escapes (C2-B-120). */
export function openerTitle(src: string, start: number, end: number): string {
  return unescape(src, start, end)
}

/** The inline content of `[start, end)`, one line of the source: the title of a div, an admonition or a directive. */
export function captionChildren(ctx: TreeContext, start: number, end: number): AstNode[] {
  const state = acquireInlineState()
  try {
    scanInline(state, ctx.src, [start, end], 0, 2, 0, false)
    const nodes = buildInlineTree(ctx.src, state.events, state.eventLength, (from, to) => ctx.src.slice(from, to))
    return inlineNodes(ctx, nodes, FLOW_PLAIN)
  } finally {
    releaseInlineState(state)
  }
}

/** C2-B-083: the destination and the optional quoted title behind the colon of a link definition. */
export function linkDefinitionFields(src: string, pos: number, end: number, out: AstNode): void {
  let p = skipSpaces(src, pos, end)
  const start = p
  while (p < end && !isSpaceOrTab(src.charCodeAt(p)) && src[p] !== '"') p++
  out.href = src.slice(start, p)
  p = skipSpaces(src, p, end)
  if (p >= end || src[p] !== '"') return
  const after = quotedEnd(src, p, end)
  if (after >= 0) out.title = unescape(src, p + 1, after - 1)
}

/** C2-A-181: the node of the include directive on the line `[start, end)`, which the block pass found to be one. */
export function includeNode(src: string, start: number, end: number): AstNode {
  const parts = readInclude(src, start, end)!
  const out: AstNode = { type: 'include', path: parts.path }
  if (parts.section !== null) out.section = parts.section
  if (parts.options.length > 0) out.options = parts.options
  return out
}
