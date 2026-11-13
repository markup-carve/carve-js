// A one-line picture of a block tree, for tests. Spans of a leaf are joined by `|`.
//   p"a|b"  img"![a](b)"  h2"T"  code"x"  hr  %"%% c"  quote[...]
//   ul(-)[li[...]]  ul(*,task,loose)[li(x)[...]]  li{}[...] for an item with attributes on its marker
//   ol(3.)[...]  ol(.)[...] for a bare first marker, ol(2))[...], ol(a8.)  ol(I4))  for letters and roman
//   dl[dt"t" dd[...]]  fn[...]  def"[a]: /u"  abbr"*[a]: b"  inc"{{ x }}"  cap"c"
//   div[...]  div(\)[...]  div(>)[...]  div(figure)[...]  lines"a|b"  %%%"x"  fm"a: b"
//   A leaf that ended without its closer has `!` before its text, as in code!"x".
//   {.a|.b}p"x" is a block that took two attribute lines.
import {
  ABBREVIATION, type BlockNode, BULLET_LIST, CAPTION, CODE, COMMENT, COMMENT_BLOCK, DESCRIPTION,
  DESCRIPTION_LIST, DIV, DOCUMENT, FLAG_ALPHA, FLAG_AUTO, FLAG_FIGURE, FLAG_HARD_BREAKS, FLAG_IMAGE,
  FLAG_MARKER_ATTRIBUTES, FLAG_PAREN, FLAG_QUOTE_FENCE, FLAG_ROMAN, FLAG_STAR, FLAG_TASK, FLAG_TIGHT,
  FLAG_UNCLOSED, FLAG_UPPER, FOOTNOTE, FRONTMATTER, HEADING, INCLUDE, ITEM, LINE_BLOCK, LINK_DEFINITION,
  ORDERED_LIST, PARAGRAPH, parseBlockTree, QUOTE, TERM, THEMATIC_BREAK,
} from '../../src/index.ts'

export function shape(src: string): string {
  return shapeOf(src, parseBlockTree(src))
}

export function shapeOf(src: string, node: BlockNode): string {
  const attributes = node.attributes === null ? '' : `{${joinSpans(src, node.attributes).replaceAll(/[ \t]+(?=\||$)/g, '').slice(1, -1).replaceAll('}|{', '|')}}`
  return attributes + bare(src, node)
}

function bare(src: string, node: BlockNode): string {
  return node.children === null ? leafShape(src, node) : containerShape(node, childShapes(src, node))
}

function containerShape(node: BlockNode, children: string): string {
  switch (node.kind) {
    case DOCUMENT: return children
    case QUOTE: return `quote[${children}]`
    case BULLET_LIST: return `ul(${bulletStyle(node)})[${children}]`
    case ORDERED_LIST: return `ol(${orderedStyle(node)})[${children}]`
    case ITEM: {
      const box = node.aux === 0 ? '' : `(${String.fromCharCode(node.aux)})`
      return `li${box}${(node.flags & FLAG_MARKER_ATTRIBUTES) !== 0 ? '{}' : ''}[${children}]`
    }
    case DESCRIPTION_LIST: return `dl[${children}]`
    case DESCRIPTION: return `dd[${children}]`
    case FOOTNOTE: return `fn[${children}]`
    case DIV: return `div${divSigil(node.flags)}[${children}]`
    default: return `?${node.kind}[${children}]`
  }
}

function bulletStyle(node: BlockNode): string {
  const parts = [(node.flags & FLAG_STAR) !== 0 ? '*' : '-']
  if ((node.flags & FLAG_TASK) !== 0) parts.push('task')
  if ((node.exitFlags & FLAG_TIGHT) === 0) parts.push('loose')
  return parts.join(',')
}

function orderedStyle(node: BlockNode): string {
  const flags = node.flags
  let style = ''
  if ((flags & FLAG_ALPHA) !== 0) style = 'a'
  if ((flags & FLAG_ROMAN) !== 0) style = 'i'
  if ((flags & FLAG_UPPER) !== 0) style = style.toUpperCase()
  const start = (flags & FLAG_AUTO) !== 0 ? '' : String(node.aux)
  const delimiter = (flags & FLAG_PAREN) !== 0 ? ')' : '.'
  return `${style}${start}${delimiter}${(node.exitFlags & FLAG_TIGHT) === 0 ? ',loose' : ''}`
}

function divSigil(flags: number): string {
  if ((flags & FLAG_HARD_BREAKS) !== 0) return '(\\)'
  if ((flags & FLAG_QUOTE_FENCE) !== 0) return '(>)'
  return (flags & FLAG_FIGURE) !== 0 ? '(figure)' : ''
}

const LEAF_NAMES = new Map<number, string>([
  [TERM, 'dt'], [CAPTION, 'cap'], [CODE, 'code'], [COMMENT_BLOCK, '%%%'], [LINE_BLOCK, 'lines'],
  [FRONTMATTER, 'fm'], [COMMENT, '%'], [INCLUDE, 'inc'], [LINK_DEFINITION, 'def'], [ABBREVIATION, 'abbr'],
])

function leafShape(src: string, node: BlockNode): string {
  if (node.kind === THEMATIC_BREAK) return 'hr'
  let name = LEAF_NAMES.get(node.kind) ?? `?${node.kind}`
  if (node.kind === PARAGRAPH) name = (node.exitFlags & FLAG_IMAGE) !== 0 ? 'img' : 'p'
  if (node.kind === HEADING) name = `h${node.aux}`
  return `${name}${(node.exitFlags & FLAG_UNCLOSED) !== 0 ? '!' : ''}"${text(src, node)}"`
}

function childShapes(src: string, node: BlockNode): string {
  return node.children!.map((child) => shapeOf(src, child)).join(' ')
}

function text(src: string, node: BlockNode): string {
  return joinSpans(src, node.spans!)
}

function joinSpans(src: string, spans: number[]): string {
  const lines: string[] = []
  for (let at = 0; at < spans.length; at += 2) lines.push(src.slice(spans[at], spans[at + 1]))
  return lines.join('|')
}
