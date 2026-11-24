// carve#6543: nested spans whose attribute value holds a line break cannot form, and their repair stays linear.
import { describe, expect, it } from 'vitest'
import { type Inline } from '../src/ast-nodes.ts'
import { type DocumentNode } from '../src/index.ts'
import { writeTreeWithStats } from '../src/write.ts'

/** `depth` spans, each holding `[ ` and the next one, around `inner`, each with the title `title`. */
function spans(depth: number, title: string, inner: Inline[] = []): Inline[] {
  let nodes = inner
  for (let level = 0; level < depth; level++) {
    nodes = [{ type: 'span', attrs: { keyValues: [['title', title]] }, children: [{ type: 'text', value: '[ ' }, ...nodes] }]
  }
  return nodes
}

function paragraph(children: Inline[]): DocumentNode {
  return { type: 'document', astVersion: '2.0', children: [{ type: 'paragraph', children }] }
}

describe('nested spans with a line break in an attribute value (carve#6543)', () => {
  it('C2-W-117: the spans are reported lost and the bytes are those of the full repair', () => {
    for (const depth of [1, 2, 25, 200]) {
      const { output } = writeTreeWithStats(paragraph(spans(depth, 'a\nb')), undefined)
      expect(output.source).toBe(`${'[[ '.repeat(depth)}${']{title=a\nb}'.repeat(depth)}\n`)
      expect(output.diagnostics.map((entry) => entry.code)).toEqual(['structure-unspellable'])
    }
  })

  it('C2-W-010, C2-W-133: the repair writes characters linear in the size of the group', () => {
    for (const depth of [25, 100, 200]) {
      const { output, stats } = writeTreeWithStats(paragraph(spans(depth, 'a\nb')), undefined)
      expect(output.diagnostics.map((entry) => entry.code)).toEqual(['structure-unspellable'])
      const [size] = stats.work[0]!
      const work = stats.work.reduce((total, [, chars]) => total + chars, 0)
      // Each level probed its whole content: depth 50 wrote 1,526,420 characters for a group of 751, depth 200 hit the limit.
      expect(work, `depth ${depth}`).toBeLessThan(4 * size)
    }
  })

  it('C2-W-088: a span that can form around them keeps the escapes it needs', () => {
    const outer: Inline = { type: 'span', attrs: { keyValues: [['title', 'ab']] }, children: spans(3, 'a\nb') }
    const { output } = writeTreeWithStats(paragraph([outer]), undefined)
    expect(output.source).toBe(`[[\\[ [\\[ [\\[ ]{title=a\nb}]{title=a\nb}]{title=a\nb}]{title=ab}\n`)
    expect(output.diagnostics.map((entry) => [entry.code, entry.path])).toEqual([['structure-unspellable', '/children/0/children/0/children/0']])
  })
})
