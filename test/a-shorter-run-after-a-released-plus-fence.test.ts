import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const ENDED = '<ul>\n  <li>\n    <pre><code></code></pre>\n  </li>\n</ul>\n'

it('opens a fence at a shorter run after an ended column-0 plus fence (carve#5604)', () => {
  expect(carveToHtml('- +\n````\n\nx\n ```\n')).toBe(`${ENDED}<p>x</p>\n<pre><code></code></pre>`)
})

it('opens it after an ordered or task host too', () => {
  expect(carveToHtml('10. +\n````\n\nx\n  ```\n')).toBe(`<ol start="10">\n  <li>\n    <pre><code></code></pre>\n  </li>\n</ol>\n<p>x</p>\n<pre><code></code></pre>`)
  expect(carveToHtml('- [ ] +\n~~~~\n\nx\n ~~~\n')).toBe(
    '<ul class="task-list">\n  <li><input type="checkbox" disabled> \n    <pre><code></code></pre>\n  </li>\n</ul>\n<p>x</p>\n<pre><code></code></pre>',
  )
})

it('opens it after a footnote host', () => {
  expect(carveToHtml('[^n]: +\n~~~~\n\nx\n ~~~\n')).toBe('<p>x</p>\n<pre><code></code></pre>')
})

it('still folds a shorter run into the outer tail after a stacked host', () => {
  expect(carveToHtml('- - +\n  ````\n\n  tail\n    ```\n')).toBe(
    '<ul>\n  <li>\n    <ul>\n      <li>\n        <pre><code></code></pre>\n      </li>\n    </ul>\n    <p>tail\n<code></code></p>\n  </li>\n</ul>',
  )
})
