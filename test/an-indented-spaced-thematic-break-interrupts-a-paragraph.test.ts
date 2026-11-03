import { describe, expect, it } from 'vitest'
import { carveToHtml, parse, renderHtml } from '../src/index.js'

// A spaced break (`- - -`, `* * *`) is tested before a list marker (PART 2
// thematic_break) and interrupts a paragraph and a quote's lazy text
// (CARVE-P2-008) at any indent, as an unspaced one does. Expected HTML is the
// spec model's.
describe('an indented spaced thematic break interrupts a paragraph', () => {
  const cases: Array<[string, string]> = [
    ['> para\n   - - -\n', '<blockquote><p>para</p></blockquote><hr>'],
    ['> para\n   * * *\n', '<blockquote><p>para</p></blockquote><hr>'],
    ['para\n - - -\n', '<p>para</p><hr>'],
    ['para\n      * * *\n', '<p>para</p><hr>'],
    ['> para\n>   - - -\nx\n', '<blockquote><p>para</p><hr></blockquote><p>x</p>'],
    ['- a\n  b\n     - - -\n', '<ul><li>a\nb\n    <hr></li></ul>'],
    ['para\n   *  * *\n', '<p>para\n*  * *</p>'],
  ]
  it.each(cases)('%j', (source, html) => {
    for (const actual of [carveToHtml(source), renderHtml(parse(source))]) {
      expect(actual.replace(/>\s+</g, '><').trim()).toBe(html)
    }
  })
})
