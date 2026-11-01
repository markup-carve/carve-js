import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

describe('hosted fence and line-block boundaries', () => {
  it('returns from a marker-line item fence to the description paragraph', () => {
    expect(carveToHtml(':: t\n: - ~~~\n  x\ntail\n').trim()).toBe(`<dl>
  <dt>t</dt>
  <dd>
    <ul>
      <li>
        <pre><code></code></pre>
      </li>
    </ul>
    <p>x
tail</p>
  </dd>
</dl>`)
  })

  it('ends a marker-line item fence when the description in an item has no body line', () => {
    expect(carveToHtml('- :: t\n  : - ```\nz\n').trim()).toBe(`<ul>
  <li>
    <dl>
      <dt>t</dt>
      <dd>
        <ul>
          <li>
            <pre><code></code></pre>
          </li>
        </ul>
      </dd>
    </dl>
  </li>
</ul>
<p>z</p>`)
  })

  it('keeps a fence-shaped payload and a following lazy line in a nested line block', () => {
    expect(carveToHtml('- - ::: |\n    ~~~\nb\n').trim()).toBe(`<ul>
  <li>
    <ul>
      <li>
        <div class="line-block">
          <p>~~~<br>
b</p>
        </div>
      </li>
    </ul>
  </li>
</ul>`)
  })

  it('keeps an overindented colon payload and a following lazy line in a nested line block', () => {
    expect(carveToHtml('- - ::: |\n    a\nlazy\n     :::\ntail\n').trim()).toBe(`<ul>
  <li>
    <ul>
      <li>
        <div class="line-block">
          <p>a<br>
lazy<br>
&nbsp;:::<br>
tail</p>
        </div>
      </li>
    </ul>
  </li>
</ul>`)
  })
})
