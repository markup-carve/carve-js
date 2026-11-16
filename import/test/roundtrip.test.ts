import { describe, expect, it } from 'vitest'
import { parse } from '../../v2/src/index.ts'
import { diffTrees, measure, roundTrip } from '../scripts/roundtrip-harness.ts'

describe('HTML round trip harness', () => {
  it('C2-A-161 finds no difference between a tree and itself', () => {
    const tree = parse('# A\n\n- *b* [c](/d)\n')
    expect(diffTrees(tree, structuredClone(tree))).toEqual([])
  })

  it('C2-A-162 skips the resolution results and the source geometry', () => {
    const tree = parse('# A\n')
    const other = structuredClone(tree)
    const heading = other.children[0]
    if (heading?.type === 'heading') heading.generatedId = 'other'
    delete other.srcByteLength
    expect(diffTrees(tree, other)).toEqual([])
  })

  it('C2-A-161 names a difference by node type and field', () => {
    const tree = parse('- a\n')
    const other = structuredClone(tree)
    const list = other.children[0]
    if (list?.type === 'list') list.spacing = 'loose'
    expect(diffTrees(tree, other)).toEqual(['list.spacing'])
  })

  it('C2-H-112 round-trips a plain paragraph', () => {
    expect(roundTrip('a *b* c\n').equal).toBe(true)
    expect(measure(['a\n', 'b\n']).equal).toBe(2)
  })
})
