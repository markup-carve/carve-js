import { describe, expect, it } from 'vitest'
import { carveToHtml, parse, renderCarve } from '../src/index.js'

const format = (source: string): string => renderCarve(parse(source))

describe('unclosed code span around a colon fence line', () => {
  it('stabilizes after one format pass', () => {
    const first = format('`\n :::\nc\n')
    expect(carveToHtml(first)).toBe(carveToHtml('`\n :::\nc\n'))
    expect(format(first)).toBe(first)
  })

  it('keeps a closed one-line span stable', () => {
    expect(format(format('`x`\n'))).toBe('`x`\n')
  })
})
