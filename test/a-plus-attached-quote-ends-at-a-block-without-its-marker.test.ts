import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// carve#5427: a quote a marker-line `+` takes ends at a later line without `>` that cannot fold
// into its paragraph, and the host reads that line (CARVE-P0-024, PART 0 S4). Corpus row 976 on carve main.
it.each([
  [
    "976-a-block-at-the-host-column-after-a-plus-attached-quote-stays-in-the-host-2",
    "- +\n> q\n  ::: w\n  :::\n",
    `<ul>
  <li>
    <blockquote><p>q</p></blockquote>
    <div class="w">

    </div>
  </li>
</ul>`,
  ],
  [
    "976-a-block-at-the-host-column-after-a-plus-attached-quote-stays-in-the-host-3",
    "[^1]: +\n> q\n  # g\n\n[^1]\n",
    `<p><a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a></p>
<section role="doc-endnotes" aria-label="Footnotes">
  <hr>
  <ol>
    <li id="fn1">
      <blockquote><p>q</p></blockquote>
      <h1 id="g">g</h1>
      <p><a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a></p>
    </li>
  </ol>
</section>`,
  ],
  [
    "976-a-block-at-the-host-column-after-a-plus-attached-quote-stays-in-the-host-4",
    ":: t\n: +\n> q\n  ::: w\n  :::\n",
    `<dl>
  <dt>t</dt>
  <dd>
    <blockquote><p>q</p></blockquote>
    <div class="w">

    </div>
  </dd>
</dl>`,
  ],
  [
    "976-a-block-at-the-host-column-after-a-plus-attached-quote-stays-in-the-host",
    "- +\n> q\n  # g\n",
    `<ul>
  <li>
    <blockquote><p>q</p></blockquote>
    <h1 id="g">g</h1>
  </li>
</ul>`,
  ],
])('%s', (_name, source, html) => {
  expect(carveToHtml(source).trim()).toBe(html)
})

it.each([
  ['a list marker', '- +\n> q\n  - y\n', '<ul><li><blockquote><p>q</p></blockquote><ul><li>y</li></ul></li></ul>'],
  ['an attribute line', '- +\n> q\n  {.c}\n  # g\n', '<ul><li><blockquote><p>q</p></blockquote><h1 class="c" id="g">g</h1></li></ul>'],
  ['a line below the host column', '- +\n> q\n # g\n', '<ul><li><blockquote><p>q</p></blockquote></li></ul><section id="g"><h1>g</h1></section>'],
])('ends the attached quote at %s', (_name, source, html) => {
  expect(carveToHtml(source).replace(/\s+/g, ' ').replace(/> </g, '><').trim()).toBe(html)
})

it.each([
  ['plain text', '- +\n> q\n  tail\n', '<ul><li><blockquote><p>q tail</p></blockquote></li></ul>'],
  ['a caption', '- +\n> q\n^ cap\n', '<ul><li><figure><blockquote><p>q</p></blockquote><figcaption>cap</figcaption></figure></li></ul>'],
])('keeps %s with the attached quote', (_name, source, html) => {
  expect(carveToHtml(source).replace(/\s+/g, ' ').replace(/> </g, '><').trim()).toBe(html)
})
