import { expect, it } from 'vitest'
import { carveToAstJson } from '../src/index.js'

it.each([
  ['[^c]: [^d]: para\n          more\n', 16],
  ['[^c]: [^d]: p\n  q\n', 13],
])('ends an emptied footnote on its opening line: %j', (source, endOffset) => {
  const doc = carveToAstJson(source)
  const outer = doc.children.find((child) => child.type === 'footnote' && child.label === 'c')
  expect(outer?.pos?.startOffset).toBe(0)
  expect(outer?.pos?.endOffset).toBe(endOffset)
  expect(outer?.pos?.endLine).toBe(1)
})

it('keeps a body continuation in a note that still has a child', () => {
  const source = '[^c]: para\n  more\n'
  const doc = carveToAstJson(source)
  const note = doc.children.find((child) => child.type === 'footnote' && child.label === 'c')
  expect(note?.pos?.endOffset).toBe(source.indexOf('more') + 4)
})
