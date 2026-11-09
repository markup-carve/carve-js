import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it('folds an unpaired run in the document after a stacked host releases its fence', () => {
  expect(carveToHtml('- - +\n  ```\n\nx\n   ~~~\n')).toBe(
    '<ul>\n  <li>\n    <ul>\n      <li>\n        <pre><code></code></pre>\n      </li>\n    </ul>\n  </li>\n</ul>\n<p>x\n~~~</p>',
  )
})

it('folds an unpaired run in the document after a column-zero host releases its fence', () => {
  expect(carveToHtml('- +\n```\n\ntail\n  ~~~\n')).toBe(
    '<ul>\n  <li>\n    <pre><code></code></pre>\n  </li>\n</ul>\n<p>tail\n~~~</p>',
  )
})

it('keeps a paired run as a new fence', () => {
  expect(carveToHtml('- +\n```\n\ntail\n  ~~~\n  body\n  ~~~\n')).toBe(
    '<ul>\n  <li>\n    <pre><code></code></pre>\n  </li>\n</ul>\n<p>tail</p>\n<pre><code>body\n</code></pre>',
  )
})

it('keeps a run below the host reach as a new fence', () => {
  expect(carveToHtml('- +\n````\n\ntail\n ```\n')).toBe(
    '<ul>\n  <li>\n    <pre><code></code></pre>\n  </li>\n</ul>\n<p>tail</p>\n<pre><code></code></pre>',
  )
})
