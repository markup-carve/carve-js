import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const backlink = (n: number): string =>
  `<a href="#fnref${n}" role="doc-backlink" aria-label="Back to reference">↩</a>`

describe('a later plus note looked past by an earlier one (carve#5542)', () => {
  it('gives a block below its body column to the later note', () => {
    const html = carveToHtml('[^m]: +\n[^n]: +\n para\n\nsee[^m][^n]\n')
    expect(html).not.toContain('<p>para</p>')
    expect(html).toContain(`<li id="fn1">\n      <p>${backlink(1)}</p>`)
    expect(html).toContain(`<li id="fn2">\n      <p>para${backlink(2)}</p>`)
  })

  it('keeps the lazy lines of that block in the later note', () => {
    for (const source of [
      '[^m]: +\n[^n]: +\n para\n more\n\nsee[^m][^n]\n',
      '[^m]: +\n%% c\n[^n]: +\n para\n more\n\nsee[^m][^n]\n',
    ]) {
      expect(carveToHtml(source)).toContain(`<li id="fn2">\n      <p>para\nmore${backlink(2)}</p>`)
    }
  })

  it('passes the block down a chain of three notes to the last one', () => {
    const html = carveToHtml('[^a]: +\n[^b]: +\n[^c]: +\n para\n\nsee[^a][^b][^c]\n')
    expect(html).toContain(`<li id="fn3">\n      <p>para${backlink(3)}</p>`)
  })

  it('still gives a block at the marker column to the first note', () => {
    const html = carveToHtml('[^m]: +\n[^n]: +\npara\n\nsee[^m][^n]\n')
    expect(html).toContain(`<li id="fn1">\n      <p>para${backlink(1)}</p>`)
    expect(html).toContain(`<li id="fn2">\n      <p>${backlink(2)}</p>`)
  })
})
