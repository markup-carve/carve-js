import { forEachSlot, type Node } from '../../src/ast.ts'

/** Visits every node of a render view, each node before its children; `edit` may replace items in place. */
export function walkView(node: Node, edit: (nodes: Node[]) => void, declarations: Parameters<typeof forEachSlot>[3] = []): void {
  forEachSlot(node, (nodes, step) => {
    if (step === 'fallback') return
    const list = nodes as Node[]
    edit(list)
    for (const child of list) walkView(child, edit, declarations)
  }, undefined, declarations)
}
