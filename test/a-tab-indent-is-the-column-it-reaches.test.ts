import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

/**
 * A tab indent is the COLUMN it reaches, for every line kind (carve-js#767).
 *
 * PART 9 section 24 C1 makes indentation a column claim: a space advances one
 * column, a tab advances to the next multiple of 4. `1. ` claims columns 0-2,
 * so the item's content column is 3 and a tab reaches column 4 - the same
 * column four spaces reach.
 *
 * The space spellings settle what column 4 means, and all three engines agree
 * on them: a block opener AT the content column nests, one column past it is
 * literal text. This engine answered the TAB spelling differently, because the
 * dedent consumed a straddling tab whole for every line except a sub-list
 * marker - so the opener arrived flush at column 0 and parsed. The residual
 * columns are indentation whatever follows them.
 */
describe('a tab indent is the column it reaches', () => {
  const ul = (html: string): number => html.split('<ul>').length - 1

  it('makes a block opener past the content column text, like its space spelling', () => {
    const withTab = carveToHtml("1. a\n   > quote\n")
    const withSpaces = carveToHtml("1. a\n   > quote\n")

    expect(withTab).not.toContain('<blockquote>')
    expect(withTab).toBe(withSpaces)
  })

  it('still nests a block opener AT the content column', () => {
    // The boundary. Making every indented opener text would satisfy the
    // assertion above and break the shape authors actually write.
    expect(carveToHtml("1. a\n+\n> quote\n")).toContain('<blockquote>')
  })

  it('keeps a heading past the content column text too', () => {
    // A second opener kind, because a fix that special-cases `>` leaves the
    // rest reading the tab as column 0.
    const withTab = carveToHtml("1. a\n   # h\n")

    expect(withTab).toBe(carveToHtml("1. a\n   # h\n"))
    expect(withTab).not.toContain('<h1')
  })

  it('keeps sibling markers at one column in one list', () => {
    // The case the residual handling already existed for, which must not
    // regress: the two markers reach column 4 by different whitespace.
    expect(ul(carveToHtml("- a\n  - b\n  - c\n"))).toBe(2)
    expect(ul(carveToHtml("- a\n  - b\n  - c\n"))).toBe(2)
  })

  it('leaves uniform indentation alone', () => {
    // The control: nothing here is about tabs specifically, so the shapes with
    // matching whitespace have to be untouched.
    expect(ul(carveToHtml("- a\n  - b\n  - c\n"))).toBe(2)
    expect(ul(carveToHtml("- a\n  - b\n  - c\n"))).toBe(2)
  })
})
