import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

const html = (s: string) => carveToHtml(s)

/**
 * List lazy continuation (matches djot.js and carve-php): a non-indented line
 * with no blank line before it folds into the item's lead paragraph when it is
 * plain paragraph text; a blank line, or a line that starts a block, ends the
 * list instead.
 */
describe('list lazy continuation', () => {
  it('folds a non-indented plain line into the item paragraph', () => {
    expect(html('- item\nlazy')).toBe('<ul>\n  <li>item\nlazy</li>\n</ul>')
  })

  it('folds the lazy line into the LAST item', () => {
    expect(html('- a\n- b\nlazy')).toBe(
      '<ul>\n  <li>a</li>\n  <li>b\nlazy</li>\n</ul>',
    )
  })

  it('folds multiple lazy lines', () => {
    expect(html('- a\nl1\nl2')).toBe('<ul>\n  <li>a\nl1\nl2</li>\n</ul>')
  })

  it('folds lazy continuation in an ordered list', () => {
    expect(html('1. a\nlazy')).toBe('<ol>\n  <li>a\nlazy</li>\n</ol>')
  })

  it('a blank line ends the list (no lazy fold across it)', () => {
    expect(html('- a\n\nlazy')).toBe('<ul>\n  <li>a</li>\n</ul>\n<p>lazy</p>')
  })

  it('a heading line ends the list', () => {
    expect(html('- a\n# H')).toBe(
      '<ul>\n  <li>a</li>\n</ul>\n<section id="H">\n  <h1>H</h1>\n</section>',
    )
  })

  it('a CLOSED fenced code line ends the list', () => {
    expect(html('- a\n```\nx\n```')).toBe(
      '<ul>\n  <li>a</li>\n</ul>\n<pre><code>x\n</code></pre>',
    )
  })

  it('an UNTERMINATED fence does not end the list', () => {
    // §10 I4: the closer lookahead guards the verbatim fence, so an
    // unterminated ``` is not a code block - it is an inline verbatim run that
    // belongs to the item's paragraph.
    //
    // This case previously asserted the opposite, with the input `- a\n```\nx`
    // and no closer. carve-rs produces what is expected here; carve-js broke
    // out of the list, which is the defect carve-js#540 fixed.
    expect(html('- a\n```\nx')).toBe('<ul>\n  <li>a\n<code>\nx</code></li>\n</ul>')
  })

  it('a blockquote line ends the list', () => {
    expect(html('- a\n> q')).toBe(
      '<ul>\n  <li>a</li>\n</ul>\n<blockquote><p>q</p></blockquote>',
    )
  })

  it('an item-local bare div opener auto-closes before a flush-left opener', () => {
    expect(html('- :::\n:::')).toBe(
      '<ul>\n  <li>\n    <div>\n    </div>\n  </li>\n</ul>\n<div>\n</div>',
    )
  })

  it('a glued item-local typed opener stays literal before a flush-left div opener', () => {
    expect(html('- ::: note\nbody\n:::')).toBe(
      '<ul>\n  <li>::: note\nbody</li>\n</ul>\n<div>\n</div>',
    )
  })

  it('an indented admonition still nests inside the list item', () => {
    expect(html('- ::: note\n  body\n  :::')).toBe(
      '<ul>\n  <li>\n    <aside class="admonition note">\n      <p>body</p>\n    </aside>\n  </li>\n</ul>',
    )
  })
  it('folds a below-column marker at every depth, not only one column in', () => {
    // PART 9 §24 C3: below the content column a marker folds as lazy item text,
    // with no mention of how deep the indent is, and C4 scopes Rule B's "any
    // indent" to where a TOP-LEVEL list may open. This engine nested `b` under
    // `a` two columns in, because the folded line kept its own indentation and
    // that reached the sub-list's content column on the reparse (carve#603).
    expect(html('-   x\n    - a\n  - b')).toBe(
      '<ul>\n  <li>x\n    <ul>\n      <li>a\n- b</li>\n    </ul>\n  </li>\n</ul>',
    )
    expect(html('-   x\n    - a\n   - b')).toBe(
      '<ul>\n  <li>x\n    <ul>\n      <li>a\n- b</li>\n    </ul>\n  </li>\n</ul>',
    )
    // The threshold is the content column, not a distance from column 0.
    expect(html('  - x\n    - a\n   - b')).toBe(
      '<ul>\n  <li>x\n    <ul>\n      <li>a\n- b</li>\n    </ul>\n  </li>\n</ul>',
    )
  })

  it('still opens a sublist at the content column', () => {
    expect(html('-   x\n    - a\n    - b')).toBe(
      '<ul>\n  <li>x\n    <ul>\n      <li>a</li>\n      <li>b</li>\n    </ul>\n  </li>\n</ul>',
    )
  })
})
