// carve#6848: the authored-block fallback of C2-W-088 under `normalize` (C2-W-127) and with CR in its slice.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { formatWithDiagnostics } from '../src/index.ts'

const cases = (JSON.parse(readFileSync(new URL('../data/conformance/clause-cases.json', import.meta.url), 'utf8')) as {
  cases: { id: string, input: string, expected: { carve?: string } }[]
}).cases

function caseOf(id: string): { input: string, expected: string } {
  const found = cases.find((entry) => entry.id === id)!
  return { input: found.input, expected: found.expected.carve! }
}

describe('C2-W-088: the authored-block fallback', () => {
  it('C2-W-127: runs under normalize for every clause case of the fallback', () => {
    for (const id of ['CC-2323', 'CC-2426', 'CC-2427', 'CC-2429', 'CC-2430', 'CC-2431', 'CC-2432']) {
      const { input, expected } = caseOf(id)
      const result = formatWithDiagnostics(input, { normalize: true })
      expect(result.source, id).toBe(expected)
      expect(result.diagnostics, id).toEqual([])
    }
  })

  it('C2-B-010: a CR that other content follows on its line is written in the authored slice', () => {
    const input = caseOf('CC-2323').input.replace('/u\n', '/u\rz\n')
    const result = formatWithDiagnostics(input)
    expect(result.source).toBe(input)
    expect(result.diagnostics).toEqual([])
  })

  it('C2-W-016: a lone CR at the end of a line keeps its refusal', () => {
    const input = caseOf('CC-2323').input.replace('/u\n', '/u\r \n')
    expect(formatWithDiagnostics(input).diagnostics.map((entry) => entry.code)).toContain('field-unspellable')
  })
})
