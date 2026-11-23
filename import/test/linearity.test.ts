import { describe, expect, it } from 'vitest'
import { render } from '../../src/index.ts'
import { importDocument } from '../src/index.ts'
import { LINEARITY_LIMIT, linearityExcess } from '../../test/support/linearity.ts'

/** Four shapes of a `roundtrip` render, each holding `n` repeats. */
const SHAPES: readonly [string, (n: number) => string][] = [
  ['flat paragraphs with references', n => Array.from({ length: n }, (_, i) => `See [a][r] and <https://x.y/${i}>.\n`).join('\n') +
    '\n[r]: /u\n'],
  ['footnotes and inline footnotes', n => Array.from({ length: n }, (_, i) => `a[^n${i}] and b^[inline ${i}].\n\n[^n${i}]: Note.\n`)
    .join('\n')],
  ['nested lists', n => Array.from({ length: n }, (_, i) => `- a ${i}\n  - b\n    - c\n`).join('')],
  ['tables with aligned cells', n => `|= a |={>} b |\n${Array.from({ length: n }, (_, i) => `| ${i} |{^} x |\n`).join('')}`],
]

describe('C2-H-182 import time grows linearly with the input', () => {
  it.each(SHAPES)('C2-H-182 importing a render of %s eight times the size takes about eight times the work', (_name, shape) => {
    const small = render(shape(250), { roundtrip: true })
    const large = render(shape(2000), { roundtrip: true })
    const excess = linearityExcess(() => importDocument(small, { from: 'html' }), () => importDocument(large, { from: 'html' }), 8)
    expect(excess).toBeLessThan(LINEARITY_LIMIT)
  })
})

describe('C2-H-182 Markdown import time grows linearly with the input', () => {
  it('C2-H-182 importing quotes apart from each other eight times as many takes about eight times the work', () => {
    const small = '> a\n\n'.repeat(1000)
    const large = '> a\n\n'.repeat(8000)
    const excess = linearityExcess(() => importDocument(small, { from: 'gfm' }), () => importDocument(large, { from: 'gfm' }), 8)
    expect(excess).toBeLessThan(LINEARITY_LIMIT)
  })
})
