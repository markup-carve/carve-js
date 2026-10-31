import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

describe('a footnote attachment with an open code fence', () => {
  it('keeps a definition-shaped line and its follower in the fence payload', () => {
    expect(carveToHtml('[^f]: n\n+\n```\na\n[^z]: z\nb\n\nsee[^f]\n')).toBe(
      '<p>see<a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a></p>\n' +
      '<section role="doc-endnotes" aria-label="Footnotes">\n' +
      '  <hr>\n  <ol>\n    <li id="fn1">\n' +
      '      <p>n</p>\n      <pre><code>a\n[^z]: z\nb\n</code></pre>\n' +
      '      <p><a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a></p>\n' +
      '    </li>\n  </ol>\n</section>',
    )
  })

  it('still treats a lone plus as a new attachment boundary', () => {
    const html = carveToHtml('[^f]: n\n+\n~~~\na\n+\nb\n\nsee[^f]\n')
    expect(html).toContain('<pre><code>a\n</code></pre>')
    expect(html).toContain('<p>b<a href="#fnref1" role="doc-backlink"')
  })
})
