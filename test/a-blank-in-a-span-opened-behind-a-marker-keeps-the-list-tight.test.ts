import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

// markup-carve/carve#5030 (ruled B), PART 9 §17 L1c: a span's closer is the
// item's, so a blank inside the span is interior, as a code fence's blank is.
// That holds when the span opens behind a description or nested list marker.
describe('a blank inside a span opened behind a marker keeps the list tight', () => {
  it('a span on a description lead in an item', () => {
    expect(carveToHtml('- a\n  :: u\n  : %%%\n\n    %%%\n- c\n')).toBe(
      '<ul>\n  <li>a\n    <dl>\n      <dt>u</dt>\n      <dd></dd>\n    </dl>\n  </li>\n  <li>c</li>\n</ul>',
    )
  })

  it.each([
    ['a nested bullet', '- a\n  - %%%\n\n    %%%\n- d\n'],
    ['a nested ordered item', '- a\n  1. %%%\n\n     %%%\n- d\n'],
    ['a nested task', '- a\n  - [ ] %%%\n\n        %%%\n- d\n'],
    ['a description lead in a nested item', '- a\n  - b\n    :: u\n    : %%%\n\n      %%%\n- d\n'],
    ['a list in a description lead', '- a\n  :: u\n  : - %%%\n\n      %%%\n- d\n'],
    ['payload around the blank', '- a\n  :: u\n  : %%%\n    x\n\n    y\n    %%%\n- d\n'],
    ['a wider span', '- a\n  - %%%%\n\n    %%%%\n- d\n'],
  ])('%s', (_name, src) => {
    expect(carveToHtml(src)).toMatch(/^<ul>\n {2}<li>a\n/)
  })

  it('an unterminated span still loosens the list', () => {
    expect(carveToHtml('- a\n  :: u\n  : %%%\n\n- c\n')).toMatch(/^<ul>\n {2}<li><p>a<\/p>/)
  })

  it.each([
    ['one colon line', '- a\n  : %%%\n\n    %%%\n- c\n'],
    ['two colon lines', '- a\n  : x\n  : %%%\n\n    %%%\n- c\n'],
  ])('%s with no term above is paragraph text and still loosens the list', (_name, src) => {
    expect(carveToHtml(src)).toMatch(/^<ul>\n {2}<li><p>a\n:/)
  })

  it('a second description of a term keeps the list tight', () => {
    expect(carveToHtml('- a\n  :: u\n  : x\n  : %%%\n\n    %%%\n- c\n')).toMatch(/^<ul>\n {2}<li>a\n/)
  })

  it('a blank after the closer still loosens the list', () => {
    expect(carveToHtml('- a\n  - %%%\n    %%%\n\n- d\n')).toMatch(/^<ul>\n {2}<li><p>a<\/p>/)
  })
})
