import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const note = (label: string, following: string): string =>
  `[^${label}]: +\n${following}\n\nsee[^${label}]\n`

const expected = (text: string): string => `<p>see<a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a></p>
<section role="doc-endnotes" aria-label="Footnotes">
  <hr>
  <ol>
    <li id="fn1">
      <p>${text}<a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a></p>
    </li>
  </ol>
</section>`

describe('a footnote first-block plus before a sibling definition', () => {
  it('keeps a refused plus as text before a duplicate note', () => {
    expect(carveToHtml(note('a', '[^a]: +')).trim()).toBe(expected('+'))
  })

  it('keeps the plus when the duplicate has an indented follower', () => {
    expect(carveToHtml(note('a', '[^a]: +\n flush')).trim()).toBe(expected('+'))
  })

  it('accepts a quote at the note marker column', () => {
    expect(carveToHtml(note('a', '> quote')).trim()).toContain('<blockquote><p>quote</p></blockquote>')
  })
})
