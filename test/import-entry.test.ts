import { describe, expect, it } from 'vitest'
import { CarveOptionError, importDocument as importHtmlOnly } from '../public/index.ts'
import { BBCODE_MAX_INPUT_LENGTH, BbcodeInputTooLargeError, importDocument, ImportInputError } from '../public/formats.ts'

describe('@markup-carve/carve/import', () => {
  it.each([
    ['markdown', '# Hi *there*\n', '= Hi /there/\n'],
    ['gfm', '~~gone~~\n', '{-gone-}\n'],
    ['djot', '_hi_ *there*\n', '/hi/ *there*\n'],
    ['bbcode', '[b]bold[/b]', '*bold*\n'],
    ['html', '<p><em>hi</em></p>', '/hi/\n'],
  ] as const)('imports %s and writes the source with the engine writer', (from, input, expected) => {
    const result = importDocument(input, { from })
    expect(result.source).toBe(expected)
    expect(result.document.type).toBe('document')
  })

  it('refuses an unknown format or option, and the core entry stays HTML only (C2-T-005)', () => {
    expect(() => importDocument('a', { from: 'rst' } as never)).toThrow(CarveOptionError)
    expect(() => importDocument('a', { from: 'markdown', adapter: 'word' } as never)).toThrow(CarveOptionError)
    expect(() => importHtmlOnly('a', { from: 'markdown' } as never)).toThrow(CarveOptionError)
  })

  it('refuses BBCode past its limit with a typed input error', () => {
    expect(() => importDocument('x'.repeat(BBCODE_MAX_INPUT_LENGTH + 1), { from: 'bbcode' })).toThrow(BbcodeInputTooLargeError)
    expect(() => importDocument('x'.repeat(BBCODE_MAX_INPUT_LENGTH + 1), { from: 'bbcode' })).toThrow(ImportInputError)
  })
})
