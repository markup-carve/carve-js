import { describe, expect, it } from 'vitest'
import { render } from '../src/index.ts'

const note = (body: string): string =>
  `<section role="doc-endnotes" aria-label="Footnotes">\n  <hr>\n  <ol>\n    <li id="fn1">\n      <p>${body}<a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a></p>\n    </li>\n  </ol>\n</section>`
const ref = '<a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a>'

describe('C2-I-089: a note that an open text note swallowed reads on its own (#5476)', () => {
  it.each([
    ['^[[[^\\}[]]] ^[a [^1] b]\n\n[^1]: n\n', `<p>^[[[^}[]]] ${ref}</p>\n${note('a [^1] b')}`],
    ['^[[[^\\}[]]] x ^[a ^[b] c\n', `<p>^[[[^}[]]] x ^[a ${ref} c</p>\n${note('b')}`],
  ])('renders %j', (source, html) => {
    expect(render(source)).toBe(html)
  })
})
