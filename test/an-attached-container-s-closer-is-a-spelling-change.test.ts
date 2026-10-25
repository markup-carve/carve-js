import { describe, it, expect } from 'vitest'
import { carveToAstJson, carveToCarve, carveToHtml } from '../src/index.js'

describe("an attached container's closer is a spelling change", () => {
  const unclosed = '- x\n  :::\n  a\n\n  b\n'
  const closed = '- x\n  :::\n  a\n\n  b\n  :::\n'

  const tightness = (src: string): boolean => {
    const first = carveToAstJson(src).children[0] as { type: string; spacing?: string }
    expect(first.type).toBe('list')
    return first.spacing === 'tight'
  }

  it('reads both spellings tight', () => {
    expect(tightness(unclosed)).toBe(true)
    expect(tightness(closed)).toBe(true)
  })

  it('renders both spellings identically, which is the half #1602 never broke', () => {
    // The lead paragraph is what moved: a loose item wraps it in `<p>`, a tight
    // one does not, and nothing about this shape puts the difference out of
    // reach the way a container's interior does.
    expect(carveToHtml(unclosed)).toBe(carveToHtml(closed))
    expect(carveToHtml(unclosed)).toBe(
      '<ul>\n  <li>x\n    <div>\n      <p>a</p>\n      <p>b</p>\n    </div>\n  </li>\n</ul>',
    )
  })

  it('supplies the closer and NOTHING ELSE', () => {
    // THE BLANK LINE ANSWERS ITSELF, and this is the assertion that records it.
    //
    // The writer used to do two things to this document: supply the closer AND
    // insert a blank line after `x`. That looked like a second spelling change
    // needing its own ruling - under a source-based reading of looseness,
    // inserting a blank line is not innocent.
    //
    // It was never an independent decision. The writer separates an attached
    // block from a LOOSE item's lead with a blank line, so the insertion was a
    // consequence of the wrong tightness reading rather than a choice beside
    // it. With the item read tight there is nothing to separate, the blank is
    // not written, and `fmt` does here exactly what it does on #1602's shape:
    // supplies the closer, changes nothing else.
    expect(carveToCarve(unclosed)).toBe(closed)
    expect(carveToCarve(closed)).toBe(closed)
  })

  it('keeps the lead container tight, both spellings', () => {
    expect(tightness('- ::: d\n  b\n\n  tail\n')).toBe(true)
    expect(tightness('- ::: d\n  b\n\n  tail\n  :::\n')).toBe(true)
  })

  it('keeps a verbatim fence opaque, closed or not', () => {
    // The closer gate stays for the two verbatim kinds, where an opener with no
    // closer is inline verbatim inside a paragraph and opens no block at all.
    // Only the `:::` container still opens one without its closer, which is what
    // corpus family 362 pins and what made this shape's reading wrong.
    expect(tightness('- x\n  ```\n  a\n\n  b\n  ```\n')).toBe(true)
    expect(tightness('- ```\n  b\n\n  tail\n  ```\n')).toBe(true)
    expect(tightness('- %%%\n  b\n\n  tail\n  %%%\n')).toBe(true)
  })

  it('keeps attached and lead configurations tight', () => {
    for (const src of [unclosed, closed]) expect(tightness(src)).toBe(true)
    for (const src of ['- ::: d\n  b\n\n  tail\n', '- ::: d\n  b\n\n  tail\n  :::\n']) {
      expect(tightness(src)).toBe(true)
    }
  })
})
