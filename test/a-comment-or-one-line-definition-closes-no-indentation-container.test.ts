import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml, parse } from '../src/index.js'
import type { BlockNode, List } from '../src/ast.js'

// carve#4862: expected output read from the spec model.
describe('a comment or one-line definition closes no indentation container', () => {
  it.each([
    ['a comment below an item', '- a\n%% c\n  b\n', '<ul>\n  <li>a\n    b\n  </li>\n</ul>'],
    ['a definition below an item', '- a\n[r]: /u\n  b [r][]\n', '<ul>\n  <li>a\n    b <a href="/u">r</a>\n  </li>\n</ul>'],
    ['an abbreviation definition below an item', '- a\n*[A]: b\n  c A\n', '<ul>\n  <li>a\n    c <abbr title="b">A</abbr>\n  </li>\n</ul>'],
    ['a matched span below an item', '- a\n%%%\nhidden\n%%%\n  b\n', '<ul>\n  <li>a\n    b\n  </li>\n</ul>'],
    ['a comment below a description', ':: t\n:  x\n%% c\n   more\n', '<dl>\n  <dt>t</dt>\n  <dd>\n    <p>x</p>\n    <p>more</p>\n  </dd>\n</dl>'],
    ['a flush-left line still closes the item', '- a\n%% c\nb\n', '<ul>\n  <li>a</li>\n</ul>\n<p>b</p>'],
    ['a quote still needs its marker', '> a\n%% c\n> b\n', '<blockquote><p>a</p></blockquote>\n<blockquote><p>b</p></blockquote>'],
    ['a region marker closes every item', '- a\n%% #endregion\n  b\n', '<ul>\n  <li>a</li>\n</ul>\n<p>b</p>'],
    ['a footnote definition keeps its frame', ':: t\n:  x\n[^f]: n\n:: t2\n: d\n', '<dl>\n  <dt>t</dt>\n  <dd>x</dd>\n</dl>\n<dl>\n  <dt>t2</dt>\n  <dd>d</dd>\n</dl>'],
    ['a span after a refused plus moves whole', '- a\n+\n%%%\n[r]: /opaque\n%%%\n  b\n', '<ul>\n  <li>a\n+\n    b\n  </li>\n</ul>'],
    ['a definition below a paragraph a second plus attached', '- +\nfirst\n+\ntext\n[r]: /u\n  y\n', '<ul>\n  <li>first\n    text\n    y\n  </li>\n</ul>'],
  ])('%s', (_name, source, html) => {
    expect(carveToHtml(source).trim()).toBe(html)
  })

  it('writes a comment after an attached paragraph without a plus', () => {
    const written = carveToCarve('- a\n+\nb\n%% c\n  d\n')
    expect(written).not.toMatch(/^\+\n%% c$/m)
    expect(carveToHtml(written)).toBe(carveToHtml('- a\n+\nb\n%% c\n  d\n'))
  })

  it('maps a moved line back to its source', () => {
    const source = '- a\n%% note\n  café\n'
    const item = (parse(source).children[0] as List).items[0]!
    const comment = item.children.find((node: BlockNode) => node.type === 'comment')!
    expect(comment.pos?.startLine).toBe(2)
    expect(source.slice(comment.pos!.startOffset, comment.pos!.endOffset)).toContain('%% note')
  })
})
