import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// A fence opened behind an item marker on a note's marker line is no paragraph,
// so a column-0 line below it is not lazy text (CARVE-P0-013, PART 0 S4).
// Expectations are the spec model's (markup-carve/carve#4327).
const ref = '<p><a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a></p>'
const note = (list: string): string =>
  '<section role="doc-endnotes" aria-label="Footnotes">\n  <hr>\n  <ol>\n    <li id="fn1">\n' +
  `      <${list}>\n        <li>\n          <pre><code class="language-js"></code></pre>\n        </li>\n      </${list}>\n` +
  '      <p><a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a></p>\n    </li>\n  </ol>\n</section>'

describe('a fence a note marker-line item opens', () => {
  it.each([
    ['a note at document level', '[^n]: - ```js\ntail\n\n[^n]\n', `<p>tail</p>\n${ref}\n${note('ul')}`],
    ['an ordered item', '[^n]: 1. ```js\ntail\n\n[^n]\n', `<p>tail</p>\n${ref}\n${note('ol')}`],
    ['a note on an item marker line', '- [^n]: - ```js\ntail\n\n[^n]\n', `<ul>\n  <li></li>\n</ul>\n<p>tail</p>\n${ref}\n${note('ul')}`],
    ['inside a quote', '> [^n]: - ```js\n> tail\n>\n> [^n]\n', `<blockquote>\n  <p>tail</p>\n  ${ref}\n</blockquote>\n${note('ul')}`],
  ])('%s', (_name, source, html) => {
    expect(carveToHtml(source).trim()).toBe(html)
  })
  it('without a reference the note renders nothing', () => {
    expect(carveToHtml('[^n]: - ``` js\ntail\n').trim()).toBe('<p>tail</p>')
  })
})
