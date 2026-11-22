import { describe, expect, it } from 'vitest'
import { compareHtml } from '../src/compare.ts'
import { html01, html02 } from '../src/engines.ts'
import { canWriteUpgrade, needsAttention, upgrade } from '../src/index.ts'

describe('quote lines consumed without output by the old parser', () => {
  it('omits the old invisible quote after a footnote body', () => {
    const source = '[^a]: +\n[^n]: a\n +\npara\n> q\n\n\nsee[^n]\n'
    const result = upgrade(source)
    expect(result.output).toBe('[^a]: +\n[^n]: a\n +\npara\n\n\n\nsee[^n]\n')
    expect(result.records.some((record) => record.entry === 'U-209')).toBe(true)
    expect(canWriteUpgrade(result)).toBe(true)
    expect(needsAttention(result)).toBe(false)
  })

  it('retains a quote the old parser rendered', () => {
    const source = '[^n]: a\n\n> visible\n\nsee[^n]\n'
    const result = upgrade(source)
    expect(result.output).toContain('> visible')
    expect(result.records.some((record) => record.entry === 'U-209' && record.message.includes('omitted'))).toBe(false)
  })

  it('never reports a preserving upgrade without complete HTML agreement across 1,000 variants', () => {
    let accepted = 0
    for (let n = 0; n < 1000; n++) {
      const id = `n${n % 17}`
      const quote = `q${Math.floor(n / 17)}`
      const before = n % 3 === 0 ? 'intro\n' : ''
      const depth = ' '.repeat(n % 4)
      const tail = n % 2 === 0 ? `see[^${id}]\n` : 'tail\n'
      const source = `${before}[^a]: +\n[^${id}]: a\n +\npara\n${depth}> ${quote}\n\n\n${tail}`
      const result = upgrade(source)
      if (!canWriteUpgrade(result)) continue
      accepted++
      expect(compareHtml(html01(source), html02(result.output, false)).equal).toBe(true)
    }
    expect(accepted).toBeGreaterThan(0)
  })
})
