import type { BlockNode, InlineNode } from './ast.js'
import { MAX_RENDER_DEPTH, RenderDepthError } from './render-depth.js'
import { trimNonNbsp } from './trim-non-nbsp.js'

/** Render a block cell's inline content without block prefixes or decoration. */
export function renderCellContent(
  blocks: BlockNode[],
  inlines: (nodes: InlineNode[]) => string,
  target: string,
  depth = 0,
  flatten = (part: string) => part.replace(/[ \t\r]*(?:\n[ \t\r]*)+/g, ' '),
): string {
  if (depth >= MAX_RENDER_DEPTH) throw new RenderDepthError(target, MAX_RENDER_DEPTH)
  const parts: string[] = []
  const descend = (children: BlockNode[]) => parts.push(renderCellContent(children, inlines, target, depth + 1, flatten))
  for (const block of blocks) {
    switch (block.type) {
      case 'paragraph':
      case 'heading':
        parts.push(inlines(block.children))
        break
      case 'block_quote':
      case 'div':
      case 'section':
      case 'line_block':
      case 'figure_group':
        descend(block.children)
        break
      case 'admonition':
      case 'directive':
        if (block.title) parts.push(inlines(block.title))
        descend(block.children)
        break
      case 'list':
        for (const item of block.items) descend(item.children)
        break
      case 'definition_list':
        for (const item of block.items) {
          for (const term of item.terms) parts.push(inlines(term))
          for (const definition of item.definitions) descend(definition)
        }
        break
      case 'table':
        for (const row of block.rows) for (const cell of row.cells) {
          if (cell.blocks) descend(cell.blocks)
          else parts.push(inlines(cell.children ?? []))
        }
        break
      case 'figure':
        descend([block.target])
        parts.push(inlines(block.caption))
        break
      case 'image':
        parts.push(inlines([block]))
        break
      case 'code_block':
        parts.push(inlines([{ type: 'text', value: trimNonNbsp(block.content.replace(/\r\n|\r|\n/g, ' ')) }]))
        break
      case 'raw_block':
      case 'abbreviation_def':
      case 'thematic_break':
      case 'comment':
      case 'link_reference_definition':
      case 'citation_definition':
        break
      default: {
        const unknown: never = block
        throw new Error(`${target}: unknown block in a table cell ${(unknown as { type: string }).type}`)
      }
    }
  }
  return parts.filter(Boolean).map(flatten).join(' ')
}
