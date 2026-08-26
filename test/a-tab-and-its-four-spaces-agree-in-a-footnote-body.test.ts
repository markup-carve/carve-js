import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

/**
 * `markup-carve/carve-js#1515`: PART 9's column model is VISUAL, and §24 C1
 * gives a tab a column value, so a bare tab and the four spaces it expands to
 * are the same document. A footnote body's minimum content column is TWO, so a
 * tab-indented body line is over-indented there by exactly the two columns §24
 * C3 turns into the body's authored base.
 *
 * The body's column strip consumed a straddling tab WHOLE, so the tab spelling
 * arrived at column 0 with nothing left to be a base out of, while the space
 * spelling arrived at column 2 and took one. Both spellings still rendered a
 * `<dl>` and a `<blockquote>` - only the nesting moved, which is why the split
 * was silent. carve-js#1508 hid it by removing the base from every definition
 * entry; it was visible again once carve-js#1509 put the base back.
 *
 * THE ASSERTION IS THAT THE TWO SPELLINGS AGREE. Pinning one of them to a
 * literal render would let a later change fix that one and drift the other,
 * which is the shape of the original defect. Each payload is therefore rendered
 * twice and compared, and a second block of expectations pins WHICH answer the
 * pair settles on so a mutation cannot satisfy the test by breaking both.
 */

const norm = (h: string): string => h.replace(/\s+/g, ' ').replace(/>\s</g, '><').trim()

/** The payload written into a footnote body under `prefix`. Blanks stay bare. */
const inNote = (prefix: string, lines: string[]): string =>
  `[^n]: intro\n\n` + lines.map((l) => (l === '' ? '' : prefix + l)).join('\n') + `\n\nsee[^n]\n`

const TAB = '\t'
const SPACES = '    '

/**
 * Seven payloads, of which TWO diverged and five never did. The five are not
 * padding: a fix that keeps the residual columns for every line rather than
 * only a straddling tab would move them, so they are what bounds the change.
 */
const PAYLOADS: Array<[string, string[]]> = [
  ['a definition list whose description holds a quote', [':: t', ':  d', '', '   > q']],
  ['a definition list whose description holds a second paragraph', [':: t', ':  d', '', '   more']],
  ['a definition list whose description holds a fence', [':: t', ':  d', '', '   ```', '   x', '   ```']],
  ['a block quote', ['> q']],
  ['a nested list', ['- a', '', '  - b']],
  ['a heading', ['# h']],
  ['a paragraph', ['text']],
]

describe('a tab and its four-space spelling in a footnote body', () => {
  for (const [name, lines] of PAYLOADS) {
    it(`reads ${name} the same way in both spellings`, () => {
      expect(norm(carveToHtml(inNote(TAB, lines)))).toBe(norm(carveToHtml(inNote(SPACES, lines))))
    })
  }

  /**
   * The answer the pair settles on, for the two payloads that used to disagree.
   * The quote belongs to the description, so the `<blockquote>` is INSIDE the
   * `<dd>` - which is what the executable spec renders for both spellings at
   * spec `44819f31`.
   */
  it('puts a description-owned quote inside the dd in both spellings', () => {
    for (const prefix of [TAB, SPACES]) {
      const html = norm(carveToHtml(inNote(prefix, [':: t', ':  d', '', '   > q'])))
      expect(html).toContain('<dd')
      expect(html).toMatch(/<dd[^>]*>(?:(?!<\/dd>).)*<blockquote/)
    }
  })

  it('puts a description-owned fence inside the dd in both spellings', () => {
    for (const prefix of [TAB, SPACES]) {
      const html = norm(carveToHtml(inNote(prefix, [':: t', ':  d', '', '   ```', '   x', '   ```'])))
      expect(html).toMatch(/<dd[^>]*>(?:(?!<\/dd>).)*<pre/)
    }
  })

  /**
   * §24 C3 names "a definition body's column 3 or a footnote body's column 2".
   * A LIST ITEM IS OUTSIDE THAT CLAUSE and legitimately answers differently -
   * carve-js#1508 wrote an arm that was right for one container and applied it
   * to all of them, and carve-js#1520 scoped it back. So the out-of-clause
   * answer is pinned as the RENDER rather than as agreement between spellings:
   * both spellings already agree in these hosts whatever the residual rule
   * does, so an agreement assertion here could not fail, while a render pin
   * fails the moment the clause is widened to reach them. Both renders were
   * measured against the executable spec at `44819f31`.
   */
  const OUT_OF_CLAUSE: Array<[string, (prefix: string) => string, string]> = [
    [
      'a list item keeps the quote INSIDE the description',
      (p) => `- intro\n\n` + PAYLOADS[0]![1].map((l) => (l === '' ? '' : p + l)).join('\n') + `\n`,
      '<ul><li>intro <dl><dt>t</dt><dd><p>d</p><blockquote><p>q</p></blockquote></dd></dl></li></ul>',
    ],
    [
      'the top level reads an indented opener as text',
      (p) => PAYLOADS[0]![1].map((l) => (l === '' ? '' : p + l)).join('\n') + `\n`,
      '<p>:: t : d</p><p>&gt; q</p>',
    ],
  ]

  for (const [name, mk, expected] of OUT_OF_CLAUSE) {
    it(`${name}, in both spellings`, () => {
      expect(norm(carveToHtml(mk(TAB)))).toBe(expected)
      expect(norm(carveToHtml(mk(SPACES)))).toBe(expected)
    })
  }
})
