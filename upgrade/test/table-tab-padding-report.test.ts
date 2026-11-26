import { describe, expect, it } from 'vitest'
import { compareHtmlExact } from '../src/compare.ts'
import { html01, html02 } from '../src/engines.ts'
import { trimCellTabPadding } from '../src/html-transform.ts'
import { canWriteUpgrade, upgrade } from '../src/index.ts'

describe('old table cell tabs', () => {
  it('explains boundary tabs after the other cell rewrite', () => {
    const source = '|\ta |\tb _u_|\n'
    const result = upgrade(source)
    expect(result.output).toBe('|\ta |\tb {_u_}|\n')
    expect(result.check).toBe('explained')
    expect(result.records.some((record) => record.entry === 'U-140' && record.class === 'report')).toBe(true)
    expect(canWriteUpgrade(result)).toBe(true)
    expect(compareHtmlExact(trimCellTabPadding(html01(source)).html,
      html02(result.output, false)).equal).toBe(true)
  })

  it('keeps a literal interior tab outside the boundary transformation', () => {
    const old = '<table><tbody><tr><td>a\tb</td></tr></tbody></table>'
    expect(trimCellTabPadding(old).html).toBe(old)
  })

  it('allows only the declared boundary tab difference across 1,000 variants', () => {
    let explained = 0
    for (let n = 0; n < 1000; n++) {
      const left = `a${n % 19}`
      const right = `b${Math.floor(n / 19)}`
      const prefix = n % 4 === 0 ? '> ' : ''
      const heading = n % 7 === 0 ? 'intro\n\n' : ''
      const second = n % 5 === 0 ? `${prefix}| x | y |\n` : ''
      const mark = n % 3 === 0 ? '_u_' : 'plain'
      const source = `${heading}${prefix}|\t${left} |\t${right} ${mark}|\n${second}`
      const result = upgrade(source)
      if (result.check !== 'explained' || !result.records.some((record) => record.entry === 'U-140')) continue
      explained++
      expect(compareHtmlExact(trimCellTabPadding(html01(source)).html,
        html02(result.output, false)).equal).toBe(true)
    }
    expect(explained).toBeGreaterThan(0)
  })
})
