// `carve flatten`: one Carve file with every include expanded in place. An engine command, outside the
// specification (C2-T-003); C2-N-005 keeps `fmt` from expanding, so this is the command that does.
import { type DocumentNode, render, write } from '../src/index.ts'
import { type Node } from '../src/ast.ts'

/** The children of each expanded include in its place, recursively; included frontmatter renders nothing and goes. */
function spliced(nodes: readonly Node[]): Node[] {
  const result: Node[] = []
  for (const node of nodes) {
    if (node.type === 'include') {
      const children = (node as { children?: Node[] }).children ?? []
      result.push(...spliced(children.filter((child) => child.type !== 'frontmatter')))
    } else result.push(withSplicedSlots(node))
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
