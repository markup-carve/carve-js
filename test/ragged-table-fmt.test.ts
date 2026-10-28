import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml } from '../src/index.js'

const cases = [
  ['| ~x~ |\n| a | b |\n', '| ~x~ |\n| a | b |\n'],
  ['| |x |\n|---|\n| y |\n', '|= |= x |\n| y |\n'],
  ['| h |\n|---|\n| |x |\n', '|= h |\n| | x |\n'],
] as const

describe('ragged table formatting', () => {
  it.each(cases)('keeps every row cell count', (source, expected) => {
    expect(carveToCarve(source)).toBe(expected)
    expect(carveToHtml(carveToCarve(source))).toBe(carveToHtml(source))
  })
})
