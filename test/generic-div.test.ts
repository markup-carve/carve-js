import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

const h = (s: string) => carveToHtml(s)

/**
 * Generic divs: a bare `:::` opens a plain `<div>` (grammar `div`
 * production; PART 9 §12). The `:::` fence carries NO inline attributes
 * (strict djot): an `::: {…}` opener is a paragraph, and attributes
 * attach via a PRECEDING `{…}` block-attribute line. A `:::` opener always
 * opens a div, and an unclosed container auto-closes at EOF.
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

  it('opens and auto-closes an unclosed ::: after prose', () => {
    // An opener always starts a container; with no closer, the div closes
    // cleanly at EOF after consuming the remaining block body.
    expect(h("before\n\n:::\nafter\n:::\n")).toBe('<p>before</p>\n<div>\n  <p>after</p>\n</div>')
  })

  it('opens an empty trailing ::: block and auto-closes it', () => {
    expect(h("text\n\n:::\n\n:::\n")).toBe('<p>text</p>\n<div>\n</div>')
  })

  it('opens and auto-closes a nested stray ::: without hanging', () => {
    expect(h("> before\n>\n> :::\n> after\n> :::\n")).toBe(
      '<blockquote>\n  <p>before</p>\n  <div>\n    <p>after</p>\n  </div>\n</blockquote>',
    )
  })

  it('interrupts a paragraph for a closed div without a blank line', () => {
    expect(h("before\n\n:::\nx\n:::\n")).toBe(
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

  it('opens without a closer and auto-closes at EOF', () => {
    expect(h('::: \\\none\ntwo')).toBe(
      '<div class="hardbreaks">\n  <p>one<br>\ntwo</p>\n</div>',
    )
  })
})
