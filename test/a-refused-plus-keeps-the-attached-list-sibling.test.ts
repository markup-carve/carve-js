import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it('keeps a shifted ordered marker beside its attached-list predecessor after a refused plus (carve#5612)', () => {
  expect(carveToHtml(':: t\n: +\n1. li\n+\n   1. sib\n')).toBe(
    '<dl>\n  <dt>t</dt>\n  <dd>\n    <ol>\n      <li>li</li>\n      <li>sib</li>\n    </ol>\n  </dd>\n</dl>')
})

it.each([
  ['1. sib', '1. li'],
  ['2. sib', '1. li'],
  ['3. sib', '2. li'],
] as const)('keeps ordered %s beside its predecessor at shifted columns', (second, first) => {
  for (const shift of [3, 4, 8]) {
    const source = `:: t\n: +\n${first}\n+\n${' '.repeat(shift)}${second}\n`
    const html = carveToHtml(source)
    expect(html, source).toMatch(/<ol(?: start="[0-9]+")?>/)
    expect(html, source).toContain('sib</li>')
    expect(html, source).not.toContain('<li>li\n        <ol>')
  }
})

it('preserves a bullet nested after the refused marker', () => {
  expect(carveToHtml(':: t\n: +\n- li\n+\n   - sib\n')).toContain('<li>li\n        <ul>')
})
