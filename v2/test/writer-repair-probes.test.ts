// The probes of the repair (write-check.ts): a probe of a nested node is made once for each state it
// reads, so nested inline nodes that do not form cost the repair work linear in their size and depth,
// and every repair is bounded by the limit of C2-W-133.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { type Inline } from '../src/ast-nodes.ts'
import { type DocumentNode, writeWithDiagnostics } from '../src/index.ts'
import { writeTreeWithStats } from '../src/write.ts'

const root = join(import.meta.dirname, '..')

function spans(depth: number, inner: Inline[]): Inline[] {
  let nodes = inner
  for (let level = 0; level < depth; level++) nodes = [{ type: 'span', children: nodes }]
  return nodes
}

/** Three spans around `]` and, behind it, `depth` spans around the text of a brace, a quote and two backslashes. */
function nested(depth: number): DocumentNode {
  const inner = spans(depth, [{ type: 'text', value: "{'\\\\" }])
  return { type: 'document', astVersion: '2.0', children: [
    { type: 'paragraph', children: spans(3, [{ type: 'text', value: ']' }, ...inner]) },
  ] }
}

/** The repair's bytes for `nested(depth)`, as the writer before the memo of the probes wrote them for depth 1 to 9. */
function nestedSource(depth: number): string {
  return `[[[\\]${'['.repeat(depth)}\\{\\'\\\\\\]{}${']{}'.repeat(depth - 1)}]{}]{}]{}\n`
}

describe('the probes of the repair', () => {
  it('C2-W-088: nested spans that do not form keep the bytes of the repair', () => {
    for (const depth of [1, 5, 9]) {
      const result = writeTreeWithStats(nested(depth), undefined, 'plan', false)
      expect(result.output.source).toBe(nestedSource(depth))
      expect(result.output.diagnostics.map((entry) => entry.code)).toEqual(['structure-unspellable'])
    }
  })

  it('C2-W-133: the repair of nested spans parses characters linear in the size of the group times its depth', () => {
    for (const depth of [9, 16, 32, 64]) {
      const result = writeTreeWithStats(nested(depth), undefined, 'plan', false)
      expect(result.output.source).toBe(nestedSource(depth))
      const [size, work] = result.stats.work[0]!
      // Without the memo, each level of spans tripled the probes: depth 9 took 3 s, depth 16 did not finish.
      expect(work, `depth ${depth}`).toBeLessThan(8 * depth * size)
    }
  })

  it('C2-W-133: the HTML import of unclosed unknown elements of proptest case 4e78df2a673d1efc is written', () => {
    const fixtures = join(root, 'test/fixtures/writer-slow')
    const tree = JSON.parse(readFileSync(join(fixtures, '4e78df2a673d1efc.json'), 'utf8')) as DocumentNode
    const started = performance.now()
    const written = writeWithDiagnostics(tree)
    expect(performance.now() - started).toBeLessThan(10_000)
    expect(written.source).toBe(readFileSync(join(fixtures, '4e78df2a673d1efc.out'), 'utf8'))
    expect(written.diagnostics.map((entry) => entry.code)).toEqual(['field-unspellable', 'structure-unspellable'])
  })
})
