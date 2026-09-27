import type { BlockNode, Paragraph } from '../../src/ast.js'

export function paragraph(node: BlockNode | undefined): Paragraph {
  if (node?.type !== 'paragraph') throw new Error(`Expected paragraph, found ${node?.type}`)
  return node
}
