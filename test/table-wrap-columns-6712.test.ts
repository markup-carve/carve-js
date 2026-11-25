// carve#6712: a wrap of a cell over several columns records the covered column of its fragment (C2-L-020, C2-L-048).
import { describe, expect, it } from 'vitest'
import { format, parse, parseWithLayout, treesEqual, validateLayout, write } from '../src/index.ts'

const wraps = (src: string) => parseWithLayout(src).layout.nodes.find((entry) => entry.wraps !== undefined)!.wraps!
const places = (src: string) => wraps(src).map((wrap) => [wrap.line, wrap.col, wrap.offset])

describe('the covered column of a wrap (carve#6712)', () => {
  it('records col on every wrap of a two-column cell, sorted by line, then col', () => {
    expect(places('| a | < |\n+ | b |\n+ e | |\n')).toEqual([[1, 1, 4], [2, 0, 2]])
    expect(places('| a | < |\n+ b | c |\n')).toEqual([[1, 0, 2], [1, 1, 4]])
  })

  it('counts the column from the cell\'s own, also behind a cell of its row', () => {
    expect(places('| x | a | < | < |\n+ | | y | z |\n+ | q | | |\n')).toEqual([[1, 1, 4], [1, 2, 6], [2, 0, 2]])
  })

  it('records no col for a cell of one column', () => {
    expect(wraps('| a | b |\n+ c | d |\n').every((wrap) => wrap.col === undefined)).toBe(true)
  })

  it('writes each fragment back under its column', () => {
    for (const src of [
      '| a | < |\n+ | b |\n+ e | |\n',
      '| a | < |\n+ b | c |\n',
      '| a | < |\n+ b | c |\n+ d | e |\n',
      '| a | < | < |\n+ x | y | z |\n+ | q | |\n',
      '> | x | a | < |\n> + | | b |\n> + c | e | |\n',
    ]) expect(format(src)).toBe(src)
  })

  it('refuses wraps of one line that are not sorted by col (C2-L-058)', () => {
    const { layout } = parseWithLayout('| a | < |\n+ b | c |\n')
    const node = layout.nodes.find((entry) => entry.wraps !== undefined)!
    node.wraps = [node.wraps![1]!, node.wraps![0]!]
    expect(() => validateLayout(layout)).toThrow(/sorted by col/u)
  })

  it('writes a record whose col does not fit the cell on one line, reading back to the tree', () => {
    const src = '| a | < |\n+ | b |\n+ e | |\n'
    const { document, layout } = parseWithLayout(src)
    const node = layout.nodes.find((entry) => entry.wraps !== undefined)!
    node.wraps = node.wraps!.map((wrap) => ({ ...wrap, col: 2 }))
    const written = write(document, { layout })
    expect(written.split('\n')[0]).toBe('| a e b | < |')
    expect(treesEqual(parse(written), parse(src))).toBe(true)
  })
})
