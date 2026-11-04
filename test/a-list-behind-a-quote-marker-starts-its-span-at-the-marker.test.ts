import { expect, it } from 'vitest'
import { parse } from '../src/index.js'
import type { Position } from '../src/ast.js'

// CARVE-P12-013 as ruled on carve#5063: a list's span begins at its owner's
// content column, which behind a quote marker is the quote's content column.
type Node = { type: string; pos?: Position; children?: Node[]; items?: Node[] }
const starts = (source: string): string[] => {
  const found: string[] = []
  const walk = (node: Node): void => {
    if ((node.type === 'list' || node.type === 'list_item') && node.pos)
      found.push(`${node.type}@${node.pos.startOffset}:${node.pos.startColumn}`)
    for (const child of [...(node.children ?? []), ...(node.items ?? [])]) walk(child)
  }
  walk(parse(source, { positions: true }) as unknown as Node)
  return found
}

it('starts a list written past the quote column at the quote content column', () => {
  expect(starts('>   - a\n> - b\n>     - c\n>       :::\n1. lazy\n')).toEqual([
    'list@2:3', 'list_item@2:3',
    'list_item@10:3',
    'list@18:5', 'list_item@18:5',
    'list@36:1', 'list_item@36:1',
  ])
})

it('starts a list past the column of a nested quote at the nested quote content column', () => {
  expect(starts('> >   - a\n')).toEqual(['list@4:5', 'list_item@4:5'])
})

it('keeps the indentation latitude where only indentation precedes the list', () => {
  expect(starts('- b\n    - c\n')).toEqual(['list@0:1', 'list_item@0:1', 'list@6:3', 'list_item@6:3'])
  expect(starts('  - a\n')).toEqual(['list@0:1', 'list_item@0:1'])
})
