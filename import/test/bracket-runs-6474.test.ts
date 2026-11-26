import { describe, expect, it } from 'vitest'
import { parse } from '../../src/index.ts'
import { importDocument } from '../src/index.ts'
import { LINEARITY_LIMIT, linearityExcess } from '../../test/support/linearity.ts'

/** carve#6474: `n` brackets, a link and a pipe, a line break, `| x |` and `n` brackets more. */
const brackets = (n: number): string => `${'['.repeat(n)}x [[t](/v)]|\n| x |${'['.repeat(n)}a\n`

const shape = (source: string): unknown => JSON.parse(JSON.stringify(parse(source).children, (key, value: unknown) =>
  key === 'pos' ? undefined : value))

describe('carve#6474 Markdown import of long bracket runs around a link', () => {
  it('C2-H-182 importing runs past the depth cap four times as long takes about four times the work', () => {
    const small = brackets(400)
    const large = brackets(1600)
    const excess = linearityExcess(() => importDocument(small, { from: 'markdown' }), () => importDocument(large, { from: 'markdown' }), 4)
    expect(excess).toBeLessThan(LINEARITY_LIMIT)
  })

  it('keeps a short run as written', () => {
    expect(importDocument(brackets(8), { from: 'markdown' }).source).toBe(brackets(8))
  })

  it('C2-I-118 writes runs far past the depth cap without a loss, and the output reads as the Markdown link', () => {
    const result = importDocument(brackets(4000), { from: 'markdown' })
    expect(result.diagnostics).toEqual([])
    const run = '['.repeat(4000)
    expect(shape(result.source)).toEqual([{ type: 'paragraph', children: [
      { type: 'text', value: `${run}x [` },
      { type: 'link', href: '/v', children: [{ type: 'text', value: 't' }] },
      { type: 'text', value: ']|' },
      { type: 'soft_break' },
      { type: 'text', value: `| x |${run}a` },
    ] }])
  })
})
