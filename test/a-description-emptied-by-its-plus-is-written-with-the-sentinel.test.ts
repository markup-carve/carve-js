import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml } from '../src/index.js'

// carve#5108: a refused `+` leaves the description with no blocks, so CARVE-P11-040 writes `{empty}`.
describe('a description emptied by its plus is written with the sentinel', () => {
  it.each([
    [':: t\n:  +\n flush\n', ':: t\n: {empty}\n\nflush\n'],
    [':: t\n:  +\n  flush\n', ':: t\n: {empty}\n\nflush\n'],
    [':: t\n : +\nl\n: b\n', ':: t\n: {empty}\n\nl\n: b\n'],
    ['> :: t\n> :  +\n>  flush\n', '> :: t\n> : {empty}\n>\n> flush\n'],
  ])('writes %j', (source, written) => {
    expect(carveToCarve(source)).toBe(written)
    expect(carveToHtml(written)).toBe(carveToHtml(source))
  })
})
