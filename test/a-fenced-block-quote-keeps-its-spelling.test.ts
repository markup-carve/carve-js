import { describe, expect, it } from 'vitest'
import { carveToCarve, parse } from '../src/index.js'

// markup-carve/carve#1718. The two spellings are one node, so the node records
// which one the author wrote: `carve fmt` has to write back what it read, and
// normalizing either way would rewrite documents nobody asked to change.

const quoteOf = (source: string): Record<string, unknown> =>
  (parse(source) as { children: Record<string, unknown>[] }).children[0]!

describe('the spelling a block quote was authored in', () => {
  it('is recorded on a fenced quote', () => {
    expect(quoteOf('::: >\nhello\n:::\n').fenced).toBe(true)
  })

  it('is absent on a prefixed quote, so an older document is unchanged', () => {
    expect(quoteOf('> hello\n')).not.toHaveProperty('fenced')
  })

  it('survives the canonical writer in both spellings', () => {
    expect(carveToCarve('::: >\nhello\n:::\n')).toBe('::: >\nhello\n:::\n')
    expect(carveToCarve('> hello\n')).toBe('> hello\n')
  })
})
