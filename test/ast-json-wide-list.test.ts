import { expect, it } from 'vitest'
import { parse } from '../src/parse.js'
import { fromAstJson, toAstJson } from '../src/ast-json.js'

it('round-trips 200,000 list items through AST JSON', () => {
  const count = 200_000
  const doc = parse('- x\n'.repeat(count))
  const list = doc.children[0]
  expect(list?.type).toBe('list')
  if (list?.type !== 'list') throw new Error('Expected a list')
  expect(list.items).toHaveLength(count)

  const wire = toAstJson(doc)
  const restored = fromAstJson(JSON.parse(JSON.stringify(wire)))
  const restoredList = restored.children[0]
  expect(restoredList?.type).toBe('list')
  if (restoredList?.type !== 'list') throw new Error('Expected a restored list')
  expect(restoredList.items).toHaveLength(count)
  expect(restoredList.items[0]).toEqual(list.items[0])
  expect(restoredList.items[count - 1]).toEqual(list.items[count - 1])
}, 60_000)


it('exports 200,000 top-level blocks without spreading them into a call', () => {
  const doc = parse('x\n')
  doc.children = Array.from({ length: 200_000 }, () => doc.children[0]!)
  const wire = toAstJson(doc)
  expect(wire.children).toHaveLength(200_000)
  expect(wire.children[0]).toEqual(wire.children[199_999])
})
