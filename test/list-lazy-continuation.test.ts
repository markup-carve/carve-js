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

  it('an UNTERMINATED fence ends the list too', () => {
    // carve#4018: no closer lookahead, so an unterminated opener is a block.
    expect(html('- a\n```\nx')).toBe('<ul>\n  <li>a</li>\n</ul>\n<pre><code>x</code></pre>')
  })

  it('a blockquote line ends the list', () => {
    expect(html('- a\n> q')).toBe(
      '<ul>\n  <li>a</li>\n</ul>\n<blockquote><p>q</p></blockquote>',
    )
  })

  it('an item-local bare div opener auto-closes before a flush-left opener', () => {
    expect(html('- :::\n:::')).toBe(
      '<ul>\n  <li>\n    <div>\n\n    </div>\n  </li>\n</ul>\n<div>\n\n</div>',
    )
  })

  it('a marker-line typed opener releases prose before a flush-left div opener', () => {
    expect(html('- ::: note\nbody\n:::')).toBe(
      "<ul>\n  <li>\n    <aside class=\"admonition note\" aria-label=\"Note\">\n\n    </aside>\n  </li>\n</ul>\n<p>body</p>\n<div>\n\n</div>",
    )
  })

  it('an indented admonition still nests inside the list item', () => {
    expect(html('- ::: note\n  body\n  :::')).toBe(
      '<ul>\n  <li>\n    <aside class="admonition note" aria-label="Note">\n      <p>body</p>\n    </aside>\n  </li>\n</ul>',
    )
  })
  it('gives a below-column marker to the enclosing item list', () => {
    expect(html('-   x\n    - a\n  - b')).toBe(
      '<ul>\n  <li>x\n    <ul>\n      <li>a</li>\n    </ul>\n  </li>\n  <li>b</li>\n</ul>',
    )
    expect(html('-   x\n    - a\n   - b')).toBe(
      '<ul>\n  <li>x\n    <ul>\n      <li>a</li>\n    </ul>\n  </li>\n  <li>b</li>\n</ul>',
    )
    // The threshold is the content column, not a distance from column 0.
    expect(html('  - x\n    - a\n   - b')).toBe(
      '<ul>\n  <li>x\n    <ul>\n      <li>a</li>\n    </ul>\n  </li>\n  <li>b</li>\n</ul>',
    )
  })

  it('still opens a sublist at the content column', () => {
    expect(html('-   x\n    - a\n    - b')).toBe(
      '<ul>\n  <li>x\n    <ul>\n      <li>a</li>\n      <li>b</li>\n    </ul>\n  </li>\n</ul>',
    )
  })
})
