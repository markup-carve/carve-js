import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// carve#5885 option 2: an opener past its frame's column is no frame (corpus row 1073).
describe('a verse lead under an opener past its frame column', () => {
  const cases: Array<[string, string, string]> = [
    ['two spaces and a tab', '- a\n   ::: |\n  \tx\n   :::\n', '- a\n   ::: |\n      x\n   :::\n'],
    ['four spaces and a tab', '- a\n   ::: |\n    \tx\n   :::\n', '- a\n   ::: |\n      x\n   :::\n'],
    ['a quoted item', '> - a\n>    ::: |\n>   \tx\n>    :::\n', '> - a\n>    ::: |\n>       x\n>    :::\n'],
  ]
  for (const [name, tabbed, spaced] of cases) {
    it(`measures ${name} per frame, less the opener column`, () => {
      expect(carveToHtml(tabbed)).toBe(carveToHtml(spaced))
      expect(carveToHtml(tabbed)).toContain('<p>&nbsp;&nbsp;&nbsp;x</p>')
    })
  }

  it('keeps a tabbed opener at its per-frame column', () => {
    expect(carveToHtml('- a\n  \t::: |\n    \tx\n  \t:::\n')).toContain('<p>x</p>')
  })
})
