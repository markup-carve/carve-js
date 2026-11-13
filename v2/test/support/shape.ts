// A one-line picture of a block tree, for tests:
//   p"a|b"  h2"T"  code"x"  hr  %"%% c"  quote[...]  ul(-)[li[...]]  ul(*,task,loose)[li(x)[...]]
//   ol(3.)[...]  ol(.)[...] for a bare first marker, ol(2))[...] for the paren delimiter.
// Spans of a leaf are joined by `|`.
import {
  type BlockNode, BULLET_LIST, CODE, COMMENT, DOCUMENT, FLAG_AUTO, FLAG_PAREN, FLAG_STAR, FLAG_TASK, HEADING, ITEM,
  ORDERED_LIST, PARAGRAPH, parseBlockTree, QUOTE,
} from '../../src/index.ts'

export function shape(src: string): string {
  return shapeOf(src, parseBlockTree(src))
}

export function shapeOf(src: string, node: BlockNode): string {
  switch (node.kind) {
    case DOCUMENT:
      return childShapes(src, node)
    case QUOTE:
      return `quote[${childShapes(src, node)}]`
    case BULLET_LIST: {
      const parts = [(node.flags & FLAG_STAR) !== 0 ? '*' : '-']
      if ((node.flags & FLAG_TASK) !== 0) parts.push('task')
      if (!node.tight) parts.push('loose')
      return `ul(${parts.join(',')})[${childShapes(src, node)}]`
    }
    case ORDERED_LIST: {
      const start = (node.flags & FLAG_AUTO) !== 0 ? '' : String(node.aux)
      const delimiter = (node.flags & FLAG_PAREN) !== 0 ? ')' : '.'
      return `ol(${start}${delimiter}${node.tight ? '' : ',loose'})[${childShapes(src, node)}]`
    }
    case ITEM:
      return `li${node.aux === 0 ? '' : `(${String.fromCharCode(node.aux)})`}[${childShapes(src, node)}]`
    case PARAGRAPH:
      return `p"${text(src, node)}"`
    case HEADING:
      return `h${node.aux}"${text(src, node)}"`
    case CODE:
      return `code"${text(src, node)}"`
    case COMMENT:
      return `%"${text(src, node)}"`
    default:
      return 'hr'
  }
}

function childShapes(src: string, node: BlockNode): string {
  return node.children!.map((child) => shapeOf(src, child)).join(' ')
}

function text(src: string, node: BlockNode): string {
  const spans = node.spans!
  const lines: string[] = []
  for (let at = 0; at < spans.length; at += 2) lines.push(src.slice(spans[at], spans[at + 1]))
  return lines.join('|')
}
