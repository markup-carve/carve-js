import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml } from '../src/index.js'

const cases = [
  ['| ~x~ |\n| a | b |\n', '| ~x~ |\n| a | b |\n'],
  // The separator row is kept where the author wrote one (PART 11 §6h
  // [CARVE-P11-066]), including the ragged case where it names fewer cells than
  // the header row: the recorded widths are spelled for the cells that exist
  // and no further.
  ['| |x |\n|---|\n| y |\n', '| | x |\n|---|\n| y |\n'],
  ['| h |\n|---|\n| |x |\n', '| h |\n|---|\n| | x |\n'],
] as const

describe('ragged table formatting', () => {
  it.each(cases)('keeps every row cell count', (source, expected) => {
    expect(carveToCarve(source)).toBe(expected)
    expect(carveToHtml(carveToCarve(source))).toBe(carveToHtml(source))
  })
})
