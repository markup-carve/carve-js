import { describe, it, expect } from 'vitest'
import { occupiedPrivateUse, pickSentinelRun } from '../src/sentinel-run.js'

/**
 * The allocator both writers share, on its own terms.
 *
 * Every other test in this repository states the rule through a rendered
 * document, which is the right place for it - but a document can only exercise
 * the runs a real author would occupy. These rows exercise the ones the scan has
 * to walk past.
 */

const at = (code: number): string => String.fromCharCode(code)

/** The code points `from`..`to`, as an occupancy set. */
const taken = (...ranges: ReadonlyArray<readonly [number, number]>): Set<number> => {
  const set = new Set<number>()
  for (const [from, to] of ranges) for (let code = from; code <= to; code++) set.add(code)
  return set
}

describe('pickSentinelRun', () => {
  it('keeps the preferred run when nothing occupies it', () => {
    expect(pickSentinelRun(new Set(), 0xe001, 6)).toEqual([
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
    const picked = pickSentinelRun(taken([0xe004, 0xe004]), 0xe001, 6)

    expect(picked).not.toContain(at(0xe004))
    expect(picked).toHaveLength(6)
  })

  it('finds a free run that no aligned scan would land on', () => {
    // THE ROW THAT DOES THE REAL WORK. The area is occupied except for the six
    // code points U+E101..U+E106, and that window is not a whole number of runs
    // from the preferred base - a scan that stepped a run at a time would walk
    // straight over it and report the area full.
    const picked = pickSentinelRun(taken([0xe001, 0xe100], [0xe107, 0xf8ff]), 0xe001, 6)

    expect(picked).toEqual([
      at(0xe101),
      at(0xe102),
      at(0xe103),
      at(0xe104),
      at(0xe105),
      at(0xe106),
    ])
  })

  it('never hands out U+E000, whatever the document holds', () => {
    // It is the parser's nbsp marker, so it is not a writer's to take even when
    // the document has left it free.
    expect(pickSentinelRun(taken([0xe001, 0xf8ff]), 0xe001, 6)).not.toContain(at(0xe000))
  })

  it('falls back to the preferred run when the area is full', () => {
    // The documented last resort. It needs the whole private-use area occupied,
    // which no real document does, and it keeps the behaviour the writer had
    // before the run was picked at all rather than refusing to render.
    expect(pickSentinelRun(taken([0xe001, 0xf8ff]), 0xe004, 5)).toEqual([
      at(0xe004),
      at(0xe005),
      at(0xe006),
      at(0xe007),
      at(0xe008),
    ])
  })
})

describe('occupiedPrivateUse', () => {
  it('reaches a string nested in arrays and objects', () => {
    const tree = { a: [{ b: [`x${at(0xe123)}`] }], c: { d: at(0xe456) } }
    const occupied = occupiedPrivateUse(tree)

    expect(occupied.has(0xe123)).toBe(true)
    expect(occupied.has(0xe456)).toBe(true)
  })

  it('records nothing outside the allocatable area', () => {
    // U+E000 is never allocated, so whether the document holds it is not this
    // set's business, and an ordinary character is not either.
    const occupied = occupiedPrivateUse([`a${at(0xe000)}${at(0xf900)}`])

    expect(occupied.size).toBe(0)
  })

  it('does not build a copy of the tree to answer the question', () => {
    // The set is bounded by the private-use area however large the input is.
    // Joining every string instead put a second copy of the document in memory,
    // and on a document near the engine's own byte budget that copy exceeded
    // V8's maximum string length - a RangeError out of a renderer that was
    // about to refuse the input for its size anyway.
    const huge = 'a'.repeat(2_000_000)
    const occupied = occupiedPrivateUse([huge, huge, huge, `${huge}${at(0xe321)}`])

    expect(occupied.size).toBe(1)
    expect(occupied.has(0xe321)).toBe(true)
  })

  it('ignores values that are not strings', () => {
    expect(() => occupiedPrivateUse({ n: 1, b: true, u: undefined, z: null })).not.toThrow()
  })
})
