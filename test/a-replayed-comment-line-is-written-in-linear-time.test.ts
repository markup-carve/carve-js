import { describe } from 'vitest'
import { parse, renderCarve } from '../src/index.js'
import { expectBuiltInputScansLinearly, perfIt } from './helpers/scaling.js'

// carve-js#5014: re-anchoring each replayed comment line used to rescan every line written before it.
describe('replayed comment lines in one long item', () => {
  perfIt.each([
    ['indented comment lines in one item', '- x\n', '   %% a\n'],
    ['comment lines after a nested task list', '- [ ] x\n      - y\n', '      %% a\n'],
  ])('writes %s in linear time', (label, head, unit) => {
    expectBuiltInputScansLinearly((source) => void renderCarve(parse(source, { positions: false })),
      (repeats) => head + unit.repeat(repeats), { label, smallRepeats: 500, minSampleMs: 250 })
  }, 120000)
})
