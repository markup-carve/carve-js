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

  it('a fenced code line ends the list', () => {
    expect(html('- a\n```\nx')).toBe(
      '<ul>\n  <li>a</li>\n</ul>\n<pre><code>x\n</code></pre>',
    )
  })

  it('a blockquote line ends the list', () => {
    expect(html('- a\n> q')).toBe(
      '<ul>\n  <li>a</li>\n</ul>\n<blockquote><p>q</p></blockquote>',
    )
  })
})
