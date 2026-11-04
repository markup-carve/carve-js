import { describe, expect, it } from 'vitest'
import { parse } from '../src/index.js'

type Pos = { startOffset?: number; endOffset?: number }

// carve-js#4392: a consumed `+` below erased comment lines ends its host at the `+` in the source.
describe('a consumed plus after an erased line ends at its source offset', () => {
  it.each([2, 10, 100])('keeps every span of %i units inside the source', (units) => {
    const source = '- > +\n%% c\np\n\n'.repeat(units)
    const spans: Pos[] = []
    JSON.stringify(parse(source), (key, value) => {
      if (key === 'pos' && value) spans.push(value as Pos)
      return value
    })
    for (const span of spans) {
      expect(Number.isInteger(span.endOffset)).toBe(true)
      expect(span.endOffset!).toBeGreaterThanOrEqual(span.startOffset!)
      expect(span.endOffset!).toBeLessThanOrEqual(source.length)
    }
    const lists = parse(source).children.filter((block) => block.type === 'list')
    expect(lists).toHaveLength(units)
    for (const list of lists) expect(source.slice(list.pos!.startOffset, list.pos!.endOffset)).toBe('- > +')
  })
})
