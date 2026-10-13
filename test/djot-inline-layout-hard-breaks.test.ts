import { expect, it } from 'vitest'
import { djotInlineLayout } from '../src/djot-block-layout.js'

it.each([
  ['a  \\\nnext', 'a\\\nnext'],
  ['a\\   \\\nnext', 'a\\ \\\nnext'],
  ['a{.x}  \\\nnext', 'a{.x}\\\nnext'],
  ['a"}  \\\nnext', 'a”\\\nnext'],
])('preserves hard-break whitespace and escapes: %s', (source, expected) => {
  expect(djotInlineLayout(source)).toBe(expected)
})

it('preserves repeated escaped comment starts', () => {
  const source = '| ' + Array(1024).fill('\\{% a').join(' | ') + ' } |'
  expect(djotInlineLayout(source)).toBe(source)
})
