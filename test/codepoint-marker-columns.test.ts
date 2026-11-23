import { expect, it } from 'vitest'
import { parseTree, columnAt } from '../src/index.ts'

it('C2-B-003: an astral marker label takes one column per code point', () => {
  const source = '[^😀]: ```\n       x\n       ```\n'
  const footnote = parseTree(source).document.children[0]
  expect(footnote?.type).toBe('footnote')
  if (footnote?.type !== 'footnote') throw new Error('expected footnote')
  expect(footnote.children[0]).toMatchObject({ type: 'code_block', value: ' x\n' })
})

it('C2-B-003: a source column counts an astral character once', () => {
  const source = '😀 x'
  expect(columnAt(source, Int32Array.of(0), 1, 3)).toBe(2)
})
