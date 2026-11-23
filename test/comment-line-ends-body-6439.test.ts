import { describe, expect, it } from 'vitest'
import { format, parse, render } from '../public/index.ts'

// carve#6439 row D. C2-B-137: a comment-only line closes only the container of the opaque body it ends.
describe('C2-B-137: a comment-only line that ends an opaque body closes only the body\'s container', () => {
  const rowD = '- x\n  - ::: |\n    %%%\n%% c\n    %%%\nz\n'

  it('keeps the outer item open, so a later comment block opens in it and the next unowned line closes it', () => {
    expect(render(rowD)).toBe(
      '<ul>\n  <li>x\n    <ul>\n      <li>\n        <div class="line-block">\n\n        </div>\n      </li>\n    </ul>\n  </li>\n</ul>\n<p>z</p>',
    )
  })

  it('places the comment and the second comment block in the outer item', () => {
    const outer = parse(rowD).children[0]
    if (outer?.type !== 'list') throw new Error('expected a list')
    expect(outer.children[0]!.children.map((child) => child.type)).toEqual(['paragraph', 'list', 'comment', 'comment'])
  })

  it('reads a line indented past the outer marker as content of the outer item, for a code fence too', () => {
    expect(render('- x\n  - ```\n%% c\n  y\n')).toBe(
      '<ul>\n  <li>x\n    <ul>\n      <li>\n        <pre><code></code></pre>\n      </li>\n    </ul>\n    <p>y</p>\n  </li>\n</ul>',
    )
    expect(render('- x\n  - ```\n%% c\n    y\n')).toBe(
      '<ul>\n  <li>x\n    <ul>\n      <li>\n        <pre><code></code></pre>\n      </li>\n    </ul>\n    <p>y</p>\n  </li>\n</ul>',
    )
  })

  it('keeps the quote around the item open', () => {
    expect(render('> - ```\n%% c\n> y\n')).toBe(
      '<blockquote>\n  <ul>\n    <li>\n      <pre><code></code></pre>\n    </li>\n  </ul>\n  <p>y</p>\n</blockquote>',
    )
  })

  it('still closes every unowned container at a region marker line', () => {
    expect(render('- x\n  - ```\n%% #region a\n  y\n')).toBe(
      '<ul>\n  <li>x\n    <ul>\n      <li>\n        <pre><code></code></pre>\n      </li>\n    </ul>\n  </li>\n</ul>\n<p>y</p>',
    )
  })

  it('writes the code fence form back to a source that reads the same and is stable', () => {
    for (const source of ['- x\n  - ```\n%% c\n  y\n', '> - ```\n%% c\n> y\n']) {
      const written = format(source)
      expect(render(written)).toBe(render(source))
      expect(format(written)).toBe(written)
    }
  })
})
