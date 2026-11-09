import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it('keeps a marker-column payload before a shifted attached fence closer', () => {
  expect(carveToHtml('- - +\n  ```\n\n  x\n   ```\n').trim()).toBe(`<ul>
  <li>
    <ul>
      <li>
        <pre><code>
x
</code></pre>
      </li>
    </ul>
  </li>
</ul>`)
})

it('does not widen a line-block closer with the code-fence rule', () => {
  expect(carveToHtml('- - +\n  ::: |\n\n  x\n   :::\n').trim()).toBe(`<ul>
  <li>
    <ul>
      <li>
        <div class="line-block">

        </div>
      </li>
    </ul>
    <p>x
:::</p>
  </li>
</ul>`)
})
