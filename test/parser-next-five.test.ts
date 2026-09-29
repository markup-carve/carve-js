import { describe, expect, it } from 'vitest'
import { carveToHtml, parse } from '../src/index.js'
import { applyLinkDefs } from '../src/inline-resolution.js'
import { referenceImage, referenceLink } from '../src/reference-resolution.js'
import type { InlineNode } from '../src/ast.js'

const authoritative = { extensions: [{ name: 'declines', matchInline: () => null }] }

describe('ordinary Unicode runs', () => {
  it.each([
    '尾😀 café\u00a0end',
    '尾\ud800\udc00\ud800end\udc00',
    '尾\u2028\u2029\ufeff\ue000end',
    '尾 *strong* /emphasis/ `code` "quote" -- end...',
    '尾 [link](/target) and [reference][r]\n\n[r]: /target',
    '| 尾 😀 *strong*\n| tail',
    '| 尾 | 😀 |\n|---|---|\n| café | end |',
    '> 尾😀\r\n>\r\n> - café *end*\r\n',
    '尾  %% comment\nnext',
    '尾\n😀',
  ])('matches the full scanner: %s', source => {
    expect(parse(source)).toEqual(parse(source, authoritative))
    expect(parse(source, { positions: false })).toEqual(parse(source, { ...authoritative, positions: false }))
    expect(carveToHtml(source)).toEqual(carveToHtml(source, authoritative))
  })

  it('lets extensions match a Unicode run at an ordinary offset', () => {
    const doc = parse('尾 😀 end', { extensions: [{ name: 'unicode', matchInline(text, pos) {
      return text.startsWith('😀', pos) ? { node: { type: 'text', value: 'changed' }, end: pos + 2 } : null
    } }] })
    expect(doc.children[0]).toMatchObject({ children: [{ value: '尾 ' }, { value: 'changed' }, { value: ' end' }] })
  })
})

describe('reference resolution without replacement arrays', () => {
  it('keeps unresolved nodes available and resolves nested links and images in place', () => {
    const unresolved = referenceLink('missing', '[x][missing]', [{ type: 'text', value: 'x' }])
    const link = referenceLink('r', '[x][r]', [{ type: 'text', value: 'x' }])
    const image = referenceImage('r', '![x][r]', 'x')
    const children: InlineNode[] = [link, image, unresolved]
    const nodes: InlineNode[] = [{ type: 'span', children }]
    expect(applyLinkDefs(nodes, new Map())).toBe(nodes)
    expect(unresolved.href).toBe('')
    expect(applyLinkDefs(nodes, new Map([['r', { href: '/target', title: 'title' }]]))).toBe(nodes)
    expect(nodes[0]).toMatchObject({ children: [{ href: '/target', title: 'title' }, { src: '/target', title: 'title' }, { href: '' }] })
    expect((nodes[0] as { children: InlineNode[] }).children).toBe(children)
  })

  it('retains heading fallback with an empty explicit-definition map', () => {
    expect(carveToHtml('[Heading][]\n\n# Heading\n')).toContain('href="#Heading"')
  })
})
