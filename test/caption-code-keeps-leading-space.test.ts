import { describe, expect, it } from 'vitest'
import { carveToHtml, parse, renderCarve } from '../src/index.js'

describe('code in a caption', () => {
  it('writes a parsed continuation with a leading space', () => {
    const source = '||\n^ `\n ^\n'
    const formatted = renderCarve(parse(source))
    expect(carveToHtml(formatted)).toBe(carveToHtml(source))
    expect(renderCarve(parse(formatted))).toBe(formatted)
  })

  it('writes an unindented continuation', () => {
    expect(() => renderCarve(parse('||\n^ `\n^\n'))).not.toThrow()
  })
})
