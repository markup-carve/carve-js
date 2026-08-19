import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml } from '../src/index.js'

const sources = [
  '* * [d]: u\n  :\n',
  '* * [d]: u\n  x\n',
  '- - [d]: u\n  tail\n',
  '* * [^f]: n\n  :\n',
  '::: n\n* * [d]: u\n  :\n:::\n',
]

describe('a marker-line item emptied by definition collection', () => {
  it.each(sources)('preserves HTML and reaches a fixed point: %j', (source) => {
    const formatted = carveToCarve(source)

    expect(carveToHtml(formatted)).toBe(carveToHtml(source))
    expect(carveToCarve(formatted)).toBe(formatted)
  })

  // The properties above hold for any stable spelling, including a wrong one
  // that happens to round-trip, so one row says WHICH spelling the writer
  // picks: the definition goes back on the marker line it was authored on,
  // rather than being hoisted and the emptied item filled with `+`. `+` is what
  // broke this - it attaches the outer item's next block to the empty inner one.
  it('writes the definition back on its own marker line', () => {
    expect(carveToCarve('* * [d]: u\n  :\n')).toBe('* * [d]: u\n  :\n')
    expect(carveToCarve('* * [^f]: n\n  :\n')).toBe('* * [^f]: n\n  :\n')
  })

  // And the definition is still a definition after the round trip - the half a
  // structural assertion cannot see. A writer that kept the text but lost the
  // hoist would pass every row above and leave the reference dead.
  it('keeps the definition resolvable after formatting', () => {
    const formatted = carveToCarve('* * [d]: u\n  :\n\n[go][d]\n')

    expect(carveToHtml(formatted)).toContain('<a href="u">go</a>')
  })
})
