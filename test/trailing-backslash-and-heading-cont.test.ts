import { describe, expect, it } from 'vitest'

import { carveToHtml } from '../src/index.js'

describe('trailing backslash at end of input is a hard break', () => {
  it('emits <br> for a backslash at end of a paragraph at EOF', () => {
    expect(carveToHtml('para\\')).toBe('<p>para<br>\n</p>')
  })

  it('still emits <br> for a normal mid-paragraph hard break', () => {
    expect(carveToHtml("a\\\nb\n")).toBe('<p>a<br>\nb</p>')
  })

  it('does not change a trailing escaped punctuation', () => {
    expect(carveToHtml('a\\*')).toBe('<p>a*</p>')
  })
})

describe('bare same-level # does not continue a heading', () => {
  it('is a paragraph between two headings, contributing no title text', () => {
    // Nothing folds into a heading any more, and a bare `#` has no content so
    // it is not a heading itself.
    expect(carveToHtml("# h\n\n#\n\n# x\n")).toBe(
      '<section id="h">\n  <h1>h</h1>\n  <p>#</p>\n</section>\n<section id="x">\n  <h1>x</h1>\n</section>',
    )
  })

  it('a different-level bare marker still starts a new heading', () => {
    expect(carveToHtml("# a\n\n# b\n")).toBe(
      '<section id="a">\n  <h1>a</h1>\n</section>\n' +
        '<section id="b">\n  <h1>b</h1>\n</section>',
    )
  })
})
