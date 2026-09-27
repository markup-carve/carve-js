import { describe, expect, it } from 'vitest'
import { htmlToCarve } from '../src/index.js'

// PART 11 §2: the narrowing search leaves no idle escape where it can finish.
describe('the escape search reaches the minimal form', () => {
  it('writes a bracket pair split by a nested link bare', () => {
    const html = '<p class="n">* a</p><p><span class="c">[<a href="/u">x</a>]</span></p>'
    expect(htmlToCarve(html).value).toBe('{.n}\n\\* a\n\n[[[x](/u)]]{.c}\n')
  })

  it('finishes on a long document whose failing units are sparse', () => {
    const html =
      '<body>' +
      Array.from({ length: 1000 }, (_, i) =>
        i % 50 === 0 ? `<p class="n">* item ${i} and 1. two</p>` : `<p>note (${i}) here.</p>`,
      ).join('') +
      '</body>'
    const carve = htmlToCarve(html).value
    expect(carve.split('\\* item').length - 1).toBe(20)
    expect(carve).not.toContain('\\(')
    expect(carve).not.toContain('1\\.')
  })
})
