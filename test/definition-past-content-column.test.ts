import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

/*
 * carve-js#613: a definition PAST a list item's content column renders as item
 * text - correctly - and was collected anyway, so the same line was both
 * visible content and an active definition.
 *
 * A definition renders nothing. If the line renders, it was not taken as a
 * definition, so collecting it too is the contradiction: a reader of the output
 * sees `[r]: /u` as prose while a reference elsewhere silently resolves through
 * it.
 *
 * The neighbouring cases were already right, which is what made this an
 * oversight rather than a decision: AT the content column it is collected and
 * invisible, and BELOW every column (carve-js#597) it is text that defines
 * nothing. Only the past-the-column case collected while rendering.
 */
const resolves = (src: string) => carveToHtml(src).includes('<a href="/u">t</a>')

describe('a definition only opens AT its content column', () => {
  it('past the column: renders as text and defines nothing', () => {
    expect(carveToHtml('- a\n      [r]: /u\n')).toBe('<ul>\n  <li>a\n[r]: /u</li>\n</ul>')
    expect(resolves('- a\n      [r]: /u\n\nsee [t][r]\n')).toBe(false)
  })

  it('below every column: text that defines nothing (carve-js#597)', () => {
    expect(resolves('- - a\n [r]: /u\n\nsee [t][r]\n')).toBe(false)
  })

  it('top level, indented under an open paragraph: defines nothing', () => {
    expect(resolves('text\n  [r]: /u\n\nsee [t][r]\n')).toBe(false)
  })
})

describe('a definition AT a content column still resolves', () => {
  it('at a list item content column', () => {
    expect(resolves('- a\n  [r]: /u\n\nsee [t][r]\n')).toBe(true)
  })

  it('at a DOUBLY nested list content column', () => {
    // The pre-pass has to count BOTH markers on `- - see`: its content column
    // is 4, not 2. Tracking only the first understated it, and the definition
    // written at the real column then read as "past the column".
    expect(carveToHtml('- - see [t][x].\n\n    [x]: /u\n')).toContain('<a href="/u">t</a>')
  })

  it('on the marker line, where it IS the item', () => {
    expect(resolves('- [r]: /u\n\nsee [t][r]\n')).toBe(true)
  })

  it('at document level', () => {
    expect(resolves('[r]: /u\n\nsee [t][r]\n')).toBe(true)
  })

  it('inside a block quote', () => {
    expect(resolves('> [r]: /u\n\nsee [t][r]\n')).toBe(true)
  })

  it('inside a footnote body, whose column the flat pass cannot model', () => {
    expect(carveToHtml('A[^n].\n\n[^n]: see [t][x].\n\n  [x]: /u\n')).toContain(
      '<a href="/u">t</a>',
    )
  })
})
