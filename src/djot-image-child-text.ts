import type { BlockNode, Document, InlineNode } from './ast.js'
import { forEachChildBlockList } from './block-children.js'
import { visitInlineChildren } from './inline-children.js'
import { renderPlainText } from './render-plain.js'

export function renderDjotImageChildText(document: Document, preserveBreaks = false): string {
  const blocks: BlockNode[] = []
  for (const block of document.children) blocks.push(block)
  while (blocks.length) {
    const block = blocks.pop()!
    forEachChildBlockList(block, children => {
      for (const child of children) blocks.push(child)
    })
    if (block.type !== 'paragraph') continue
    const lists: InlineNode[][] = [block.children]
    while (lists.length) {
      const children = lists.pop()!
      for (let index = 0; index < children.length; index++) {
        const child = children[index]!
        if (child.type === 'link' && !child.href || child.type === 'image' && !child.src) {
          delete child.ref
          delete child.rawRef
        }
        if (preserveBreaks && child.type === 'soft_break') children[index] = { type: 'hard_break' }
        else visitInlineChildren(child, nested => { lists.push(nested) }, undefined)
      }
    }
  }
  return renderPlainText(document, { smartTypography: false })
}
