// Lint time linear in the input on bracket runs, and link-gap-before-destination unchanged by its linear scan.
import { describe, expect, it } from 'vitest'
import { lint } from '../src/index.ts'
import { expectScansLinearly, perfIt } from './helpers/scaling.ts'

const gaps = (source: string) => lint(source, {})
  .filter(d => d.code === 'link-gap-before-destination')
  .map(d => [d.range!.startOffset, d.range!.endOffset])

describe('link-gap-before-destination', () => {
  it('reports the matches of its pattern, each from its first bracket', () => {
    expect(gaps('[a] (b)\n')).toEqual([[0, 7]])
    expect(gaps('[[a] (b)\n')).toEqual([[0, 8]])
    expect(gaps('[a] (b) [c]\t(d)\n')).toEqual([[0, 7], [8, 15]])
    expect(gaps('[a] ( ) [c] (d)\n')).toEqual([[8, 15]])
    expect(gaps('[a] (b [c] (d)\n')).toEqual([[0, 14]])
    expect(gaps('[] (b)\n')).toEqual([])
    expect(gaps('[a](b)\n')).toEqual([])
    expect(gaps('[a] (b\n')).toEqual([])
  })
})

describe('lint on bracket runs', () => {
  perfIt('scales linearly on open brackets', () => {
    expectScansLinearly(source => { lint(source, {}) }, '[', { label: 'open brackets', smallRepeats: 4_000 })
  })
  perfIt('scales linearly on gaps without a closing parenthesis', () => {
    expectScansLinearly(source => { lint(source, {}) }, '[a] (', { label: 'gaps', smallRepeats: 2_000 })
  })
})
