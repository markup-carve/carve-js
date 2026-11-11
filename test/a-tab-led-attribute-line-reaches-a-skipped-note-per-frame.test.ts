import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// carve#5987 (corpus 1075): a `+` looking past a note measures the note's body lines per frame
// (PART 9 §24 C5), so a tab after the item's three columns reaches the note body at column 7.
const note = '<p>p<a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a></p>\n<section role="doc-endnotes" aria-label="Footnotes">\n  <hr>\n  <ol>\n    <li id="fn1">\n' +
  '      <p>n<a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a></p>\n    </li>\n  </ol>\n</section>'

it('keeps a tab-led attribute line in the note a nested plus passes', () => {
  for (const lead of ['   \t', '   \t ', '    \t', '   \t\t']) {
    expect(carveToHtml(`1. x\n   1. +\n   [^m]: n\n${lead}{#i}\n   q\n\np[^m]\n`)).toBe(
      '<ol>\n  <li>x\n    <ol>\n      <li>q</li>\n    </ol>\n  </li>\n</ol>\n' + note,
    )
  }
})

it('keeps a tab-led attribute line in the note under a bullet host', () => {
  expect(carveToHtml('- x\n  - +\n  [^m]: n\n  \t{#i}\n  q\n\np[^m]\n')).toBe(
    '<ul>\n  <li>x\n    <ul>\n      <li>q</li>\n    </ul>\n  </li>\n</ul>\n' + note,
  )
})
