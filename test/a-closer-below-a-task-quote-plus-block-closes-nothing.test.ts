import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it('ends a task item quote\'s attached fence at a column-0 fence line (#4606)', () => {
  expect(carveToHtml('- [ ] > +\n      ```\n      k\n```\n').trim()).toBe(`<ul class="task-list">
  <li><input type="checkbox" disabled> 
    <blockquote>
      <pre><code>k
</code></pre>
    </blockquote>
  </li>
</ul>
<pre><code></code></pre>`)
})

it('does the same for a checked task and a tilde fence (#4606)', () => {
  expect(carveToHtml('- [x] > +\n      ~~~\n      k\n~~~\n').trim()).toBe(`<ul class="task-list">
  <li data-task-state="x"><input type="checkbox" checked disabled> 
    <blockquote>
      <pre><code>k
</code></pre>
    </blockquote>
  </li>
</ul>
<pre><code></code></pre>`)
})

it('opens a div at a column-0 colon line below a quote\'s attached admonition (#4606)', () => {
  expect(carveToHtml('- > +\n  ::: note\n  k\n:::\n').trim()).toBe(`<ul>
  <li>
    <blockquote>
      <aside class="admonition note" aria-label="Note">
        <p>k</p>
      </aside>
    </blockquote>
  </li>
</ul>
<div>

</div>`)
})

it('opens it below a task item quote too (#4606)', () => {
  expect(carveToHtml('- [ ] > +\n      ::: note\n      k\n:::\n').trim()).toBe(`<ul class="task-list">
  <li><input type="checkbox" disabled> 
    <blockquote>
      <aside class="admonition note" aria-label="Note">
        <p>k</p>
      </aside>
    </blockquote>
  </li>
</ul>
<div>

</div>`)
})
