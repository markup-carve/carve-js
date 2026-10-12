import { describe, it, expect } from 'vitest'
import { carveToAstJson, carveToCarve, carveToHtml } from '../src/index.js'

describe("an item's lead container hides no blank line", () => {
  // Corpus `362-an-unterminated-container-does-not-extend-the-item-past-a-
  // blank-line-3`, and the document the ruling was measured on.
  const source = '- ::: d\n  b\n\n  tail\n'
  const formatted = '- ::: d\n  b\n\n  tail\n  :::\n'

  const tightness = (src: string): boolean => {
    const first = carveToAstJson(src).children[0] as { type: string; tight?: boolean }
    expect(first.type).toBe('list')
    return first.tight === true
  }

  it('supplies the closer and nothing else', () => {
    expect(carveToCarve(source)).toBe(formatted)
  })

  it('reads both spellings tight', () => {
    expect(tightness(source)).toBe(true)
    expect(tightness(formatted)).toBe(true)
  })

  it('renders the same bytes either way, which is why the HTML gates missed it', () => {
    expect(carveToHtml(formatted)).toBe(carveToHtml(source))
  })

  it('keeps the interior of a container the item ATTACHES below a lead block', () => {
    // The other side of the line, corpus `279-a-boundary-line-inside-an-open-
    // fence-does-not-end-the-container-10`. Here the item has prose of its own
    // and the container is a later block, so the blank between the container's
    // two paragraphs is the CONTAINER's and the item stays tight. Reading the
    // ruling as "a `:::` never hides a blank line" would flip this golden.
    const attached = '- x\n  :::\n  a\n\n  b\n  :::\n'
    expect(tightness(attached)).toBe(true)
    expect(carveToHtml(attached)).toBe(
      '<ul>\n  <li>x\n    <div>\n      <p>a</p>\n      <p>b</p>\n    </div>\n  </li>\n</ul>',
    )
  })

  it('keeps a verbatim fence opaque, lead or not', () => {
    // A code or comment fence's payload is BYTES of one block, so a blank
    // between two of its lines was never an interior separator of the item.
    // That is untouched, and it is what stops the fix from reading as "a blank
    // line inside anything loosens".
    expect(tightness('- ```\n  b\n\n  tail\n  ```\n')).toBe(true)
    expect(tightness('- %%%\n  b\n\n  tail\n  %%%\n')).toBe(true)
  })
})
