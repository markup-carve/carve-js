import { describe, it, expect } from 'vitest'
import { parse } from '../src/index.js'

/**
 * Two position gaps that had nothing to do with each other and the same cause:
 * text joined from SEVERAL source lines was given the FIRST line's origin, and
 * every later line inherited it.
 *
 * - A caption ran through `stripPositions`, so nothing in it carried a position
 *   at all. That was 41 of this engine's 61 unplaced corpus nodes. A caption's
 *   text is a suffix of its line and its continuation lines are appended whole,
 *   so an exact mapping exists - unlike a line block's expanded whitespace,
 *   which is what that helper is for.
 * - A second heading line (`## A` / `## still A`) took the first one's origin,
 *   so "still A" reported the span of "## stil". Those two lines were one
 *   folded heading when this was found; they are two headings now
 *   (markup-carve/carve#451), and the placement still has to be per line.
 *
 * These assert by SLICING THE SOURCE with the reported offsets. A span that is
 * present but points somewhere else fails; asserting on the numbers alone would
 * not.
 */
const nodesOfType = (node: unknown, type: string): Array<Record<string, any>> => {
  const out: Array<Record<string, any>> = []
  const walk = (n: any): void => {
    if (!n || typeof n !== 'object') return
    if (Array.isArray(n)) {
      n.forEach(walk)
      return
    }
    if (n.type === type) out.push(n)
    for (const [key, value] of Object.entries(n)) {
      if (key !== 'pos') walk(value)
    }
  }
  walk(node)
  return out
}

const slice = (src: string, pos: any): string =>
  [...src].slice(pos.startOffset, pos.endOffset).join('')

describe('caption positions', () => {
  const cases: Record<string, string> = {
    'under a paragraph': 'body text\n\n^ the caption\n',
    'under a table': '| a | b |\n|---|---|\n| c | d |\n\n^ table caption\n',
    'under a code block': '```js\ncode()\n```\n\n^ listing caption\n',
    'under a blockquote': '> quoted\n\n^ quote caption\n',
  }

  for (const [label, src] of Object.entries(cases)) {
    it(`places the caption text ${label}`, () => {
      const [caption] = nodesOfType(parse(src), 'text').filter((n) =>
        String(n.value).includes('caption'),
      )
      expect(caption, 'a caption text node').toBeDefined()
      expect(caption!.pos, 'caption text carries a position').toBeDefined()
      expect(slice(src, caption!.pos)).toBe(caption!.value)
    })
  }

  it('places a caption that continues onto a second line', () => {
    const src = 'body\n\n^ first part\nsecond part\n'
    const texts = nodesOfType(parse(src), 'text')
    for (const node of texts) {
      expect(node.pos, `position on ${JSON.stringify(node.value)}`).toBeDefined()
      expect(slice(src, node.pos)).toBe(node.value)
    }
  })
})

describe('heading positions across consecutive heading lines', () => {
  it('places the second heading at its own text, not at the first one', () => {
    const src = '## A\n## still A\n# B\n'
    const [, second] = nodesOfType(parse(src), 'text')

    expect(second!.value).toBe('still A')
    // Before: startOffset 5, selecting "## stil" - the second line's marker.
    expect(slice(src, second!.pos)).toBe('still A')
    expect(second!.pos.startLine).toBe(2)
    expect(second!.pos.startColumn).toBe(4)
  })

  it('places the paragraph under a heading at its own text', () => {
    const src = '# Title\ncontinues here\n'
    const texts = nodesOfType(parse(src), 'text')
    for (const node of texts) {
      expect(slice(src, node.pos)).toBe(node.value)
    }
  })
})
