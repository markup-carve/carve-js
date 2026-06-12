import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

const h = (s: string) => carveToHtml(s)

/**
 * Fence-length nesting (djot rule): a longer colon fence contains shorter
 * ones, and only a bare closer of equal-or-greater length closes a block.
 */
describe('::: fence-length nesting', () => {
  it('nests an admonition inside a longer-fenced admonition', () => {
    expect(h(':::: note\nOuter.\n\n::: warning\nNested.\n:::\n::::')).toBe(
      [
        '<aside class="admonition note">',
        '  <p>Outer.</p>',
        '  <aside class="admonition warning">',
        '    <p>Nested.</p>',
        '  </aside>',
        '</aside>',
      ].join('\n'),
    )
  })

  it('nests a div inside a longer-fenced div', () => {
    // Attributes via preceding block-attribute lines (strict djot: no
    // inline attrs on the ::: fence).
    expect(h('{.outer}\n::::\n{.inner}\n:::\nx\n:::\n::::')).toBe(
      [
        '<div class="outer">',
        '  <div class="inner">',
        '    <p>x</p>',
        '  </div>',
        '</div>',
      ].join('\n'),
    )
  })

  it('treats a shorter bare closer as content, not a closer', () => {
    // The inner `:::` (len 3) does not close the `::::` (len 4) block.
    const out = h('{#box}\n::::\n::: tip\nuse a longer fence\n:::\n::::')
    expect(out).toContain('<div id="box">')
    expect(out).toContain('<aside class="admonition tip">')
  })

  it('a lone unclosed :::: stays literal', () => {
    expect(h('a\n\n::::\n\nb')).toBe('<p>a</p>\n<p>::::</p>\n<p>b</p>')
  })

  it('a plain 3-colon block is unchanged', () => {
    expect(h('::: note\nhi\n:::')).toBe(
      '<aside class="admonition note">\n  <p>hi</p>\n</aside>',
    )
  })
})
