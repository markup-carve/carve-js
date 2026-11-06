import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it('keeps a line at a stacked inner item content column in that item (#4608)', () => {
  expect(carveToHtml('- - > +\n    # h\n    after\n').trim()).toBe(`<ul>
  <li>
    <ul>
      <li>
        <blockquote>
          <h1 id="h">h</h1>
        </blockquote>
        after
      </li>
    </ul>
  </li>
</ul>`)
})

it('keeps a line after a stacked fence in the inner item (#4608)', () => {
  expect(carveToHtml('- - > +\n    ```\n    c\n    ```\n    after\n').trim()).toBe(`<ul>
  <li>
    <ul>
      <li>
        <blockquote>
          <pre><code>c
</code></pre>
        </blockquote>
        after
      </li>
    </ul>
  </li>
</ul>`)
})

it('still gives the outer item a line at its own column (#4608)', () => {
  expect(carveToHtml('- - > +\n    # h\n  after\n').trim()).toBe(`<ul>
  <li>
    <ul>
      <li>
        <blockquote>
          <h1 id="h">h</h1>
        </blockquote>
      </li>
    </ul>
    after
  </li>
</ul>`)
})
