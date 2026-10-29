import { expect, it } from 'vitest'
import { parse } from '../src/index.js'
import type { Position } from '../src/ast.js'

// PART 12 section 4: a container's span may begin in the line's leading
// indentation, which places a nested marker. Behind a quote marker the run is not
// leading indentation, so the span begins at the list marker.
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

it('starts a list written past the quote column at its marker', () => {
  expect(starts('>   - a\n> - b\n>     - c\n>       :::\n1. lazy\n')).toEqual([
    'list@4:5', 'list_item@4:5',
    'list_item@10:3',
    'list@20:7', 'list_item@20:7',
    'list@36:1', 'list_item@36:1',
  ])
})

it('starts a list past the column of a nested quote at its marker', () => {
  expect(starts('> >   - a\n')).toEqual(['list@6:7', 'list_item@6:7'])
})

it('keeps the indentation latitude where only indentation precedes the list', () => {
  expect(starts('- b\n    - c\n')).toEqual(['list@0:1', 'list_item@0:1', 'list@6:3', 'list_item@6:3'])
  expect(starts('  - a\n')).toEqual(['list@0:1', 'list_item@0:1'])
})
