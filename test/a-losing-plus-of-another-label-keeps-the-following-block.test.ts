import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const notes = (first: string, second: string): string =>
  '<p>see<a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a><a id="fnref2" href="#fn2" role="doc-noteref"><sup>2</sup></a></p>\n' +
  '<section role="doc-endnotes" aria-label="Footnotes">\n  <hr>\n  <ol>\n' +
  `    <li id="fn1">\n${first}      <p><a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a></p>\n    </li>\n` +
  `    <li id="fn2">\n      <p>${second}<a href="#fnref2" role="doc-backlink" aria-label="Back to reference">↩</a></p>\n    </li>\n` +
  '  </ol>\n</section>'
const list = '      <ul>\n        <li>item</li>\n      </ul>\n'

it('keeps the block below a losing plus of another label in the pending note (carve#5482)', () => {
  // Corpus rows 981-2 and 981-3.
  expect(carveToHtml('[^n]: +\n[^m]: d1\n[^m]: +\n  - item\n\nsee[^n][^m]\n')).toBe(notes(list, 'd1'))
  expect(carveToHtml('[^n]: +\n[^m]: d1\n[^m]: +\n\n  - item\n\nsee[^n][^m]\n')).toBe(notes(list, 'd1'))
})

it('reads the losing lead the same with a comment in it or with the pending label losing', () => {
  for (const lead of ['[^m]: d1\n%% c\n[^m]: +', '[^m]: d1\n[^n]: +']) {
    const html = carveToHtml(`[^n]: +\n${lead}\n  - item\n\nsee[^n][^m]\n`)
    expect(html).toBe(notes(list, 'd1'))
  }
})

it('gives the block to a winning later plus note the earlier plus looked past (carve#5542, corpus row 998)', () => {
  const html = carveToHtml('[^n]: +\n[^m]: +\n[^m]: +\n  - item\n\nsee[^n][^m]\n')
  expect(html).toContain('<li id="fn1">\n      <p><a href="#fnref1"')
  expect(html).toContain('<li id="fn2">\n      <ul>\n        <li>item</li>')
})

it('attaches a quote below a losing plus of another label', () => {
  const html = carveToHtml('[^n]: +\n[^m]: d1\n[^m]: +\n> q\n\nsee[^n][^m]\n')
  expect(html).toBe(notes('      <blockquote><p>q</p></blockquote>\n', 'd1'))
})
