import { describe, expect, it } from 'vitest'
import { carveToHtml, parse } from '../src/index.js'
import type { List } from '../src/ast.js'

// carve#5170: a refused `+` changes no owner and a `%%%` span closes no item, so the
// next visible line at the content column stays in the host (CARVE-P9-067, #5013, #4449).
describe('a comment span after a refused plus closes no item', () => {
  it.each([
    ['a marker-line plus', '- +\n%%%\nx\n%%%\n  text\n', '<ul>\n  <li>text</li>\n</ul>'],
    ['an own-line plus', '- a\n+\n%%%\nx\n%%%\n  text\n', '<ul>\n  <li>a\n    text\n  </li>\n</ul>'],
    ['an ordered item', '1. +\n%%%\nx\n%%%\n   text\n', '<ol>\n  <li>text</li>\n</ol>'],
    ['a description', ':: t\n: +\n%%%\nx\n%%%\n  text\n', '<dl>\n  <dt>t</dt>\n  <dd>text</dd>\n</dl>'],
    ['a nested item', '- - +\n  %%%\n  x\n  %%%\n    text\n', '<ul>\n  <li>\n    <ul>\n      <li>text</li>\n    </ul>\n  </li>\n</ul>'],
    ['a nested own-line plus', '- a\n  - b\n  +\n  %%%\n  x\n  %%%\n    text\n',
      '<ul>\n  <li>a\n    <ul>\n      <li>b\n        text\n      </li>\n    </ul>\n  </li>\n</ul>'],
    ['a quoted item', '> - +\n> %%%\n> x\n> %%%\n>   text\n', '<blockquote>\n  <ul>\n    <li>text</li>\n  </ul>\n</blockquote>'],
    ['two spans', '- +\n%%%\nx\n%%%\n%%%\ny\n%%%\n  text\n', '<ul>\n  <li>text</li>\n</ul>'],
  ])('%s', (_name, source, html) => {
    expect(carveToHtml(source).trim()).toBe(html)
  })

  it('reads a span like a comment line', () => {
    for (const host of ['- +', '- a\n+', ':: t\n: +', '- - +']) {
      const indent = host === '- - +' ? '  ' : ''
      const follower = ' '.repeat(host === '- - +' ? 4 : 2) + 'text'
      expect(carveToHtml(`${host}\n${indent}%%%\n${indent}x\n${indent}%%%\n${follower}\n`))
        .toBe(carveToHtml(`${host}\n${indent}%% x\n${follower}\n`))
    }
  })

  it('registers a definition the span hides the line before', () => {
    const html = carveToHtml('- +\n%%%\n[r]: /opaque\n%%%\n  [^n]: note\n\nSee [^n].\n')
    expect(html).toContain('<p>See <a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a>.</p>')
    expect(html).toContain('<p>note<a href="#fnref1"')
  })

  it('keeps the span in the item', () => {
    const item = (parse('- +\n%%%\nx\n%%%\n  text\n').children[0] as List).items[0]!
    expect(item.children.map((node) => node.type)).toEqual(['comment', 'paragraph'])
  })

  it('leaves a sibling marker after the span a sibling', () => {
    expect(carveToHtml('- +\n%%%\nx\n%%%\n- b\n').trim()).toBe('<ul>\n  <li></li>\n  <li>b</li>\n</ul>')
  })
})
