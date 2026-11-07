import { describe, expect, it } from 'vitest'
import { carveToHtml, decisionTrace } from '../src/index.js'

describe('an unclosed colon block attached by a marker-line plus', () => {
  it('hands its blank and following paragraph back to the item (carve#5359)', () => {
    const source = '- +\n::: note\n\n  tail\n'
    const trace = decisionTrace(source)
    expect(trace.find((record) => record.line === 3)?.owner).toBe('doc/item:1')
    expect(trace.find((record) => record.line === 4)?.owner).toBe('doc/item:1')
    expect(carveToHtml(source)).toBe(`<ul>
  <li>
    <aside class="admonition note" aria-label="Note">

    </aside>
    <p>tail</p>
  </li>
</ul>`)
  })

  it('opens a later list after the note at the outer item (carve#5359)', () => {
    const source = '- a\n  * +\n  ::: note\n\n    - q\n'
    const trace = decisionTrace(source)
    expect(trace.find((record) => record.line === 4)?.owner).toBe('doc/item:1')
    expect(trace.find((record) => record.line === 5)?.owner).toBe('doc/item:1/item:5')
    expect(carveToHtml(source)).toBe(`<ul>
  <li><p>a</p>
    <ul>
      <li>
        <aside class="admonition note" aria-label="Note">

        </aside>
      </li>
    </ul>
    <ul>
      <li>q</li>
    </ul>
  </li>
</ul>`)
  })

  it('keeps a paired colon block open across its blank', () => {
    const source = '- +\n::: note\n\n  tail\n:::\n'
    const trace = decisionTrace(source)
    expect(trace.find((record) => record.line === 3)?.owner).toBe('doc/item:1/div:2')
    expect(trace.find((record) => record.line === 4)?.owner).toBe('doc/item:1/div:2')
    expect(carveToHtml(source)).toBe(`<ul>
  <li>
    <aside class="admonition note" aria-label="Note">
      <p>tail</p>
    </aside>
  </li>
</ul>`)
  })

  it('closes the trace at the blank when an ordered item is already out of reach', () => {
    const trace = decisionTrace('1. +\n::: note\n\n  tail\n')
    expect(trace.find((record) => record.line === 3)?.owner).toBe('doc')
    expect(trace.find((record) => record.line === 4)?.owner).toBe('doc')
  })

  it('does not pair a closer after a separate list block with the attached note', () => {
    const trace = decisionTrace('- a\n  * +\n  ::: note\n\n    - q\n  :::\n')
    expect(trace.find((record) => record.line === 4)?.owner).toBe('doc/item:1')
    expect(trace.find((record) => record.line === 5)?.owner).toBe('doc/item:1/item:5')
  })

  it('keeps a closer paired after a heading in the note', () => {
    const source = '- +\n::: note\n\n# heading\n:::\n'
    const trace = decisionTrace(source)
    expect(trace.find((record) => record.line === 3)?.owner).toBe('doc/item:1/div:2')
    expect(trace.find((record) => record.line === 4)?.owner).toBe('doc/item:1/div:2')
    expect(carveToHtml(source)).toContain('<h1 id="heading">heading</h1>')
  })

  it('keeps text in the inner item when its column reaches that item', () => {
    const source = '- a\n  * +\n  ::: note\n\n      tail\n'
    const trace = decisionTrace(source)
    expect(trace.find((record) => record.line === 4)?.owner).toBe('doc/item:1/item:2')
    expect(trace.find((record) => record.line === 5)?.owner).toBe('doc/item:1/item:2')
    expect(carveToHtml(source)).toContain('        <p>tail</p>')
  })
})
