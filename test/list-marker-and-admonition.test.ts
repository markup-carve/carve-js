import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

const h = (s: string) => carveToHtml(s)

/**
 * Grammar PART 9 §11: a change of unordered marker character (`-` / `*`
 * / `+`) between adjacent items at the same indent starts a new list.
 */
describe('list marker change starts a new list (§11)', () => {
  it('splits - then * into two lists', () => {
    expect(h('- a\n- b\n* c\n* d')).toBe(
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

  it('splits - and * into two single-item lists', () => {
    // `+` is no longer a bullet (it is the list-continuation marker), so the
    // two remaining bullet characters split on a marker change.
    const html = h('- a\n* b')
    expect(html.match(/<ul>/g)).toHaveLength(2)
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

  it('an indented differing marker with no blank line stays item text', () => {
    // With no blank line the indented `* b` does not interrupt item 1's
    // paragraph (it is lazy continuation text), so there is no nested list;
    // `- c` at column 0 is a sibling item. A blank line would be needed to
    // nest. One list, two items.
    const html = h('- a\n  * b\n- c')
    expect(html.match(/<ul>/g)).toHaveLength(1) // no nested list
    expect(html).toContain('<li>a\n* b</li>')
    expect(html).toContain('<li>c</li>')
  })

  it('does not interrupt a paragraph with two differing lone markers (§10+§11)', () => {
    // `- a` then `+ b` after prose with no blank line are two single
    // markers of different character — each its own one-item list — so
    // per §10 they do not interrupt; the lines stay paragraph text.
    expect(h('para\n- a\n+ b')).toBe('<p>para\n- a\n+ b</p>')
  })

  it('two same-marker lines after prose stay prose (need a blank line, §10)', () => {
    expect(h('para\n- a\n- b')).toBe('<p>para\n- a\n- b</p>')
  })

  it('does not loosen a list when a blank precedes a different marker', () => {
    // `- a\n\n* b` is two distinct lists (§11); the blank line sits
    // BETWEEN them, so the first list stays tight (no <p> wrapper).
    expect(h('- a\n\n* b')).toBe(
      '<ul>\n  <li>a</li>\n</ul>\n<ul>\n  <li>b</li>\n</ul>',
    )
  })

  it('still loosens a list when a blank precedes the same marker', () => {
    expect(h('- a\n\n- b')).toBe(
      '<ul>\n  <li><p>a</p></li>\n  <li><p>b</p></li>\n</ul>',
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

  it('renders a custom (Tier-2) type as a generic div with the title', () => {
    // §12 Tier 2: a non-canonical type renders as <div class="{type}">,
    // the fenced-div primitive extensions build on. The title element
    // and the quote-stripping rule still apply.
    expect(h('::: hint "Tip"\nBody.\n:::')).toBe(
      [
        '<div class="hint">',
        '  <p class="admonition-title">Tip</p>',
        '  <p>Body.</p>',
        '</div>',
      ].join('\n'),
    )
  })

  it('renders a custom type with no title as a bare div', () => {
    expect(h('::: glossary\nBody.\n:::')).toBe(
      '<div class="glossary">\n  <p>Body.</p>\n</div>',
    )
  })

  it('renders details as a Tier-2 div (not specially)', () => {
    expect(h('::: details "More"\nHidden.\n:::')).toBe(
      [
        '<div class="details">',
        '  <p class="admonition-title">More</p>',
        '  <p>Hidden.</p>',
        '</div>',
      ].join('\n'),
    )
  })
})
