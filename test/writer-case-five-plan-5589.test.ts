import { describe, expect, it } from 'vitest'
import { format, parse, treesEqual, writeWithDiagnostics } from '../src/index.ts'
import { writeTreeWithStats } from '../src/write.ts'

// C2-W-088, C2-W-125 case five (carve#6656): where a case-five `]` lets the link's closer take only text openers, the
// plan escapes them itself, with the form the repair rounds give, and leaves no paragraph to the rounds.
describe('C2-W-125: the plan decides the kind beside a case-five link closer', () => {
  it.each([
    ['[x [a\\]b](u)', '\\[x [a\\]b](u)\n'],
    ['[foo[https://e.com/?q=\\](uri)](https://e.com/x)', '\\[foo[https://e.com/?q=\\](uri)](https://e.com/x)\n'],
    // C2-W-088: the closer reports the nearest opener; of the others only the first bracket of a run (carve#6681).
    ['[[a [a [b\\] c](/u)', '\\[[a \\[a [b\\] c](/u)\n'],
    ['See [x [a\\]b](u) and *em* text.', 'See \\[x [a\\]b](u) and *em* text.\n'],
  ])('plans %j', (source, expected) => {
    const tree = parse(source)
    const written = writeWithDiagnostics(tree)
    expect(written.diagnostics).toEqual([])
    expect(written.source).toBe(expected)
    expect(format(expected)).toBe(expected)
    expect(treesEqual(parse(expected), tree)).toBe(true)
    const both = writeTreeWithStats(tree, undefined, 'both')
    expect(both.stats.differences).toEqual([])
    expect(both.stats.repaired).toBe(0)
  })
})
