// The range of a carrier or denied-destination loss is found from the node start; it used to measure the whole
// prefix of the source for every loss, which made a document with many of them quadratic.
import { describe, expect, it } from 'vitest'
import { renderWithDiagnostics } from '../src/index.ts'
import { expectBuiltInputScansLinearly, perfIt } from './helpers/scaling.ts'

const ranges = (src: string) => renderWithDiagnostics(src, { roundtrip: true }).diagnostics.map(d => [d.code, d.range])

describe('render loss ranges', () => {
  it('are byte offsets behind non-ASCII text', () => {
    expect(ranges('é€😀 [t]{data-carve-ref=x} [u](data:x)\n')).toEqual([
      ['carrier-attribute-dropped', { startOffset: 14, endOffset: 30 }],
      ['destination-denied', { startOffset: 36, endOffset: 42 }],
    ])
  })

  it('hold when notes are written in another order than their source', () => {
    expect(ranges('a[^2] b[^1]\n\n[^1]: é [t]{data-carve-ref=x}\n\n[^2]: 😀 [u]{data-carve-ref=y}\n')).toEqual([
      ['carrier-attribute-dropped', { startOffset: 60, endOffset: 76 }],
      ['carrier-attribute-dropped', { startOffset: 26, endOffset: 42 }],
    ])
  })

  perfIt('scale linearly on many carrier losses', () => {
    expectBuiltInputScansLinearly(source => { renderWithDiagnostics(source, { roundtrip: true, maxLosses: 1e9 }) },
      count => '<https://x.y>{data-carve-autolink=1} [t](data:x)\n\n'.repeat(count), { label: 'carrier losses', smallRepeats: 1_000 })
  })
})
