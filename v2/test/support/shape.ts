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
  const flags = node.flags
  const unclosed = (node.exitFlags & FLAG_UNCLOSED) !== 0 ? '!' : ''
  switch (node.kind) {
    case DOCUMENT: return childShapes(src, node)
    case QUOTE: return `quote[${childShapes(src, node)}]`
    case BULLET_LIST: {
      const parts = [(flags & FLAG_STAR) !== 0 ? '*' : '-']
      if ((flags & FLAG_TASK) !== 0) parts.push('task')
      if ((node.exitFlags & FLAG_TIGHT) === 0) parts.push('loose')
      return `ul(${parts.join(',')})[${childShapes(src, node)}]`
    }
    case ORDERED_LIST: {
      let style = ''
      if ((flags & FLAG_ALPHA) !== 0) style = 'a'
      if ((flags & FLAG_ROMAN) !== 0) style = 'i'
      if ((flags & FLAG_UPPER) !== 0) style = style.toUpperCase()
      const start = (flags & FLAG_AUTO) !== 0 ? '' : String(node.aux)
      const delimiter = (flags & FLAG_PAREN) !== 0 ? ')' : '.'
      const loose = (node.exitFlags & FLAG_TIGHT) === 0 ? ',loose' : ''
      return `ol(${style}${start}${delimiter}${loose})[${childShapes(src, node)}]`
    }
    case ITEM: {
      const box = node.aux === 0 ? '' : `(${String.fromCharCode(node.aux)})`
      return `li${box}${(flags & FLAG_MARKER_ATTRIBUTES) !== 0 ? '{}' : ''}[${childShapes(src, node)}]`
    }
    case DESCRIPTION_LIST: return `dl[${childShapes(src, node)}]`
    case DESCRIPTION: return `dd[${childShapes(src, node)}]`
    case FOOTNOTE: return `fn[${childShapes(src, node)}]`
    case DIV: {
      let sigil = ''
      if ((flags & FLAG_HARD_BREAKS) !== 0) sigil = '(\\)'
      if ((flags & FLAG_QUOTE_FENCE) !== 0) sigil = '(>)'
      if ((flags & FLAG_FIGURE) !== 0) sigil = '(figure)'
      return `div${sigil}[${childShapes(src, node)}]`
    }
    case PARAGRAPH: return `${(node.exitFlags & FLAG_IMAGE) !== 0 ? 'img' : 'p'}"${text(src, node)}"`
    case TERM: return `dt"${text(src, node)}"`
    case CAPTION: return `cap"${text(src, node)}"`
    case HEADING: return `h${node.aux}"${text(src, node)}"`
    case CODE: return `code${unclosed}"${text(src, node)}"`
    case COMMENT_BLOCK: return `%%%${unclosed}"${text(src, node)}"`
    case LINE_BLOCK: return `lines${unclosed}"${text(src, node)}"`
    case FRONTMATTER: return `fm${unclosed}"${text(src, node)}"`
    case COMMENT: return `%"${text(src, node)}"`
    case INCLUDE: return `inc"${text(src, node)}"`
    case LINK_DEFINITION: return `def"${text(src, node)}"`
    case ABBREVIATION: return `abbr"${text(src, node)}"`
    case THEMATIC_BREAK: return 'hr'
    default: return `?${node.kind}`
  }
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
