import { describe } from 'vitest'
import { carveToHtml } from '../src/index.js'
import { expectScansLinearly, perfIt } from './helpers/scaling.js'

// A marker-column `+` asks which fences the body leaves open; the answer must not rescan the body per marker.
describe('a run of plus markers in one body', () => {
  const heads: Record<string, [string, string]> = {
    description: [':: t\n: a\n', ''],
    footnote: ['[^n]: a\n', '\nr[^n]\n'],
  }
  for (const [label, [prefix, suffix]] of Object.entries(heads)) {
    perfIt(`parses a ${label} with many plus markers in linear time`, () => {
      expectScansLinearly((input) => void carveToHtml(input), '+\npara\n', { label, prefix, suffix, smallRepeats: 1000 })
    })
  }
})
