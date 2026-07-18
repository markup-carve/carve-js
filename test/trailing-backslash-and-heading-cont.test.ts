import { describe, expect, it } from 'vitest'

import { carveToHtml } from '../src/index.js'

describe('trailing backslash at end of input is a hard break', () => {
  it('emits <br> for a backslash at end of a paragraph at EOF', () => {
    expect(carveToHtml('para\\')).toBe('<p>para<br>\n</p>')
  })

  it('still emits <br> for a normal mid-paragraph hard break', () => {
    expect(carveToHtml('a\\\nb')).toBe('<p>a<br>\nb</p>')
  })

  it('does not change a trailing escaped punctuation', () => {
    expect(carveToHtml('a\\*')).toBe('<p>a*</p>')
  })
})

describe('bare same-level # continues a heading', () => {
  it('joins marker lines with a single newline, contributing no content', () => {
    expect(carveToHtml('# h\n#\n# x')).toBe(
      '<section id="h-x">\n  <h1>h\nx</h1>\n</section>',
    )
  })

  it('a different-level bare marker still starts a new heading', () => {
    expect(carveToHtml('# a\n\n# b')).toBe(
      '<section id="a">\n  <h1>a</h1>\n</section>\n' +
        '<section id="b">\n  <h1>b</h1>\n</section>',
    )
  })
})
