import type { InlineNode } from '../../ast.js'
import { inlineText } from '../../heading/heading-ids.js'

export function djotReferenceText(nodes: InlineNode[]): string {
  const parts: string[] = []
  const pending = [...nodes].reverse()
  while (pending.length) {
    const node = pending.pop()!
    if (node.type === 'non_breaking_space' || node.type === 'footnote_ref') continue
    if (node.type === 'soft_break' || node.type === 'hard_break') { parts.push('\n'); continue }
    if (node.type === 'raw_inline') { parts.push(node.content); continue }
    if ('children' in node) {
      for (let at = node.children.length - 1; at >= 0; at--) pending.push(node.children[at]!)
    } else parts.push(inlineText([node], false))
  }
  return parts.join('')
}
