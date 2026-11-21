// Plain words (write-plain.ts) skip the model of the plan and the readback parse; both shortcuts claim a fact about
// the rules and the reader, which these tests pin.
import { describe, expect, it } from 'vitest'
import { parse, treesEqual } from '../src/index.ts'
import { plainLeaf, plainParagraph } from '../src/write-plain.ts'
import { writeTreeWithStats } from '../src/write.ts'
import { INLINE_TRIGGERS, LINE_TRIGGERS } from '../src/write-tables.ts'
import { seededRandom } from './support/writer-checks.ts'

const WORDS = ['a', 'i', 'iv', 'x', 'Z', '0', '1', '12', '1a', 'a1', 'alpha', 'TODO', 'sss', 'v2']

function line(next: () => number): string {
  return Array.from({ length: 1 + Math.floor(next() * 5) }, () => WORDS[Math.floor(next() * WORDS.length)]).join(' ')
}

describe('plain words', () => {
  it('C2-W-092, C2-W-093: no unit of plain words is a trigger, and the line rules need `.` or `)` behind one', () => {
    for (const char of 'abcxyzABCXYZ0189 ') {
      expect(INLINE_TRIGGERS[char.charCodeAt(0)]).toBe(0)
      expect(LINE_TRIGGERS[char.charCodeAt(0)]).toBe(0)
    }
    expect(plainLeaf([{ type: 'text', value: '1. a' }], '1. a')).toBe(false)
    expect(plainLeaf([{ type: 'text', value: 'a) b' }], 'a) b')).toBe(false)
  })

  it('a leaf is plain only with texts of plain words between soft breaks, written as their values', () => {
    const text = (value: string) => ({ type: 'text' as const, value })
    const soft = { type: 'soft_break' as const }
    expect(plainLeaf([text('alpha beta'), soft, text('12 x')], 'alpha beta\n12 x')).toBe(true)
    expect(plainLeaf([text('alpha'), text('beta')], 'alphabeta')).toBe(false)
    expect(plainLeaf([text('alpha'), soft], 'alpha\n')).toBe(false)
    expect(plainLeaf([text('')], '')).toBe(false)
    expect(plainLeaf([text('a  b')], 'a  b')).toBe(false)
    expect(plainLeaf([text(' a')], ' a')).toBe(false)
    expect(plainLeaf([text('a b')], 'a\\ b')).toBe(false)
    expect(plainLeaf([text('a'), { type: 'hard_break' }, text('b')], 'a\\\nb')).toBe(false)
  })

  it('C2-W-002: the reader reads lines of plain words as the paragraph plainParagraph builds', () => {
    const next = seededRandom(5232)
    for (let round = 0; round < 500; round++) {
      const lines = Array.from({ length: 1 + Math.floor(next() * 4) }, () => line(next))
      const read = parse(`${round % 2 === 0 ? '' : '\n'}${lines.join('\n')}\n`).children
      expect(read).toHaveLength(1)
      expect(treesEqual(read[0]!, plainParagraph(lines)!)).toBe(true)
    }
    expect(plainParagraph(['a', 'b.'])).toBeNull()
    expect(plainParagraph([])).toBeNull()
  })

  it('C2-W-010: plain words in any block are written by the plan with no readback parse of their paragraph', () => {
    const source = 'alpha beta\n12 x\n\n= TODO\n\n- a\n  iv\n\n> sss\n'
    const tree = parse(source)
    const { output, stats } = writeTreeWithStats(tree, undefined, 'both')
    expect(output.source).toBe(source)
    expect(stats.differences).toEqual([])
    expect(stats.repaired).toBe(0)
    expect(writeTreeWithStats(parse('alpha beta\n'), undefined).stats.parses).toBe(0)
  })
})
