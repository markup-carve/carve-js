import { describe, expect, it } from 'vitest'
import { upgrade } from '../src/index.ts'
import { html01, html02 } from '../src/engines.ts'
import { compareHtmlExact } from '../src/compare.ts'

const oldSource = '['.repeat(200) + 'x' + ']{.a}'.repeat(200) + '\n'
const preserving = '['.repeat(199) + '\\[x\\]{.a}' + ']{.a}'.repeat(199) + '\n'

describe('U-445 attributed brackets at the 0.1 shared depth cap', () => {
  it('escapes both brackets left literal by 0.1 and passes the complete HTML check', () => {
    const result = upgrade(oldSource)
    expect(result.output).toBe(preserving)
    expect(result.check).toBe('pass')
    expect(result.records.some((record) => record.entry === 'U-445')).toBe(true)
    expect(compareHtmlExact(html01(oldSource), html02(result.output, false)).equal).toBe(true)
  })

  it('leaves a span below the old cap alone', () => {
    const source = '['.repeat(199) + 'x' + ']{.a}'.repeat(199) + '\n'
    const result = upgrade(source)
    expect(result.output).toBe(source)
    expect(result.check).toBe('pass')
  })

  it.each([201, 202])('escapes every bracket pair left literal at depth %i', (depth) => {
    const source = '['.repeat(depth) + 'x' + ']{.a}'.repeat(depth) + '\n'
    const literal = depth - 199
    const expected = '['.repeat(199) + '\\['.repeat(literal) + 'x'
      + '\\]{.a}'.repeat(literal) + ']{.a}'.repeat(199) + '\n'
    const result = upgrade(source)
    expect(result.output).toBe(expected)
    expect(result.check).toBe('pass')
    expect(compareHtmlExact(html01(source), html02(result.output, false)).equal).toBe(true)
  })

  it.each([
    ['quote', (source: string) => '> ' + source],
    ['list', (source: string) => '- ' + source],
    ['div', (source: string) => '::: note\n' + source + ':::'],
  ])('keeps the old HTML inside a %s', (_name, wrap) => {
    const source = wrap(oldSource)
    const result = upgrade(source)
    expect(result.output).toBe(wrap(preserving))
    expect(result.check).toBe('pass')
    expect(compareHtmlExact(html01(source), html02(result.output, false)).equal).toBe(true)
  })

  it('counts an inline footnote toward the shared depth cap', () => {
    const source = '^[' + '['.repeat(199) + 'x' + ']{.a}'.repeat(199) + ']\n'
    const expected = '^[' + '['.repeat(198) + '\\[x\\]{.a}' + ']{.a}'.repeat(198) + ']\n'
    const result = upgrade(source)
    expect(result.output).toBe(expected)
    expect(result.check).toBe('pass')
    expect(compareHtmlExact(html01(source), html02(result.output, false)).equal).toBe(true)
  })

  it('reports U-445 at the literal bracket pair if another difference prevents a full match', () => {
    const source = oldSource + '\n[x]{class=""}\n'
    const result = upgrade(source)
    expect(result.check).toBe('mismatch')
    const record = result.records.find((item) => item.entry === 'U-445')
    expect(record?.range).toEqual({ startOffset: 199, endOffset: 202 })
    const mismatch = result.records.find((item) => item.entry === 'upgrade-mismatch')
    expect(mismatch?.status).toBeUndefined()
    expect(mismatch?.message).toContain('U-445')
  })
})
