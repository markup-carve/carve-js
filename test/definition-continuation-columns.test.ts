import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const heads = [
  ['a bullet', '- a', 2],
  ['an explicit ordered marker', '1. a', 3],
  ['a bare-dot ordered marker', '. a', 2],
] as const

const source = (head: string, contentColumn: number, definition: string, continuationColumn: number) =>
  `${head}\n${' '.repeat(contentColumn)}${definition}\n${' '.repeat(continuationColumn)}more\ntail\n`

const tailIsInside = (html: string) => html.indexOf('tail') < html.indexOf('</li>')

describe('definition continuations obey the enclosing item and definition columns', () => {
  for (const [name, head, contentColumn] of heads) {
    it(`ends ${name} below its content column after a collected definition`, () => {
      for (const definition of ['[^f]: t', '[r]: /u']) {
        for (let column = 1; column < contentColumn; column++) {
          const html = carveToHtml(source(head, contentColumn, definition, column))
          expect(tailIsInside(html), `${definition} at continuation column ${column}`).toBe(false)
          expect(html).toContain('<p>more\ntail</p>')
        }
      }
    })

    it(`reopens ${name} at its content column after either definition kind`, () => {
      for (const definition of ['[^f]: t', '[r]: /u']) {
        expect(tailIsInside(carveToHtml(source(head, contentColumn, definition, contentColumn)))).toBe(true)
      }
    })

    it(`treats one column short of a footnote body as ${name} prose`, () => {
      expect(
        tailIsInside(carveToHtml(source(head, contentColumn, '[^f]: t', contentColumn + 1))),
      ).toBe(true)
    })

    it(`keeps a line at the footnote body column in the definition block for ${name}`, () => {
      const src = `${source(head, contentColumn, '[^f]: t', contentColumn + 2)}\nx[^f]\n`
      const html = carveToHtml(src)
      expect(tailIsInside(html)).toBe(false)
      expect(html).toContain('t\nmore')
      expect(html).toMatch(/<\/[uo]l>\n<p>tail<\/p>/)
    })
  }

  it('keeps an abbreviation-shaped line as item prose because it is not a definition there', () => {
    for (const [, head, contentColumn] of heads) {
      expect(tailIsInside(carveToHtml(source(head, contentColumn, '*[A]: expansion', 1)))).toBe(true)
    }
  })
})
