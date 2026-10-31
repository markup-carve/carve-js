import { expect, it } from 'vitest'
import { decisionTrace } from '../src/index.js'

it('records a fence taken by a marker-line plus in that item', () => {
  const trace = decisionTrace('- foo\n  - +\n  ```\n  x\n  ```\n')
  expect(trace.slice(2)).toEqual([
    { line: 3, step: 'S5', owner: 'doc/item:1/item:2/code:3', rule: 'CARVE-P0-024', form: 'code', cell: 'B-code-start', plus: 2 },
    { line: 4, step: 'S1', owner: 'doc/item:1/item:2/code:3', rule: 'CARVE-P0-005', form: 'payload', cell: 'B-code-keep' },
    { line: 5, step: 'S1', owner: 'doc/item:1/item:2/code:3', rule: 'CARVE-P0-005', form: 'closer', cell: 'B-code-end' },
  ])
})

it('uses the same owner for an attached div and its body', () => {
  const trace = decisionTrace('- foo\n  - +\n  ::: note\n  x\n  :::\n')
  expect(trace.slice(2).map(record => record.owner)).toEqual([
    'doc/item:1/item:2/div:3',
    'doc/item:1/item:2/div:3',
    'doc/item:1/item:2/div:3',
  ])
})

it('does not reassign an invisible comment to the item', () => {
  const trace = decisionTrace('- foo\n  - +\n  %%%\n  x\n  %%%\n')
  expect(trace[2]).toMatchObject({ owner: 'doc/item:1/comment:3', closed: 1, reached: 'doc/item:1' })
})
