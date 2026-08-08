import { describe, expect, it } from 'vitest'
import { thematicBreakSpelling } from '../src/thematic-break-marker.js'

describe('thematic-break marker override', () => {
  it('can force the default spelling over an authored marker', () => {
    expect(thematicBreakSpelling('*', '---')).toBe('---')
  })

  it('preserves the authored marker without an override', () => {
    expect(thematicBreakSpelling('*', null)).toBe('***')
    expect(thematicBreakSpelling('_', null)).toBe('___')
    expect(thematicBreakSpelling(undefined, null)).toBe('---')
  })
})
