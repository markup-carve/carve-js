import type { InlineNode } from './ast.js'
import { inlineText } from './heading-ids.js'

export function djotReferenceText(nodes: InlineNode[]): string {
  const parts: string[] = []
  const pending = [...nodes].reverse()
  while (pending.length) {
    const node = pending.pop()!
    if (node.type === 'non_breaking_space') continue
    if ('children' in node) {
      for (let at = node.children.length - 1; at >= 0; at--) pending.push(node.children[at]!)
    } else parts.push(inlineText([node], false))
  }
  return parts.join('')
}
