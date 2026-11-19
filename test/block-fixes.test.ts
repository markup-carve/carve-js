// Two cases of the block pass that the tree work found.
import { expect, it } from 'vitest'
import { definitionLabel } from '../src/index.ts'
import { shape } from './support/shape.ts'

it('C2-B-157: a comment-only line below a block image or a math block does not count as a line', () => {
  expect(shape('![a](b)\n%% c')).toBe('img"![a](b)|%% c"')
  expect(shape('$$`x`\n%% c')).toBe('math"$$`x`|%% c"')
  expect(shape('![a](b)\ntext')).toBe('p"![a](b)|text"')
})

it('C2-B-137: a comment-only line does not separate a caption from its block image', () => {
  expect(shape('![a](b)\n%% c\n^ cap')).toBe('img"![a](b)|%% c" cap"cap"')
})

it('C2-I-076: the label of a definition runs to the next bracket that no backslash escapes', () => {
  const src = '[a\\]b]: /u'
  expect(src.slice(...definitionLabel(src, 0))).toBe('a\\]b')
  const note = '[^a\\]b]: x'
  expect(note.slice(...definitionLabel(note, 0))).toBe('a\\]b')
})
