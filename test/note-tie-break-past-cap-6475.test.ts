import { describe, expect, it } from 'vitest'
import { render } from '../src/index.ts'

const note = (body: string): string =>
  `<section role="doc-endnotes" aria-label="Footnotes">\n  <hr>\n  <ol>\n    <li id="fn1">\n      <p>${body}<a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a></p>\n    </li>\n  </ol>\n</section>`
const ref = '<a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a>'
const tie = '^[[[^\\}[]]] '
const text = '^[[[^}[]]] '

// C2-I-118 makes openers text past 200 open entries; each swallowed note still reads as it would on its own.
describe('C2-I-089 with C2-I-118: tie-break notes past the depth cap settle (carve#6475)', () => {
  it.each([197, 198, 1379, 1380, 1381, 3000, 5000])('%i tie-break notes before a note', (count) => {
    expect(render(`${tie.repeat(count)}^[ok]\n`)).toBe(`<p>${text.repeat(count)}${ref}</p>\n${note('ok')}`)
  })

  it('a closing note after a long run keeps its caret pairs as text', () => {
    expect(render(`${tie.repeat(2000)}^[a ^[b] c]\n`)).toBe(`<p>${text.repeat(2000)}${ref}</p>\n${note('a ^[b] c')}`)
  })
})
