import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml, parse } from '../src/index.js'

/*
 * A DEFINITION LIST'S PAYLOAD NEEDS A BASE OF ITS OWN, AND THE WRITER GIVES IT
 * ONE (markup-carve/carve#1763, carve-js#1509).
 *
 * A description's payload sits three columns in from `::`, so inside a body
 * whose minimum content column is its own - a footnote body, a definition
 * description - that payload is INDENTED relative to the `::` line. At the
 * PART 0 now gives every container one rule: a local base owns one complete
 * block, and a nested body's content column is resolved before an ancestor may
 * claim another opener. Therefore every outer container and every authored
 * offset below reads this quote inside the description.
 *
 * KNOWN GAP: a bare tab and its visual-column space spelling do not agree at a
 * footnote body's column - `\t:: t` reads as at-the-minimum where four spaces
 * read as over-indented, and the executable spec reads both as over-indented.
 * That is a reader defect on both sides of this fix, and it is carve-js#1515.
 */

const description = ':: t\n:  d\n\n   > q'
const indent = (source: string, width: number) =>
  source
    .split('\n')
    .map((line) => (line === '' ? line : `${' '.repeat(width)}${line}`))
    .join('\n')

const containers = [
  ['a footnote body', 2, (body: string) => `[^n]: intro\n\n${body}\n\nsee[^n]\n`],
  ['a definition description', 3, (body: string) => `:: term\n:  intro\n\n${body}\n`],
] as const

const aListItem = ['a list item', 2, (body: string) => `- intro\n\n${body}\n`] as const

const everyContainer = [...containers, aListItem] as const

const holdsTheQuote = (html: string) => /<dd>\s*<p>d<\/p>\s*<blockquote>/.test(html)

describe('a definition list at an authored block base', () => {
  for (const [name, minimum, wrap] of containers) {
    it(`keeps the payload inside the description at ${name}'s own column`, () => {
      expect(holdsTheQuote(carveToHtml(wrap(indent(description, minimum))))).toBe(true)
    })

    for (const over of [minimum + 1, minimum + 2, minimum + 5]) {
      it(`keeps the payload inside the description ${over - minimum} past ${name}`, () => {
        expect(holdsTheQuote(carveToHtml(wrap(indent(description, over))))).toBe(true)
      })
    }
  }

  {
    const [name, minimum, wrap] = aListItem
    for (const width of [minimum, minimum + 1, minimum + 2, minimum + 5]) {
      it(`keeps the payload inside the description at ${name} + ${width - minimum}`, () => {
        expect(holdsTheQuote(carveToHtml(wrap(indent(description, width))))).toBe(true)
      })
    }
  }

  for (const [name, minimum, wrap] of everyContainer) {
    for (const width of [minimum, minimum + 1, minimum + 2, minimum + 5]) {
      it(`writes back what the document says at ${name} + ${width - minimum}`, () => {
        const source = wrap(indent(description, width))
        const written = carveToCarve(source)
        expect(carveToHtml(written)).toBe(carveToHtml(source))
        expect(carveToCarve(written)).toBe(written)
      })
    }
  }

  it('writes the ticket document back as the same tree, not just the same HTML', () => {
    // PART 11 §1's STRONGER property, on the document carve-js#1509 reports.
    // `to_html(fmt(x)) == to_html(x)` alone would pass a writer that traded one
    // wrong spelling for another whose HTML happened to match, so this compares
    // the TREES. `srcByteLength` is the source's own length and moves whenever
    // the canonical spelling is shorter or longer than the authored one, which
    // is every document the writer is not already a fixed point of; it is not
    // part of what the document says.
    const source = '[^n]: intro\n\n   :: term\n   :  definition\n\n      > quote\n\nsee[^n]\n'
    const written = carveToCarve(source)
    const tree = (src: string) => {
      const { srcByteLength: _srcByteLength, ...rest } = parse(src, { positions: false })

      return JSON.stringify(rest)
    }
    expect(tree(written)).toBe(tree(source))
    expect(carveToHtml(source)).toContain('<dd>')
    expect(carveToHtml(source)).toContain('<blockquote>')
  })

  it('raises the attribute line with the list it belongs to', () => {
    // The attribute line is part of how the block is spelled, so leaving it at
    // the body minimum would put `{loose}` a column below its own `::`.
    for (const attrs of ['{loose}', '{.k}', '{#id .k}']) {
      const source = `[^n]: intro\n\n   ${attrs}\n   :: term\n   :  definition\n\n      > quote\n\nsee[^n]\n`
      const written = carveToCarve(source)
      expect(written).toContain(`\n  ${attrs}\n  :: term\n`)
      expect(carveToHtml(written)).toBe(carveToHtml(source))
      expect(carveToCarve(written)).toBe(written)
    }
  })

  it('leaves a description the body column can hold at the body column', () => {
    // Nothing here needs a base: a soft-wrapped description, a second
    // paragraph and a sub-list all stay inside the `<dd>` at the minimum, so
    // the canonical form PART 11 §2 pins for them is unchanged.
    for (const body of [':: t\n:  d\n   more', ':: t\n:  d\n\n   second', ':: t\n:  d\n\n   - a']) {
      const written = carveToCarve(`[^n]: intro\n\n${indent(body, 2)}\n\nsee[^n]\n`)
      expect(written).toContain('\n  :: t\n')
      expect(written).not.toContain('\n   :: t\n')
    }
  })
})
