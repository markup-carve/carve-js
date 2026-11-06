import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const note = (verse: string) =>
  '<section role="doc-endnotes" aria-label="Footnotes">\n  <hr>\n  <ol>\n    <li id="fn1">\n' +
  `      <div class="line-block">\n        <p>${verse}</p>\n      </div>\n` +
  '      <p><a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a></p>\n    </li>\n  </ol>\n</section>'
const ref = '<p>r<a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a></p>\n'

it('folds a lazy line into the open stanza of a note leading a description body (carve-js#4540)', () => {
  expect(carveToHtml(':: t\n: [^n]: ::: |\n    x\nb\n\nr[^n]\n')).toBe(
    '<dl>\n  <dt>t</dt>\n  <dd></dd>\n</dl>\n' + ref + note('x<br>\nb'))
})

it('folds it into a note leading a list item', () => {
  expect(carveToHtml('- [^n]: ::: |\n    x\nb\n\nr[^n]\n')).toBe('<ul>\n  <li></li>\n</ul>\n' + ref + note('x<br>\nb'))
})

it('takes no lazy line once the line block has closed', () => {
  expect(carveToHtml('- [^n]: ::: |\n    x\n    :::\nb\n\nr[^n]\n')).toContain('</ul>\n<p>b</p>\n')
})
