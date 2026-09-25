import { describe, expect, it } from 'vitest'
import { bbcodeToCarve, carveToHtml, carveToCarve } from '../src/index.js'

describe('an empty BBCode quote', () => {
  it('writes the canonical marker for empty and whitespace-only bodies', () => {
    const source = 'a\n\n[quote][/quote]\n\n[quote] [/quote]\n\nb'
    const written = bbcodeToCarve(source)

    expect(written).toBe('a\n\n>\n\n>\n\nb\n')
    expect(carveToCarve(written)).toBe(written)
    expect(carveToHtml(written)).toBe('<p>a</p>\n<blockquote>\n\n</blockquote>\n<blockquote>\n\n</blockquote>\n<p>b</p>')
  })

  it('keeps empty lines within a quote and an empty attributed quote', () => {
    expect(bbcodeToCarve('[quote]a\n  \nb[/quote]')).toBe('> a\n>\n> b\n')
    expect(bbcodeToCarve('[quote=Alice][/quote]')).toBe('>\n^ Alice\n')
    expect(bbcodeToCarve('[quote]a\r\n \r\nb[/quote]')).toBe('> a\n>\n> b\n')
  })
})
