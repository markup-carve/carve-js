import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

/*
 * PART 9's MARKER REQUIRES CONTENT rule, applied to the definition-term marker.
 *
 *   "A content-less marker line -- bare (`-`) or with trailing whitespace only
 *   (`- `, `-   `) -- is NOT a list: it is paragraph text. The rule ignores
 *   trailing whitespace, so `-` and `- ` behave identically (an editor
 *   stripping the trailing space cannot change the meaning)."
 *
 * The rule named bullets and ordered markers; `::` is the sibling nobody
 * extended it to, and the engines split three ways (markup-carve/carve#512).
 * Under the old behavior here, `::` with ONE trailing space was a paragraph and
 * `::` with TWO was a definition list - so stripping a trailing space changed
 * the document's structure, which is the precise thing the rule exists to
 * prevent. carve-rs already behaves this way.
 */
const squash = (html: string) => html.replace(/\s+/g, ' ').trim()

describe('a content-less definition-term marker', () => {
  for (const [name, source] of [
    ['bare', '::\n'],
    ['one trailing space', ':: \n'],
    ['two trailing spaces', '::  \n'],
    ['three trailing spaces', '::   \n'],
    ['space then tab', ':: \t\n'],
    ['tab only', '::\t\n'],
  ] as const) {
    it(`is paragraph text: ${name}`, () => {
      expect(squash(carveToHtml(source))).toBe('<p>::</p>')
    })
  }

  it('cannot change structure by stripping a trailing space', () => {
    // The rule's own rationale. These three must be indistinguishable.
    const bare = squash(carveToHtml('::\n'))

    expect(squash(carveToHtml(':: \n'))).toBe(bare)
    expect(squash(carveToHtml('::  \n'))).toBe(bare)
  })

  it('leaves a term with content alone', () => {
    expect(squash(carveToHtml(':: t\n:  d\n'))).toBe('<dl> <dt>t</dt> <dd>d</dd> </dl>')
  })

  it('leaves a term with extra separator whitespace alone', () => {
    expect(squash(carveToHtml('::  x\n'))).toBe('<dl> <dt>x</dt> </dl>')
  })
})
