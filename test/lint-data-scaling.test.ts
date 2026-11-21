// The lint data model trims trailing spaces and tabs by a scan from the end: an end-anchored /[ \t\r]+$/ retries
// from every character of a run that text follows, which made lint quadratic on a div opener line of tabs.
import { describe, expect, it } from 'vitest'
import { lint } from '../src/index.ts'
import { expectBuiltInputScansLinearly, perfIt } from './helpers/scaling.ts'
import { TableLines } from '../lint/data-table.ts'

const codes = (source: string) => lint(source, {}).map(d => `${d.code}@${d.range?.startOffset}-${d.range?.endOffset}`)

describe('lint data model on opener lines', () => {
  it('reads an opener with trailing spaces and tabs as before', () => {
    expect(codes('::: d \t\r\nx\n:::\n')).toEqual(codes('::: d\nx\n:::\n'))
  })

  perfIt('scales linearly on a div opener line of tabs before text', () => {
    expectBuiltInputScansLinearly(source => { lint(source, {}) }, count => `::: d${'\t'.repeat(count)}x\n:::\n`,
      { label: 'div opener tabs', smallRepeats: 2_000 })
  })
})

// A line maps to its pipe table by an index built once, not by a scan over the tables per lookup.
describe('lint data model on tables', () => {
  perfIt('scales linearly on the table of every line of many pipe tables', () => {
    const body = { raw_body: '| a |' }
    expectBuiltInputScansLinearly(source => {
      const tables: [number, number, string][] = Array.from(source, (_, at) => [at, at, `/children/${at}`])
      const lines = new TableLines(tables, { count: source.length, at: () => body })
      for (let at = 0; at < source.length; at++) lines.pathOf(at)
    }, count => 'x'.repeat(count), { label: 'pipe tables', smallRepeats: 5_000 })
  })
})
