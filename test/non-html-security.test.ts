import { describe, expect, it } from 'vitest'

import { carveToMarkdown, carveToAnsi, carveToPlainText } from '../src/index.js'

const md = (s: string): string => carveToMarkdown(s).trim()

describe('Markdown renderer is safe-by-default', () => {
  it('blanks dangerous link/image schemes', () => {
    expect(md('[x](javascript:alert(1))')).toContain('[x]()')
    expect(md('![a](javascript:alert(1))')).toContain('![a]()')
    expect(md('[ok](https://e.com)')).toContain('[ok](https://e.com)')
  })

  it('blanks dangerous autolink schemes while preserving the visible label', () => {
    expect(md('<javascript:alert(1)>')).toBe('[javascript:alert(1)]()')
  })

  it('percent-encodes markdown destination breakout characters', () => {
    // A `)` reaching a destination via a reference definition (URL runs to
    // end-of-line, not `)`-delimited) is percent-encoded so it cannot break
    // out of the `(...)` in Markdown output.
    expect(md('[x][r]\n\n[r]: https://e.com/a)b')).toBe('[x](https://e.com/a%29b)')
  })

  it('keeps safe autolink destinations unchanged', () => {
    expect(md('<https://example.com>')).toBe('[https://example.com](https://example.com)')
  })

  it('escapes raw =html instead of emitting it', () => {
    const out = md('```=html\n<script>alert(1)</script>\n```')
    expect(out).not.toContain('<script>')
    expect(out).toContain('&lt;script&gt;')
  })

  it('neutralizes embedded HTML in text and HTML-fallback tags', () => {
    expect(md('plain <img onerror=x> text')).not.toContain('<img')
    const sup = md('{^<img src=x onerror=alert(1)>^}')
    expect(sup).toContain('<sup>')
    expect(sup).not.toContain('<img')
  })

  it('entity-escapes < > & in text', () => {
    expect(md('a < b & c')).toBe('a &lt; b &amp; c')
  })

  it('escapes quotes and backslashes in link/image titles', () => {
    expect(md('[x](u "a \\"b\\" \\\\ c")')).toBe('[x](u "a \\"b\\" \\\\ c")')
    expect(md('![x](u "a \\"b\\" \\\\ c")')).toBe('![x](u "a \\"b\\" \\\\ c")')
  })
})

describe('ANSI/plain renderers strip terminal escapes', () => {
  it('removes ESC and other C0 controls (keeps tab/newline)', () => {
    const ansi = carveToAnsi('hi \x1b[31mX\x1b[0m\x07 there')
    expect(ansi).not.toContain('\x1b[31m')
    expect(ansi).not.toContain('\x07')
    expect(ansi).toContain('there')
    const plain = carveToPlainText('a\x1bb\x07c')
    expect(plain).not.toContain('\x1b')
    expect(plain).not.toContain('\x07')
  })

  it('strips terminal controls from link hrefs', () => {
    const src = '[x](http://a/\x1b]0;PWNED\x07/b)'
    const ansi = carveToAnsi(src)
    const plain = carveToPlainText(src)

    expect(ansi).not.toContain('\x1b]0;PWNED')
    expect(ansi).not.toContain('\x07')
    expect(plain).not.toContain('\x1b')
    expect(plain).not.toContain('\x07')
    expect(plain).toContain('http://a/]0;PWNED/b')
  })
})
