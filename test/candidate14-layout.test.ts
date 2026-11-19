import { expect, it } from 'vitest'
import { parseWithLayout, validateLayout } from '../src/index.ts'

it('C2-L-020, C2-L-058: a wrap offset cannot pass the cell source span', () => {
  const layout = parseWithLayout('| a |\n+ b |\n').layout
  const cell = layout.nodes.find((entry) => entry.wraps?.length === 1)!
  cell.wraps![0]!.offset = 999
  expect(() => validateLayout(layout)).toThrow('/wraps/0/offset')
})

it('C2-L-011: a table child precedes a table column in document order', () => {
  const layout = parseWithLayout('| a |\n').layout
  layout.nodes.push({ path: '/children/0/columns/0', startByte: 0, endByte: 5 })
  expect(() => validateLayout(layout)).not.toThrow()
})
