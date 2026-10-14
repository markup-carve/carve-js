import { describe, expect, it } from 'vitest'
import { carveToHtml, parse, renderCarve } from '../src/index.js'

describe('blocked span text on a later continuation line', () => {
  it('keeps the authored line when formatting', () => {
    const source = '| ^ | b |\n+   | u |\n+ t | v |\n'
    expect(renderCarve(parse(source))).toBe('| ^ | b |\n+ | u |\n+ t | v |\n')
    expect(carveToHtml(renderCarve(parse(source)))).toBe(carveToHtml(source))
  })

  it('uses the first continuation line when it holds the text', () => {
    const source = '| ^ | b |\n+ t | u |\n+   | v |\n'
    expect(renderCarve(parse(source))).toBe('| ^ | b |\n+ t | u |\n+ | v |\n')
  })
})
