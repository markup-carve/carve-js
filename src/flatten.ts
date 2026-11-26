// `flatten` and `carve flatten`: one Carve file with every include expanded in place. An engine feature, outside the
// specification (C2-T-003); C2-N-005 keeps `fmt` from expanding, so this is the call that does.
import { pushAll } from './arrays.ts'
import { render } from './api.ts'
import { type DocumentNode, type IncludeNode, type Node } from './ast.ts'
import { write } from './write.ts'
import { leadingIncludedFrontmatter } from './frontmatter-origin.ts'

/**
 * The children of each expanded include in its place, recursively; only its line-1 frontmatter goes.
 * An include that did not expand has no `children` and stays, so it is written as its directive.
 */
function includedBody(node: IncludeNode): readonly Node[] {
  const children = node.children ?? []
  const first = children[0]
  if (first?.type !== 'frontmatter') return children
  // The parser records line-1 provenance even when the public tree omits positions.
  const leading = first.pos?.startLine === 1 || leadingIncludedFrontmatter.has(first)
  return leading ? children.slice(1) : children
}

function spliced(nodes: readonly Node[]): Node[] {
  const result: Node[] = []
  for (const node of nodes) {
    if (node.type === 'include' && node.children !== undefined) pushAll(result, spliced(includedBody(node)))
    else result.push(withSplicedSlots(node))
  }
  return result
}

function withSplicedSlots(node: Node): Node {
  const record = node as unknown as Record<string, unknown>
  let copy: Record<string, unknown> | undefined
  for (const [key, value] of Object.entries(record)) {
    if (!Array.isArray(value) || !value.some((item) => typeof item === 'object' && item !== null && 'type' in item)) continue
    copy ??= { ...record }
    copy[key] = spliced(value as Node[])
  }
  return (copy ?? record) as unknown as Node
}

export interface Flattened {
  source: string
  /** The flattened source renders as the expanded tree does. */
  same: boolean
}

/**
 * The expanded tree written as one file. Keys that two files define each once are scoped per file
 * (C2-N-054, C2-N-055) and meet in one scope here, so the caller learns whether the render held.
 */
export function flatten(document: DocumentNode): Flattened {
  const tree = { ...document, children: spliced(document.children) } as DocumentNode
  delete (tree as { stages?: unknown }).stages
  const source = write(tree)
  return { source, same: render(source) === render(document) }
}
