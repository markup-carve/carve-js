import { describe, expect, it } from 'vitest'
import { carveToAstJson } from '../src/index.js'

/**
 * Rule A removes indentation before the block readers run. Every reported
 * column must still index the SOURCE line, for a leading cut and a mid-line one.
 */
describe('a rule A ownership cut', () => {
  const pos = (node: any) => [node.pos.startLine, node.pos.startColumn, node.pos.startOffset, node.pos.endColumn, node.pos.endOffset]

  it('keeps heading and heading text columns after a leading cut', () => {
    const doc = carveToAstJson('  ## H\n') as any
    expect(pos(doc.children[0])).toEqual([1, 3, 2, 7, 6])
    expect(pos(doc.children[0].children[0])).toEqual([1, 6, 5, 7, 6])
  })

  it('keeps paragraph text columns after a leading cut', () => {
    const doc = carveToAstJson('  para\n') as any
    expect(pos(doc.children[0].children[0])).toEqual([1, 3, 2, 7, 6])
  })

  it('keeps link definition columns after a leading cut', () => {
    const doc = carveToAstJson('  [a]: /u\n') as any
    expect(pos(doc.children[0])).toEqual([1, 3, 2, 10, 9])
  })

  it('keeps columns on a later line, after a paragraph', () => {
    const doc = carveToAstJson('a\n  ## H\n') as any
    expect(pos(doc.children[1])).toEqual([2, 3, 4, 7, 8])
    expect(pos(doc.children[1].children[0])).toEqual([2, 6, 7, 7, 8])
  })

  it('keeps columns after a mid-line cut behind a quote marker', () => {
    const doc = carveToAstJson('> a\n>     ## H\n') as any
    const heading = doc.children[0].children[1]
    expect(pos(heading)).toEqual([2, 7, 10, 11, 14])
    expect(pos(heading.children[0])).toEqual([2, 10, 13, 11, 14])
  })

  it('counts columns and offsets in codepoints past a cut', () => {
    const source = '  ## ä😀 H\n'
    const doc = carveToAstJson(source) as any
    const text = doc.children[0].children[0]
    expect(text.pos.startColumn).toBe(6)
    expect([...source].slice(text.pos.startOffset, text.pos.endOffset).join('')).toBe('ä😀 H')
  })
})
