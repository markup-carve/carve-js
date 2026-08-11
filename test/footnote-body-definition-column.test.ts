import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

/**
 * A definition inside a footnote body is collected at the body's own column and
 * NOWHERE ELSE.
 *
 * The definition prepass exempted footnote bodies outright, on the grounds that a
 * flat pass cannot model the body's content column. It can: the column is two,
 * §16's own (carve#717). Without that, a definition anywhere in a note body was
 * registered - including at columns where the body renders the line as prose, so
 * the reader saw `[r]: /u` in the note text while a reference to it silently
 * resolved through the same line. Visible AND active is the one outcome no
 * reading produces, and it is the `VA` rows of carve#669 and carve#701.
 *
 * Each case asserts BOTH halves, because either alone passes on a wrong answer:
 * "renders" alone passes when the line is also active, and "resolves" alone
 * passes when the line is also printed. Measured against the executable spec,
 * which agrees on every row below.
 */

/** `[^a]: note` + `[r]: /u` at N spaces + a use of both. */
const document = (indent: number): string =>
  `[^a]: note\n\n${' '.repeat(indent)}[r]: /u\n\nsee[^a] and [t][r]\n`

const renders = (html: string): boolean => html.includes('[r]: /u')
const resolves = (html: string): boolean => html.includes('href="/u"')

describe('a definition in a footnote body', () => {
  it('defines at the body column of two, and the line disappears', () => {
    const html = carveToHtml(document(2))
    expect(renders(html)).toBe(false)
    expect(resolves(html)).toBe(true)
  })

  it('defines at column zero, where it is the document\'s own definition', () => {
    // A flush-left line ends the body, so this is not a body definition at all -
    // kept as the control that shows the column test did not simply reject
    // everything.
    const html = carveToHtml(document(0))
    expect(renders(html)).toBe(false)
    expect(resolves(html)).toBe(true)
  })

  it('is text below the body column, and inert', () => {
    // One space: too little for a continuation, so the line is the document's
    // next block - a paragraph, and no definition (the production allows no
    // leading indent).
    const html = carveToHtml(document(1))
    expect(renders(html)).toBe(true)
    expect(resolves(html)).toBe(false)
  })

  it('is text past the body column, and inert', () => {
    // Three and four: inside the body, but above its content column, so the
    // body's blocks read residual indent and the line is paragraph text there.
    for (const indent of [3, 4]) {
      const html = carveToHtml(document(indent))
      expect(renders(html), `indent ${indent}`).toBe(true)
      expect(resolves(html), `indent ${indent}`).toBe(false)
    }
  })

  it('never renders a line it also defines from', () => {
    // The invariant behind all four cases above, stated once: whatever the
    // indent, a definition line is content or metadata, never both.
    for (let indent = 0; indent <= 6; indent++) {
      const html = carveToHtml(document(indent))
      expect(renders(html) && resolves(html), `indent ${indent}: ${html}`).toBe(false)
    }
  })

  it('still collects a definition inside a list inside the body', () => {
    // Two is the body's column, not a ceiling: an item opened at two puts its
    // content column at four, and a definition there belongs to the item.
    const html = carveToHtml("see[^a] and [t][r]\n\n[^a]: note\n\n  - item\n\n[r]: /u\n")
    expect(renders(html)).toBe(false)
    expect(resolves(html)).toBe(true)
  })

  it('collects a `+`-attached definition at column zero', () => {
    // The continuation marker attaches a FLUSH-LEFT block to the note (§17 L4),
    // so the column that counts after a `+` is zero, not two.
    const html = carveToHtml("see[^a] and [t][r]\n\n[^a]: note\n\n[r]: /u\n")
    expect(renders(html)).toBe(false)
    expect(resolves(html)).toBe(true)
  })
})
