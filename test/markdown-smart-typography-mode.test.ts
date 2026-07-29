import { describe, it, expect } from 'vitest'
import { carveToMarkdown } from '../src/index.js'

/**
 * Smart typography is a presentation choice: right for a person reading the
 * output, usually wrong for a machine reading it. Source mode reproduces what
 * the author typed so a search for the source spelling finds it.
 */
const CASES: Array<[string, string]> = [
  ['a...b', 'a…b'],
  ['a--b', 'a–b'],
  ['a---b', 'a—b'],
  ['a----b', 'a––b'],
  ['a -> b', 'a → b'],
  ['a <= b', 'a ≤ b'],
  ['(c) 2026', '© 2026'],
  ['say "hi"', 'say “hi”'],
  ["say 'hi'", 'say ‘hi’'],
]

describe('markdown smart typography mode', () => {
  it.each(CASES)('source mode emits what the author typed for %j', (source) => {
    expect(carveToMarkdown(source, { smartTypography: 'source' }).trim()).toBe(source)
  })

  it.each(CASES)('glyph mode remains the default for %j', (source, glyphs) => {
    expect(carveToMarkdown(source).trim()).toBe(glyphs)
    expect(carveToMarkdown(source, { smartTypography: 'glyph' }).trim()).toBe(glyphs)
  })

  it('leaves escaping alone', () => {
    // Escaping is a separate concern with its own rationale.
    expect(carveToMarkdown('a & b', { smartTypography: 'source' }).trim()).toBe('a &amp; b')
  })

  it('leaves code spans alone', () => {
    expect(carveToMarkdown('`a...b`', { smartTypography: 'source' }).trim()).toBe('`a...b`')
  })

  it('still renders markdown structure', () => {
    const md = carveToMarkdown('# Title\n\nA *strong* claim... with a [link](https://example.com).\n', {
      smartTypography: 'source',
    }).trim()

    expect(md).toContain('# Title')
    expect(md).toContain('**strong**')
    expect(md).toContain('[link](https://example.com)')
    expect(md).toContain('claim... with')
  })

  it('does not affect other targets', async () => {
    const { carveToHtml, carveToPlainText } = await import('../src/index.js')
    expect(carveToHtml('a...b').trim()).toBe('<p>a…b</p>')
    expect(carveToPlainText('a...b').trim()).toBe('a…b')
  })
})
