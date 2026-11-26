// carve#6543: nested spans whose attribute value holds a line break. Since carve#6542 they form, within the nested-span bound.
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
  // carve#6542: each value is written with a space and reported, so the spans form.
  it('C2-W-050, C2-W-117: each value is written with a space and reported, and the spans form', () => {
    for (const depth of [1, 2, 25, 200]) {
      const { output } = writeTreeWithStats(paragraph(spans(depth, 'a\nb')), undefined)
      expect(output.source).toBe(`${'[\\[ '.repeat(depth)}${']{title="a b"}'.repeat(depth)}\n`)
      expect(output.diagnostics.map((entry) => entry.code)).toEqual(Array(depth).fill('field-unspellable'))
    }
  })

  it('C2-W-010, C2-W-133: the repair writes characters linear in the size of the group times its depth', () => {
    for (const depth of [25, 100, 200]) {
      const { output, stats } = writeTreeWithStats(paragraph(spans(depth, 'a\nb')), undefined)
      expect(output.diagnostics).toHaveLength(depth)
      const [size] = stats.work[0]!
      const work = stats.work.reduce((total, [, chars]) => total + chars, 0)
      // Each level probed its whole content: depth 50 wrote 1,526,420 characters for a group of 751, depth 200 hit the limit.
      // Spans that form take the bound of writer-repair-probes.test.ts for nested spans.
      expect(work, `depth ${depth}`).toBeLessThan(8 * depth * size)
    }
  })

  it('C2-W-088: a span that can form around them keeps the escapes it needs', () => {
    const outer: Inline = { type: 'span', attrs: { keyValues: [['title', 'ab']] }, children: spans(3, 'a\nb') }
    const { output } = writeTreeWithStats(paragraph([outer]), undefined)
    expect(output.source).toBe('[[\\[ [\\[ [\\[ ]{title="a b"}]{title="a b"}]{title="a b"}]{title=ab}\n')
    const value = '/attrs/keyValues/0/1'
    expect(output.diagnostics.map((entry) => [entry.code, entry.path])).toEqual([
      ['field-unspellable', `/children/0/children/0/children/0${value}`],
      ['field-unspellable', `/children/0/children/0/children/0/children/1${value}`],
      ['field-unspellable', `/children/0/children/0/children/0/children/1/children/1${value}`],
    ])
  })
})
