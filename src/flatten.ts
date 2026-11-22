// `flatten` and `carve flatten`: one Carve file with every include expanded in place. An engine feature, outside the
// specification (C2-T-003); C2-N-005 keeps `fmt` from expanding, so this is the call that does.
import { render } from './api.ts'
import { type DocumentNode, type Node } from './ast.ts'
import { write } from './write.ts'

/**
 * The children of each expanded include in its place, recursively; only its line-1 frontmatter goes.
 * An include that did not expand has no `children` and stays, so it is written as its directive.
 */
function spliced(nodes: readonly Node[]): Node[] {
  const result: Node[] = []
  for (const node of nodes) {
    const children = node.type === 'include' ? node.children : undefined
    if (children !== undefined) result.push(...spliced(children.filter((child) =>
      child.type !== 'frontmatter' || child.pos?.startLine !== 1)))
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
