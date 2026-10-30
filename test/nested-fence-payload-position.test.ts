import { expect, it } from 'vitest'
import { parse } from '../src/index.js'

it('ends a nested open fence and its lists at the last payload newline', () => {
  const doc = parse('- - ```\n\n\n  +\ntail\n')
  const outer = doc.children[0]
  expect(outer?.type).toBe('list')
  if (outer?.type !== 'list') return
  const inner = outer.items[0]?.children[0]
  expect(inner?.type).toBe('list')
  if (inner?.type !== 'list') return
  const item = inner.items[0]
  const code = item?.children[0]
  expect(code?.type).toBe('code_block')
  if (code?.type !== 'code_block') return

  expect(code.content).toBe('\n\n')
  expect(code.pos?.endOffset).toBe(10)
  expect(item?.pos?.endOffset).toBe(10)
  expect(inner.pos?.endOffset).toBe(10)
})

it('keeps the payload boundary when blank lines contain spaces', () => {
  const doc = parse('- - ```\n    \n    \n  +\ntail\n')
  const outer = doc.children[0]
  expect(outer?.type).toBe('list')
  if (outer?.type !== 'list') return
  const inner = outer.items[0]?.children[0]
  expect(inner?.type).toBe('list')
  if (inner?.type !== 'list') return
  const item = inner.items[0]
  const code = item?.children[0]
  expect(code?.type).toBe('code_block')
  if (code?.type !== 'code_block') return

  expect(code.content).toBe('\n\n')
  expect(code.pos?.endOffset).toBe(17)
  expect(item?.pos?.endOffset).toBe(17)
  expect(inner.pos?.endOffset).toBe(17)
})
