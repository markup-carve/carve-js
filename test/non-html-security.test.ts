import { describe, expect, it } from 'vitest'

import { carveToMarkdown, carveToAnsi, carveToPlainText } from '../src/index.js'

const md = (s: string): string => carveToMarkdown(s).trim()

describe('Markdown renderer is safe-by-default', () => {
  it('blanks dangerous link/image schemes', () => {
    expect(md('[x](javascript:alert(1))')).toContain('[x]()')
    expect(md('![a](javascript:alert(1))')).toContain('![a]()')
    expect(md('[ok](https://e.com)')).toContain('[ok](https://e.com)')
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
})
