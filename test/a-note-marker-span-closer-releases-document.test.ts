import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it('releases a document line after a note item marker span closes below the note body (carve#5314)', () => {
  expect(carveToHtml('[^n]: i\n  . %%%\n    n\n%%%\nzz\n\n[^n]\n')).toBe(
    '<p>zz</p>\n<p><a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a></p>\n<section role="doc-endnotes" aria-label="Footnotes">\n  <hr>\n  <ol>\n    <li id="fn1">\n      <p>i</p>\n      <ol>\n        <li></li>\n      </ol>\n      <p><a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a></p>\n    </li>\n  </ol>\n</section>',
  )
})
