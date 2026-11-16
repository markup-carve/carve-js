import { describe, expect, it } from 'vitest'
import { render } from '../../v2/src/index.ts'
import { importDocument } from '../src/index.ts'

/** Four shapes of a `roundtrip` render, each holding `n` repeats. */
const SHAPES: readonly [string, (n: number) => string][] = [
  ['flat paragraphs with references', n => Array.from({ length: n }, (_, i) => `See [a][r] and <https://x.y/${i}>.\n`).join('\n') +
    '\n[r]: /u\n'],
  ['footnotes and inline footnotes', n => Array.from({ length: n }, (_, i) => `a[^n${i}] and b^[inline ${i}].\n\n[^n${i}]: Note.\n`)
    .join('\n')],
  ['nested lists', n => Array.from({ length: n }, (_, i) => `- a ${i}\n  - b\n    - c\n`).join('')],
  ['tables with aligned cells', n => `|= a |={>} b |\n${Array.from({ length: n }, (_, i) => `| ${i} |{^} x |\n`).join('')}`],
]

function best(html: string): number {
  let fastest = Number.POSITIVE_INFINITY
  for (let round = 0; round < 5; round++) {
    const start = performance.now()
    importDocument(html, { from: 'html' })
    fastest = Math.min(fastest, performance.now() - start)
  }
  return fastest
}

describe('C2-H-182 import time grows linearly with the input', () => {
  it.each(SHAPES)('C2-H-182 doubling a render of %s at most triples the import time', (_name, shape) => {
    const small = render(shape(1000), { roundtrip: true })
    const large = render(shape(2000), { roundtrip: true })
    best(small)
    expect(best(large) / best(small)).toBeLessThan(3)
  })
})
