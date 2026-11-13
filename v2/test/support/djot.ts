// Block structure of a document as djot.js reads it, in a notation shared with the 0.2 block
// tree, for the constructs whose rules the two languages share. Leaf text is left out.
import { parse } from '@djot/djot'
import {
  type BlockNode, BULLET_LIST, CODE, CODE_SPAN, DOCUMENT, FLAG_STAR, FLAG_TIGHT, type InlineNode, ITEM, LINK, PARAGRAPH,
  parseBlockTree, parseTree, QUOTE, STRONG, TEXT, THEMATIC_BREAK,
} from '../../src/index.ts'

interface DjotNode {
  tag: string
  children?: DjotNode[]
  style?: string
  tight?: boolean
  text?: string
  destination?: string
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

// Inline structure of a document that is one paragraph, in a notation shared by the two
// engines, for the constructs whose rules the two languages share: strong, code spans and links.
//   "text"  strong[...]  code"x"  a(u)[...]  ref[...] for a reference, whatever its label
// A text run starts with T until `joinRuns` merges it with its neighbors. Null when the document is not one paragraph.
function joinRuns(parts: string[]): string {
  const out: string[] = []
  let text: string | null = null
  for (const part of parts) {
    if (part.startsWith('T')) {
      text = (text ?? '') + part.slice(1)
      continue
    }
    if (text !== null) out.push(JSON.stringify(text))
    text = null
    out.push(part)
  }
  if (text !== null) out.push(JSON.stringify(text))
  return out.join(' ')
}

function djotInlineShape(node: DjotNode): string {
  const children = joinRuns((node.children ?? []).map(djotInlineShape))
  switch (node.tag) {
    case 'str': return `T${node.text ?? ''}`
    case 'strong': return `strong[${children}]`
    case 'verbatim': return `code"${node.text ?? ''}"`
    case 'link': return node.destination === undefined ? `ref[${children}]` : `a(${node.destination})[${children}]`
    default: return `?${node.tag}`
  }
}

export function djotInline(src: string): string | null {
  const blocks = (parse(src) as DjotNode).children ?? []
  return blocks.length === 1 && blocks[0]!.tag === 'para' ? joinRuns((blocks[0]!.children ?? []).map(djotInlineShape)) : null
}

function carveInlineShape(node: InlineNode): string {
  const children = node.children === null ? '' : joinRuns(node.children.map(carveInlineShape))
  switch (node.kind) {
    case TEXT: return `T${node.value ?? ''}`
    case STRONG: return `strong[${children}]`
    case CODE_SPAN: return `code"${node.value ?? ''}"`
    case LINK: return node.destination === null ? `ref[${children}]` : `a(${node.destination})[${children}]`
    default: return `?${node.kind}`
  }
}

export function carveInline(src: string): string | null {
  const blocks = parseTree(src).children!
  return blocks.length === 1 && blocks[0]!.inlines !== null ? joinRuns(blocks[0]!.inlines.map(carveInlineShape)) : null
}
