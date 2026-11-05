import { describe, expect, it } from 'vitest'
import { carveToHtml, djotToCarve } from '../src/index.js'

// djot.js keeps an item tight across a blank before its sub-list, and Carve reads
// that blank as loosening (carve#5015), so the importer drops it (carve#5187).
describe('a Djot blank before a sub-list', () => {
  it.each([
    ['- one\n\n  - two\n', '- one\n  - two\n'],
    ['- [x] parent\n\n  - [ ] child\n', '- [x] parent\n  - [ ] child\n'],
    ['1. one\n\n\n   - two\n', '1. one\n   - two\n'],
    ['> - one\n>\n>   - two\n', '> - one\n>   - two\n'],
    ['- a\n\n  - b\n- c\n', '- a\n  - b\n- c\n'],
    ['> ```\n> code\n\n- a\n\n  - b\n', '> ```\n> code\n\n- a\n  - b\n'],
  ])('is dropped in %j', (djot, carve) => {
    expect(djotToCarve(djot)).toBe(carve)
  })

  it('imports a tight item as tight', () => {
    expect(carveToHtml(djotToCarve('- one\n\n  - two\n'))).not.toContain('<p>')
  })

  it.each([
    '- one\n\n  > q\n',
    '- one\n\n  para\n',
  ])('stays where Djot loosens the list: %j', (djot) => {
    expect(carveToHtml(djotToCarve(djot))).toContain('<p>')
  })
})
