import { describe, expect, it } from 'vitest'
import { format, type LineBlockNode, type LineNode, type ListNode, parse, render } from '../public/index.ts'

describe('C2-B-123, C2-B-024: a comment block in a line block body opens no stanza', () => {
  const empty = '<div class="line-block">\n\n    </div>'

  it('closes the item at an unowned line after a leading comment block', () => {
    expect(render('- ::: |\n  %%%\n  c\n  %%%\nz\n')).toBe(`<ul>\n  <li>\n    ${empty}\n  </li>\n</ul>\n<p>z</p>`)
  })

  it('closes the quote at an unowned line after a leading comment block', () => {
    expect(render('> ::: |\n> %%%\n> c\n> %%%\nz\n')).toBe('<blockquote>\n  <div class="line-block">\n\n  </div>\n</blockquote>\n<p>z</p>')
  })

  it('opens no stanza after a blank line either', () => {
    expect(render('- ::: |\n  a\n\n  %%%\n  c\n  %%%\nz\n')).toBe(
      '<ul>\n  <li>\n    <div class="line-block">\n      <p>a</p>\n    </div>\n  </li>\n</ul>\n<p>z</p>',
    )
  })

  it('closes the item at an unowned line inside a leading unclosed comment block', () => {
    expect(render('- ::: |\n  %%%\n  c\nz\n')).toBe(`<ul>\n  <li>\n    ${empty}\n  </li>\n</ul>\n<p>z</p>`)
    expect(render('- ::: |\n  %%%\n  c\n- z\n')).toBe(`<ul>\n  <li>\n    ${empty}\n  </li>\n  <li>z</li>\n</ul>`)
  })

  it('keeps an unowned line in an unclosed comment block below an open stanza', () => {
    expect(render('- ::: |\n  a\n  %%%\n  c\nz\n  %%%\n  b\n')).toBe(
      '<ul>\n  <li>\n    <div class="line-block">\n      <p>a<br>\nb</p>\n    </div>\n  </li>\n</ul>',
    )
  })

  it('closes the comment block at a bare run below the item column (C2-B-109)', () => {
    expect(render('- - ::: |\n    a\n    %%%\n%%%%\nz\n')).toBe(
      '<ul>\n  <li>\n    <ul>\n      <li>\n        <div class="line-block">\n          <p>a<br>\nz</p>\n        </div>\n      </li>\n    </ul>\n  </li>\n</ul>',
    )
    expect(render('- ::: |\n  %%%\n  c\n%%%\nz\n')).toBe(`<ul>\n  <li>\n    ${empty}\n  </li>\n</ul>\n<p>z</p>`)
  })

  it('gives a lazy comment-only line after a comment block to the stanza line above it (C2-B-024)', () => {
    const tree = parse('- ::: |\n  a\n  %%%\n  c\n  %%%\n%% z\n')
    const block = (tree.children[0] as ListNode).children[0]!.children[0] as LineBlockNode
    expect(block.children.map((child) => child.type)).toEqual(['line', 'comment'])
    expect((block.children[0] as LineNode).children.map((child) => child.type)).toEqual(['text', 'comment'])
    expect(render('- ::: |\n  a\n  %%%\n  c\n  %%%\n%% z\n')).toBe(
      '<ul>\n  <li>\n    <div class="line-block">\n      <p>a</p>\n    </div>\n  </li>\n</ul>',
    )
  })

  it('keeps a stanza that is already open', () => {
    expect(render('- ::: |\n  a\n  %%%\n  c\n  %%%\nz\n')).toBe(
      '<ul>\n  <li>\n    <div class="line-block">\n      <p>a<br>\nz</p>\n    </div>\n  </li>\n</ul>',
    )
  })

  it('writes the unowned line outside the item', () => {
    expect(format('- ::: |\n  %%%\n  c\n  %%%\nz\n')).toBe('- ::: |\n  %%%\n  c\n  %%%\n  :::\n\nz\n')
  })
})
