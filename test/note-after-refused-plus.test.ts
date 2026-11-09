import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it('returns a reachable follower to the note after a refused plus', () => {
  expect(carveToHtml('[^a]: +\n- li\n  ```\n+\n  p\n\nsee[^a]\n').trim()).toBe(`<p>see<a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a></p>
<section role="doc-endnotes" aria-label="Footnotes">
  <hr>
  <ol>
    <li id="fn1">
      <ul>
        <li>li
          <pre><code></code></pre>
        </li>
      </ul>
      <p>p<a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a></p>
    </li>
  </ol>
</section>`)
})
