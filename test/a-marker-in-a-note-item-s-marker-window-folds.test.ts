import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// A marker between a missed item's marker and content columns that differs on
// any axis is text of the open paragraph, here the note's (carve#4545, carve#4614).
describe('a marker in a note item\'s marker window folds into the note (carve#4614)', () => {
  const cases = [
    ['bullet item', '- [^q]: note\n * child\n\nr[^q]\n', '* child'],
    ['ordered item', '1. [^q]: n\n  * c\n\nr[^q]\n', '* c'],
    ['quoted item', '> - [^q]: n\n>  * c\n\nr[^q]\n', '* c'],
    ['after a second note line', '- [^q]: note\n  more\n * child\n\nr[^q]\n', '* child'],
    ['stacked items', '- - [^q]: note\n * child\n\nr[^q]\n', '* child'],
  ] as const
  for (const [name, source, text] of cases) {
    it(name, () => {
      const html = carveToHtml(source)
      expect(html).toContain(`\n${text}<a href="#fnref1"`)
      expect(html).not.toContain('<li>c')
    })
  }

  it('still opens a sibling on the same axes', () => {
    expect(carveToHtml('- [^q]: note\n - child\n\nr[^q]\n')).toContain('<li>child</li>')
  })
})
