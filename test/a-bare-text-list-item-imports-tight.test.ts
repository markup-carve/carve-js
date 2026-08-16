/*
 * Tight-list import, as ruled (spec corpus-convert 27/28): a bare-text
 * `<li>one</li>` is a TIGHT list item, a block-wrapped `<li><p>one</p></li>`
 * a loose one. Tightness is a property of the LIST, so a mixed list has to
 * pick a side, and it is LOOSE: markup-carve/carve#1210 ruled that
 * `<li><p>...</p></li>` stays loose and that import preserves source
 * structure rather than normalizing, so one block-wrapped item decides it.
 *
 * This engine normalized a mixed list TIGHT, which is the one shape that
 * ruling refuses (markup-carve/carve#1260), and it was alone in doing so -
 * carve-php and carve-rs both import that list loose. Every list imported
 * loose before the tight-item rule, whatever the source spelled.
 */
import { describe, it, expect } from 'vitest'
import { htmlToCarve, carveToHtml } from '../src/index.js'

const imp = (html: string): string => htmlToCarve(html).value

describe('a bare-text list item imports tight', () => {
  it('a bare-text list imports tight (corpus-convert 27)', () => {
    expect(imp('<ul><li>one</li><li>two</li></ul>')).toBe('- one\n- two\n')
    expect(carveToHtml(imp('<ul><li>one</li><li>two</li></ul>'))).toBe(
      '<ul>\n  <li>one</li>\n  <li>two</li>\n</ul>',
    )
  })

  it('a mixed list stays loose (corpus-convert 28)', () => {
    // One block-wrapped item is enough: the ruling preserves what the source
    // spelled, and tight/loose belongs to the list rather than the item.
    expect(imp('<ul><li>one</li><li><p>two</p></li></ul>')).toBe('- one\n\n- two\n')
    expect(carveToHtml(imp('<ul><li>one</li><li><p>two</p></li></ul>'))).toBe(
      '<ul>\n  <li><p>one</p></li>\n  <li><p>two</p></li>\n</ul>',
    )
  })

  it('the block-wrapped item decides it wherever it sits', () => {
    // FIRST item wrapped, not the last: a rule reading only one end of the
    // list would pass the case above and still normalize this one.
    expect(imp('<ul><li><p>one</p></li><li>two</li></ul>')).toBe('- one\n\n- two\n')
  })

  it('an all-paragraph list stays loose', () => {
    expect(imp('<ul><li><p>one</p></li><li><p>two</p></li></ul>')).toBe('- one\n\n- two\n')
  })

  it('a nested sublist does not make its host item loose', () => {
    // The item's own text is bare; the `<ul>` beside it is structure, not a
    // paragraph wrapper.
    expect(imp('<ul><li>one<ul><li>sub</li></ul></li><li>two</li></ul>')).toBe(
      '- one\n  - sub\n- two\n',
    )
  })

  it('the consumed checkbox input does not decide tightness', () => {
    // The `<input>` is not a block tag, but it is consumed into the `[x]`
    // marker rather than imported - only real content votes.
    expect(
      imp('<ul class="task-list"><li><input type="checkbox" checked> done</li><li><input type="checkbox"> open</li></ul>'),
    ).toBe('{.task-list}\n- [x] done\n- [ ] open\n')
  })

  it('the engine of both looseness spellings round-trips through its own HTML', () => {
    expect(imp(carveToHtml('- one\n- two\n'))).toBe('- one\n- two\n')
    expect(imp(carveToHtml('- one\n\n- two\n'))).toBe('- one\n\n- two\n')
  })
})
