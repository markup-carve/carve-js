import { describe, expect, it } from 'vitest'
import { carveToCarve } from '../src/index.js'

describe('footnote write-back uses the selected owner column', () => {
  it('collects a list-owned note with a lazy line (carve#5109)', () => {
    expect(carveToCarve('- a\n  [^f]: x\n  more\n\nsee[^f]\n'))
      .toBe('- a\n\nsee[^f]\n\n[^f]: x\n  more\n')
  })

  it('places a note between an item paragraph and sublist', () => {
    expect(carveToCarve('. d\n   [^n]: e\n    - a\n'))
      .toBe('. d\n  [^n]: e\n  - a\n')
  })

  it('collects a quoted list-owned note with a lazy line (carve#5109)', () => {
    expect(carveToCarve('> - w\n>   [^f]: x\n>   more\n>\n> ## after\n'))
      .toBe('> - w\n>\n> ## after\n\n[^f]: x\n  more\n')
  })
})
