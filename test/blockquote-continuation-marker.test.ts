import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

const html = (s: string) => carveToHtml(s)

/**
 * Continuation marker in a block quote (Carve, grammar PART 9 §17, matches
 * carve-php). A lone `+` at column 0 immediately after a quoted line attaches
 * the following flush-left block to the quote body, with no `>` prefix and no
 * blank line -- the un-prefixed analogue of the list-item continuation marker.
 * It only attaches; a blank line still ends the quote, and a `+` outside any
 * container stays literal text.
 */
describe('blockquote continuation marker (+)', () => {
  it('attaches a list to the quote', () => {
    expect(html('> quoted\n+\n- item')).toBe(
      '<blockquote>\n  <p>quoted</p>\n  <ul>\n    <li>item</li>\n  </ul>\n</blockquote>',
    )
  })

  it('attaches fenced code to the quote', () => {
    expect(html('> quoted\n+\n```\ncode\n```')).toBe(
      '<blockquote>\n  <p>quoted</p>\n  <pre><code>code\n</code></pre>\n</blockquote>',
    )
  })

  it('attaches a table to the quote', () => {
    expect(html('> quoted\n+\n| a | b |')).toBe(
      '<blockquote>\n  <p>quoted</p>\n  <table>\n    <tbody>\n      <tr><td>a</td><td>b</td></tr>\n    </tbody>\n  </table>\n</blockquote>',
    )
  })

  it('attaches two blocks via two markers', () => {
    expect(html('> q\n+\n- a\n+\n```\nc\n```')).toBe(
      '<blockquote>\n  <p>q</p>\n  <ul>\n    <li>a</li>\n  </ul>\n  <pre><code>c\n</code></pre>\n</blockquote>',
    )
  })

  it('resumes the quote with `>` after an attached block', () => {
    expect(html('> q\n+\n- item\n> more')).toBe(
      '<blockquote>\n  <p>q</p>\n  <ul>\n    <li>item</li>\n  </ul>\n  <p>more</p>\n</blockquote>',
    )
  })

  it('treats a `+` after a blank line as literal (the quote already ended)', () => {
    expect(html('> q\n\n+\n- item')).toBe(
      '<blockquote><p>q</p></blockquote>\n<p>+\n- item</p>',
    )
  })

  it('does not treat an indented `+` as a continuation marker', () => {
    expect(html('> q\n  +\n- item')).toBe(
      '<blockquote><p>q\n+</p></blockquote>\n<ul>\n  <li>item</li>\n</ul>',
    )
  })
})
