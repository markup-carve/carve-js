import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const normalize = (html: string) => html.replace(/\s+/g, ' ').replace(/ ?(<[^>]+>) ?/g, '$1').trim()

const note = (body: string) => '<section role="doc-endnotes" aria-label="Footnotes"><hr><ol><li id="fn1">' + body +
  '<a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a></p></li></ol></section>'
const ref = '<p>x<a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a></p>'

// carve-js#4015: with no exact-width closer ahead, the opener is one line comment (CARVE-P9-053),
// so the wider run below the column is a comment that closes nothing (carve#4862).
it('keeps a description past a wider comment run below a closerless opener', () => {
  expect(normalize(carveToHtml(':: t\n: head\n\n  %%%\n%%%%%\n  tail\n'))).toBe(normalize(
    '<dl><dt>t</dt><dd>head</dd></dl>',
  ))
})

it('keeps a note body past a wider comment run below a closerless opener', () => {
  expect(normalize(carveToHtml('[^f]: head\n  %%%%\n%%%%%%\n  tail\n\nx[^f]\n'))).toBe(normalize(
    `${ref}${note('<p>head')}`,
  ))
})

it('opens the span of a later opener after a closerless one', () => {
  expect(normalize(carveToHtml(':: t\n: head\n  %%%\n  %%%%\n  c\n%%%%\n  tail\n'))).toBe(normalize(
    '<dl><dt>t</dt><dd>head</dd></dl>',
  ))
})

it('keeps an exact-width closer below the column in the description span', () => {
  expect(normalize(carveToHtml(':: t\n: head\n\n  %%%%\n%%%%\n  tail\n'))).toBe(normalize(
    '<dl><dt>t</dt><dd><p>head</p><p>tail</p></dd></dl>',
  ))
})
