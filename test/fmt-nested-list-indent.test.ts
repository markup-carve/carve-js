import { describe, it, expect } from 'vitest'
import { carveToCarve, carveToHtml } from '../src/index.js'

/*
 * carve-js#641: the canonical writer INFLATED a nested list ladder.
 *
 * Each level was indented twice - once by an absolute `'  '.repeat(listDepth)`
 * and again by the parent item's continuation prefix - with a two-space strip
 * as partial compensation. The net per-level indent therefore GREW:
 *
 *     in    0  2  4  6  8 10
 *     out   0  4 10 18 28 40
 *
 * so a document's output was O(depth^3) bytes where the source is O(depth^2).
 * At depth 100 a 10 KB ladder came back as 344 KB.
 *
 * That is what made `fmt` look superlinear in depth. Time was roughly linear in
 * the bytes it emitted; the bytes were the defect.
 *
 * Pinned by BYTES, not by wall clock. The size is deterministic, so it cannot
 * flake on a loaded machine - which is what #641 says a ratio guard tight
 * enough to catch this would do. Nothing caught the inflation before because
 * every existing check compared HTML or asserted idempotence, and the inflated
 * form is equivalent HTML and a fixed point.
 */
const ladder = (depth: number): string =>
  Array.from({ length: depth }, (_, i) => ' '.repeat(i * 2) + '- x').join('\n') + '\n'

describe('the writer does not inflate a nested list', () => {
  it('indents each level by exactly the marker width', () => {
    expect(carveToCarve(ladder(6))).toBe(ladder(6))
  })

  it('returns a deep ladder byte-identical, at every depth', () => {
    for (const depth of [10, 50, 100, 200]) {
      const src = ladder(depth)
      expect(carveToCarve(src), `depth ${depth}`).toBe(src)
    }
  })

  it('keeps the output the size of the source', () => {
    // The property behind the byte equality above: O(depth^2), which is what a
    // ladder's own text costs, and not a power more.
    const src = ladder(100)
    expect(carveToCarve(src).length).toBe(src.length)
  })

  it('is idempotent and preserves the rendering', () => {
    const src = ladder(40)
    const once = carveToCarve(src)
    expect(carveToCarve(once)).toBe(once)
    expect(carveToHtml(once)).toBe(carveToHtml(src))
  })
})

describe('nesting the writer has to indent is unchanged', () => {
  it('indents an item body under its marker', () => {
    const src = '- a\n\n  b\n'
    expect(carveToCarve(src)).toBe(src)
  })

  it('indents under a wider ordered marker', () => {
    const src = '10. a\n    - b\n'
    expect(carveToHtml(carveToCarve(src))).toBe(carveToHtml(src))
    expect(carveToCarve(carveToCarve(src))).toBe(carveToCarve(src))
  })

  it('keeps a task marker s continuation aligned', () => {
    const src = '- [ ] a\n      - b\n'
    expect(carveToHtml(carveToCarve(src))).toBe(carveToHtml(src))
  })

  it('uses the bullet content column for an attached run after a task sublist', () => {
    const source = '- [ ] a\n  - b\n\n    > q\n'
    const canonical = '- [ ] a\n  - b\n  +\n  > q\n'
    expect(carveToCarve(source)).toBe(canonical)
    expect(carveToHtml(canonical)).toBe(carveToHtml(source))
  })
})
