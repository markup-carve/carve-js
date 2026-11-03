import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const normalize = (html: string) => html.replace(/\s+/g, ' ').replace(/ ?(<[^>]+>) ?/g, '$1').trim()

// carve#5028: a marker line opens an item after any body line, so a `%%%` behind it opens a span
// that a closer below the item's column ends (CARVE-P9-060).
it('closes a marker-line span three items deep at column 0', () => {
  expect(normalize(carveToHtml('- a\n  - b\n    - %%%\n%%%\nc\n'))).toBe(normalize(
    '<ul><li>a<ul><li>b<ul><li></li></ul></li></ul></li></ul><p>c</p>',
  ))
})

it('closes a marker-line span after paragraph text at depth two', () => {
  expect(normalize(carveToHtml('- b\n  text\n  - %%%\n%%%\nc\n'))).toBe(normalize(
    '<ul><li>b text<ul><li></li></ul></li></ul><p>c</p>',
  ))
})

it('closes a marker-line span on a sibling item below the column', () => {
  expect(normalize(carveToHtml('- a\n  - b\n  2. %%%%\n %%%%\n- c\n'))).toBe(normalize(
    '<ul><li>a<ul><li>b</li></ul><ol start="2"><li></li></ol></li><li>c</li></ul>',
  ))
})

it('closes a marker-line span four items deep inside a quote', () => {
  expect(normalize(carveToHtml('> - a\n>   - b\n>     - c\n>       - %%%\n> %%%\n> d\n'))).toBe(normalize(
    '<blockquote><ul><li>a<ul><li>b<ul><li>c<ul><li></li></ul></li></ul></li></ul></li></ul><p>d</p></blockquote>',
  ))
})
