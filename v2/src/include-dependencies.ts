// The dependencies of a document (C2-N-083, C2-N-084): the include nodes of its tree in tree order.
import { type DocumentNode, forEachSlot, type Node } from './ast.ts'
import { append } from './append.ts'

/** One include node: its path as written, the id of its including file (absent for the top level), and its file if read. */
export interface IncludeDependency {
  path: string
  from?: string
  file?: string
  read: boolean
}

/** C2-N-083: the include nodes of `document` in tree order, each with its including file (C2-N-053). */
export function includeDependencies(document: DocumentNode): IncludeDependency[] {
  const found: IncludeDependency[] = []
  const pending: { node: Node, from: string | undefined }[] = [{ node: document, from: undefined }]
  for (let item = pending.pop(); item !== undefined; item = pending.pop()) {
    const { node, from } = item
    let inner = from
    if (node.type === 'include') {
      const entry: IncludeDependency = { path: node.path, read: node.file !== undefined }
      if (from !== undefined) entry.from = from
      if (node.file !== undefined) entry.file = node.file
      found.push(entry)
      inner = node.file
    }
    const below: Node[] = []
    forEachSlot(node, (nodes) => { append(below, nodes) }, undefined, document.extensions)
    for (let at = below.length - 1; at >= 0; at--) pending.push({ node: below[at]!, from: inner })
  }
  return found
}
