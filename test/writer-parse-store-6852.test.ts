// carve#6852: a short source that the parse cache dropped is charged again as before, but its tree is not built again.
import { describe, expect, it } from 'vitest'
import { parseChunk, readbackParse } from '../src/write-check.ts'
import { createWriter } from '../src/write-state.ts'

describe('writer parse store (carve#6852)', () => {
  it('charges a dropped source again and reuses its tree', () => {
    const w = createWriter(null, false)
    const first = parseChunk(w, 'a [b] ^c\n')
    // The cache keeps 128 trees and starts over with the next one.
    for (let at = 0; at < 128; at++) parseChunk(w, `x${at}\n`)
    const chars = w.work.chars
    const again = parseChunk(w, 'a [b] ^c\n')
    expect(again).toBe(first)
    expect(w.parses).toBe(130)
    expect(w.work.chars).toBe(chars + 'a [b] ^c\n'.length)
  })

  it('does the same for the readback parses without positions', () => {
    const w = createWriter(null, false)
    const first = readbackParse(w, 'a [b] ^c\n')
    for (let at = 0; at < 64; at++) readbackParse(w, `x${at}\n`)
    const parses = w.parses
    expect(readbackParse(w, 'a [b] ^c\n')).toBe(first)
    expect(w.parses).toBe(parses + 1)
  })

  it('builds the tree of a long source again', () => {
    const w = createWriter(null, false)
    const source = `${'word '.repeat(1000)}\n`
    const first = parseChunk(w, source)
    for (let at = 0; at < 128; at++) parseChunk(w, `x${at}\n`)
    const again = parseChunk(w, source)
    expect(again).not.toBe(first)
    expect(again).toEqual(first)
  })
})
