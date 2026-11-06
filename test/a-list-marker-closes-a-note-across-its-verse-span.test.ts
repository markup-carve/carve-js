import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const note = (verse: string) =>
  '<section role="doc-endnotes" aria-label="Footnotes">\n  <hr>\n  <ol>\n    <li id="fn1">\n' +
  `      <div class="line-block">\n        <p>${verse}</p>\n      </div>\n` +
  '      <p><a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a></p>\n    </li>\n  </ol>\n</section>'
const ref = '<p>r<a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a></p>\n'

it('closes a note at a list marker below its column while a verse span is open (carve#5278)', () => {
  expect(carveToHtml('r[^n]\n\n[^n]: ::: |\n  x\n  %%%\n- b\n')).toBe(ref + '<ul>\n  <li>b</li>\n</ul>\n' + note('x'))
})

it('closes it when the span has a closer after the marker', () => {
  expect(carveToHtml('r[^n]\n\n[^n]: ::: |\n  x\n  %%%\n- b\n  %%%\nc\n')).toContain('<ul>\n  <li>b</li>\n</ul>\n<p>c</p>\n')
})

it('still folds a text line into the stanza the span interrupted', () => {
  expect(carveToHtml('r[^n]\n\n[^n]: ::: |\n  x\n  %%%\nb\n')).toBe(ref + note('x<br>\nb'))
})
