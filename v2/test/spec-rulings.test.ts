// The rulings of the 0.2 specification that the engine follows: one describe per ruling, each test named by its clause.
import { describe, expect, it } from 'vitest'
import { parseWithDiagnostics, render } from '../src/index.ts'
import { isJoining, isLetter, isUrlCharacter, isWordCharacter } from '../src/unicode.ts'
import { UNICODE_VERSION } from '../src/unicode-tables.ts'

function findings(src: string): string[] {
  return parseWithDiagnostics(src).diagnostics.map((entry) => entry.code)
}

describe('where a name ends', () => {
  it('C2-B-225: a div name, a language word and a raw format end at the first character outside their sets', () => {
    const result = parseWithDiagnostics('::: glossary>\nq\n:::\n\n```js}\ncode\n```\n\n```=html~\n<b>x</b>\n```\n\n::: note{.x}\nn\n:::\n')
    expect(result.document.children.map((node) => node.type)).toEqual(['directive', 'code_block', 'raw_block', 'admonition'])
    expect(result.document.children).toMatchObject([{ kind: 'glossary' }, { syntax: 'js' }, { format: 'html' }, { kind: 'note' }])
    expect(result.diagnostics.map((entry) => entry.code))
      .toEqual(['fence-title-syntax', 'fence-title-syntax', 'fence-title-syntax', 'fence-opener-fallback'])
  })

  it('C2-B-225, C2-B-105: a brace block glued to a raw format or a div name is an attribute block', () => {
    expect(findings('```=html{.c}\na\n```\n')).toEqual(['fence-opener-fallback'])
    expect(findings('::: glossary{.c}\nq\n:::\n')).toEqual(['fence-opener-fallback'])
    expect(findings('::: x{.c}\nq\n:::\n')).toEqual(['fence-opener-fallback'])
  })

  it('C2-B-122: the report of what is glued to a raw format names that text', () => {
    const message = parseWithDiagnostics('```=html~\na\n```\n').diagnostics[0]?.message ?? ''
    expect(message).toContain('"~"')
    expect(message).not.toContain('typographic')
  })

  it('C2-B-225: a raw format starts with a letter, so a digit or an underscore after the equals sign names no format', () => {
    for (const src of ['```=1x\na\n```\n', '```=_x\na\n```\n']) {
      expect(parseWithDiagnostics(src).document.children[0]?.type, src).toBe('code_block')
    }
    expect(parseWithDiagnostics('```=x_1-\na\n```\n').document.children[0]).toMatchObject({ type: 'raw_block', format: 'x_1-' })
  })
})

describe('the Unicode version', () => {
  it('C2-I-127, C2-I-047: a letter new in Unicode 18.0.0 is a letter before a star', () => {
    expect(render('𽀀*𰨌*')).toBe('<p>𽀀*𰨌*</p>')
  })

  it('C2-I-127: every category test reads the ranges of data/unicode-categories.json', () => {
    expect(UNICODE_VERSION).toBe('18.0.0')
    expect(isLetter(0x3d000)).toBe(true)
    expect(isWordCharacter(0x1246f)).toBe(true)
    expect(isJoining(0x5c8)).toBe(true)
    expect(isLetter(0x1246f)).toBe(false)
  })

  it('C2-H-148, C2-I-127: a heading that starts with a number new in Unicode 18.0.0 takes the prefix', () => {
    expect(render('# \u{1246f} x')).toContain('id="s-\u{1246f}-x"')
  })

  it('C2-I-122: a URL character outside ASCII has no White_Space, is no control and no format character', () => {
    for (const code of [0x85, 0xa0, 0x2028, 0x3000, 0x9f, 0x200b, 0xfeff]) expect(isUrlCharacter(code), code.toString(16)).toBe(false)
    for (const code of [0xe9, 0x4e00, 0x3d000]) expect(isUrlCharacter(code), code.toString(16)).toBe(true)
  })
})
