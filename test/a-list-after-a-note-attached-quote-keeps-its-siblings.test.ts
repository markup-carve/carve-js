import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// carve-js#4658: a list marker cannot fold into a quote a footnote's marker-line `+` took, as for an
// item or a description (PART 0 S3, S4), so the list keeps its sibling markers.
const norm = (html: string): string => html.replace(/\s+/g, ' ').replace(/> </g, '><').trim()
const backlink = '<p><a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a></p>'

it('opens a list after the note for markers short of its body column', () => {
  expect(carveToHtml('[^1]: +\n> q\n - y\n  - z\n\n[^1]\n')).toContain(`<ul>
  <li>y</li>
  <li>z</li>
</ul>`)
})

it.each([
  ['in the note', '[^1]: +\n> q\n   - y\n  - z\n\n[^1]\n', `<li id="fn1"><blockquote><p>q</p></blockquote><ul><li>y</li><li>z</li></ul>${backlink}</li>`],
  ['in a quoted note', '> [^1]: +\n> > q\n>  - y\n>   - z\n>\n\n[^1]\n', '<blockquote><ul><li>y</li><li>z</li></ul></blockquote>'],
  ['after a two-line quote', '[^1]: +\n> q\n> r\n - y\n  - z\n\n[^1]\n', '<ul><li>y</li><li>z</li></ul>'],
])('keeps both markers in one list %s', (_name, source, html) => {
  expect(norm(carveToHtml(source))).toContain(html)
})

// An attribute run before the quote leads the block the `+` pulls, so the quote is still the attached one.
it.each([
  ['an item', '- +\n{.c}\n> q\n- y\n - z\n', '<ul><li><blockquote class="c"><p>q</p></blockquote></li><li>y</li><li>z</li></ul>'],
  ['an item, in the host', '- +\n{.c}\n> q\n  # g\n', '<ul><li><blockquote class="c"><p>q</p></blockquote><h1 id="g">g</h1></li></ul>'],
])('ends an attribute-led attached quote in %s', (_name, source, html) => {
  expect(norm(carveToHtml(source))).toBe(html)
})

it('still folds plain text into the quote', () => {
  expect(norm(carveToHtml('[^1]: +\n> q\n tail\n\n[^1]\n'))).toContain('<blockquote><p>q tail</p></blockquote>')
})
