import { describe, expect, it } from 'vitest'
import { upgrade } from '../src/index.ts'
import { rescueDirectiveSocial } from '../src/directive-social-rescue.ts'

const MISMATCH = { entry: 'upgrade-mismatch', class: 'mismatch' as const, line: 1, message: '' }

describe('U-290: option names of a directive 0.2 reads as text', () => {
  it('escapes the at sign of an invalid directive before inline content', () => {
    const result = upgrade('{{ d @lines:0 }}*a*\n')
    expect(result.output).toBe('{{ d \\@lines:0 }}*a*\n')
    expect(result.check).toBe('pass')
    expect(result.records.map((record) => record.entry)).toContain('U-290')
  })

  it('escapes every option of a directive inside link text', () => {
    const result = upgrade('[a {{ x @lines:0 }} b][r]\n\n[r]: /r\n')
    expect(result.output).toBe('[a {{ x \\@lines:0 }} b][r]\n\n[r]: /r\n')
    expect(result.check).toBe('pass')
  })

  it('leaves a block directive alone, since 0.2 can still expand it', () => {
    expect(rescueDirectiveSocial('{{ a.crv @code:js }}\n', '{{ a.crv @code:js }}\n', MISMATCH)).toBeNull()
  })
})

describe('U-256: a tag inside any failed brace attribute', () => {
  it('escapes the brace opener before the tag in a list item', () => {
    const result = upgrade('-{{#k} a\n')
    expect(result.output).toBe('-{\\{#k} a\n')
    expect(result.check).toBe('pass')
    expect(result.records.map((record) => record.entry)).toContain('U-256')
  })

  it('escapes the brace opener inside emphasis', () => {
    const result = upgrade('a/{#i}*y*/ b\n')
    expect(result.output).toBe('a/\\{#i}*y*/ b\n')
    expect(result.check).toBe('pass')
  })
})

describe('U-068: braced spans where the bare respelling pairs a delimiter of the content', () => {
  it('writes explicit spans around content that ends in a star', () => {
    const result = upgrade('/*x**/\n')
    expect(result.output).toBe('{*{/x*/}*}\n')
    expect(result.check).toBe('pass')
    expect(result.records.map((record) => record.entry)).toContain('U-068')
  })

  it('keeps the bare respelling where it already holds', () => {
    expect(upgrade('/*bold italic*/\n').output).toBe('*/bold italic/*\n')
  })
})
