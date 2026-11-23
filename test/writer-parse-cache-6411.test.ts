// carve#6411: the parse cache of the writer keeps the trees of short sources and of repeated ones; the first repeat of
// another source is parsed again but counts no parse for the repair limit, as a repeat whose tree is kept.
import { describe, expect, it } from 'vitest'
import { parseChunk } from '../src/write-check.ts'
import { createWriter } from '../src/write-state.ts'

describe('writer parse cache (carve#6411)', () => {
  it('reuses the tree of a short source and counts it once', () => {
    const w = createWriter(null, false)
    const first = parseChunk(w, 'a *b* [c](u)\n')
    expect(parseChunk(w, 'a *b* [c](u)\n')).toBe(first)
    expect(w.parses).toBe(1)
  })

  it('parses a source again once the kept trees fill their budget, without counting the repeat', () => {
    const w = createWriter(null, false)
    const [kept, held, source] = ['a', 'b', 'c'].map((tail) => `${'^*[*[[*'.repeat(1000)}${tail}\n`)
    parseChunk(w, kept!)
    parseChunk(w, held!)
    const first = parseChunk(w, source!)
    const chars = w.work.chars
    const again = parseChunk(w, source!)
    expect(again).not.toBe(first)
    expect(again).toEqual(first)
    expect(w.parses).toBe(3)
    expect(w.work.chars).toBe(chars)
    // The repeat keeps its tree, so each source is parsed uncounted at most once.
    expect(parseChunk(w, source!)).toBe(again)
  })

  it('keeps no trees past its budget but still knows every source it saw', () => {
    const w = createWriter(null, false)
    const sources = Array.from({ length: 40 }, (_, at) => `${'word '.repeat(200)}${at}\n`)
    for (const source of sources) parseChunk(w, source)
    for (const source of sources) parseChunk(w, source)
    expect(w.parses).toBe(40)
  })
})
