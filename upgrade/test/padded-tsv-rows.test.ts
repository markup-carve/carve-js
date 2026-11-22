import { describe, expect, it } from 'vitest'
import { canWriteUpgrade, upgrade } from '../src/index.ts'

const cases = [
  ['{table header-rows=0}\n```tsv\n```tsv\nA\tB\n^\t<x>\n```\n',
    '{table header-rows=0}\n```tsv\n```tsv\t\nA\tB\n^\t<x>\n```\n'],
  ['{table header-rows=0}\n\n```tsv\nA\tBB\n\t^\t<x>\n\t```\n',
    '{table header-rows=0}\n````tsv\nA\tBB\t\n\t^\t<x>\n\t```\t\n````\n'],
] as const

describe('old TSV table padding', () => {
  it.each(cases)('writes the old table cells for %j', (source, output) => {
    const result = upgrade(source)
    expect(result.output).toBe(output)
    expect(result.check).toBe('pass')
    expect(canWriteUpgrade(result)).toBe(true)
  })
})
