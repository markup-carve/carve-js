import type { BlockNode } from './ast.js'

/** Visit directly owned block lists, including table cells and figure targets. */
export function forEachChildBlockList(node: BlockNode, visit: (children: BlockNode[]) => void): void {
  switch (node.type) {
    case 'block_quote': case 'admonition': case 'directive': case 'div':
    case 'figure_group': case 'section': case 'line_block':
      visit(node.children)
      return
    case 'list':
      for (const item of node.items) visit(item.children)
      return
    case 'definition_list':
      for (const item of node.items) for (const definition of item.definitions) visit(definition)
      return
    case 'table':
      for (const row of node.rows) for (const cell of row.cells) {
        if (cell.blocks) visit(cell.blocks)
      }
      return
    case 'figure':
      forEachChildBlockList(node.target, visit)
      return
    case 'heading': case 'paragraph': case 'code_block': case 'thematic_break':
    case 'image': case 'abbreviation_def': case 'link_reference_definition':
    case 'citation_definition': case 'raw_block': case 'comment':
      return
    default:
      return assertNever(node)
  }
}

function assertNever(_node: never): never {
  throw new Error('Unsupported block node type')
}

/**
 * A shallow copy of `b` whose child block lists are fresh arrays, or `b` itself
 * when it holds none. The copies are what makes the rewrite above safe to do in
 * place without touching the caller's tree.
 */
export function withClonedChildBlockLists(b: BlockNode): BlockNode {
  switch (b.type) {
    case 'block_quote':
    case 'admonition':
    case 'directive':
    case 'div':
    case 'figure_group':
    case 'section':
      return { ...b, children: b.children.slice() }
    case 'list':
      return { ...b, items: b.items.map((item) => ({ ...item, children: item.children.slice() })) }
    case 'definition_list':
      return {
        ...b,
        items: b.items.map((it) => ({ ...it, definitions: it.definitions.map((d) => d.slice()) })),
      }
    case 'table':
      return {
        ...b,
        rows: b.rows.map((row) => ({
          ...row,
          cells: row.cells.map((cell) => cell.blocks ? { ...cell, blocks: cell.blocks.slice() } : cell),
        })),
      }
    case 'figure':
      if (b.target.type === 'block_quote' || b.target.type === 'table') {
        return { ...b, target: withClonedChildBlockLists(b.target) as typeof b.target }
      }
      return b
    case 'heading': case 'paragraph': case 'code_block': case 'thematic_break':
    case 'image': case 'abbreviation_def': case 'link_reference_definition':
    case 'citation_definition': case 'raw_block': case 'comment': case 'line_block':
      return b
    default:
      return assertNever(b)
  }
}

