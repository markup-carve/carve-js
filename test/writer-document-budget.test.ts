// C2-W-133: the repairs of all groups of a document draw on one budget of parsed characters.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { type DocumentNode, formatWithDiagnostics, parse, treesEqual } from '../src/index.ts'

const source = readFileSync(join(import.meta.dirname, 'fixtures', 'writer-document-budget.crv'), 'utf8')

describe('the writer repair budget of a document', () => {
  it('C2-W-088, C2-W-133: three quotes complete within the shared budget after round repairs (CC-1493)', () => {
    const result = formatWithDiagnostics(source)
    expect(result.diagnostics).toEqual([])
  }, 120_000)

  it('C2-W-133: the first quote alone is written without refusal', () => {
    const result = formatWithDiagnostics(`${source.split('\n\n')[0]!}\n`)
    expect(result.diagnostics).toEqual([])
  }, 120_000)
})

/** Colon fence openers, each one colon shorter than the one before, a body line and the closers (#5283). */
function nestedFences(n: number): string {
  const open = Array.from({ length: n }, (_, k) => ':'.repeat(n + 3 - k))
  return `${[...open, '+', '', ...[...open].reverse()].join('\n')}\n`
}

describe('the writes of the repair rounds', () => {
  it('C2-W-133: a repair under the parse budget is not refused for what its rounds wrote', () => {
    const source = nestedFences(560)
    const result = formatWithDiagnostics(source)
    expect(result.diagnostics).toEqual([])
    expect(parse(result.source)).toSatisfy((tree: DocumentNode) => treesEqual(tree, parse(source)))
  }, 120_000)
})
