import { describe, it, expect } from 'vitest'
import { carveToHtml, carveToCarve, htmlToCarve } from '../src/index.js'

/**
 * PART 10 §11 / carve#1870. All five unchecked spellings render the same box,
 * so the item names the state it was written with.
 */
describe('an extended task state names itself in the HTML', () => {
  it.each([
    ['-', 'dropped'],
    ['_', 'paused'],
    ['?', 'maybe'],
  ])('writes data-task-state for [%s]', (state, word) => {
    expect(carveToHtml(`- [${state}] ${word}`)).toContain(`<li data-task-state="${state}">`)
  })

  it('escapes the value like any other attribute', () => {
    expect(carveToHtml('- [>] deferred')).toContain('<li data-task-state="&gt;">')
  })

  it('writes nothing for the two states the box already tells apart', () => {
    expect(carveToHtml('- [ ] a')).not.toContain('data-task-state')
    expect(carveToHtml('- [x] a')).not.toContain('data-task-state')
    expect(carveToHtml('- [X] a')).not.toContain('data-task-state')
  })

  it('writes nothing on a plain bullet', () => {
    expect(carveToHtml('- a')).not.toContain('data-task-state')
  })

  it('leads the authored attributes, being structural', () => {
    expect(carveToHtml('-{.c} [?] q')).toContain('<li data-task-state="?" class="c">')
  })

  it('survives a render and import cycle', () => {
    const source = carveToCarve('- [-] dropped\n- [x] done\n- [ ] open\n')
    expect(carveToCarve(htmlToCarve(carveToHtml(source)).value)).toBe(source)
  })

  it('reads the attribute as state rather than keeping it as one', () => {
    const back = htmlToCarve('<ul><li data-task-state="_"><input type="checkbox" disabled> paused</li></ul>').value
    expect(carveToCarve(back)).toBe('- [_] paused\n')
  })

  it('keeps a value outside the enumeration as the author attribute it is', () => {
    const back = htmlToCarve('<ul><li data-task-state="/"><input type="checkbox" disabled> odd</li></ul>').value
    expect(carveToCarve(back)).toBe('-{data-task-state=/} [ ] odd\n')
  })

  it('does not let a state the box contradicts tick the box', () => {
    // An unchecked box beside `data-task-state="x"` is a contradiction no
    // renderer wrote. Reading it would build a tree the schema refuses and tick
    // a box the HTML left empty.
    const back = htmlToCarve('<ul><li data-task-state="x"><input type="checkbox" disabled> a</li></ul>').value
    expect(carveToCarve(back)).toBe('-{data-task-state=x} [ ] a\n')
  })

  it('ignores the attribute on an item with no checkbox', () => {
    const back = htmlToCarve('<ul><li data-task-state="-">plain</li></ul>').value
    expect(carveToCarve(back)).toBe('-{data-task-state=-} plain\n')
  })
})
