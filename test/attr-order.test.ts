import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

const h = (s: string) => carveToHtml(s)

/**
 * Attributes render in the author's source-appearance order (matching
 * djot and carve-php), classes merged into one `class` at the position
 * of the first class. Previously carve-js used a fixed class/id/key
 * order, diverging from both reference impls.
 */
describe('attribute source order', () => {
  it('renders inline attrs in source order (class, id, key)', () => {
    expect(h('[t]{.a #b key=c}')).toBe(
      '<p><span class="a" id="b" key="c">t</span></p>',
    )
  })

  it('renders inline attrs in source order (key, class, id)', () => {
    expect(h('[t]{key=c .a #b}')).toBe(
      '<p><span key="c" class="a" id="b">t</span></p>',
    )
  })

  it('renders inline attrs in source order (id, key, class)', () => {
    expect(h('[t]{#b key=c .a}')).toBe(
      '<p><span id="b" key="c" class="a">t</span></p>',
    )
  })

  it('keeps merged classes at the first class position', () => {
    expect(h('[t]{.a key=k .b}')).toBe(
      '<p><span class="a b" key="k">t</span></p>',
    )
  })

  it('block-attribute merge follows first-appearance order (djot canonical)', () => {
    expect(
      h('{#id}\n{key=val}\n{.foo .bar}\n{key=val2}\n{.baz}\n{#id2}\nOkay'),
    ).toBe('<p id="id2" key="val2" class="foo bar baz">Okay</p>')
  })
})
