import { describe, it, expect } from 'vitest'
import { carveToAstJson, carveToCarve, fromAstJson, renderCarve } from '../src/index.js'

/**
 * A generated heading id is published, and never written back as source.
 *
 * PART 12 §5 makes the slugged id a resolution result, so it reaches the wire -
 * this engine has always published it. `attrs.order` is what says whether the
 * author wrote it: an AUTHORED id carries an `#id` slot, a generated one carries
 * none, because it never appeared in an attribute block.
 *
 * The writer did not consult that, so a tree that had been through the AST came
 * back with `{#Welcome}` above a heading whose source has no attribute block at
 * all (carve-js#741). PART 11 §1's job is to give the document back.
 *
 * It compounds: after one round trip the id IS authored, so renaming the heading
 * text stops renaming the id.
 */
describe('a generated id is not authored source', () => {
  const roundTrip = (src: string): string => renderCarve(fromAstJson(carveToAstJson(src)))

  it('writes a plain heading back unchanged', () => {
    expect(roundTrip('# Welcome\n')).toBe('# Welcome\n')
  })

  it('publishes the id it does not write', () => {
    // Both halves in one place: the field is on the wire (§5) AND absent from
    // the source (PART 11). Dropping the field to fix the writer would pass a
    // test that only checked the source.
    const heading = carveToAstJson('# Welcome\n').children[0] as Record<string, unknown>
    expect(heading.attrs).toEqual({ id: 'Welcome' })
  })

  it('keeps an authored id, which carries its slot', () => {
    const src = '{#chosen}\n# Welcome\n'
    expect(roundTrip(src)).toBe(src)
  })

  it('keeps an authored id beside other authored attributes', () => {
    const src = '{#chosen .cls k=v}\n# Welcome\n'
    expect(roundTrip(src)).toBe(src)
  })

  it('still writes authored attributes when the id is generated', () => {
    // The narrow case: the block is real, the id in it is not.
    const src = '{.cls k=v}\n# Welcome\n'
    expect(roundTrip(src)).toBe(src)
  })

  it('is idempotent, so a second trip cannot promote the id', () => {
    const once = roundTrip('# Notes\n\n# Notes\n')
    expect(roundTrip(once)).toBe(once)
    expect(once).toBe('# Notes\n\n# Notes\n')
  })

  it('does not change what a direct fmt writes', () => {
    const src = '# Notes\n\n# Notes\n'
    expect(carveToCarve(src)).toBe(roundTrip(src))
  })
})
