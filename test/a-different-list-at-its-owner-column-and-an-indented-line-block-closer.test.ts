import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml } from '../src/index.js'

describe('an item at its owner column starts a list whatever its axes', () => {
  it.each([
    ['1. p\n- x\n  > q\n', '<ol>\n  <li>p</li>\n</ol>\n<ul>\n  <li>x\n    <blockquote><p>q</p></blockquote>\n  </li>\n</ul>'],
    ['- a\n1. b\n   > q\n', '<ul>\n  <li>a</li>\n</ul>\n<ol>\n  <li>b\n    <blockquote><p>q</p></blockquote>\n  </li>\n</ol>'],
    ['1. p\n- ::: note\n  :::\n', '<ol>\n  <li>p</li>\n</ol>\n<ul>\n  <li>\n    <aside class="admonition note" aria-label="Note">\n\n    </aside>\n  </li>\n</ul>'],
    // Right of the owner column, a different list still folds as text (carve#4545).
    ['  1. a\n - b\n   > q\n', '<ol>\n  <li>a\n- b</li>\n</ol>\n<blockquote><p>q</p></blockquote>'],
  ])('%j', (source, html) => {
    expect(carveToHtml(source)).toBe(html)
  })
})

describe('an indented colon run neither closes a line block nor leaves it', () => {
  it('keeps both lines as verse', () => {
    expect(carveToHtml('::: |\na\n :::\n :::\nb\n')).toBe(
      '<div class="line-block">\n  <p>a<br>\n&nbsp;:::<br>\n&nbsp;:::<br>\nb</p>\n</div>',
    )
  })
})

describe('the writer escapes only what the re-parse needs', () => {
  it('writes a caption line after a quote that holds nothing without a backslash', () => {
    expect(carveToCarve('> >\n^ cap\n')).toBe('> >\n\n^ cap\n')
  })

  it('keeps a quoted closer in a substitution attribute as written', () => {
    expect(carveToCarve('{~p~>[x](/u){k="~}"}b~}\n')).toBe('{~p~>[x](/u){k="~}"}b~}\n')
  })
})
