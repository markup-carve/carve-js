// The decided cases of the three-way check of the 0.2 engines, read from a data file any engine can run:
// input, render options, expected HTML and the expected children of the document without positions.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { encodeTree, parseTree, render, resolveTree } from '../src/index.ts'

interface ClauseCase {
  id: string
  clauses: string[]
  input: string
  options: Record<string, unknown>
  html: string
  tree: unknown[]
}

const FILE = join(import.meta.dirname, 'fixtures/clause-cases.json')
const { cases } = JSON.parse(readFileSync(FILE, 'utf8')) as { cases: ClauseCase[] }
const withoutPositions = (value: unknown): unknown => JSON.parse(JSON.stringify(value, (key, field: unknown) => key === 'pos' ? undefined : field))

describe('the clause cases of fixtures/clause-cases.json', () => {
  it('holds the 45 decided cases, each with a clause', () => {
    expect(cases).toHaveLength(45)
    for (const entry of cases) expect(entry.clauses.length).toBeGreaterThan(0)
  })

  for (const entry of cases) {
    it(`${entry.clauses.join(', ')}: case ${entry.id}`, () => {
      expect(render(entry.input, entry.options)).toBe(entry.html)
      const document = resolveTree(parseTree(entry.input), entry.options).document
      expect((withoutPositions(JSON.parse(encodeTree(document))) as { children: unknown[] }).children).toEqual(entry.tree)
    })
  }
})
