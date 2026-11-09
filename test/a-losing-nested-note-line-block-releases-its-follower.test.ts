import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

describe('a losing nested note releases a line below its body column', () => {
  it('keeps the heading in the winner and the following reference in the document', () => {
    const source = '[^n]: a\n  [^n]: a\n      ::: |\n  # h\n[^n]\n'
    expect(carveToHtml(source)).toBe([
      '<p><a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a></p>',
      '<section role="doc-endnotes" aria-label="Footnotes">',
      '  <hr>',
      '  <ol>',
      '    <li id="fn1">',
      '      <p>a</p>',
      '      <h1 id="h">h</h1>',
      '      <p><a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a></p>',
      '    </li>',
      '  </ol>',
      '</section>',
    ].join('\n'))
  })

  it('lets ordinary prose at the winning note column open a paragraph', () => {
    const source = '[^n]: a\n  [^n]: a\n      ::: |\n  tail\n\n[^n]\n'
    expect(carveToHtml(source)).toContain('<p>tail<a href="#fnref1"')
  })
})
