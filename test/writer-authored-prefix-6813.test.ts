import { describe, expect, it } from 'vitest'
import { formatWithDiagnostics, parse, treesEqual } from '../src/index.ts'

const quoted = (lines: number): string => '> [a *[a][]*[x]: /u\n'.repeat(lines)

// C2-W-075, C2-W-088 (carve#6813): the authored source of a leaf block in a container drops the container prefix of
// every line, also of a line break that no break node holds, as one in the alternative text of an image.
describe('C2-W-088: an authored leaf block drops the prefix of each line (carve#6813)', () => {
  it.each([
    ['an image across two lines between the references', `${quoted(60)}> ![b\n> c](u)\n${quoted(62)}`],
    ['an image across two lines first', `> ![b\n> c](u)\n${quoted(122)}`],
    ['in a list item', `- ![b\n  c](u)\n${'  [a *[a][]*[x]: /u\n'.repeat(122)}`],
    // A lazy line holds no prefix and keeps its spelling.
    ['an image across a lazy line first', `> ![b\nc](u)\n${quoted(122)}`],
    ['an image across a lazy line between the references', `${quoted(60)}> ![b\nc](u)\n${quoted(62)}`],
  ])('%s', (_, source) => {
    const out = formatWithDiagnostics(source)
    expect(out.diagnostics).toEqual([])
    expect(treesEqual(parse(out.source), parse(source))).toBe(true)
    expect(formatWithDiagnostics(out.source).source).toBe(out.source)
  })
})
