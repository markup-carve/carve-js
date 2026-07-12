import { describe, expect, it } from 'vitest'

import { carveToHtml, details, type CarveExtension } from '../src/index.js'

const h = (s: string) => carveToHtml(s, { extensions: [details()] }).trim()

describe('details disclosure extension', () => {
  it('renders ::: details as <details>/<summary> with a quoted title', () => {
    expect(h('::: details "More info"\nHidden.\n:::')).toBe(
      [
        '<details>',
        '  <summary>More info</summary>',
        '  <p>Hidden.</p>',
        '</details>',
      ].join('\n'),
    )
  })

  it('falls back to a default summary when no title is given', () => {
    expect(h('::: details\nHidden.\n:::')).toBe(
      ['<details>', '  <summary>Details</summary>', '  <p>Hidden.</p>', '</details>'].join('\n'),
    )
  })

  it('escapes HTML-special characters in the summary', () => {
    expect(h('::: details "Tom & Jerry"\nx\n:::')).toContain(
      '<summary>Tom &amp; Jerry</summary>',
    )
  })

  it('renders inline markup in the title (summary is phrasing content)', () => {
    expect(h('::: details "see /here/"\nx\n:::')).toContain('<summary>see <em>here</em></summary>')
    expect(h('::: details "a *b* `c`"\nx\n:::')).toContain(
      '<summary>a <strong>b</strong> <code>c</code></summary>',
    )
  })

  it('keeps multiple block children inside the disclosure', () => {
    expect(h('::: details "T"\nOne.\n\nTwo.\n:::')).toBe(
      [
        '<details>',
        '  <summary>T</summary>',
        '  <p>One.</p>',
        '  <p>Two.</p>',
        '</details>',
      ].join('\n'),
    )
  })

  it('renders a heading child without leaking the section-wrapping pass', () => {
    expect(h('::: details "T"\n# H\n\nx\n:::')).toBe(
      [
        '<details>',
        '  <summary>T</summary>',
        // A heading inside the container still carries its slug id on the
        // <h*> (carve-php parity); only the top-level <section> pass is skipped.
        '  <h1 id="H">H</h1>',
        '  <p>x</p>',
        '</details>',
      ].join('\n'),
    )
  })

  it('preserves <p> wrappers for a details body inside a list item', () => {
    expect(h('- item\n\n  ::: details "T"\n  x\n  :::')).toBe(
      [
        '<ul>',
        '  <li>item',
        '    <details>',
        '      <summary>T</summary>',
        '      <p>x</p>',
        '    </details>',
        '  </li>',
        '</ul>',
      ].join('\n'),
    )
  })

  it('handles nested details blocks', () => {
    expect(h(':::: details "Outer"\n::: details "Inner"\ndeep\n:::\n::::')).toBe(
      [
        '<details>',
        '  <summary>Outer</summary>',
        '  <details>',
        '    <summary>Inner</summary>',
        '    <p>deep</p>',
        '  </details>',
        '</details>',
      ].join('\n'),
    )
  })

  it('carries block attributes onto the <details> tag', () => {
    expect(h('{#faq .open}\n::: details "Q"\na\n:::')).toBe(
      [
        '<details id="faq" class="open">',
        '  <summary>Q</summary>',
        '  <p>a</p>',
        '</details>',
      ].join('\n'),
    )
  })

  it('keeps attrs another extension adds with a stale order list', () => {
    // `addClass` appends a class but does not touch `attrs.order`; the
    // details renderer must still emit it (not silently drop it).
    const addClass: CarveExtension = {
      name: 'add',
      beforeRender(doc) {
        const walk = (n: unknown): void => {
          if (!n || typeof n !== 'object') return
          const node = n as Record<string, unknown>
          if (node.type === 'admonition' && node.kind === 'details') {
            const a = (node.attrs ??= {}) as { classes?: string[] }
            a.classes = [...(a.classes ?? []), 'added']
          }
          for (const v of Object.values(node)) {
            if (Array.isArray(v)) v.forEach(walk)
            else walk(v)
          }
        }
        walk(doc)
        return doc
      },
    }
    const out = carveToHtml('{#x}\n::: details "Q"\na\n:::', {
      extensions: [addClass, details()],
    })
    expect(out).toContain('<details id="x" class="added">')
  })

  it('leaves canonical admonitions untouched', () => {
    expect(h('::: note\nhi\n:::')).toContain('<aside class="admonition note">')
  })

  it('leaves other custom admonition types as plain divs', () => {
    expect(h('::: aside-note\nhi\n:::')).toContain('<div class="aside-note">')
  })

  it('without the extension, ::: details stays a plain div', () => {
    expect(carveToHtml('::: details "More"\nHidden.\n:::').trim()).toContain(
      '<div class="details">',
    )
  })
})

describe('details: explicit empty id', () => {
  it('preserves an explicit empty id from a preceding block-attribute line', () => {
    const h = (s: string) => carveToHtml(s, { extensions: [details()] }).trim()
    expect(h('{id}\n::: details "T"\nx\n:::')).toContain('<details id="">')
    expect(h('{#foo}\n::: details "T"\nx\n:::')).toContain('<details id="foo">')
  })
})
