import { describe, expect, it } from 'vitest'
import { carveToCarve } from '../src/index.js'
import { expectBuiltInputScansLinearly, perfIt } from './helpers/scaling.js'

// Every level of a loose ladder is a one-item loose list, and the writer
// reparsed each level's whole body to confirm it reads back loose: cubic in
// depth (carve#5193).

const ladder = (levels: number): string =>
  `${Array.from({ length: levels }, (_, index) => `${' '.repeat(index * 2)}- x`).join('\n\n')}\n`

describe('writing a loose list ladder', () => {
  it('writes the ladder unchanged', () => {
    expect(carveToCarve(ladder(3))).toBe('- x\n\n  - x\n\n    - x\n')
    expect(carveToCarve(ladder(40))).toBe(ladder(40))
  })

  perfIt('writes a deep loose ladder in time linear in its size', () => {
    expectBuiltInputScansLinearly((input) => void carveToCarve(input), ladder, {
      label: 'loose list ladder levels',
      smallRepeats: 20,
      largeRepeats: 80,
    })
  })
})
