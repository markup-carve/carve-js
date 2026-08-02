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

describe('a bare # line does not continue a heading', () => {
  it('is a content-less marker line, so it is literal text between two headings', () => {
    // Under multi-line headings this joined `h` and `x` into one title with the
    // id `h-x`. A heading now ends at its newline, so each `#` line stands alone
    // and the content-less one is not a heading at all.
    expect(carveToHtml('# h\n#\n# x')).toBe(
      '<section id="h">\n  <h1>h</h1>\n  <p>#</p>\n</section>\n' +
        '<section id="x">\n  <h1>x</h1>\n</section>',
    )
  })

  it('a different-level bare marker still starts a new heading', () => {
    expect(carveToHtml('# a\n\n# b')).toBe(
      '<section id="a">\n  <h1>a</h1>\n</section>\n' +
        '<section id="b">\n  <h1>b</h1>\n</section>',
    )
  })
})
