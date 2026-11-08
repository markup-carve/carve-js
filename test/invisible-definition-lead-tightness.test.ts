import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

describe('invisible definition leads in list items', () => {
  it.each([
    ['two note definitions', '- [^n]: d0\n\n  [^m]: x\n\n  flush\n\nsee[^n][^m]\n'],
    ['one note definition', '- [^n]: d0\n\n  flush\n\nsee[^n]\n'],
  ])('%s does not loosen the first visible paragraph', (_name, source) => {
    expect(carveToHtml(source)).toContain('<li>flush</li>')
  })
})
