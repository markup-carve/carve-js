import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const closed = (payload: string) => `<ul>\n  <li>\n    <pre><code>\n${payload}</code></pre>\n  </li>\n</ul>`

it('closes a column-0 plus fence at a shifted closer past a payload line (carve-js#4763)', () => {
  expect(carveToHtml('- +\n```\n\nx\n ```\n').trim()).toBe(closed('x\n'))
})

it('keeps every payload line and blank up to the closer', () => {
  expect(carveToHtml('- +\n```\n\nx\n   y\n\n- z\n ```\n').trim()).toBe(closed('x\n   y\n\n- z\n'))
})

it('reads the closer below an ordered item content column', () => {
  expect(carveToHtml('1. +\n~~~\n\nx\n  ~~~\n').trim()).toBe('<ol>\n  <li>\n    <pre><code>\nx\n</code></pre>\n  </li>\n</ol>')
})

it('leaves a run at the content column to the document paragraph', () => {
  expect(carveToHtml('- +\n```\n\nx\n  ```\n').trim()).toBe('<ul>\n  <li>\n    <pre><code></code></pre>\n  </li>\n</ul>\n<p>x\n<code></code></p>')
})

it('bounds the closer by a list marker that follows the blank', () => {
  expect(carveToHtml('1. +\n```\n\n- z\n  ```\n').trim()).toBe(closed('- z\n').replace('<ul>', '<ol>').replace('</ul>', '</ol>'))
})

it('keeps a lone plus fence ending at its blank', () => {
  expect(carveToHtml('- x\n+\n```\na\n\nb\n ```\n').trim()).toBe('<ul>\n  <li>x\n    <pre><code>a\n\n</code></pre>\n  </li>\n</ul>\n<p>b\n<code></code></p>')
})
