import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// carve#5404: the first-blank end of an unclosed attached fence or colon holds for every marker-line `+` host.
const backlink = '<a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a>'

it('ends an unclosed fence a footnote marker-line `+` takes at its first blank', () => {
  expect(carveToHtml('[^1]: +\n```\n\n  tail\n\n[^1]\n')).toContain(`<li id="fn1">
      <pre><code></code></pre>
      <p>tail${backlink}</p>
    </li>`)
})

it('ends an unclosed colon a footnote marker-line `+` takes at its first blank', () => {
  expect(carveToHtml('[^1]: +\n::: note\n\n  tail\n\n[^1]\n')).toContain(`<li id="fn1">
      <aside class="admonition note" aria-label="Note">

      </aside>
      <p>tail${backlink}</p>
    </li>`)
})

it('ends an unclosed fence a description marker-line `+` takes at its first blank', () => {
  expect(carveToHtml(':: t\n: +\n```\n\n  tail\n').trim()).toBe(`<dl>
  <dt>t</dt>
  <dd>
    <pre><code></code></pre>
    <p>tail</p>
  </dd>
</dl>`)
})

it('ends an unclosed colon a description marker-line `+` takes at its first blank', () => {
  expect(carveToHtml(':: t\n: +\n::: note\n\n  tail\n').trim()).toBe(`<dl>
  <dt>t</dt>
  <dd>
    <aside class="admonition note" aria-label="Note">

    </aside>
    <p>tail</p>
  </dd>
</dl>`)
})

it('keeps the blank in a footnote fence whose closer stands at the body column', () => {
  expect(carveToHtml('[^1]: +\n```\na\n\n  ```\n\n[^1]\n')).toContain(`<pre><code>a

</code></pre>`)
})

it('keeps the blank in a description fence whose closer stands at the marker column', () => {
  expect(carveToHtml(':: t\n: +\n```\na\n\n  b\n```\n').trim()).toBe(`<dl>
  <dt>t</dt>
  <dd>
    <pre><code>a

  b
</code></pre>
  </dd>
</dl>`)
})

it('reads a colon run inside a later fence as payload, not as the closer', () => {
  expect(carveToHtml('[^1]: +\n::: note\n\n  ```\n  :::\n  ```\n  tail\n\n[^1]\n')).toContain(`<aside class="admonition note" aria-label="Note">

      </aside>
      <pre><code>:::
</code></pre>
      <p>tail${backlink}</p>`)
})
