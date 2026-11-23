import { expect, it } from 'vitest'
import { parse, render } from '../src/index.ts'

// carve#6460: a label the inline scan rejects behind a nested pair leaves that pair text (C2-I-006), so its `[` opens.
it.each([
  ['![[a][@[]]](u)', '<img src="u" alt="[a][@[]]">'],
  ['![[ ][][[x]](u)', '<img src="u" alt="[ ][][[x]">'],
  ['![[a][ ][[x]](u)', '<img src="u" alt="[a][ ][[x]">'],
  ['![[a][@x][[y]](u)', '<img src="u" alt="[a][@x][[y]">'],
])('C2-I-072, C2-I-078, C2-I-079: %s is one block image', (line, html) => {
  expect(render(`${line}\n`)).toBe(html)
  expect(parse(`${line}\n`).children[0]).toMatchObject({ type: 'paragraph', role: 'image' })
})

it('C2-B-197: the role is set exactly where the inline content is one image', () => {
  for (const line of ['![[a][@[]]][k]', '> ![[ ][]](u)', '- ![[a][ ]](u)', '![[a][@x]](u) z', '![[a][ ]][]', '![[a][(u)']) {
    const tree = parse(`${line}\n\n[k]: /u\n`)
    let block = tree.children[0] as { type: string, role?: string, children: { type: string, children?: unknown[] }[] }
    while (block.type !== 'paragraph') block = block.children[0] as typeof block
    const only = block.children.length === 1 && block.children[0]!.type === 'image'
    expect(block.role === 'image', line).toBe(only)
  }
})
