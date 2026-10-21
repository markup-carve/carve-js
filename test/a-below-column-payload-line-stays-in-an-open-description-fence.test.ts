import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it('keeps a below-column payload line before a closer in the description', () => {
  expect(carveToHtml(':: m\n: l\n     ```\ne\n     ```\n')).toBe(`<dl>
  <dt>m</dt>
  <dd>
    <p>l</p>
    <pre><code>e
</code></pre>
  </dd>
</dl>`)
})

it('keeps a below-column fence run as payload until an eligible closer', () => {
  expect(carveToHtml(':: m\n: l\n     ```\n```\n     ```\n')).toBe(`<dl>
  <dt>m</dt>
  <dd>
    <p>l</p>
    <pre><code>\`\`\`
</code></pre>
  </dd>
</dl>`)
})

it('keeps payload in a fence one column past the body', () => {
  expect(carveToHtml(':: t\n: a\n   ```\n   b\n y\n   ```\n')).toBe(`<dl>
  <dt>t</dt>
  <dd>
    <p>a</p>
    <pre><code>b
y
</code></pre>
  </dd>
</dl>`)
})

it('leaves a below-column line outside an unclosed authored fence', () => {
  expect(carveToHtml(':: m\n: l\n    [n]:\n   ```\ntail\n')).toBe(`<dl>
  <dt>m</dt>
  <dd>
    <p>l</p>
    <pre><code></code></pre>
  </dd>
</dl>
<p>tail</p>`)
})

it('leaves a below-column line outside a fence opened after a blank', () => {
  expect(carveToHtml(':: m\n: l\n\n     ```\ne\n     ```\n')).toBe(`<dl>
  <dt>m</dt>
  <dd>
    <p>l</p>
    <pre><code></code></pre>
  </dd>
</dl>
<p>e
<code></code></p>`)
})

it('lets a below-column block opener end the description fence', () => {
  expect(carveToHtml(':: m\n: l\n     ```\n# h\n     ```\n')).toBe(`<dl>
  <dt>m</dt>
  <dd>l
<code></code></dd>
</dl>
<section id="h">
  <h1>h</h1>
  <p><code></code></p>
</section>`)
})

it('keeps the authored fence extent inside a list item', () => {
  expect(carveToHtml('- x\n  :: m\n  : l\n     ```\ne\n     ```\n')).toBe(`<ul>
  <li>x
    <dl>
      <dt>m</dt>
      <dd>
        <p>l</p>
        <pre><code>e
</code></pre>
      </dd>
    </dl>
  </li>
</ul>`)
})

it('ends a fence at the description body column before a below-column line', () => {
  expect(carveToHtml(':: t\n: a\n  ```\n  b\n y\n  ```\n')).toBe(`<dl>
  <dt>t</dt>
  <dd>
    <p>a</p>
    <pre><code>b
</code></pre>
  </dd>
</dl>
<p>y
<code></code></p>`)
})

it('ends an over-indented item fence at a below-column line', () => {
  expect(carveToHtml('- a\n    ```\n    b\ny\n    ```\n')).toBe(`<ul>
  <li>a
    <pre><code>b
</code></pre>
  </li>
</ul>
<p>y
<code></code></p>`)
})
