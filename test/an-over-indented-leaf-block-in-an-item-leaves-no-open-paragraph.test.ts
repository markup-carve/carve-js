import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

const html = (s: string) => carveToHtml(s).trim()

/**
 * AN OVER-INDENTED LEAF BLOCK IN A LIST ITEM LEAVES NO OPEN PARAGRAPH
 * (markup-carve/carve-js#2542).
 *
 * `trackItemLazyState`'s heading, table-row and thematic-break arms are column-0
 * strict (§24 C3), and a block the author wrote PAST the item's content column
 * still carries that run when it reaches them, so it read as prose and left a
 * paragraph the block does not have. The flush-left line below then folded into
 * the item as bare text beside the block, where the oracle has already ended the
 * item.
 *
 * ONLY WHEN THE RUN IS AUTHORED. At a deeper nesting level the leading run is
 * the nested item's own content column, and reading it flush erases a level.
 * `ItemLazyState` now carries `ownedColumn`, the distinction
 * `rebaseOverindentedBlocks` has carried under that name all along, seeded from
 * the lead's nested marker and advanced by the lines the deeper item takes. An
 * open quote's own paragraph and an open colon-fence container hold the run for
 * the same reason, and are excluded the same way.
 */
describe('an over-indented leaf block in a list item leaves no open paragraph', () => {
  it('ends the item on an over-indented heading', () => {
    expect(html('- p\n    # H\nx\n')).toBe(
      ['<ul>', '  <li>p', '    <h1 id="H">H</h1>', '  </li>', '</ul>', '<p>x</p>'].join('\n'),
    )
  })

  it('ends the item on an over-indented table row', () => {
    expect(html('- p\n    | a |\nx\n')).toBe(
      [
        '<ul>',
        '  <li>p',
        '    <table>',
        '      <tbody>',
        '        <tr><td>a</td></tr>',
        '      </tbody>',
        '    </table>',
        '  </li>',
        '</ul>',
        '<p>x</p>',
      ].join('\n'),
    )
  })

  it('ends the item on an over-indented thematic break', () => {
    expect(html('- p\n    ---\nx\n')).toBe(
      ['<ul>', '  <li>p', '    <hr>', '  </li>', '</ul>', '<p>x</p>'].join('\n'),
    )
  })

  // The control the ownedColumn exists for: the run here is the nested item's
  // content column, not an authored over-indent, so the line is the sub-item's
  // and the flush-left line below still folds.
  it('reads a nested item’s own column as a nesting level', () => {
    expect(html('- - p\n    q\nx\n')).toBe(
      ['<ul>', '  <li>', '    <ul>', '      <li>p', 'q', 'x</li>', '    </ul>', '  </li>', '</ul>'].join('\n'),
    )
  })

  // At the item's own column both answers already agreed, and prose at any
  // column leaves a paragraph genuinely open. Neither moves.
  it('leaves the at-column spelling where it was', () => {
    expect(html('- p\n  # H\nx\n')).toBe(
      ['<ul>', '  <li>p', '    <h1 id="H">H</h1>', '  </li>', '</ul>', '<p>x</p>'].join('\n'),
    )
  })

  it('leaves over-indented prose folding', () => {
    expect(html('- p\n    q\nx\n')).toBe(['<ul>', '  <li>p', 'q', 'x</li>', '</ul>'].join('\n'))
  })
})
