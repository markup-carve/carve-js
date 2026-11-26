// The HTML round-trip clauses of 16 November 2026: one reading per element, and the rebuilt link definitions.
import { describe, expect, it } from 'vitest'
import { parse, render } from '../../src/index.ts'
import { importDocument } from '../src/index.ts'

const CARRIER = '<ul data-carve-tight><li>t</li></ul>'
const strip = (value: unknown): unknown => JSON.parse(JSON.stringify(value, (key, field: unknown) => key === 'pos' ? undefined : field))
const blocks = (html: string): unknown[] => (strip(importDocument(html, { from: 'html' }).document.children) as unknown[])

describe('C2-H-197: no document-wide round-trip mode', () => {
  it('C2-H-195 row 3: a no-break space is the text character, beside a carrier as alone', () => {
    const paragraph = { type: 'paragraph', children: [{ type: 'text', value: 'a b' }] }
    expect(blocks('<p>a&nbsp;b</p>')[0]).toEqual(paragraph)
    expect(blocks(`<p>a&nbsp;b</p>${CARRIER}`)[0]).toEqual(paragraph)
  })

  it('C2-H-195 row 5: a line ending before a hard break is layout in every document', () => {
    const paragraph = { type: 'paragraph', children: [{ type: 'text', value: 'a' }, { type: 'hard_break' }, { type: 'text', value: 'b' }] }
    expect(blocks('<p>a\n<br>\nb</p>')[0]).toEqual(paragraph)
    expect(blocks(`<p>a\n<br>\nb</p>${CARRIER}`)[0]).toEqual(paragraph)
  })

  it('C2-H-195 row 7: a line break in a cell reads as a space in every document', () => {
    const cell = (html: string): unknown => (blocks(html)[0] as { children: { children: { children: { children: unknown[] }[] }[] }[] })
      .children[0]!.children[0]!.children[0]!.children
    const spaced = [{ type: 'cell_paragraph', children: [{ type: 'text', value: 'a b' }] }]
    expect(cell('<table><tr><td>a<br>b</td></tr></table>')).toEqual(spaced)
    expect(cell(`<table><tr><td>a<br>b</td></tr></table>${CARRIER}`)).toEqual(cell('<table><tr><td>a<br>b</td></tr></table>'))
  })

  it('C2-H-195 row 6: a list without data-carve-tight is read by its structure, also beside a carrier', () => {
    expect(blocks(`<ul><li>a</li><li>b</li></ul>${CARRIER}`)[0]).toMatchObject({ type: 'list', spacing: 'tight' })
  })

  it('C2-H-196: the attributes of a ruby survive without a carrier', () => {
    expect(JSON.stringify(blocks('<p><ruby class="r">a<rp>(</rp><rt>b</rt><rp>)</rp></ruby></p>'))).toContain('"classes":["r"]')
  })

  it('C2-H-186: a reserved name is never kept as an authored attribute', () => {
    expect(blocks('<p data-carve-tight>x</p>')[0]).toEqual({ type: 'paragraph', children: [{ type: 'text', value: 'x' }] })
  })

  it('C2-H-158, C2-H-194: the notes of a footnote section are definitions after the blocks, without backlinks, in every document', () => {
    const html = render('a[^n]\n\n[^n]: note')
    const imported = blocks(html)
    // Without the label carrier the key comes from the id of the note (C2-H-186).
    const note = [{ type: 'paragraph', children: [{ type: 'text', value: 'note' }] }]
    expect(imported.at(-1)).toEqual({ type: 'footnote', key: '1', namespace: 'footnote', children: note })
  })
})

describe('C2-H-198: rebuilt link definitions and the heading lookup', () => {
  const roundTrip = (src: string): unknown[] => blocks(render(src, { roundtrip: true }))
  const definitions = (src: string): unknown[] =>
    roundTrip(src).filter((node) => (node as { type: string }).type === 'link_reference_definition')

  it('C2-H-198: a key the heading lookup does not match gets its definition back', () => {
    expect(definitions('[x][d]\n\n[d]: #intro\n\n{#intro}\n# Intro')).toEqual([
      { type: 'link_reference_definition', key: 'd', namespace: 'link', href: '#intro' },
    ])
  })

  it('C2-H-195 row 15: a key that finds the heading itself gets none', () => {
    expect(definitions('[Intro][]\n\n[Intro]: #intro\n\n{#intro}\n# Intro')).toEqual([])
  })

  it('C2-I-083: an image key always gets its definition', () => {
    expect(definitions('![Intro][]\n\n[Intro]: #intro\n\n{#intro}\n# Intro')).toEqual([
      { type: 'link_reference_definition', key: 'Intro', namespace: 'link', href: '#intro' },
    ])
  })

  it('C2-H-191, C2-H-192: one definition per key from its first element, after the blocks in first-met order', () => {
    const tree = roundTrip('[a][k2] [b][k1] [c][k2]\n\n[k1]: /one "T"\n[k2]: /two')
    expect(tree.slice(1)).toEqual([
      { type: 'link_reference_definition', key: 'k2', namespace: 'link', href: '/two' },
      { type: 'link_reference_definition', key: 'k1', namespace: 'link', href: '/one', tooltip: 'T' },
    ])
    expect(parse('[a][k2] [b][k1] [c][k2]\n\n[k1]: /one "T"\n[k2]: /two').children.length).toBe(3)
  })
})

describe('C2-H-199: a figure is read as the block it holds', () => {
  const tree = (src: string): unknown[] => (strip(parse(src, { positions: false }).children) as unknown[])

  it('C2-H-199, C2-A-082: the block takes the caption in its slot and the attributes of the figure', () => {
    for (const src of ['{#f .w}\n![a](x.png)\n^ Sun', '```js\nx\n```\n^ L', '> q\n^ Q', '$$`x`\n^ E']) {
      expect(blocks(render(src)), src).toEqual(tree(src))
    }
  })

  it('C2-H-199, C2-H-064: a panel figure is read the same way without its class, and a table panel gives the table', () => {
    const src = '::: figure\n![a](a.png)\n^ (a) A\n\n| t |\n^ T\n:::\n^ Both'
    expect(blocks(render(src))).toEqual(tree(src))
  })

  it('C2-A-084: a figure that holds no captionable block alone is read as a figure group', () => {
    expect(blocks('<figure><p>a</p><p>b</p><figcaption>c</figcaption></figure>')).toMatchObject([{ type: 'figure_group' }])
  })
})
