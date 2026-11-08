import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const backlink = (n: number): string =>
  `<a href="#fnref${n}" role="doc-backlink" aria-label="Back to reference">↩</a>`

describe('the block below interleaved losing note pluses (carve#5528)', () => {
  it('gives the paragraph past the blank to the later note (corpus row 992)', () => {
    const html = carveToHtml('[^m]: +\n[^n]: +\n[^n]: +\n\n  para\n\nsee[^m][^n]\n')
    expect(html).toContain(`<li id="fn1">\n      <p>${backlink(1)}</p>`)
    expect(html).toContain(`<li id="fn2">\n      <p>para${backlink(2)}</p>`)
  })

  it('reads a same-label loser behind a comment line as one without it', () => {
    for (const source of ['[^n]: +\n%% c\n[^n]: +\n\n  para\n\nx[^n]\n', '- h\n  [^n]: +\n  %% c\n  [^n]: +\n\n    para\n\nx[^n]\n']) {
      expect(carveToHtml(source)).toContain(`<li id="fn1">\n      <p>para${backlink(1)}</p>`)
    }
  })
})
