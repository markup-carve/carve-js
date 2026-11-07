import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// carve#5421: a block at a footnote's body column ends the paragraph its marker-line `+` pulled,
// and opens in the note (CARVE-P0-011, PART 9 §17 L3). Corpus row 975 on carve main.
it.each([
  [
    "975-a-block-at-a-pulled-footnote-column-opens-in-the-note-2",
    "[^1]\n\n[^1]: +\nh\n  {.c}\n  k\n",
    `<p><a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a></p>
<section role="doc-endnotes" aria-label="Footnotes">
  <hr>
  <ol>
    <li id="fn1">
      <p>h</p>
      <p class="c">k<a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a></p>
    </li>
  </ol>
</section>`,
  ],
  [
    "975-a-block-at-a-pulled-footnote-column-opens-in-the-note",
    "[^1]\n\n[^1]: +\nh\n  ```\nz\n",
    `<p><a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a></p>
<p>z</p>
<section role="doc-endnotes" aria-label="Footnotes">
  <hr>
  <ol>
    <li id="fn1">
      <p>h</p>
      <pre><code></code></pre>
      <p><a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a></p>
    </li>
  </ol>
</section>`,
  ],
])('%s', (_name, source, html) => {
  expect(carveToHtml(source).trim()).toBe(html)
})

const norm = (html: string): string => html.replace(/\s+/g, ' ').replace(/> </g, '><').trim()
it.each([
  ['a heading', '[^1]: +\nh\n  # g\n\n[^1]\n', '<p>h</p><h1 id="g">g</h1>'],
  ['an attribute run before the paragraph', '[^1]: +\n{.a}\nh\n  {.c}\n  k\n\n[^1]\n', '<p class="a">h</p><p class="c">k<a href="#fnref1"'],
  ['an attribute run before the paragraph and a heading', '[^1]: +\n{.a}\nh\n  # g\n\n[^1]\n', '<p class="a">h</p><h1 id="g">g</h1>'],
  ['an attribute run before the paragraph and a fence', '[^1]: +\n{.a}\nh\n  ```\n  c\n  ```\n\n[^1]\n', '<p class="a">h</p><pre><code>c </code></pre>'],
])('opens %s at the note body column in the note', (_name, source, inner) => {
  expect(norm(carveToHtml(source))).toContain(`<li id="fn1">${inner}`)
})

it('keeps plain text in the pulled paragraph', () => {
  expect(norm(carveToHtml('[^1]: +\n{.a}\nh\n  tail\n\n[^1]\n'))).toContain('<p class="a">h tail<a href="#fnref1"')
})
