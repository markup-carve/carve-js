import { describe, expect, it } from 'vitest'
import { htmlToCarve } from '../src/index.js'

/**
 * A NON-EMPTY `attrs.order` IS THE ELEMENT'S OWN ORDER, not a fixed one.
 *
 * The importer spelled `#id`, then `.class`, then the key-values, whatever order
 * the element had written them in. `<h1 class="k" id="x">` came back as
 * `{#x .k}` and re-rendered as `<h1 id="x" class="k">` - attributes the input
 * did not have in that order, which is carve-rs#1354's own statement of the
 * defect. carve-rs reads the element; markup-carve/carve-js#1416 added the slot
 * here without that half, so the two engines wrote different source for the same
 * HTML (markup-carve/carve-js#1456).
 *
 * THE EXPECTATIONS ARE carve-rs's ANSWERS, taken from that engine at `11ab195f`
 * rather than from this one, so a shape the two disagree on fails here rather
 * than recording whatever this engine happens to do.
 */
describe("an imported heading keeps its element's attribute order", () => {
  const written = (html: string) => htmlToCarve(html).value

  it('writes a class before an id where the element did', () => {
    expect(written('<h1 class="k" id="x">h</h1>')).toBe('{.k #x}\n# h\n')
  })

  it('writes the id first where the element did', () => {
    expect(written('<h1 id="x" class="k">h</h1>')).toBe('{#x .k}\n# h\n')
  })

  it('orders a key-value against the id by the element too', () => {
    expect(written('<h1 data-a="1" id="x">h</h1>')).toBe('{data-a=1 #x}\n# h\n')
  })

  it('orders all three by the element', () => {
    expect(written('<h1 class="k" data-a="1" id="x">h</h1>')).toBe('{.k data-a=1 #x}\n# h\n')
  })

  /*
   * A NON-EMPTY ORDER IS EXHAUSTIVE. A slot the element did not spell under its
   * own name still has to appear or the writer drops it silently, so the id
   * survives an element whose only other attribute was folded away.
   */
  it('keeps a slot the element did not name', () => {
    expect(written('<h1 style="color:red" id="x">h</h1>')).toBe('{#x}\n# h\n')
  })
})
