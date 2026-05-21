import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

const h = (s: string) => carveToHtml(s)

/**
 * Grammar PART 9 §11: a change of unordered marker character (`-` / `*`
 * / `+`) between adjacent items at the same indent starts a new list.
 */
describe('list marker change starts a new list (§11)', () => {
  it('splits - then + into two lists', () => {
    expect(h('- a\n- b\n+ c\n+ d')).toBe(
      [
        '<ul>',
        '  <li>a</li>',
        '  <li>b</li>',
        '</ul>',
        '<ul>',
        '  <li>c</li>',
        '  <li>d</li>',
        '</ul>',
      ].join('\n'),
    )
  })

  it('splits -, *, + into three single-item lists', () => {
    const html = h('- a\n* b\n+ c')
    expect(html.match(/<ul>/g)).toHaveLength(3)
  })

  it('keeps a same-marker run as one list', () => {
    expect(h('- a\n- b\n- c')).toBe(
      '<ul>\n  <li>a</li>\n  <li>b</li>\n  <li>c</li>\n</ul>',
    )
  })

  it('splits plain then task (different kind)', () => {
    const html = h('- a\n- [x] b')
    expect(html.match(/<ul>/g)).toHaveLength(2)
  })

  it('does not split on a nested differing marker (deeper indent)', () => {
    // The nested `* b` is a child of `- a`, not a sibling, so it does not
    // terminate the outer list.
    const html = h('- a\n  * b\n- c')
    expect(html.match(/<ul>/g)).toHaveLength(2) // outer + one nested
    expect(html).toContain('<li>a')
    expect(html).toContain('<li>c</li>')
  })

  it('does not interrupt a paragraph with two differing lone markers (§10+§11)', () => {
    // `- a` then `+ b` after prose with no blank line are two single
    // markers of different character — each its own one-item list — so
    // per §10 they do not interrupt; the lines stay paragraph text.
    expect(h('para\n- a\n+ b')).toBe('<p>para\n- a\n+ b</p>')
  })

  it('still interrupts a paragraph with two same-marker lines', () => {
    expect(h('para\n- a\n- b')).toBe(
      '<p>para</p>\n<ul>\n  <li>a</li>\n  <li>b</li>\n</ul>',
    )
  })
})

/**
 * Grammar PART 9 §12: a `<p class="admonition-title">` is emitted only
 * when the opener carries a double-quoted title; the quotes are
 * delimiters and are stripped. Unquoted trailing text is not a title.
 */
describe('admonition title (§12)', () => {
  it('renders a quoted title with the delimiters stripped', () => {
    expect(h('::: note "Heads up"\nBody.\n:::')).toBe(
      [
        '<aside class="admonition note">',
        '  <p class="admonition-title">Heads up</p>',
        '  <p>Body.</p>',
        '</aside>',
      ].join('\n'),
    )
  })

  it('does not treat unquoted trailing text as a title', () => {
    expect(h('::: note hello\nBody.\n:::')).toBe(
      '<aside class="admonition note">\n  <p>Body.</p>\n</aside>',
    )
  })

  it('renders no title element when the opener has only a type', () => {
    expect(h('::: note\nBody.\n:::')).toBe(
      '<aside class="admonition note">\n  <p>Body.</p>\n</aside>',
    )
  })

  it('preserves a quoted title when an attribute block follows', () => {
    // `::: note "Heads up" {#x}` — the title survives; the trailing
    // attribute block is tolerated (carve-js does not yet attach
    // admonition attributes, but the title must not be dropped).
    expect(h('::: note "Heads up" {#x}\nBody.\n:::')).toContain(
      '<p class="admonition-title">Heads up</p>',
    )
  })

  it('emits an empty title element for an explicitly empty quoted title', () => {
    expect(h('::: note ""\nBody.\n:::')).toBe(
      [
        '<aside class="admonition note">',
        '  <p class="admonition-title"></p>',
        '  <p>Body.</p>',
        '</aside>',
      ].join('\n'),
    )
  })

  it('renders a custom type to the same shape', () => {
    expect(h('::: hint "Tip"\nBody.\n:::')).toBe(
      [
        '<aside class="admonition hint">',
        '  <p class="admonition-title">Tip</p>',
        '  <p>Body.</p>',
        '</aside>',
      ].join('\n'),
    )
  })
})
