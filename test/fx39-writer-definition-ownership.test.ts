import { describe, expect, it } from 'vitest'
import { carveToCarve } from '../src/index.js'

describe('footnote write-back uses the selected owner column', () => {
  it('keeps a list-owned note beside its item blocks', () => {
    expect(carveToCarve('- a\n  [^f]: x\n  more\n\nsee[^f]\n'))
      .toBe('- a\n  [^f]: x\n  more\n\nsee[^f]\n')
  })

  it('places a note between an item paragraph and sublist', () => {
    expect(carveToCarve('. d\n   [^n]: e\n    - a\n'))
      .toBe('. d\n  [^n]: e\n  - a\n')
  })

  it('uses the item column inside a quote', () => {
    const source = '> - w\n>   [^f]: x\n>   more\n>\n> ## after\n'
    expect(carveToCarve(source)).toBe(source)
  })
})
