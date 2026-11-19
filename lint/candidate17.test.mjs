import { describe, expect, it } from 'vitest'
import { lint } from './lint.ts'

const files = { 'outer.crv': '{{ child.crv }}\n', 'child.crv': 'See [x][missing].\n' }
const resolver = request => files[request.path] ? { id: request.path, text: files[request.path] } : { error: 'not_found' }

describe('candidate 17 diagnostic ancestry', () => {
  it('records outermost-first include directive ranges', () => {
    const finding = lint('{{ outer.crv }}\n', { includes: { resolver } }).find(entry => entry.code === 'unresolved-reference-link')
    expect(finding).toMatchObject({ file: 'child.crv', includedBy: [
      { range: { startOffset: 0, endOffset: 15 } },
      { file: 'outer.crv', range: { startOffset: 0, endOffset: 15 } },
    ] })
  })
  it('keeps the first route to a repeated file as C2-N-087 requires', () => {
    const findings = lint('{{ child.crv }}\n\n{{ child.crv }}\n', { includes: { resolver } })
      .filter(entry => entry.code === 'unresolved-reference-link')
    expect(findings).toHaveLength(1)
    expect(findings[0].includedBy).toEqual([{ range: { startOffset: 0, endOffset: 15 } }])
  })
})
