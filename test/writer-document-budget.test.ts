// C2-W-133: the repairs of all groups of a document draw on one budget of parsed characters.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { formatWithDiagnostics } from '../src/index.ts'

const source = readFileSync(join(import.meta.dirname, 'fixtures', 'writer-document-budget.crv'), 'utf8')

describe('the writer repair budget of a document', () => {
  it('C2-W-133: three quotes that each fit the floor share it, so the second and third are refused (CC-1493)', () => {
    const result = formatWithDiagnostics(source)
    expect(result.diagnostics.map((entry) => [entry.code, entry.path])).toEqual([
      ['writer-refused', '/children/1'],
      ['writer-refused', '/children/2'],
    ])
  }, 120_000)

  it('C2-W-133: the first quote alone is written without refusal', () => {
    const result = formatWithDiagnostics(`${source.split('\n\n')[0]!}\n`)
    expect(result.diagnostics).toEqual([])
  }, 120_000)
})
