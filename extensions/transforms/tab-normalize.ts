import type { ExtensionBundle } from '../../src/extensions/standard/bundle.ts'
import type { DocumentTransform } from '../../src/api.ts'
import type { DocumentNode } from '../../src/ast.ts'
import { walkView } from './view.ts'

/** Replaces each tab in code blocks and code spans with `width` spaces in the render view. */
export function tabNormalize(width = 2): ExtensionBundle {
  if (!Number.isInteger(width) || width < 0 || width > 16) throw new RangeError('tab width must be an integer from 0 to 16')
  const spaces = ' '.repeat(width)
  const transform: DocumentTransform = { name: 'carve.tabNormalize', transform(view: DocumentNode) {
    walkView(view, (nodes) => {
      for (const node of nodes) if (node.type === 'code_block' || node.type === 'code') node.value = node.value.replaceAll('\t', spaces)
    }, view.extensions)
    return view
  } }
  return { extensions: [], renderers: {}, transforms: [transform] }
}
