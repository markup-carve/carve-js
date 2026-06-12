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

  it('does not split on a nested differing marker (deeper indent)', () => {
    // The nested `* b` is a child of `- a`, not a sibling, so it does not
    // terminate the outer list.
    const html = h('- a\n  * b\n- c')
    expect(html.match(/<ul>/g)).toHaveLength(2) // outer + one nested
    expect(html).toContain('<li>a')
    expect(html).toContain('<li>c</li>')
  })

  it('interrupts a paragraph, then splits two differing markers (§10+§11)', () => {
    // `+` is not a Carve bullet (§3 divergence; it is the continuation marker),
    // so the two differing bullets here are `-` and `*`.
    expect(h('para\n- a\n* b')).toBe(
      '<p>para</p>\n<ul>\n  <li>a</li>\n</ul>\n<ul>\n  <li>b</li>\n</ul>',
    )
  })

  it('two same-marker lines after prose interrupt as one list (§10)', () => {
    expect(h('para\n- a\n- b')).toBe(
      '<p>para</p>\n<ul>\n  <li>a</li>\n  <li>b</li>\n</ul>',
    )
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

  it('a typed opener followed by an unquoted word is not a fence (strict)', () => {
    // Only a quoted title may follow the type; any other trailing text
    // makes the line an ordinary paragraph (strict djot).
    expect(h('::: note hello\nBody.\n:::')).toBe('<p>::: note hello\nBody.\n:::</p>')
  })

  it('renders no title element when the opener has only a type', () => {
    expect(h('::: note\nBody.\n:::')).toBe(
      '<aside class="admonition note">\n  <p>Body.</p>\n</aside>',
    )
  })

  it('a trailing attribute block on the opener is not a fence (strict)', () => {
    // No inline attributes on a ::: fence: the line is a paragraph. Covers
    // spaced, abutting, and post-title forms.
    for (const src of [
      '::: note {.x}',
      '::: note{.x}',
      '::: note "Heads up" {#x}',
      '::: hint {.x}',
    ]) {
      const html = h(`${src}\nBody.\n:::`)
      expect(html.startsWith('<p>')).toBe(true)
      expect(html).not.toContain('<aside')
      expect(html).not.toContain('<div')
    }
  })

  it('a quoted title still renders, with braces preserved (no attributes)', () => {
    expect(h('::: note "Use {x}"\nBody.\n:::')).toBe(
      [
        '<aside class="admonition note">',
        '  <p class="admonition-title">Use {x}</p>',
        '  <p>Body.</p>',
        '</aside>',
      ].join('\n'),
    )
  })

  it('attributes attach via a preceding block-attribute line (strict)', () => {
    // The only way to attribute an admonition: a {...} line before the
    // opener (§15). Works for Tier-1 and Tier-2 types.
    expect(h('{#x .lead}\n::: note\nBody.\n:::')).toBe(
      '<aside class="admonition note lead" id="x">\n  <p>Body.</p>\n</aside>',
    )
    expect(h('{.lead}\n::: hint\nBody.\n:::')).toBe(
      '<div class="hint lead">\n  <p>Body.</p>\n</div>',
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

/**
 * A marker is a list item only with non-empty content. A content-less marker
 * (bare or trailing whitespace only) is paragraph text, not a list. The rule
 * ignores trailing whitespace, so it cannot be flipped by an editor stripping
 * the space. Stricter than CommonMark.
 */
describe('content-less marker is not a list', () => {
  it('treats a bare `-` as paragraph text', () => {
    expect(h('-\nnot a list')).toBe('<p>-\nnot a list</p>')
  })

  it('treats `- ` (trailing space only) the same as bare `-`', () => {
    expect(h('- \nnot a list')).toBe(h('-\nnot a list').replace('-\n', '- \n'))
    expect(h('- \nx')).not.toContain('<ul>')
  })

  it('treats a content-less ordered marker `1. ` as paragraph text', () => {
    expect(h('1. \nx')).not.toContain('<ol>')
  })

  it('still parses a marker with real content as a list', () => {
    expect(h('- a\n- b')).toBe('<ul>\n  <li>a</li>\n  <li>b</li>\n</ul>')
  })
})

/**
 * A list marker requires a SPACE after the marker character, not a tab
 * (the space is a syntax delimiter, not indentation). A tab there means the
 * line is paragraph text, matching carve-php and carve-rs.
 */
describe('marker separator must be a space, not a tab', () => {
  const t = (s: string) => carveToHtml(s).trim()

  it('a tab after a bullet is not a list item', () => {
    expect(t('-\ta')).toBe('<p>-\ta</p>')
  })

  it('a tab after an ordered marker is not a list item', () => {
    expect(t('1.\ta')).toBe('<p>1.\ta</p>')
  })

  it('a tab after a task checkbox marker is not a task item', () => {
    expect(t('-\t[x] done')).toBe('<p>-\t[x] done</p>')
  })

  it('a normal space-separated bullet is still a list', () => {
    expect(t('- a')).toBe('<ul>\n  <li>a</li>\n</ul>')
  })
})
