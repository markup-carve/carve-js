import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const modelHtml = (source: string): string => carveToHtml(source).split('\n').map(line => line.trim()).filter(Boolean).join('\n')

describe('an indented first-block opener takes a reached follower', () => {
  it('takes a column-zero paragraph into a description quote', () => {
    expect(modelHtml(':: term\n: body\n  > +\nnext\n')).toBe('<dl>\n<dt>term</dt>\n<dd>\n<p>body</p>\n<blockquote><p>next</p></blockquote>\n</dd>\n</dl>')
  })

  it('takes a column-zero paragraph into an item quote', () => {
    expect(modelHtml('- a\n  > +\npara')).toBe('<ul>\n<li>a\n<blockquote><p>para</p></blockquote>\n</li>\n</ul>')
  })

  it('keeps the innermost quote as owner', () => {
    expect(modelHtml('- a\n  > > +\npara')).toBe('<ul>\n<li>a\n<blockquote>\n<blockquote><p>para</p></blockquote>\n</blockquote>\n</li>\n</ul>')
  })

  it('takes a column-zero paragraph into a task item quote', () => {
    expect(modelHtml('- [ ] > +\npara')).toBe('<ul class="task-list">\n<li><input type="checkbox" disabled>\n<blockquote><p>para</p></blockquote>\n</li>\n</ul>')
  })

  it('takes a column-zero paragraph into a footnote', () => {
    expect(modelHtml('[^n]: +\npara\n\nref [^n]')).toBe('<p>ref <a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a></p>\n<section role="doc-endnotes" aria-label="Footnotes">\n<hr>\n<ol>\n<li id="fn1">\n<p>para<a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a></p>\n</li>\n</ol>\n</section>')
  })
})
