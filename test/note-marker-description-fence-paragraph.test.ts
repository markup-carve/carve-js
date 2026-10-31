import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it('leaves a note after a fence opens on its marker-line description', () => {
  expect(carveToHtml('[^0]: :: t\n  : ```\nz\n\n[^0]\n')).toBe(
    '<p>z</p>\n<p><a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a></p>\n<section role="doc-endnotes" aria-label="Footnotes">\n  <hr>\n  <ol>\n    <li id="fn1">\n      <dl>\n        <dt>t</dt>\n        <dd>\n          <pre><code></code></pre>\n        </dd>\n      </dl>\n      <p><a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a></p>\n    </li>\n  </ol>\n</section>',
  )
})

it('keeps a plain marker-line description open for a lazy line', () => {
  expect(carveToHtml('[^0]: :: t\n  : d\nz\n\n[^0]\n')).toContain('<dd>d\nz</dd>')
})

it('releases the containing list when its note description starts a fence', () => {
  const html = carveToHtml('- [^0]: :: t\n    : ```\nz\n\n[^0]\n')
  expect(html).toContain('</ul>\n<p>z</p>')
})

it('keeps a surrounding description owner for a marker below the note column', () => {
  const html = carveToHtml(':: outer\n: [^0]: :: t\n  : ```\nz\n\n[^0]\n')
  expect(html).toContain('<dt>t\n: <code>\nz</code></dt>')
})
