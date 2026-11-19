import type { ExtensionBundle } from '../../src/extensions/standard/bundle.ts'
import type { DocumentTransform } from '../../src/api.ts'
import type { DocumentNode, Node } from '../../src/ast.ts'
import { walkView } from './view.ts'

/** Writes each inline footnote as its content in parentheses after a space, for targets without notes. */
export function inlineFootnotesToParentheses(): ExtensionBundle {
  const transform: DocumentTransform = { name: 'carve.inlineFootnotesToParentheses', transform(view: DocumentNode) {
    walkView(view, (nodes) => {
      for (let at = 0; at < nodes.length; at++) {
        const node = nodes[at]
        if (node?.type !== 'inline_footnote') continue
        const replacement: Node[] = [{ type: 'text', value: ' (' }, ...node.children, { type: 'text', value: ')' }]
        nodes.splice(at, 1, ...replacement)
        at += replacement.length - 1
      }
    }, view.extensions)
    return view
  } }
  return { extensions: [], renderers: {}, transforms: [transform] }
}
