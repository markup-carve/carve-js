import { expect, it } from 'vitest'
import { parse, render } from '../src/index.ts'

// carve#6470, C2-I-087: the `[` of a nested image opener belongs to that opener, so `![^]` is no footnote reference.
it.each([
  ['![[![^]]](u)', '<img src="u" alt="[![^]]">'],
  ['![![^ ]](u)', '<img src="u" alt="![^ ]">'],
  ['> ![![^x]](u)', '<blockquote>\n  <img src="u" alt="![^x]">\n</blockquote>'],
])('C2-B-197: %s is one block image', (line, html) => {
  expect(render(`${line}\n`)).toBe(html)
  let block = parse(`${line}\n`).children[0] as { type: string, role?: string, children: unknown[] }
  while (block.type !== 'paragraph') block = block.children[0] as typeof block
  expect(block).toMatchObject({ type: 'paragraph', role: 'image' })
})

it('C2-B-197: no image role where the inline content is not one image', () => {
  const tree = parse('1. ![[[[![^]][`[`][^x]][k]](u "t")\n')
  let block = tree.children[0] as { type: string, role?: string, children: { type: string }[] }
  while (block.type !== 'paragraph') block = block.children[0] as typeof block
  expect(block.role).toBeUndefined()
  expect(block.children.length === 1 && block.children[0]!.type === 'image').toBe(false)
})
