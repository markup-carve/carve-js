import { expect, it } from 'vitest'
import { djotToCarve, carveToHtml } from '../src/index.js'

// The item's content column is where its content sits on the note's marker line,
// so every line the importer writes for the item starts there.
it.each([
  {
    source: '[^1]: - [x] ::: d\n    x\n    :::\n\nt[^1]\n',
    carve: '[^1]: - [x] ::: d\n        :::\n  x\n  \\:::\n\nt[^1]\n',
  },
  {
    source: '[^1]: - ::: d\n        x\n        :::\n\nt[^1]\n',
    carve: '[^1]: - ::: d\n        x\n        :::\n\nt[^1]\n',
  },
  {
    source: '[^1]: - a\n\n        b\n\nt[^1]\n',
    carve: '[^1]: - a\n\n        b\n\nt[^1]\n',
  },
  {
    source: '[^1]: - [x] a\n\n        - y\n\nt[^1]\n',
    carve: '[^1]: - [x] a\n\n        - y\n\nt[^1]\n',
  },
  {
    source: '[^1]: 1. ::: d\n\n         > z\n         :::\n\nt[^1]\n',
    carve: '[^1]: 1. ::: d\n\n         > z\n         :::\n\nt[^1]\n',
  },
])('writes the item lines at the item content column: $source', ({ source, carve }) => {
  expect(djotToCarve(source)).toBe(carve)
  expect(carveToHtml(djotToCarve(source))).toBe(carveToHtml(carve))
})

it('keeps a block indented into the item inside the item', () => {
  const html = carveToHtml(djotToCarve('[^1]: - a\n\n        > q\n\nt[^1]\n'))
  expect(html).toMatch(/<li><p>a<\/p>\s*<blockquote><p>q<\/p><\/blockquote>\s*<\/li>/)
})
