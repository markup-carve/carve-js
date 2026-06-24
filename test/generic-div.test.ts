import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

const h = (s: string) => carveToHtml(s)

/**
 * Generic divs: a bare `:::` opens a plain `<div>` (grammar `div`
 * production; PART 9 §12). The `:::` fence carries NO inline attributes
 * (strict djot): an `::: {…}` opener is a paragraph, and attributes
 * attach via a PRECEDING `{…}` block-attribute line. A `:::` only opens a
 * div when a matching closing `:::` exists ahead; a lone, unclosed `:::`
 * is literal text (djot + carve-php + the grammar).
 */
describe('generic divs', () => {
  it('wraps a bare ::: block in a plain <div>', () => {
    expect(h(':::\nx\n:::')).toBe('<div>\n  <p>x</p>\n</div>')
  })

  it('attributes a div via a preceding block-attribute line', () => {
    expect(h('{.x #y}\n:::\nz\n:::')).toBe(
      '<div class="x" id="y">\n  <p>z</p>\n</div>',
    )
  })

  it('an inline-attribute opener is not a div (strict djot)', () => {
    // `::: {…}` / `:::{…}` on the fence line is a paragraph, not a div (its
    // inline content is then parsed as prose).
    for (const src of ['::: {.x #y}', ':::{.x junk}']) {
      const html = h(`${src}\nz\n:::`)
      expect(html.startsWith('<p>')).toBe(true)
      expect(html).not.toContain('<div')
    }
  })

  it('does NOT open a div for a stray, unclosed ::: after prose', () => {
    // Regression: a lone `:::` must not swallow the rest of the document.
    // Matches djot + carve-php: it stays paragraph text.
    expect(h('before\n:::\nafter')).toBe('<p>before\n:::\nafter</p>')
  })

  it('keeps a trailing unclosed ::: literal', () => {
    expect(h('text\n:::')).toBe('<p>text\n:::</p>')
  })

  it('does not hang or open a div on a nested stray ::: ', () => {
    expect(h('> before\n> :::\n> after')).toBe(
      '<blockquote><p>before\n:::\nafter</p></blockquote>',
    )
  })

  it('interrupts a paragraph for a closed div without a blank line', () => {
    expect(h('before\n:::\nx\n:::')).toBe(
      '<p>before</p>\n<div>\n  <p>x</p>\n</div>',
    )
  })

  it('still renders canonical admonitions as <aside>', () => {
    expect(h('::: note\nz\n:::')).toBe(
      '<aside class="admonition note">\n  <p>z</p>\n</aside>',
    )
  })

  it('treats ::: line-block as an ordinary div (the keyword is no longer special)', () => {
    // The line-block opener is now `::: |` ONLY; the `line-block` type word
    // is an ordinary Tier-2 typed div. It carries the `line-block` class (as
    // any type word does) but gets NONE of the line-block handling: no `<br>`
    // hard breaks and no leading-whitespace nbsp indent (the soft break
    // collapses to a space). Mirrors carve-php#124 / carve#119.
    expect(h('::: line-block\nflush\n  indented\n:::')).toBe(
      '<div class="line-block">\n  <p>flush\nindented</p>\n</div>',
    )
  })

  it('accepts a type word that starts with an underscore', () => {
    // The type word is a grammar identifier (letter | underscore first),
    // matching carve-php / carve-rs.
    expect(h('::: _box\nz\n:::')).toBe(
      '<div class="_box">\n  <p>z</p>\n</div>',
    )
  })
})

describe('hard-break block (::: \\)', () => {
  // carve spec #207 / 88-line-blocks. The body is parsed as ordinary blocks
  // and soft breaks become hard breaks ONLY in the div's direct paragraph
  // children; nested blocks keep ordinary soft breaks. Emits
  // `<div class="hardbreaks">`. Matches carve-rs / carve-php.
  it('promotes soft breaks to hard breaks in direct paragraphs', () => {
    expect(h('::: \\\none\ntwo\n:::')).toBe(
      '<div class="hardbreaks">\n  <p>one<br>\ntwo</p>\n</div>',
    )
  })

  it('keeps ordinary soft breaks inside nested blocks, no leading-ws nbsp', () => {
    expect(h(':::: \\\n  indented\nnext\n\n::: note\na\nb\n:::\n::::')).toBe(
      '<div class="hardbreaks">\n' +
        '  <p>indented<br>\nnext</p>\n' +
        '  <aside class="admonition note">\n    <p>a\nb</p>\n  </aside>\n' +
        '</div>',
    )
  })

  it('renders inline markup within the hard-broken lines', () => {
    expect(h('::: \\\n*Bold* and /italic/,\nplain\n:::')).toBe(
      '<div class="hardbreaks">\n' +
        '  <p><strong>Bold</strong> and <em>italic</em>,<br>\nplain</p>\n' +
        '</div>',
    )
  })

  it('does not open without a closer (opener stays literal text)', () => {
    expect(h('::: \\\none\ntwo')).toBe('<p>::: <br>\none\ntwo</p>')
  })
})
