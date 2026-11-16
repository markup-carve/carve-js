// The rulings of the 0.2 specification that the engine follows: one describe per ruling, each test named by its clause.
import { describe, expect, it } from 'vitest'
import { parseWithDiagnostics } from '../src/index.ts'

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
