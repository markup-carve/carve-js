import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it('ends an item at a colon line after its marker-line term has ended', () => {
  expect(carveToHtml('- :: t\n   a\n  : x\n: z\n').trim()).toBe(`<ul>
  <li>
    <dl>
      <dt>t</dt>
    </dl>
    a
: x
  </li>
</ul>
<p>: z</p>`)
})

it('keeps a colon line one column right of a task marker in the stanza', () => {
  expect(carveToHtml('* [ ] a\n      :: t\n      : u\n        ::: |\n          x\n : b\n').trim()).toContain('<p>&nbsp;&nbsp;x<br>\n: b</p>')
})

it('ends each nested item at its own marker column', () => {
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
  </li>
</ul>
<p>: c</p>`)
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
