import { describe, expect, it } from 'vitest'
import { compareHtmlExact } from '../src/compare.ts'
import { html01, html02 } from '../src/engines.ts'
import { canWriteUpgrade, upgrade } from '../src/index.ts'

describe('attribute-like text around old inline forms', () => {
  it('composes the old smart quote and link spellings across paragraphs', () => {
    const source = 'x{.k title="`"} y\nx{.k title="`"} y\n\n x{title="[a"}](u)\n \n x{*a { b*} c\n'
    const result = upgrade(source)
    expect(result.output).toBe('x{.k title=“`"} y\nx{.k title="`”} y\n\n x\\{title=“[a”}](u)\n \n x{*a { b*} c\n')
    expect(result.records.some((record) => record.entry === 'U-190')).toBe(true)
    expect(result.records.some((record) => record.entry === 'U-275')).toBe(true)
    expect(canWriteUpgrade(result)).toBe(true)
    expect(compareHtmlExact(html01(source), html02(result.output, false)).equal).toBe(true)
  })

  it('does not rewrite an already preserving link', () => {
    const source = 'x\\{title=“[a”}](u)\n'
    const result = upgrade(source)
    expect(result.output).toBe(source)
    expect(result.records.some((record) => record.entry === 'U-275')).toBe(false)
  })

  it('keeps complete HTML agreement across 1,000 mutations and containers', () => {
    let accepted = 0
    for (let n = 0; n < 1000; n++) {
      const word = `a${n % 23}`
      const url = `u${Math.floor(n / 23)}`
      const prefix = n % 5 === 0 ? '> ' : n % 7 === 0 ? '- ' : ''
      const tail = n % 2 === 0 ? '\nnext\n' : ''
      const source = `${prefix}x{.k title="\`"} y\n${prefix}x{.k title="\`"} y\n\n`
        + `${prefix}x{title="[${word}"}](${url})\n \n${prefix}x{*a { b*} c\n${tail}`
      const result = upgrade(source)
      if (!canWriteUpgrade(result)) continue
      accepted++
      expect(compareHtmlExact(html01(source), html02(result.output, false)).equal).toBe(true)
    }
    expect(accepted).toBeGreaterThan(0)
  })
})
