import { expect, it } from 'vitest'
import { carveToAstJson } from '../src/index.js'

it.each([
  ['plain body', '[^a]: q\n+\n+\n\nref [^a]\n', '[^a]: q'],
  ['paragraph body', '[^a]: q\n\n  tail\n+\n+\n\nref [^a]\n', '[^a]: q\n\n  tail'],
])('ends a collected footnote at its last child after a consumed marker: %s', (_name, source, expected) => {
  const note = carveToAstJson(source).children.find((node) => node.type === 'footnote')
  expect(note?.pos).toBeDefined()
  expect(source.slice(note!.pos!.startOffset, note!.pos!.endOffset)).toBe(expected)
})
