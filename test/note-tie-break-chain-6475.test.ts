import { describe, expect, it } from 'vitest'
import { render } from '../src/index.ts'

const note = (body: string): string =>
  `<section role="doc-endnotes" aria-label="Footnotes">\n  <hr>\n  <ol>\n    <li id="fn1">\n      <p>${body}<a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a></p>\n    </li>\n  </ol>\n</section>`
const ref = '<a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a>'
const tie = '^[[[^\\}[]]] '
const text = '^[[[^}[]]] '

describe('C2-I-089: a note behind any number of tie-break notes reads on its own (carve#6475)', () => {
  it.each([1, 7, 8, 9, 16, 64])('%i tie-break notes before a note', (count) => {
    expect(render(`${tie.repeat(count)}^[ok]\n`)).toBe(`<p>${text.repeat(count)}${ref}</p>\n${note('ok')}`)
  })

  it.each([8, 40])('%i tie-break notes before a footnote reference', (count) => {
    expect(render(`${tie.repeat(count)}[^1]\n\n[^1]: n\n`)).toBe(`<p>${text.repeat(count)}${ref}</p>\n${note('n')}`)
  })

  it('a closing note after the run keeps its caret pairs as text', () => {
    expect(render(`${tie.repeat(10)}^[a ^[b] c]\n`)).toBe(`<p>${text.repeat(10)}${ref}</p>\n${note('a ^[b] c')}`)
  })
})
