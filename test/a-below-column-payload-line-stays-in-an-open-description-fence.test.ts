import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it('ends a description fence at a below-column payload line', () => {
  expect(carveToHtml(':: m\n: l\n     ```\ne\n     ```\n')).toBe(`<dl>
  <dt>m</dt>
  <dd>
    <p>l</p>
    <pre><code></code></pre>
  </dd>
</dl>
<p>e</p>
<pre><code></code></pre>`)
})

it('ends a description fence at a below-column fence run, which opens its own fence', () => {
  expect(carveToHtml(':: m\n: l\n     ```\n```\n     ```\n')).toBe(`<dl>
  <dt>m</dt>
  <dd>
    <p>l</p>
    <pre><code></code></pre>
  </dd>
</dl>
<pre><code>     \`\`\`
</code></pre>`)
})

it('ends a fence one column past the body at a below-column line', () => {
  expect(carveToHtml(':: t\n: a\n   ```\n   b\n y\n   ```\n')).toBe(`<dl>
  <dt>t</dt>
  <dd>
    <p>a</p>
    <pre><code>b
</code></pre>
  </dd>
</dl>
<p>y</p>
<pre><code></code></pre>`)
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
<p>e</p>
<pre><code></code></pre>`)
})

it('lets a below-column block opener end the description fence', () => {
  expect(carveToHtml(':: m\n: l\n     ```\n# h\n     ```\n')).toBe(`<dl>
  <dt>m</dt>
  <dd>
    <p>l</p>
    <pre><code></code></pre>
  </dd>
</dl>
<section id="h">
  <h1>h</h1>
  <pre><code></code></pre>
</section>`)
})

it('ends a description fence inside a list item at a below-column line', () => {
  expect(carveToHtml('- x\n  :: m\n  : l\n     ```\ne\n     ```\n')).toBe(`<ul>
  <li>x
    <dl>
      <dt>m</dt>
      <dd>
        <p>l</p>
        <pre><code></code></pre>
      </dd>
    </dl>
  </li>
</ul>
<p>e</p>
<pre><code></code></pre>`)
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
<p>y</p>
<pre><code></code></pre>`)
})

it('ends an over-indented item fence at a below-column line', () => {
  expect(carveToHtml('- a\n    ```\n    b\ny\n    ```\n')).toBe(`<ul>
  <li>a
    <pre><code>b
</code></pre>
  </li>
</ul>
<p>y</p>
<pre><code></code></pre>`)
})
