import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

/**
 * PART 9R R1a / markup-carve/carve#1881. A definition-shaped marker line under
 * an open paragraph is lazy continuation text, so it defines nothing - and that
 * is a property of the grammar, not of how long the document is.
 *
 * This engine kept the answer for one line and left it from the second on. The
 * pre-pass asked `prepassOpensBlock` about the line ABOVE, which answers "does
 * it look like an opener" - and a definition-shaped line looks like one whether
 * or not it was collected, so the question begged itself (carve-js#1580).
 */
const doc = (n: number) =>
  `intro paragraph\n${Array.from({ length: n }, (_, i) => `- [d${i}]: /u${i}`).join('\n')}\n\n[go][d${n - 1}]\n`

describe('a lazy marker line defines nothing at any size', () => {
  it.each([1, 2, 3, 10, 100])('leaves the reference unresolved at %i lines', (n) => {
    const html = carveToHtml(doc(n))
    expect(html).not.toContain(`href="/u${n - 1}"`)
    // AND THE TEXT IS ALL THERE. Not collecting is the half that must not cost
    // the author anything: every line renders as what was typed.
    expect(html).toContain(`[d${n - 1}]: /u${n - 1}`)
  })

  it('still collects a definition no paragraph is open above', () => {
    expect(carveToHtml('para\n\n[d]: /u\n\n[go][d]\n')).toContain('href="/u"')
  })

  it('still collects a marker-carried definition under a heading', () => {
    // A heading closes the paragraph, so the marker line below it is not lazy.
    expect(carveToHtml('# H\n- [d]: /u\n\n[go][d]\n')).toContain('href="/u"')
  })

  it('keeps an invisible opener interrupting', () => {
    // A top-level definition has a paragraph open above it and interrupts it
    // anyway - the case that separates "this line folded" from "a paragraph was
    // open above it", which is what the carry had to be narrowed to.
    expect(carveToHtml('para\n[q]: /q\n\n[go][q]\n')).toContain('href="/q"')
  })
})
