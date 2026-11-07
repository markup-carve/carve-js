import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it('leaves a document line after a second unclosed fence outside the list', () => {
  const source = '- - +\n  ```\n  c\n\n  ```\n  c\n  ```\nafter\n'
  expect(carveToHtml(source)).toBe('<ul>\n  <li>\n    <ul>\n      <li>\n        <pre><code>c\n\n</code></pre>\n      </li>\n    </ul>\n    c\n    <pre><code></code></pre>\n  </li>\n</ul>\n<p>after</p>')
})

it('ends every enclosing item after the fence at three list levels', () => {
  const source = '- - - +\n    ```\n    c\n\n    ```\n    c\n    ```\nafter\n'
  expect(carveToHtml(source)).toBe('<ul>\n  <li>\n    <ul>\n      <li>\n        <ul>\n          <li>\n            <pre><code>c\n\n</code></pre>\n          </li>\n        </ul>\n        c\n        <pre><code></code></pre>\n      </li>\n    </ul>\n  </li>\n</ul>\n<p>after</p>')
})
