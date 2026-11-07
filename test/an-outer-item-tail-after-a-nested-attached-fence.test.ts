import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it('reads the tail after an unclosed nested attached fence in the outer item', () => {
  expect(carveToHtml('- - +\n  ```\n\n  tail\n    ```\n')).toBe(
    '<ul>\n  <li>\n    <ul>\n      <li>\n        <pre><code></code></pre>\n      </li>\n    </ul>\n    <p>tail\n<code></code></p>\n  </li>\n</ul>',
  )
})

it('opens a sibling list after the outer tail', () => {
  expect(carveToHtml('- - +\n  ```\n\n  tail\n  - z\n    ```\n')).toBe(
    '<ul>\n  <li>\n    <ul>\n      <li>\n        <pre><code></code></pre>\n      </li>\n    </ul>\n    <p>tail</p>\n    <ul>\n      <li>z\n        <pre><code></code></pre>\n      </li>\n    </ul>\n  </li>\n</ul>',
  )
})

it('opens a fence with a different delimiter after the released fence', () => {
  expect(carveToHtml('- - +\n  ```\n\n  tail\n    ~~~\n    x\n    ~~~\n')).toBe(
    '<ul>\n  <li>\n    <ul>\n      <li>\n        <pre><code></code></pre>\n      </li>\n    </ul>\n    <p>tail</p>\n    <pre><code>x\n</code></pre>\n  </li>\n</ul>',
  )
})

it('opens a later run when the released fence was two items deeper', () => {
  expect(carveToHtml('- - - +\n    ```\n\n  tail\n     ```\n')).toBe(
    '<ul>\n  <li>\n    <ul>\n      <li>\n        <ul>\n          <li>\n            <pre><code></code></pre>\n          </li>\n        </ul>\n      </li>\n    </ul>\n    <p>tail</p>\n    <pre><code></code></pre>\n  </li>\n</ul>',
  )
})

it('keeps consecutive sublist markers in one list', () => {
  expect(carveToHtml('- - +\n  ```\n\n  tail\n  - z\n  - y\n')).toBe(
    '<ul>\n  <li>\n    <ul>\n      <li>\n        <pre><code></code></pre>\n      </li>\n    </ul>\n    <p>tail</p>\n    <ul>\n      <li>z</li>\n      <li>y</li>\n    </ul>\n  </li>\n</ul>',
  )
})

it('keeps the attached fence open when a later run pairs with a deeper run', () => {
  expect(carveToHtml('- - +\n  ```\n\n  tail\n    ```\n  x\n    ```\n')).toBe(
    '<ul>\n  <li>\n    <ul>\n      <li>\n        <pre><code>\ntail\n</code></pre>\n      </li>\n    </ul>\n    x\n    <pre><code></code></pre>\n  </li>\n</ul>',
  )
})
