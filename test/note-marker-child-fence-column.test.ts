import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

describe('a fence on a note marker-line child', () => {
  it('reads payload and closer from the child content column', () => {
    expect(carveToHtml('x[^n]\n\n[^n]: - ```js\n        a\n        ```\n').trim()).toBe(`<p>x<a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a></p>
<section role="doc-endnotes" aria-label="Footnotes">
  <hr>
  <ol>
    <li id="fn1">
      <ul>
        <li>
          <pre><code class="language-js">a
</code></pre>
        </li>
      </ul>
      <p><a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a></p>
    </li>
  </ol>
</section>`)
  })

  it('uses the same column for an ordered child and a tilde fence', () => {
    const html = carveToHtml('x[^n]\n\n[^n]: 1. ~~~\n         a\n         ~~~\n')
    expect(html).toContain('<ol>\n        <li>\n          <pre><code>a\n</code></pre>')
  })
})
