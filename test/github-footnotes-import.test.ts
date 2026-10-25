import { expect, it } from 'vitest'
import { migrateHtml } from '../src/index.js'

it('imports GitHub footnotes and removes their navigation markup', () => {
  const html = '<p>x<sup><a href="#fn-1" id="fnref-1" data-footnote-ref>1</a></sup></p>'
    + '<section data-footnotes class="footnotes"><h2 class="sr-only">Footnotes</h2>'
    + '<ol><li id="fn-1"><p>note <a href="#fnref-1" data-footnote-backref class="data-footnote-backref">↩</a></p></li></ol></section>'
  const result = migrateHtml(html)
  expect(result.value).toContain('x[^1]')
  expect(result.value).toContain('[^1]: note')
  expect(result.value).not.toContain('Footnotes')
  expect(result.value).not.toContain('↩')
})

it('resolves perturbed GitHub footnote fragments and repeated references', () => {
  const html = '<p>A<sup><a href="#note-x" id="fnref-1" data-footnote-ref>X</a></sup> '
    + 'B<sup><a href="#note-x" id="fnref-1-2" data-footnote-ref>X</a></sup></p>'
    + '<section data-footnotes><h3 class="sr-only">Notes</h3><ol><li id="note-x"><p>body '
    + '<a href="#fnref-1" data-footnote-backref>back</a></p></li></ol></section>'
  const value = migrateHtml(html).value
  expect(value).toContain('A[^1] B[^1]')
  expect(value).toContain('[^1]: body')
  expect(value).not.toContain('Notes')
  expect(value).not.toContain('back')
})
