// carve-js#5572: a call that spreads an input-sized list onto the stack throws above about 125,000 items.
import { expect, it } from 'vitest'
import { charsText, maxOf, pushAll, pushReversed, spliceAll } from '../src/arrays.ts'
import type { Node } from '../src/ast.ts'
import { earlyTextNoteClosers } from '../src/write-check.ts'

const LARGE = 300_000

it('the array helpers take lists larger than a call can spread', () => {
  const items = Array.from({ length: LARGE }, (_, at) => at)
  const target = [-1]
  pushAll(target, items)
  expect(target.length).toBe(LARGE + 1)
  expect(target[LARGE]).toBe(LARGE - 1)
  const reversed: number[] = []
  pushReversed(reversed, items)
  expect(reversed[0]).toBe(LARGE - 1)
  const list = [0, 1, 2]
  spliceAll(list, 1, 1, items)
  expect([list.length, list[0], list[1], list[LARGE + 1]]).toEqual([LARGE + 2, 0, 0, 2])
  expect(maxOf(items)).toBe(LARGE - 1)
  expect(maxOf([], 3)).toBe(3)
  const codes = Array.from({ length: LARGE }, (_, at) => 97 + (at % 3))
  expect(charsText(codes, 1, LARGE - 1)).toBe('abc'.repeat(LARGE / 3).slice(1, -1))
})

it('the early note closer walk takes a paragraph of 300,000 inline children', () => {
  const children = Array.from({ length: LARGE }, (): Node => ({ type: 'text', value: 'a ' }) as Node)
  const document = { type: 'document', children: [{ type: 'paragraph', children }] } as unknown as Node
  expect(earlyTextNoteClosers([document])).toEqual([])
})
