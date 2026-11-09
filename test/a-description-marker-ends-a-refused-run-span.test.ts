import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it('ends a refused-run description at the next description marker (carve#5592)', () => {
  expect(carveToHtml(':: t\n: +\n{.x\n.y}\n```\n: d\n```\n').trim()).toBe(
    '<dl>\n  <dt>t</dt>\n  <dd>{.x\n.y}\n<code></code></dd>\n  <dd>d</dd>\n</dl>\n<pre><code></code></pre>')
})

it('reads a fence below the new description at the document', () => {
  expect(carveToHtml(':: t\n: +\n{.x\n.y}\n```\n:  d\n  ```\n').trim()).toBe(
    '<dl>\n  <dt>t</dt>\n  <dd>{.x\n.y}\n<code></code></dd>\n  <dd>d</dd>\n</dl>\n<pre><code></code></pre>')
})

it('ends a refused-run item at a sibling marker', () => {
  expect(carveToHtml('- +\n{.x\n.y}\n```\n- d\n```\n').trim()).toBe(
    '<ul>\n  <li>{.x\n.y}\n<code></code></li>\n  <li>d</li>\n</ul>\n<pre><code></code></pre>')
})

it('keeps a list marker inside a description span', () => {
  expect(carveToHtml(':: t\n: +\n{.x\n.y}\n```\n- d\n```\n').trim()).toBe(
    '<dl>\n  <dt>t</dt>\n  <dd>{.x\n.y}\n<code>\n- d\n</code></dd>\n</dl>')
})
