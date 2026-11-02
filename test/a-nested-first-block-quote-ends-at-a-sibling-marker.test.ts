import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

const flat = (html: string): string => html.split('\n').map((line) => line.trim()).join('')

// A quote a nested item's first-block `+` attaches is that item's (§17 L3, CARVE-P9-067),
// so a marker at the item's own marker column is its sibling, not the quote's lazy text.
describe('a quote attached by a nested first-block plus', () => {
  const twins: Array<[string, string]> = [
    ['- foo\n  - +\n  > q\n  - x\n', '- +\n> q\n- x\n'],
    ['- foo\n  - +\n  > q\n  1. x\n', '- +\n> q\n1. x\n'],
    ['- foo\n  - +\n  > q\n  > r\n  - x\n', '- +\n> q\n> r\n- x\n'],
    ['- foo\n  - +\n  > q\n  r\n  - x\n', '- +\n> q\nr\n- x\n'],
    ['- foo\n  - [ ] +\n  > q\n  - x\n', '- [ ] +\n> q\n- x\n'],
    ['- foo\n  - +\n  > q\n   - x\n', '- +\n> q\n - x\n'],
  ]
  for (const [nested, topLevel] of twins) {
    it(`reads ${JSON.stringify(nested)} like its top-level twin`, () => {
      expect(flat(carveToHtml(nested))).toBe(`<ul><li>foo${flat(carveToHtml(topLevel))}</li></ul>`)
    })
  }

  it('keeps the sibling at every depth and inside a quote', () => {
    expect(flat(carveToHtml('- a\n  - b\n    - +\n    > q\n    - x\n'))).toBe(
      '<ul><li>a<ul><li>b<ul><li><blockquote><p>q</p></blockquote></li><li>x</li></ul></li></ul></li></ul>',
    )
    expect(flat(carveToHtml('> - foo\n>   - +\n>   > q\n>   - x\n'))).toBe(
      '<blockquote><ul><li>foo<ul><li><blockquote><p>q</p></blockquote></li><li>x</li></ul></li></ul></blockquote>',
    )
  })
})
