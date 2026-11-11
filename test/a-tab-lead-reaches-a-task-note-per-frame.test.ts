import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// carve#5877: a leading tab is measured per frame (PART 0 L1, carve#5755). The item frame cuts the
// first tab to two spaces, the second walks to item column 4, short of the task note's body at 6.
const note = '<p>x<a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a></p>\n<section role="doc-endnotes" aria-label="Footnotes">\n  <hr>\n  <ol>\n    <li id="fn1">\n'

it('gives a tab-led quote short of a task note body to the item', () => {
  for (const lead of ['\t\t', '    \t', ' \t\t', '\t\t ']) {
    expect(carveToHtml(`- [ ] [^n]: t\n${lead}> x\n\nx[^n]\n`)).toBe(
      '<ul class="task-list">\n  <li><input type="checkbox" disabled> \n    <blockquote><p>x</p></blockquote>\n  </li>\n</ul>\n' +
      note + '      <p>t<a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a></p>\n    </li>\n  </ol>\n</section>',
    )
  }
})

it('gives a tab-led quote that reaches the body per frame to the note', () => {
  for (const lead of ['  \t  ', '  \t\t', '\t\t  ']) {
    expect(carveToHtml(`- [ ] [^n]: t\n${lead}> x\n\nx[^n]\n`)).toBe(
      '<ul class="task-list">\n  <li><input type="checkbox" disabled> </li>\n</ul>\n' + note +
      '      <p>t</p>\n      <blockquote><p>x</p></blockquote>\n      <p><a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a></p>\n    </li>\n  </ol>\n</section>',
    )
  }
})
