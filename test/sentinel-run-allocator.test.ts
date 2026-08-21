import { describe, it, expect } from 'vitest'
import { collectStrings, pickSentinelRun } from '../src/sentinel-run.js'

/**
 * The allocator both writers share, on its own terms.
 *
 * Every other test in this repository states the rule through a rendered
 * document, which is the right place for it - but a document can only exercise
 * the runs a real author would occupy. These rows exercise the ones the scan has
 * to walk past.
 */

const at = (code: number): string => String.fromCharCode(code)

/** The code points `from`..`to`, joined. */
const run = (from: number, to: number): string => {
  let text = ''
  for (let code = from; code <= to; code++) text += at(code)
  return text
}

describe('pickSentinelRun', () => {
  it('keeps the preferred run when the text does not contain it', () => {
    expect(pickSentinelRun('plain text', 0xe001, 6)).toEqual([
      at(0xe001),
      at(0xe002),
      at(0xe003),
      at(0xe004),
      at(0xe005),
      at(0xe006),
    ])
  })

  it('moves off it when ONE of its code points is occupied', () => {
    // Not "when all of them are": a run is unusable as soon as any slot in it
    // can be confused with authored text.
    const picked = pickSentinelRun(`a${at(0xe004)}b`, 0xe001, 6)

    expect(picked).not.toContain(at(0xe004))
    expect(picked).toHaveLength(6)
  })

  it('finds a free run that no aligned scan would land on', () => {
    // THE ROW THAT DOES THE REAL WORK. The area is occupied except for the six
    // code points U+E101..U+E106, and that window is not a whole number of runs
    // from the preferred base - a scan that stepped a run at a time would walk
    // straight over it and report the area full.
    const occupied = run(0xe001, 0xe100) + run(0xe107, 0xf8ff)
    const picked = pickSentinelRun(occupied, 0xe001, 6)

    expect(picked).toEqual([
      at(0xe101),
      at(0xe102),
      at(0xe103),
      at(0xe104),
      at(0xe105),
      at(0xe106),
    ])
  })

  it('never hands out U+E000, whatever the text holds', () => {
    // It is the parser's nbsp marker, so it is not the writer's to take even
    // when the document has left it free.
    const occupied = run(0xe001, 0xf8ff)

    expect(pickSentinelRun(occupied, 0xe001, 6)).not.toContain(at(0xe000))
  })

  it('falls back to the preferred run when the area is full', () => {
    // The documented last resort. It needs the whole private-use area occupied,
    // which no real document does, and it keeps the behaviour the writer had
    // before the run was picked at all rather than refusing to render.
    const occupied = run(0xe001, 0xf8ff)

    expect(pickSentinelRun(occupied, 0xe004, 5)).toEqual([
      at(0xe004),
      at(0xe005),
      at(0xe006),
      at(0xe007),
      at(0xe008),
    ])
  })
})

describe('collectStrings', () => {
  it('reaches a string nested in arrays and objects', () => {
    const tree = { a: [{ b: ['x'] }], c: { d: 'y' } }
    const text = collectStrings(tree)

    expect(text).toContain('x')
    expect(text).toContain('y')
  })

  it('separates two strings so no run is found across the seam', () => {
    // `ab` is present only if the two values are read as one string, which
    // would make the allocator reject a run no single value occupies.
    expect(collectStrings(['a', 'b'])).not.toContain('ab')
  })

  it('ignores values that are not strings', () => {
    expect(() => collectStrings({ n: 1, b: true, u: undefined, z: null })).not.toThrow()
  })
})
