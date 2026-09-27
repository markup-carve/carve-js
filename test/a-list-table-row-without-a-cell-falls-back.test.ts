import { describe, expect, it } from 'vitest'
import { parse, renderMarkdown, renderPlainText } from '../src/index.js'
import type { Admonition, BlockNode, List } from '../src/ast.js'

const SOURCE = ['::: list-table', '- - a', '  - b', '- - c', '  - d', ':::', ''].join('\n')

/** The first row's leading list emptied, so its paragraph has no cell to join. */
function withAnUngriddedFirstRow() {
  const doc = parse(SOURCE)
  const table = doc.children[0] as Admonition
  const outer = table.children[0] as List
  const row = outer.items[0]!
  const emptied: BlockNode = { ...(row.children[0] as List), items: [] }
  row.children = [emptied, { type: 'paragraph', children: [{ type: 'text', value: 'orphan' }] }]
  return doc
}

describe('a list-table row whose leading list is empty', () => {
  it('is still a grid when every row has a cell', () => {
    expect(renderMarkdown(parse(SOURCE))).toBe('|  |  |\n| --- | --- |\n| a | b |\n| c | d |\n')
  })

  it('falls back to the admonition instead of throwing', () => {
    expect(() => renderMarkdown(withAnUngriddedFirstRow())).not.toThrow()
    expect(renderMarkdown(withAnUngriddedFirstRow())).toBe('- orphan\n- - c\n  - d\n')
  })

  it('agrees with the plain target, which never crashed', () => {
    expect(renderMarkdown(withAnUngriddedFirstRow())).toBe(renderPlainText(withAnUngriddedFirstRow()))
  })
})
