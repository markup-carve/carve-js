// Block structure of a document as djot.js reads it, in a notation shared with the 0.2 block
// tree, for the constructs whose rules the two languages share. Leaf text is left out.
import { parse } from '@djot/djot'
import {
  type BlockNode, BULLET_LIST, CODE, DOCUMENT, FLAG_STAR, FLAG_TIGHT, ITEM, PARAGRAPH, parseBlockTree, QUOTE,
  THEMATIC_BREAK,
} from '../../src/index.ts'

interface DjotNode {
  tag: string
  children?: DjotNode[]
  style?: string
  tight?: boolean
}

export function djotStructure(src: string): string {
  return djotChildren(parse(src) as DjotNode)
}

function djotChildren(node: DjotNode): string {
  return (node.children ?? []).map(djotShape).join(' ')
}

function djotShape(node: DjotNode): string {
  switch (node.tag) {
    case 'para': return 'p'
    case 'code_block': return 'code'
    case 'thematic_break': return 'hr'
    case 'block_quote': return `quote[${djotChildren(node)}]`
    case 'bullet_list': return `ul(${node.style ?? '?'}${node.tight === true ? '' : ',loose'})[${djotChildren(node)}]`
    case 'list_item': return `li[${djotChildren(node)}]`
    default: return `?${node.tag}`
  }
}

export function carveStructure(src: string): string {
  return carveShape(parseBlockTree(src))
}

function carveShape(node: BlockNode): string {
  const children = node.children === null ? '' : node.children.map(carveShape).join(' ')
  switch (node.kind) {
    case DOCUMENT: return children
    case PARAGRAPH: return 'p'
    case CODE: return 'code'
    case THEMATIC_BREAK: return 'hr'
    case QUOTE: return `quote[${children}]`
    case BULLET_LIST: {
      const loose = (node.exitFlags & FLAG_TIGHT) !== 0 ? '' : ',loose'
      return `ul(${(node.flags & FLAG_STAR) !== 0 ? '*' : '-'}${loose})[${children}]`
    }
    case ITEM: return `li[${children}]`
    default: return `?${node.kind}`
  }
}
