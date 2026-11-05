import { describe, expect, it } from 'vitest'
import { carveToCarve, parse } from '../src/index.js'
import { writtenReadsBackAs } from '../src/render-carve.js'
import { lowestAccusedRatio, perfIt, timeCalls } from './helpers/scaling.js'

// Unclosed colon fences nested past the cap leave every later opener as paragraph
// text that must stay escaped, so the narrowing search fails at every probe, and
// the deep spine makes each probe a whole-document render and parse (carve-js#4429).
const nested = (pairs: number): string => ':::: note\ntext\n'.repeat(pairs)

describe('fmt of colon fences nested past the cap', () => {
  it('escapes the over-cap openers and reads back', () => {
    const src = nested(205)
    const out = carveToCarve(src)
    expect(out).toContain('\n\\:::: note\n')
    expect(writtenReadsBackAs(src, out)).toBe(true)
  })

  perfIt('re-parses a bounded number of documents', () => {
    // Relative to parsing the same input, so the reading does not depend on how
    // busy the machine is. Healthy reads ~80; the search re-parsing the whole
    // document for every probe of its count read ~300.
    const src = nested(600)
    carveToCarve(src)
    const { measured } = lowestAccusedRatio(() => {
      const ratios: number[] = []
      for (let round = 0; round < 3; round++) {
        const parseFirst = round % 2 === 0
        const p1 = parseFirst ? timeCalls(() => void parse(src), 200).msPerCall : 0
        const f = timeCalls(() => void carveToCarve(src)).msPerCall
        const p2 = parseFirst ? 0 : timeCalls(() => void parse(src), 200).msPerCall
        ratios.push(f / (p1 + p2))
      }
      ratios.sort((a, b) => a - b)
      return { ratio: ratios[1]! }
    }, 150)
    expect(measured.ratio).toBeLessThan(150)
  })
})
