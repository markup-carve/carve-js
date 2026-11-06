import { expect, test } from 'vitest'
import { parse, toAstJson } from '../src/index.js'

type Node = { type: string; pos?: { endOffset?: number }; children?: Node[]; items?: Node[] }
const wire = (source: string): Node => toAstJson(parse(source)) as unknown as Node

test('corpus 868 ends the quote, list, and item after their last placed child', () => {
  const quote = wire('>\n+\n. e\n+\n').children![0]!
  const list = quote.children![0]!
  const item = list.items![0]!
  expect([quote.pos?.endOffset, list.pos?.endOffset, item.pos?.endOffset]).toEqual([7, 7, 7])
  expect(item.children![0]!.pos?.endOffset).toBe(7)
})

test('corpus 947 leaves the refused plus outside the code item', () => {
  const quote = wire('> a\n+\n- ``` js\n  x\n+\n- y\n').children![0]!
  const list = quote.children![1]!
  expect(list.items![0]!.pos?.endOffset).toBe(18)
  expect(list.items![0]!.children![0]!.pos?.endOffset).toBe(18)
  expect(list.items![1]!.pos?.endOffset).toBe(24)
})

test('an empty item may still span its sole consumed plus', () => {
  const first = wire('- +\n- b\n').children![0]!.items![0]!
  expect(first.children).toEqual([])
  expect(first.pos?.endOffset).toBe(3)
})

test('a nonempty description and its list stop at the placed paragraph', () => {
  const list = wire(':: t\n: q\n+\n+\n').children![0]!
  const description = list.items![1]!
  expect([list.pos?.endOffset, description.pos?.endOffset]).toEqual([8, 8])
  expect(description.children![0]!.pos?.endOffset).toBe(8)
})
