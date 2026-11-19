import { describe, expect, it } from 'vitest'
import { render } from '../src/index.ts'

describe('C2-H-202 footnote id registry', () => {
  it('moves a note id behind a generated heading id', () => {
    expect(render('# fn1\n\na[^x]\n\n[^x]: n')).toBe(`<section id="fn1">
  <h1>fn1</h1>
  <p>a<a id="fnref1" href="#fn1-2" role="doc-noteref"><sup>1</sup></a></p>
</section>
<section role="doc-endnotes" aria-label="Footnotes">
  <hr>
  <ol>
    <li id="fn1-2">
      <p>n<a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a></p>
    </li>
  </ol>
</section>`)
  })

  it('reserves an authored reference id before note ids', () => {
    expect(render('a^[x] and b[^n]{#fn1}\n\n[^n]: y')).toBe(`<p>a<a id="fnref1" href="#fn1-2" role="doc-noteref"><sup>1</sup></a> and b<a id="fn1" href="#fn2" role="doc-noteref"><sup>2</sup></a></p>
<section role="doc-endnotes" aria-label="Footnotes">
  <hr>
  <ol>
    <li id="fn1-2">
      <p>x<a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a></p>
    </li>
    <li id="fn2">
      <p>y<a href="#fn1" role="doc-backlink" aria-label="Back to reference">↩</a></p>
    </li>
  </ol>
</section>`)
  })

  it('moves a generated reference id behind an authored reference id', () => {
    expect(render('a^[x]{#fnref2} b^[y]')).toBe(`<p>a<a id="fnref2" href="#fn1" role="doc-noteref"><sup>1</sup></a> b<a id="fnref2-2" href="#fn2" role="doc-noteref"><sup>2</sup></a></p>
<section role="doc-endnotes" aria-label="Footnotes">
  <hr>
  <ol>
    <li id="fn1">
      <p>x<a href="#fnref2" role="doc-backlink" aria-label="Back to reference">↩</a></p>
    </li>
    <li id="fn2">
      <p>y<a href="#fnref2-2" role="doc-backlink" aria-label="Back to reference">↩</a></p>
    </li>
  </ol>
</section>`)
  })

  it('keeps the no-collision output byte-identical', () => {
    expect(render('a[^x] b^[y] c[^x]\n\n[^x]: n')).toBe(`<p>a<a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a> b<a id="fnref2" href="#fn2" role="doc-noteref"><sup>2</sup></a> c<a id="fnref1-2" href="#fn1" role="doc-noteref"><sup>1</sup></a></p>
<section role="doc-endnotes" aria-label="Footnotes">
  <hr>
  <ol>
    <li id="fn1">
      <p>n<a href="#fnref1" role="doc-backlink" aria-label="Back to reference 1">↩<sup>1</sup></a> <a href="#fnref1-2" role="doc-backlink" aria-label="Back to reference 2">↩<sup>2</sup></a></p>
    </li>
    <li id="fn2">
      <p>y<a href="#fnref2" role="doc-backlink" aria-label="Back to reference">↩</a></p>
    </li>
  </ol>
</section>`)
  })

  it('suffixes a repeated reference after its authored counterpart', () => {
    const html = render('a[^x]{#fnref1-2} b[^x]\n\n[^x]: n')
    expect(html).toContain('<a id="fnref1-2" href="#fn1" role="doc-noteref"><sup>1</sup></a>')
    expect(html).toContain('<a id="fnref1-2-2" href="#fn1" role="doc-noteref"><sup>1</sup></a>')
    expect(html).toContain('<a href="#fnref1-2-2" role="doc-backlink" aria-label="Back to reference 2">')
  })
})
