import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it('folds a colon line after its marker-line term has ended (carve#5368)', () => {
  expect(carveToHtml('- :: t\n   a\n  : x\n: z\n').trim()).toBe(`<ul>
  <li>
    <dl>
      <dt>t</dt>
    </dl>
    a
: x
: z
  </li>
</ul>`)
})

it('keeps a colon line one column right of a task marker in the stanza', () => {
  expect(carveToHtml('* [ ] a\n      :: t\n      : u\n        ::: |\n          x\n : b\n').trim()).toContain('<p>&nbsp;&nbsp;x<br>\n: b</p>')
})

it('folds through a released outer paragraph after the nested item (carve#5373)', () => {
  expect(carveToHtml('- - a\n    :: t\n    : u\n      ::: |\n        x\n  : b\n: c\n').trim()).toBe(`<ul>
  <li>
    <ul>
      <li>a
        <dl>
          <dt>t</dt>
          <dd>
            <p>u</p>
            <div class="line-block">
              <p>&nbsp;&nbsp;x</p>
            </div>
          </dd>
        </dl>
      </li>
    </ul>
    : b
: c
  </li>
</ul>`)
})

it('does not count a literal term in a code fence as an open definition', () => {
  expect(carveToHtml('- a\n  ```\n  :: t\n  ```\n  b\n: x\n').trim()).toBe(`<ul>
  <li>a
    <pre><code>:: t
</code></pre>
    b
: x
  </li>
</ul>`)
})
