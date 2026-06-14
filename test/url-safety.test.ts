import { describe, it, expect } from 'vitest'
import { carveToHtml, renderHtml, type Document } from '../src/index.js'

const h = (s: string, opts = {}) => carveToHtml(s, opts)

/**
 * URL-scheme sanitization (safe-by-default). Authored Carve must not be
 * able to smuggle script through a link `href` or image `src`. Dangerous
 * schemes (`javascript:`, `data:`, `vbscript:`, `file:`, …) collapse to an
 * empty value so the element is inert while the surrounding text stays.
 *
 * Mirrors the spec's SafeMode link policy
 * (allow `['http','https','mailto']`, deny `['javascript','data','file']`).
 */
describe('URL scheme sanitization (default on)', () => {
  it('blocks javascript: in a link href', () => {
    expect(h('[click](javascript:alert(1))')).toBe('<p><a href="">click</a>)</p>')
  })

  it('blocks javascript: case-insensitively', () => {
    expect(h('[x](JavaScript:alert(1))')).toBe('<p><a href="">x</a>)</p>')
  })

  it('does not even form a link when the URL has leading whitespace', () => {
    // The parser rejects a link target with leading spaces, so the
    // dangerous scheme never becomes a clickable href - it stays literal.
    expect(h('[x](   javascript:alert(1))')).toBe(
      '<p>[x](   javascript:alert(1))</p>',
    )
  })

  it('does not form a link when a control char splits the scheme', () => {
    // `java\tscript:` is not a valid link target either; rendered literal.
    expect(h('[x](java\tscript:alert(1))')).toBe(
      '<p>[x](java\tscript:alert(1))</p>',
    )
  })

  it('blocks data: URLs', () => {
    expect(h('[d](data:text/html;base64,PHNjcmlwdD4=)')).toBe(
      '<p><a href="">d</a></p>',
    )
  })

  it('blocks vbscript: URLs', () => {
    expect(h('[x](vbscript:msgbox(1))')).toBe('<p><a href="">x</a>)</p>')
  })

  it('blocks javascript: in an image src', () => {
    expect(h("![x](javascript:alert('img'))")).toBe(
      '<p><img src="" alt="x">)</p>',
    )
  })

  it('blocks data: in an image src', () => {
    // A bare image line is a block image (no paragraph wrapper).
    expect(h('![x](data:image/png;base64,AAAA)')).toBe('<img src="" alt="x">')
  })

  it('does not let an attribute block inject a second href on a link', () => {
    // The sanitized structural href wins; an author `{href=...}` override
    // must be dropped, not appended as a second (unsanitized) attribute.
    expect(h('[x](https://safe){href="javascript:alert(1)"}')).toBe(
      '<p><a href="https://safe">x</a></p>',
    )
  })

  it('does not let an attribute block inject a second src on an image', () => {
    expect(h('![x](https://safe/i.png){src="javascript:alert(1)"}')).toBe(
      '<img src="https://safe/i.png" alt="x">',
    )
  })

  it('drops an uppercase HREF override (attribute names are case-insensitive)', () => {
    expect(h('[x](https://safe){HREF="javascript:alert(1)"}')).toBe(
      '<p><a href="https://safe">x</a></p>',
    )
  })
})

describe('URL scheme sanitization (safe schemes pass through)', () => {
  it('allows https links unchanged', () => {
    expect(h('[ok](https://example.com/a)')).toBe(
      '<p><a href="https://example.com/a">ok</a></p>',
    )
  })

  it('allows http links unchanged', () => {
    expect(h('[ok](http://example.com)')).toBe(
      '<p><a href="http://example.com">ok</a></p>',
    )
  })

  it('allows mailto links unchanged', () => {
    expect(h('[mail](mailto:a@b.com)')).toBe(
      '<p><a href="mailto:a@b.com">mail</a></p>',
    )
  })

  it('allows relative paths (no scheme)', () => {
    expect(h('[rel](/docs/page)')).toBe('<p><a href="/docs/page">rel</a></p>')
  })

  it('allows fragment-only links', () => {
    expect(h('[frag](#section)')).toBe('<p><a href="#section">frag</a></p>')
  })

  it('allows protocol-relative URLs', () => {
    expect(h('[pr](//cdn.example.com/x)')).toBe(
      '<p><a href="//cdn.example.com/x">pr</a></p>',
    )
  })

  it('allows https image src unchanged', () => {
    expect(h('![a](https://example.com/i.png)')).toBe(
      '<img src="https://example.com/i.png" alt="a">',
    )
  })
})

describe('URL scheme sanitization (renderer defense-in-depth)', () => {
  // Direct renderHtml callers may build their own AST, bypassing the
  // parser's link-target validation. The renderer must still neutralize a
  // scheme obfuscated with leading/embedded control characters, which
  // browsers strip before reading the scheme.
  const linkDoc = (href: string): Document => ({
    type: 'document',
    children: [
      {
        type: 'paragraph',
        children: [{ type: 'link', href, children: [{ type: 'text', value: 'x' }] }],
      },
    ],
  })

  it('blocks a tab-split javascript: scheme on a hand-built link', () => {
    expect(renderHtml(linkDoc('java\tscript:alert(1)'))).toBe('<p><a href="">x</a></p>')
  })

  it('blocks a leading-whitespace javascript: scheme on a hand-built link', () => {
    expect(renderHtml(linkDoc('  javascript:alert(1)'))).toBe('<p><a href="">x</a></p>')
  })

  it('passes a clean https href on a hand-built link', () => {
    expect(renderHtml(linkDoc('https://example.com'))).toBe(
      '<p><a href="https://example.com">x</a></p>',
    )
  })

  it('does not blank a relative URL that merely contains a space', () => {
    // `foo bar:baz` has no real scheme (a space cannot appear in one), so it
    // is a relative URL and must pass through, not collapse to empty.
    expect(renderHtml(linkDoc('foo bar:baz'))).toBe(
      '<p><a href="foo bar:baz">x</a></p>',
    )
  })
})

describe('URL scheme sanitization (configuration)', () => {
  it('passes dangerous URLs through verbatim when sanitizeUrls is false', () => {
    expect(h('[x](javascript:alert(1))', { sanitizeUrls: false })).toBe(
      '<p><a href="javascript:alert(1">x</a>)</p>',
    )
  })

  it('honors a custom allowedUrlSchemes list', () => {
    expect(h('[call](tel:+15551234)', { allowedUrlSchemes: ['tel'] })).toBe(
      '<p><a href="tel:+15551234">call</a></p>',
    )
  })

  it('still blocks schemes outside a custom allowlist', () => {
    expect(h('[x](https://example.com)', { allowedUrlSchemes: ['tel'] })).toBe(
      '<p><a href="">x</a></p>',
    )
  })

  it('blocks a NUL-obfuscated scheme (NUL -> U+FFFD at parse, still caught)', () => {
    expect(h('[x](java\0script:alert(1))')).toBe('<p><a href="">x</a>)</p>')
  })
})
