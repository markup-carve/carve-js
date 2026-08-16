/*
 * Tight-list import, as ruled (spec corpus-convert 27/28; clears the js
 * entries in the spec repo's resources/converter-drift.txt): a bare-text
 * `<li>one</li>` is a TIGHT list item, a block-wrapped `<li><p>one</p></li>`
 * a loose one. Tightness is a property of the LIST, so a mixed list has to
 * pick a side, and it normalizes TIGHT - one bare item is the author's word
 * that the list is tight, while `<p>` is what serializers wrap everything
 * in. Every list imported loose before this, whatever the source spelled.
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

  it('a mixed list normalizes tight (corpus-convert 28)', () => {
    expect(imp('<ul><li>one</li><li><p>two</p></li></ul>')).toBe('- one\n- two\n')
    expect(carveToHtml(imp('<ul><li>one</li><li><p>two</p></li></ul>'))).toBe(
      '<ul>\n  <li>one</li>\n  <li>two</li>\n</ul>',
    )
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
