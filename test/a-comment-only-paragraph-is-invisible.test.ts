import { describe, expect, it } from 'vitest'
import { carveToHtml, parse } from '../src/index.js'

// The superseding option-C ruling in carve#4799 makes a finished paragraph
// of braced comments invisible, while a later line can still join it.
describe('a paragraph holding only braced comments', () => {
  it.each([
    ['{% c %}', ''],
    ['{% c %}\n{% next %}', ''],
    ['> {% c %}\n^ cap', '<blockquote>\n\n</blockquote>\n<p>^ cap</p>'],
    ['- {% c %}', '<ul>\n  <li></li>\n</ul>'],
    ['{#a}\n{% c %}\n\np', '<p id="a">p</p>'],
    ['{% c %}\nx', '<p>\nx</p>'],
  ])('renders %j by the completed paragraph', (source, expected) => {
    expect(carveToHtml(source)).toBe(expected)
  })

  it('does not create a paragraph node for an orphaned commented line', () => {
    expect(parse('{% c %}').children).toEqual([])
  })
})
