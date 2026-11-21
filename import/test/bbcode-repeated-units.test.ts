import { expect, it } from 'vitest'
import { importDocument } from '../src/index.ts'

it('keeps the source and findings of repeated independent BBCode blocks in their original order', () => {
  const input = '[quote=Lee]x[/quote]\n\nplain\n\n[quote=Lee]x[/quote]'
  const result = importDocument(input, { from: 'bbcode' })
  expect(result.source).toBe('> x\n^ Lee\n\nplain\n\n> x\n^ Lee\n')
  expect(result.diagnostics).toEqual([])
  expect(result.document.children.map(node => node.type)).toEqual(['block_quote', 'paragraph', 'block_quote'])
})
