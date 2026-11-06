import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it('ends an unclosed attached fence at the first blank', () => {
  expect(carveToHtml(':: t\n: +\n```\n\n\nz\n').trim()).toBe(`<dl>
  <dt>t</dt>
  <dd>
    <pre><code></code></pre>
  </dd>
</dl>
<p>z</p>`)
})

it('keeps the blank as payload when the next line reaches the description body', () => {
  expect(carveToHtml(':: t\n: +\n~~~\n\n  p\n').trim()).toBe(`<dl>
  <dt>t</dt>
  <dd>
    <pre><code>
p
</code></pre>
  </dd>
</dl>`)
})

it('ends the list before a below-column colon line after the blank', () => {
  expect(carveToHtml(':: t\n: +\n```\n\n : text\n').trim()).toBe(`<dl>
  <dt>t</dt>
  <dd>
    <pre><code></code></pre>
  </dd>
</dl>
<p>: text</p>`)
})

it('keeps a blank inside a closed attached fence', () => {
  expect(carveToHtml(':: t\n: +\n```\n\n```\n\nz\n').trim()).toContain('<pre><code>\n</code></pre>')
})
