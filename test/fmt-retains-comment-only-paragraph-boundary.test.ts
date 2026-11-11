import { describe, expect, it } from 'vitest'
import { carveToHtml, parse, renderCarve } from '../src/index.js'

const fmt = (source: string): string => renderCarve(parse(source, { positions: true }))

describe('fmt keeps the blank before a comment-only paragraph in an item', () => {
  it.each([
    '- x\n\n  {% a z %}\n\n',
    '- p\n\n  {% a\n   - m\n   z %}\n',
    '* x\n\n  {% another %}\n',
    '1. x\n\n   {% another %}\n',
  ])('keeps the rendered meaning of %j', (source) => {
    const formatted = fmt(source)
    expect(formatted).toContain('\n\n')
    expect(carveToHtml(formatted)).toBe(carveToHtml(source))
    expect(fmt(formatted)).toBe(formatted)
  })
})
