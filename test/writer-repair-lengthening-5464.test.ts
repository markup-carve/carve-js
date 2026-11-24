import { describe, expect, it } from 'vitest'
import { parse, treesEqual } from '../src/index.ts'
import { writeTreeWithStats } from '../src/write.ts'

describe('C2-W-088 repair lengthening escapes (carve-js#5464)', () => {
  it.each([
    'a {{,,\\{,},,},}_}',
    '> a {{,,\\{,},,},}_}',
    '- a {{,,\\{,},,},}_}',
  ])('waits for the parse after a reported construct in %j', (source) => {
    const tree = parse(source)
    const output = writeTreeWithStats(tree, undefined, 'repair').output
    const planned = writeTreeWithStats(tree, undefined, 'plan').output
    expect(output.diagnostics).toEqual([])
    expect(output.source).toBe(planned.source)
    expect(treesEqual(parse(output.source), tree)).toBe(true)
  })
})
