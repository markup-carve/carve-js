import type { BlockNode, Document, Image, Link } from '../../ast.js'
import { isResolvedEmptyReference } from './reference-state.js'
import { normalizeRefLabel } from '../../label-key.js'
import { ownedChildFields } from '../../ast/owned-child-fields.js'

/** Resolved links and images use their definition even when it precedes them. */
export function referencedLinkLabels(ast: Document): ReadonlySet<string> {
  const labels = new Set<string>()
  const stack: unknown[] = [ast.children, ...Object.values(ast.footnoteDefs ?? {})]
  const visited = new WeakSet<object>()
  while (stack.length > 0) {
    const value = stack.pop()
    if (value === null || typeof value !== 'object' || visited.has(value)) continue
    visited.add(value)
    if (Array.isArray(value)) {
      for (const child of value) stack.push(child)
      continue
    }
    const node = value as Record<string, unknown>
    if ((node.type === 'link' && (node.href || isResolvedEmptyReference(node as unknown as Link)) || node.type === 'image' && (node.src || isResolvedEmptyReference(node as unknown as Image))) && typeof node.ref === 'string') {
      labels.add(normalizeRefLabel(node.ref))
    }
    for (const field of ownedChildFields(node)) stack.push(node[field])
  }
  return labels
}

/** Merge hoisted definition nodes into the root blocks by their source position. */
export function blocksWithLinkDefinitionsInSourceOrder(ast: Document): BlockNode[] {
  const definitions = ast.children.filter(node => node.type === 'link_reference_definition')
  if (definitions.length === 0) return ast.children
  const blocks: BlockNode[] = ast.children.filter(node => node.type !== 'link_reference_definition')
  // The parser appends definitions sorted by offset; root blocks retain source order.
  const positioned = definitions.filter(node => node.pos?.startOffset !== undefined)
  const unpositioned = definitions.filter(node => node.pos?.startOffset === undefined)
  const merged: BlockNode[] = []
  let next = 0
  for (const block of blocks) {
    const offset = block.pos?.startOffset
    while (offset !== undefined && next < positioned.length
      && positioned[next]!.pos!.startOffset! < offset) {
      merged.push(positioned[next++]!)
    }
    merged.push(block)
  }
  merged.push(...positioned.slice(next), ...unpositioned)
  return merged
}
