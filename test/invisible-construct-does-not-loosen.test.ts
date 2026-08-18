import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

/*
 * PART 9 §17 L1 (carve#621): an INVISIBLE construct in a list item does not
 * loosen it.
 *
 * L1 defines loose as an item followed by a blank line before the next sibling
 * marker, OR an item holding a blank-line-separated second PARAGRAPH. A comment
 * and a definition are neither - they render nothing at all - so an item
 * wrapped in `<p>` because of one is the blank line showing through.
 *
 * carve-js already got the DEFINITION case right and the COMMENT case wrong, so
 * the two invisible kinds disagreed for no stated reason. Each of the three
 * engines failed a different subset of the three corpus cases, which is why
 * engine-vs-engine comparison never surfaced any of it.
 */
describe('an invisible construct does not loosen the item', () => {
  it('a comment after a blank keeps the item tight (87-compact-list-blocks-4)', () => {
    expect(carveToHtml('- a\n\n  %% just a note\n')).toBe('<ul>\n  <li>a</li>\n</ul>')
  })

  it('a definition after a blank keeps it tight (87-compact-list-blocks-5)', () => {
    expect(carveToHtml('- a\n\n  [r]: /u\n')).toBe('<ul>\n  <li>a</li>\n</ul>')
  })

  it('a comment block keeps it tight too', () => {
    // Covered by the existing block-opener arm rather than the invisible-line
    // skip: skipping past a `%%%` OPENER would land the scan on the block's
    // body - ordinary text - and loosen the item on content nobody sees.
    expect(carveToHtml('- a\n\n  %%%\n  note\n  %%%\n')).toBe('<ul>\n  <li>a</li>\n</ul>')
  })

  it('a real second paragraph still loosens', () => {
    // The clause turns on "second PARAGRAPH", so the visible case is unchanged.
    expect(carveToHtml('- a\n\n  b\n')).toContain('<p>a</p>')
  })
})

describe('the blank is still remembered', () => {
  /*
   * L1's OTHER clause: with a sibling item after it, the item IS followed by a
   * blank line before the next marker, and an invisible line in the gap does
   * not FILL it - so the list is loose. Attaching the comment to the item must
   * not consume that signal.
   *
   * This is the half that makes the fix two changes rather than one: treating
   * the comment as a block opener alone turned this case tight, which is the
   * opposite error.
   */
  it('a comment before a sibling still loosens (87-compact-list-blocks-6)', () => {
    expect(carveToHtml('- a\n\n  %% just a note\n- b\n')).toBe(
      '<ul>\n  <li><p>a</p></li>\n  <li><p>b</p></li>\n</ul>',
    )
  })

  it('a definition before a sibling loosens by the same rule', () => {
    expect(carveToHtml('- a\n\n  [r]: /u\n- b\n')).toBe(
      '<ul>\n  <li><p>a</p></li>\n  <li><p>b</p></li>\n</ul>',
    )
  })

  it('several invisible lines in the gap do not fill it either', () => {
    expect(carveToHtml('- a\n\n  %% one\n  [r]: /u\n  %% two\n- b\n')).toBe(
      '<ul>\n  <li><p>a</p></li>\n  <li><p>b</p></li>\n</ul>',
    )
  })

  it('a VISIBLE line after the blank fills it, and loosens on its own merit', () => {
    const html = carveToHtml('- a\n\n  %% note\n  text\n- b\n')
    expect(html).toContain('<p>a</p>')
    expect(html).toContain('text')
  })

  it('no blank at all stays tight, sibling or not', () => {
    expect(carveToHtml('- a\n  %% note\n')).toBe('<ul>\n  <li>a</li>\n</ul>')
    expect(carveToHtml('- a\n  %% note\n- b\n')).toBe(
      '<ul>\n  <li>a</li>\n  <li>b</li>\n</ul>',
    )
  })

  it('a different marker kind ends the item on the comment', () => {
    // `- a` / blank / `%% note` / `+ b`: the `+` is not a sibling of `-`, so the
    // sibling clause never fires. This used to fold the line into the item and
    // render it loose, recorded here as a PRE-EXISTING divergence from the
    // executable spec. `markup-carve/carve#1364` closes it: the comment at the
    // content column is a block, so the item holds no open paragraph and `+ b`
    // at column 0 reaches no container. carve-php `925f7dc` renders it this way.
    expect(carveToHtml('- a\n\n  %% note\n+ b\n')).toBe(
      '<ul>\n  <li>a</li>\n</ul>\n<p>+ b</p>',
    )
  })
})
