import { expect, it } from 'vitest'
import { parse, render } from '../src/index.ts'

// carve-js#5436: the block-image line shape (C2-B-197) pairs brackets as the inline scan does.
it('C2-I-087: a `[^` whose label is none is text and opens no bracket pair', () => {
  expect(render('![a [^](u)\n')).toBe('<img src="u" alt="a [^">')
  expect(parse('![a [^](u)\n').children[0]).toMatchObject({ type: 'paragraph', role: 'image' })
  expect(parse('![aa[^][k]\n\n[k]: /u\n').children[0]).toMatchObject({ role: 'image' })
})

it('C2-I-089: an inline footnote closes taking no label, and `[^` in it is an ordinary bracket', () => {
  expect(render('![a ^[f][a](b])](u)\n')).toBe('<img src="u" alt="a ^[f][a](b])">')
  expect(parse('![a ^[f [^n] g] h](u)\n\n[^n]: x\n').children[0]).toMatchObject({ role: 'image' })
})

it('C2-I-089: the line takes the passes of the inline scan, so a note that closes only in the alt demotes nothing', () => {
  for (const line of ['![^[[^]](u)', '![^[a[^]](u)', '![^[^[[^]]][k]', '![a ^[b [^ ]](u)']) {
    const tree = parse(`${line}\n\n[k]: /u\n`)
    const paragraph = tree.children[0] as { role?: string, children: { type: string }[] }
    const only = paragraph.children.length === 1 && paragraph.children[0]!.type === 'image'
    expect(paragraph.role === 'image', line).toBe(only)
  }
})
