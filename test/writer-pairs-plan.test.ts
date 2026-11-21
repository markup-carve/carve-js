// C2-W-146 in the planned writer: the pair escapes of a group are settled before its one readback.
import { describe, expect, it } from 'vitest'
import { type Inline, type Node, type ParagraphNode } from '../src/ast.ts'
import { lint } from '../src/index.ts'
import { writeTreeWithStats } from '../src/write.ts'
import { createWriter, lose, loseKey, markLosses, rollBackLosses } from '../src/write-state.ts'
import { growthRatio } from './support/growth.ts'
import { documentOf } from './support/tree.ts'

const PAIR_RULES = ['deprecated-bare-underline', 'deprecated-bare-strike', 'deprecated-bare-highlight',
  'markdown-strikethrough-double-tilde', 'markdown-strong-double-star']

describe('C2-W-146: pair escapes in a planned group', () => {
  const cases: [string, Inline[], string][] = [
    ['beside emphasis', [{ type: 'emphasis', children: [{ type: 'text', value: 'x' }] },
      { type: 'text', value: ' a _u_ and ~~s~~ b' }], '/x/ a \\_u_ and \\~\\~s~~ b\n'],
    ['inside strong', [{ type: 'text', value: 'a ' }, { type: 'strong', children: [{ type: 'text', value: '=h= y' }] }],
      'a *\\=h= y*\n'],
  ]

  it.each(cases)('writes the pairs %s with one parse, the readback of the plan', (_, children, expected) => {
    const tree = documentOf({ type: 'paragraph', children })
    const { output, stats } = writeTreeWithStats(tree, undefined, 'plan', true)
    expect(output.source).toBe(expected)
    expect(output.diagnostics).toEqual([])
    expect(stats.parses).toBe(1)
    expect(lint(output.source).filter((entry) => PAIR_RULES.includes(entry.code))).toEqual([])
  })

  it('writes plain paragraphs of pairs with their escapes placed before the write: one readback each, no repair', () => {
    const value = 'alpha ~~s~~ beta _u_ gamma =h= delta **b** epsilon'
    const children = Array.from({ length: 200 }, (): ParagraphNode => ({ type: 'paragraph', children: [{ type: 'text', value }] }))
    const { output, stats } = writeTreeWithStats(documentOf(...children), undefined, 'plan', true)
    expect(output.source.split('\n\n')[0]).toBe('alpha \\~\\~s~~ beta \\_u_ gamma \\=h= delta \\*\\*b** epsilon')
    expect(stats.repaired).toBe(0)
    expect(stats.parses).toBe(200)
  })
})

describe('C2-W-146: pair escapes take time linear in the text', () => {
  const PAIRS = 'alpha ~~s~~ beta _u_ gamma =h= delta **b** epsilon '
  const shapes: [string, (count: number) => ParagraphNode[]][] = [
    ['one paragraph', (count) => [{ type: 'paragraph', children: [{ type: 'text', value: PAIRS.repeat(count).trim() }] }]],
    ['one paragraph beside emphasis', (count) => [{ type: 'paragraph', children: [
      { type: 'emphasis', children: [{ type: 'text', value: 'x' }] }, { type: 'text', value: PAIRS.repeat(count).trim() }] }]],
    ['paragraphs', (count) => Array.from({ length: count }, (): ParagraphNode =>
      ({ type: 'paragraph', children: [{ type: 'text', value: PAIRS.trim() }] }))],
  ]
  it.each(shapes)('%s', (_, shape) => {
    const small = documentOf(...shape(100))
    const large = documentOf(...shape(1600))
    const write = (tree: typeof small): void => { writeTreeWithStats(tree, undefined, 'plan', true) }
    const { ratio, times } = growthRatio(() => write(small), () => write(large))
    expect(ratio, `${times.map((time) => time.toFixed(1)).join(', ')} ms`).toBeLessThan(48)
  })
})

describe('a refused round takes back its losses without a copy of the document losses', () => {
  it('restores the lost nodes, the lost keys and the entries to the mark', () => {
    const w = createWriter(null, false)
    const earlier: Node = { type: 'thematic_break' }
    const later: Node = { type: 'paragraph', children: [] }
    lose(w, earlier, null)
    loseKey(w, earlier, 0, 'a')
    const mark = markLosses(w)
    lose(w, later, 'children')
    loseKey(w, earlier, 1, 'b')
    loseKey(w, later, 0, 'c')
    rollBackLosses(w, mark)
    expect([...w.lost]).toEqual([earlier])
    expect([...w.lostKeys]).toEqual([[earlier, ['a']]])
    expect(w.losses.entries).toHaveLength(2)
    expect(w.losses.nodes).toEqual([earlier, earlier])
  })
})
