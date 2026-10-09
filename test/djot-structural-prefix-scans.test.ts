import { describe, expect, it } from 'vitest'
import { djotEmphasis, djotStructuralPrefixEnd, djotStructuralPrefixSteps } from '../src/djot-emphasis.js'

const prefix = /^(?:[ \t]*>)*[ \t]*(?:(?:[-*+]|[0-9]+[.)])[ \t]+(?:\[[ xX-]\][ \t]+)?)*[ \t]*$/

describe('Djot structural prefixes', () => {
  it('agrees with the prefix grammar at each asterisk', () => {
    const chunks = ['* ', '+ ', '- ', '12. ', '3)\t', '[x] ', '[ ]\t', '>', '> ', ' ', '\t', '\\*', '*a*', '1.', '[X]', '[*]', 'é', 'x']
    let seed = 7
    for (let row = 0; row < 1000; row++) {
      let line = ''
      for (let at = 0; at < 12; at++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
        line += chunks[seed % chunks.length]
      }
      const end = djotStructuralPrefixEnd(line)
      for (let at = 0; at < line.length; at++) {
        if (line[at] === '*') expect(at <= end, `${line} at ${at}`).toBe(prefix.test(line.slice(0, at)))
      }
    }
  })

  it('reads long marker chains once and preserves the trailing emphasis', () => {
    for (const count of [1000, 4000, 16000]) {
      const markers = '* '.repeat(count)
      const source = markers + '_a_'
      djotStructuralPrefixSteps.count = 0
      expect(djotEmphasis(source, plain => plain)).toBe(markers + '/a/')
      expect(djotStructuralPrefixSteps.count).toBeLessThan(source.length * 2)
    }
  })

  it('resets the line facts after a thematic break', () => {
    expect(djotEmphasis('***\n* _a_\n> * _b_', plain => plain)).toBe('***\n* /a/\n> * /b/')
  })
})
