import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml } from '../src/index.js'

const wrap = (depth: number, source: string): string => source.split('\n').map((line, index, lines) =>
  index === lines.length - 1 && line === '' ? '' : line ? `${'> '.repeat(depth)}${line}` : '>'.repeat(depth)).join('\n')

describe('relative continuation in nested quoted items', () => {
  it.each([0, 1, 2])('keeps the item tight at quote depth %i', (quoteDepth) => {
    const source = wrap(quoteDepth, '- x\n  - x\n    para\n  +\n  tail\n')
    const output = carveToCarve(source)
    expect(output).toContain(wrap(quoteDepth, '  +\n'))
    expect(carveToHtml(output)).toBe(carveToHtml(source))
    expect(carveToCarve(output)).toBe(output)
  })
})
