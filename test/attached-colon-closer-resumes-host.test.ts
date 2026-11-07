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

it.each(['- +\n::: |\n\n   :::: \n', ':: t\n: +\n::: |\n\n   :::: \n', '[^1]: +\n::: |\n\n   :::: \n\n[^1]\n'])(
  'reads a wider colon run in the resumed host at an offset column (carve#5414): %s', source => {
    expect(carveToHtml(source)).toMatch(/<div class="line-block">\n\s*<\/div>\n\s*<div>\n\s*<\/div>/)
  },
)
