import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

describe('a footnote reference in link text renders as a sup', () => {
  it('counts the reference and keeps both endnote backlinks', () => {
    expect(carveToHtml(`a [t[^1]][r] c [^1] b

[r]: /u

[^1]: n
`)).toBe(`<p>a <a href="/u">t<sup id="fnref1">1</sup></a> c <a id="fnref1-2" href="#fn1" role="doc-noteref"><sup>1</sup></a> b</p>
<section role="doc-endnotes" aria-label="Footnotes">
  <hr>
  <ol>
    <li id="fn1">
      <p>n<a href="#fnref1" role="doc-backlink" aria-label="Back to reference 1">↩<sup>1</sup></a> <a href="#fnref1-2" role="doc-backlink" aria-label="Back to reference 2">↩<sup>2</sup></a></p>
    </li>
  </ol>
</section>`)
  })

  it.each(['[t[^1]](/u)', '[t[^1]][r]'])('renders a sup in %s', (link) => {
    const html = carveToHtml(`${link}

[r]: /u

[^1]: n
`)
    expect(html.split('\n')[0]).toBe('<p><a href="/u">t<sup id="fnref1">1</sup></a></p>')
    expect(html).toContain('href="#fnref1" role="doc-backlink"')
  })

  it('keeps a repeat inside link text numbered and linked back', () => {
    const html = carveToHtml(`[^1] [t[^1]](/u)

[^1]: n
`)
    expect(html.split('\n')[0]).toBe('<p><a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a> <a href="/u">t<sup id="fnref1-2">1</sup></a></p>')
    expect(html).toContain('href="#fnref1-2" role="doc-backlink"')
  })

  it('moves authored attributes to the sup and keeps its structural id', () => {
    const html = carveToHtml(`[t[^1]{#author .x title="note"}](/u) [^1]{.outside}

[^1]: n
`)
    expect(html.split('\n')[0]).toBe('<p><a href="/u">t<sup id="fnref1" class="x" title="note">1</sup></a> <a id="fnref1-2" href="#fn1" role="doc-noteref" class="outside"><sup>1</sup></a></p>')
  })

  it('moves the roundtrip label carrier to the sup', () => {
    const html = carveToHtml(`[t[^note]{.x}](/u) [^note]

[^note]: n
`, { roundtrip: true })
    expect(html.split('\n')[0]).toBe('<p><a href="/u">t<sup id="fnref1" data-carve-footnote-label="note" class="x">1</sup></a> <a id="fnref1-2" href="#fn1" role="doc-noteref" data-carve-footnote-label="note"><sup>1</sup></a></p>')
  })

  it('renders an inline footnote in link text as a sup', () => {
    expect(carveToHtml(`[t^[n]](/u)
`).split('\n')[0]).toBe('<p><a href="/u">t<sup id="fnref1">1</sup></a></p>')
  })

  it('does not treat image alt text as a link reference', () => {
    const html = carveToHtml(`![t[^1]](/u) [^1]

[^1]: n
`)
    expect(html).toContain('<a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a>')
    expect(html).not.toContain('fnref1-2')
  })
})
