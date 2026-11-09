import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const note = '<p>ref<a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a></p>\n' +
  '<section role="doc-endnotes" aria-label="Footnotes">\n  <hr>\n  <ol>\n    <li id="fn1">\n' +
  '      <p>x<a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a></p>\n' +
  '    </li>\n  </ol>\n</section>'

describe('a list marker closes a quoted note paragraph', () => {
  it.each(['- li', '* li', '1. li'])('ends the quote before the next root marker after %j', marker => {
    const html = carveToHtml(`> [^a]: x\n> ${marker}\n- y\n\nref[^a]\n`)
    expect(html).toContain('</blockquote>\n<ul>\n  <li>y</li>\n</ul>')
    expect(html).toContain(note)
    expect(html).not.toContain('li\n- y')
  })
})
