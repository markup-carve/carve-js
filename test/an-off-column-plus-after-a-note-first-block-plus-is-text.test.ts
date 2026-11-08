import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it('keeps an off-column plus and its lazy follower in the note', () => {
  const source = 'x[^a]\n\n[^a]: +\n +\nq\n'
  expect(carveToHtml(source)).toBe(`<p>x<a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a></p>
<section role="doc-endnotes" aria-label="Footnotes">
  <hr>
  <ol>
    <li id="fn1">
      <p>+
q<a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a></p>
    </li>
  </ol>
</section>`)
})
