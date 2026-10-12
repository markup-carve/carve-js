import {expect, it} from 'vitest'
import {carveToHtml, parse, renderHtml} from '../src/index.js'
import fixtures from './fixtures/quoted-colon-remaining-parity.json'

it('preserves the shared Native ownership controls through Source and AST rendering', () => {
  expect(fixtures).toHaveLength(210)
  for (const fixture of fixtures) {
    for (const actual of [carveToHtml(fixture.source), renderHtml(parse(fixture.source))]) {
      expect(actual.replace(/>\s+</g, '><').trim(), fixture.id).toBe(fixture.html.replace(/>\s+</g, '><').trim())
    }
  }
})

for (const indent of ['   ', '\t']) {
  it(`maps a lazy quoted marker back to its source after ${JSON.stringify(indent)}`, () => {
    const source = `> paragraph\n${indent}- x\n`
    const document = parse(source)
    const quote = document.children[0]
    expect(quote?.type).toBe('block_quote')
    if (quote?.type !== 'block_quote') throw new Error('Missing quote')
    const paragraph = quote.children[0]
    expect(paragraph?.type).toBe('paragraph')
    if (paragraph?.type !== 'paragraph') throw new Error('Missing paragraph')
    const marker = paragraph.children.find(node => node.type === 'text' && node.value === '- x')
    expect(marker?.pos).toBeDefined()
    expect(source.slice(marker!.pos!.startOffset, marker!.pos!.endOffset)).toBe('- x')
    expect(marker!.pos!.startLine).toBe(2)
    expect(marker!.pos!.startColumn).toBe(indent.length + 1)
  })
}
