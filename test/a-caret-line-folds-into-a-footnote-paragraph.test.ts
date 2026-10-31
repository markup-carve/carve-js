import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// PART 9 §10 lists no caption line among the interrupters, and a footnote
// paragraph is no captionable host (§4), so a `^ ` line is lazy text (carve-js#4009).
const note = (body: string) => `<p>x<a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a></p>
<section role="doc-endnotes" aria-label="Footnotes">
  <hr>
  <ol>
    <li id="fn1">
      ${body}
    </li>
  </ol>
</section>`
const backlink = '<a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a>'

describe('a caret line after a footnote paragraph', () => {
  it('folds into the paragraph', () => {
    expect(carveToHtml(`x[^n]

[^n]: a
^ c
`)).toBe(note(`<p>a
^ c${backlink}</p>`))
  })

  it('keeps the lines after it in the note', () => {
    expect(carveToHtml(`x[^n]

[^n]: a
 ^ c
more
`)).toBe(note(`<p>a
^ c
more${backlink}</p>`))
  })

  it('folds into a quote paragraph in the note', () => {
    expect(carveToHtml(`x[^n]

[^n]: > q
^ c
`)).toBe(note(`<blockquote><p>q
^ c</p></blockquote>
      <p>${backlink}</p>`))
  })

  it('leaves nothing at the top level when the note is unreferenced', () => {
    expect(carveToHtml(`[^n]: a
^ c
`)).toBe('')
  })
})
