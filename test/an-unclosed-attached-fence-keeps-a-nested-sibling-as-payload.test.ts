import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it('keeps a sibling marker in an unclosed attached fence until its first blank (#4716)', () => {
  expect(carveToHtml('- - +\n  ```\n  - z\n\n    q\n')).toBe(`<ul>
  <li>
    <ul>
      <li>
        <pre><code>- z
</code></pre>
        <p>q</p>
      </li>
    </ul>
  </li>
</ul>`)
})
