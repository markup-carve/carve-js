import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const ENDED = '<ul>\n  <li>\n    <ul>\n      <li>\n        <pre><code></code></pre>\n      </li>\n    </ul>\n'

it('folds an unpaired fence line of the other character into the outer tail', () => {
  expect(carveToHtml('- - +\n  ```\n\n  tail\n    ~~~\n')).toBe(`${ENDED}    <p>tail\n~~~</p>\n  </li>\n</ul>`)
})

it('folds an unpaired fence line with an info string', () => {
  expect(carveToHtml('- - +\n  ````\n\n  tail\n    ``` js\n')).toBe(`${ENDED}    <p>tail\n<code> js</code></p>\n  </li>\n</ul>`)
})

it('opens a paired fence of the other character', () => {
  expect(carveToHtml('- - +\n  ```\n\n  tail\n    ~~~\n    x\n    ~~~\n')).toBe(
    `${ENDED}    <p>tail</p>\n    <pre><code>x\n</code></pre>\n  </li>\n</ul>`,
  )
})

it('opens it after a single host', () => {
  expect(carveToHtml('- +\n```\n\nx\n ~~~\n')).toBe(
    '<ul>\n  <li>\n    <pre><code></code></pre>\n  </li>\n</ul>\n<p>x</p>\n<pre><code></code></pre>',
  )
})
