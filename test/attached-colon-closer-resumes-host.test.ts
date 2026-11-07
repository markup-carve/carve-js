import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const backlink = '<a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a>'

it('keeps a closed line block attached to an item through its later exact closer (carve#5405)', () => {
  expect(carveToHtml('- +\n::: |\n\n  ::: x\n  :::\n')).toBe(`<ul>
  <li>
    <div class="line-block">
      <p>::: x</p>
    </div>
  </li>
</ul>`)
  expect(carveToHtml('- +\n::: x\n\n  a\n  :::\n')).toBe(`<ul>
  <li>
    <div class="x">
      <p>a</p>
    </div>
  </li>
</ul>`)
})

it('resumes a footnote and description after an unclosed attached div (carve#5413)', () => {
  expect(carveToHtml('[^1]: +\n::: x\n\n  ::: y\n  b\n  :::\n\n[^1]\n')).toContain(`<li id="fn1">
      <div class="x">

      </div>
      <div class="y">
        <p>b</p>
      </div>
      <p>${backlink}</p>
    </li>`)
  expect(carveToHtml(':: t\n: +\n::: x\n\n  ::: y\n  b\n  :::\n')).toBe(`<dl>
  <dt>t</dt>
  <dd>
    <div class="x">

    </div>
    <div class="y">
      <p>b</p>
    </div>
  </dd>
</dl>`)
})

it('uses the outer attached opener when a div contains a closed line block (carve#5413)', () => {
  const body = '::: x\n::: |\nverse\n:::\n\n  ::: y\n  b\n  :::'
  expect(carveToHtml(`[^1]: +\n${body}\n\n[^1]\n`)).toContain(`<li id="fn1">
      <div class="x">
        <div class="line-block">
          <p>verse</p>
        </div>
      </div>
      <div class="y">
        <p>b</p>
      </div>
      <p>${backlink}</p>
    </li>`)
  expect(carveToHtml(`:: t\n: +\n${body}\n`)).toBe(`<dl>
  <dt>t</dt>
  <dd>
    <div class="x">
      <div class="line-block">
        <p>verse</p>
      </div>
    </div>
    <div class="y">
      <p>b</p>
    </div>
  </dd>
</dl>`)
})

it('does not treat inline code as an opaque fence when pairing an attached div (carve#5405)', () => {
  expect(carveToHtml('- +\n::: x\n```foo```\n\n  a\n  :::')).toBe(`<ul>
  <li>
    <div class="x">
      <p><code>foo</code></p>
      <p>a</p>
    </div>
  </li>
</ul>`)
})

it('treats a nested line block colon opener as verse when pairing its parent div (carve#5405)', () => {
  expect(carveToHtml('- +\n::: x\n::: |\n::: y\n:::\n\n  a\n  :::')).toBe(`<ul>
  <li>
    <div class="x">
      <div class="line-block">
        <p>::: y</p>
      </div>
      <p>a</p>
    </div>
  </li>
</ul>`)
})

it('pairs an outer attached div past verse in a nested line block in every host (carve#5405)', () => {
  const body = '::: x\n::: |\n::: y\n:::\n\n  a\n  :::'
  expect(carveToHtml(`[^1]: +\n${body}\n\n[^1]\n`)).toContain(`<li id="fn1">
      <div class="x">
        <div class="line-block">
          <p>::: y</p>
        </div>
        <p>a</p>
      </div>
      <p>${backlink}</p>
    </li>`)
  expect(carveToHtml(`:: t\n: +\n${body}\n`)).toBe(`<dl>
  <dt>t</dt>
  <dd>
    <div class="x">
      <div class="line-block">
        <p>::: y</p>
      </div>
      <p>a</p>
    </div>
  </dd>
</dl>`)
})

it.each(['- +\n::: |\n\n   :::: \n', ':: t\n: +\n::: |\n\n   :::: \n', '[^1]: +\n::: |\n\n   :::: \n\n[^1]\n'])(
  'reads a wider colon run in the resumed host at an offset column (carve#5414): %s', source => {
    expect(carveToHtml(source)).toMatch(/<div class="line-block">\n\s*<\/div>\n\s*<div>\n\s*<\/div>/)
  },
)

it('releases an attached line block to a document opener left of its host (carve#5450)', () => {
  expect(carveToHtml('[^1]: +\n::: |\n\n :::: \n\n[^1]\n')).toBe(`<div>
  <p><a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a></p>
</div>
<section role="doc-endnotes" aria-label="Footnotes">
  <hr>
  <ol>
    <li id="fn1">
      <div class="line-block">

      </div>
      <p>${backlink}</p>
    </li>
  </ol>
</section>`)
})
