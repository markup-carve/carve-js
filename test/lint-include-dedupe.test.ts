// carve-js#5514: with `includes`, lint dedupes repeated findings of a twice-included file, never distinct findings on one range.
import { describe, expect, it } from 'vitest'
import { lint } from '../src/index.ts'
import { includes } from './support/includes.ts'

const overlap = '{aligns=left,right}\n|={<} a |={>} b |\n'

describe('lint with includes keeps distinct findings on one range', () => {
  it('reports table-column-overlap once per column, as lint without includes does', () => {
    const plain = lint(overlap, {})
    expect(plain.filter((entry) => entry.code === 'table-column-overlap')).toHaveLength(2)
    expect(lint(overlap, { includes: includes({}) })).toEqual(plain)
  })

  it('keeps the per-column findings inside an included file', () => {
    const found = lint('{{ t.crv }}\n\n{{ t.crv }}\n', { includes: includes({ 't.crv': overlap }) })
      .filter((entry) => entry.code === 'table-column-overlap')
    expect(found.map((entry) => entry.file)).toEqual(['t.crv', 't.crv'])
    expect(new Set(found.map((entry) => entry.message)).size).toBe(2)
  })

  it('still reports a finding of a twice-included file once', () => {
    const found = lint('{{ a.crv }}\n\n{{ a.crv }}\n', { includes: includes({ 'a.crv': '**child**\n' }) })
      .filter((entry) => entry.code === 'markdown-strong-double-star')
    expect(found).toHaveLength(1)
    expect(found[0]!.file).toBe('a.crv')
  })
})
