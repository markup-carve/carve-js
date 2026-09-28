import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

/**
 * A colon fence written on a marker line opens nothing when no body line ever
 * reaches the item's content column: the lead is item text, and the flush-left
 * line below folds into it.
 *
 * The decision was spelled per KIND rather than asked of the dispatcher's
 * predicate, and only the admonition and the div were listed. `::: |`, `::: >`
 * and `::: \` therefore opened their block off a body that belonged to the
 * document, which put the line block, the quote block and the hard-break block
 * inside an item whose own text had vanished (carve-js#2236). The values below
 * are the oracle's, run at spec `71b51d00`.
 *
 * ALL FIVE KINDS IN ONE FILE, because they are one reading. A per-kind spelling
 * is what let three of them drift, and a test per kind in three files would
 * have looked complete while asking the same question of only two.
 */
describe('a colon fence on a marker line needs a body inside the item', () => {
  const html = (src: string) => carveToHtml(src).trim()

  it('keeps the lead as item text for every colon kind', () => {
    expect(html('* ::: x\n~\n')).toBe('<ul>\n  <li>::: x\n~</li>\n</ul>')
    expect(html('* ::: note\n~\n')).toBe('<ul>\n  <li>::: note\n~</li>\n</ul>')
    expect(html('* ::: |\n~\n')).toBe('<ul>\n  <li>::: |\n~</li>\n</ul>')
    expect(html('* ::: >\n~\n')).toBe('<ul>\n  <li>::: &gt;\n~</li>\n</ul>')
    // The trailing backslash is then ordinary inline text, so it hard-breaks.
    expect(html('* ::: \\\n~\n')).toBe('<ul>\n  <li>::: <br>\n~</li>\n</ul>')
  })

  it('still opens the block when a body line reaches the content column', () => {
    // The control, and the half a kind-blind fix would break: one column of
    // indent on the body is the whole difference between item text and an open
    // container.
    expect(html('* ::: |\n  ~\n')).toBe(
      '<ul>\n  <li>\n    <div class="line-block">\n      <p>~</p>\n    </div>\n  </li>\n</ul>',
    )
    expect(html('* ::: >\n  ~\n')).toBe(
      '<ul>\n  <li>\n    <blockquote><p>~</p></blockquote>\n  </li>\n</ul>',
    )
    expect(html('* ::: \\\n  ~\n')).toBe(
      '<ul>\n  <li>\n    <div class="hardbreaks">\n      <p>~</p>\n    </div>\n  </li>\n</ul>',
    )
  })

  it('reads the same off a dash marker, and with the fence closed in the item', () => {
    expect(html('- ::: |\n~\n')).toBe('<ul>\n  <li>::: |\n~</li>\n</ul>')
    expect(html('* ::: |\n  ~\n  :::\n')).toBe(
      '<ul>\n  <li>\n    <div class="line-block">\n      <p>~</p>\n    </div>\n  </li>\n</ul>',
    )
  })
})
