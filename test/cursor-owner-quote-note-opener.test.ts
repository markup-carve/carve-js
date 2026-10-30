import { describe, expect, it } from 'vitest'
import { ownLines } from '../src/parse/block/block-ownership.js'

describe('ownLines quoteNotes', () => {
  it('marks a footnote definition opened inside a quote', () => {
    expect([...ownLines(['> [^f]: n', 'tail'], 0).quoteNotes]).toEqual([0])
  })

  it('marks one nested under a list item quote', () => {
    expect([...ownLines(['- > [^f]: n', 'tail'], 0).quoteNotes]).toEqual([0])
  })

  it('does not mark a document-level definition or a quote paragraph', () => {
    expect([...ownLines(['[^f]: n', '> text', '> [^g] x'], 0).quoteNotes]).toEqual([])
  })
})

describe('ownLines quoteMarkers', () => {
  it('marks marker-shaped text after a quote prefix, opener or not', () => {
    expect([...ownLines(['> - x', '> text', '> 1. y', '> >- z'], 0).quoteMarkers]).toEqual([0, 2, 3])
  })

  it('marks marker text a footnote body absorbs inside a quote', () => {
    expect([...ownLines(['> [^f]: n', '>   - sub'], 0).quoteMarkers]).toEqual([1])
  })

  it('does not mark marker text outside a quote', () => {
    expect([...ownLines(['- x', 'a > - b'], 0).quoteMarkers]).toEqual([])
  })
})
