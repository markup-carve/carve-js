import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

const html = (s: string) => carveToHtml(s)

/**
 * An ordered sub-list indented to the parent item's content column must nest,
 * matching carve-php / carve-rs. Ordered markers do not interrupt a paragraph
 * (§10), so the sub-list used to fold into the lead paragraph as literal text
 * (`<li>a\n1. b</li>`) instead of nesting.
 */
describe('ordered sub-list nesting', () => {
  it('nests an ordered sub-list at the content column', () => {
    expect(html('1. a\n   1. b')).toBe(
      '<ol>\n  <li>a\n    <ol>\n      <li>b</li>\n    </ol>\n  </li>\n</ol>',
    )
  })

  it('nests several ordered levels', () => {
    expect(html('1. a\n   1. b\n      1. c')).toBe(
      '<ol>\n  <li>a\n    <ol>\n      <li>b\n        <ol>\n          <li>c</li>\n        </ol>\n      </li>\n    </ol>\n  </li>\n</ol>',
    )
  })

  it('an ordered marker still does not interrupt a paragraph (§10)', () => {
    // A non-indented ordered marker after paragraph text stays inline (§10).
    expect(html('text here\n1. b')).toBe('<p>text here\n1. b</p>')
  })

  it('nests an unordered sub-list under an ordered item', () => {
    expect(html('1. a\n   - b')).toBe(
      '<ol>\n  <li>a\n    <ul>\n      <li>b</li>\n    </ul>\n  </li>\n</ol>',
    )
  })
})

describe('ordered list indentation (Model A: content column)', () => {
  const h = (s: string) => carveToHtml(s).trim()

  it('folds an ordered child BELOW the content column (no blank, §10)', () => {
    // `  1. b` is at column 2, below `1. `'s content column (3); ordered does
    // not interrupt a paragraph, so it is lazy continuation, not a sub-list.
    expect(h('1. a\n  1. b')).toBe('<ol>\n  <li>a\n1. b</li>\n</ol>')
  })

  it('nests an ordered child AT the content column', () => {
    expect(h('1. a\n   1. b')).toBe(
      '<ol>\n  <li>a\n    <ol>\n      <li>b</li>\n    </ol>\n  </li>\n</ol>',
    )
  })

  it('an ordered dialect change at the base column still starts a new list (§11)', () => {
    expect(h('1. a\nb. c')).toBe(
      '<ol>\n  <li>a</li>\n</ol>\n<ol type="a" start="2">\n  <li>c</li>\n</ol>',
    )
  })
})
