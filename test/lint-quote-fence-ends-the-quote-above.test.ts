import { describe, expect, it } from 'vitest'
import { carveToHtml, lintCarve } from '../src/index.js'

/*
 * The one authoring hazard around `::: >` that no other diagnostic reaches.
 *
 * Written on the wrong side of the marker a fence is left unclosed, and
 * `unclosed-container-fence` reports it. Written at column 0 under a quote
 * nothing is malformed at all: the fence is a block opener, so it ends the
 * quote above and starts a sibling one, and the two adjacent blockquotes read
 * exactly like the nesting the author was reaching for (markup-carve/carve#1718).
 */
describe('lintCarve - a quote fence below a quote', () => {
  const reports = (source: string) =>
    lintCarve(source).filter((w) => w.rule === 'quote-fence-ends-the-quote-above')

  it('reports the opener, and the render shows why', () => {
    const source = '> a\n::: >\nb\n:::\n'
    expect(carveToHtml(source)).toBe(
      '<blockquote><p>a</p></blockquote>\n<blockquote><p>b</p></blockquote>',
    )
    const [warning] = reports(source)
    expect(warning).toMatchObject({ line: 2, column: 1, data: { quoteLine: 1 } })
    expect(warning?.message).toContain('opens a sibling one')
    expect(warning?.message).toContain('"> ::: >"')
  })

  it('reports it inside a container and inside a list item, where the column moves', () => {
    expect(reports(':::: note\n> a\n::: >\nb\n:::\n::::\n')).toHaveLength(1)
    expect(reports('- > a\n  ::: >\n  b\n  :::\n')).toHaveLength(1)
  })

  it('reports it in a footnote body, which hangs off the document', () => {
    // The body is a block list like any other, and a walk of `children` alone
    // reports the construct on the page and stays silent in the note.
    //
    // AT THE BODY'S OWN COLUMN, which is the only column where the construct
    // this rule names exists. A footnote body strips a two-column margin, so
    // `  ` here is the body's column 0 - the same spelling the document-level
    // row above uses, and the one where a `::: >` opener really does end the
    // quote above it and open a sibling.
    expect(reports('[^a]: > q\n  ::: >\n  b\n  :::\n\nsee[^a]\n')).toHaveLength(1)
  })

  it('says nothing when the fence is INDENTED past the quote it follows', () => {
    // NOT A HOLE IN THE LINT - there is no second quote to report. Past the
    // body's own column the fence is a lazy continuation of the quoted
    // paragraph, exactly as it is at the top level (carve#1781, carve-js#1535;
    // the equality is pinned across the whole column band in
    // `a-recognized-opener-in-a-body-needs-no-blank-line-above-it.test.ts`).
    //
    // This document USED to report, because the body answered every authored
    // column the same way and produced two sibling quotes at all of them. The
    // report was a true statement about a parse that was itself wrong.
    expect(reports('[^a]: > q\n      ::: >\n      b\n      :::\n\nsee[^a]\n')).toEqual([])
    expect(carveToHtml('> q\n    ::: >\n    b\n    :::\n').replace(/\s+/g, ' ').trim()).toBe(
      '<blockquote><p>q ::: &gt; b :::</p></blockquote>',
    )
  })

  it('says nothing about the nested spelling, which needs the marker', () => {
    const source = '> ::: >\n> b\n> :::\n'
    expect(carveToHtml(source)).toBe(
      '<blockquote>\n  <blockquote><p>b</p></blockquote>\n</blockquote>',
    )
    expect(reports(source)).toEqual([])
  })

  it('says nothing when the blank line makes two quotes deliberate', () => {
    expect(reports('> a\n\n::: >\nb\n:::\n')).toEqual([])
  })

  it('says nothing about a fenced quote below a fenced quote', () => {
    // Both spellings are one node, but only the prefixed one leaves the author
    // no visible cue: after a closing fence the sibling is where it looks.
    expect(reports('::: >\na\n:::\n::: >\nb\n:::\n')).toEqual([])
  })

  it('says nothing about a lone quote in either spelling', () => {
    expect(reports('> a\n> b\n')).toEqual([])
    expect(reports('::: >\nb\n:::\n')).toEqual([])
  })
})
