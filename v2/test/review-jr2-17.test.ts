import { expect, it } from 'vitest'
import { CarveTreeError, decodeTree } from '../src/index.ts'

it('C2-A-171: list pairs and inline footnotes count toward parser depth', () => {
  let block: unknown = { type: 'paragraph', children: [{ type: 'text', value: 'x' }] }
  for (let depth = 0; depth < 101; depth++) {
    block = { type: 'list', marker: { kind: 'bullet', char: '-' }, spacing: 'tight',
      children: [{ type: 'list_item', children: [block] }] }
  }
  expect(() => decodeTree(JSON.stringify({ type: 'document', astVersion: '2.0', children: [block] }))).toThrow(CarveTreeError)
  let inline: unknown = { type: 'text', value: 'x' }
  for (let depth = 0; depth < 201; depth++) inline = { type: 'inline_footnote', children: [inline] }
  expect(() => decodeTree(JSON.stringify({ type: 'document', astVersion: '2.0',
    children: [{ type: 'paragraph', children: [inline] }] }))).toThrow(CarveTreeError)
})
