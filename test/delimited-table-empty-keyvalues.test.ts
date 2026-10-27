import { expect, it } from 'vitest'
import { parse, toAstJson } from '../src/index.js'

const table = (source: string) => {
  const list = toAstJson(parse(source)).children[0]
  if (list?.type !== 'list') throw new Error('Expected a list')
  const node = list.items[0]?.children[1]
  if (node?.type !== 'table') throw new Error('Expected a table')
  return node
}

it('omits a consumed structural key from table attributes under a continuation marker', () => {
  const node = table('- a\n+\n{table .x}\n```csv\na,b\n1,2\n```')
  expect(node.attrs).toEqual({ classes: ['x'], order: ['.class'] })
})

it('keeps other key-value attributes after consuming the structural key', () => {
  const node = table('- a\n+\n{table .x data-k=v}\n```csv\na,b\n1,2\n```')
  expect(node.attrs).toEqual({ classes: ['x'], keyValues: { 'data-k': 'v' }, order: ['.class', 'data-k'] })
})
