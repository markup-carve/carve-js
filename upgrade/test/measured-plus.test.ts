import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { upgrade } from '../src/index.ts'

interface Fixture {
  cause: string
  entry: string
  path: string
  line: number
  input: string
}

const fixtures = JSON.parse(readFileSync(join(import.meta.dirname, 'measured-plus.json'), 'utf8')) as Fixture[]
const clauses: Record<string, string> = {
  C19: 'C2-B-056 C2-B-059',
  C16: 'C2-B-059 C2-B-076',
  C17: 'C2-B-059 C2-B-087',
  C18: 'C2-B-032 C2-B-059',
}

describe('measured continuation causes', () => {
  for (const fixture of fixtures) {
    it(`${clauses[fixture.cause]} ${fixture.cause} ${fixture.path}:${fixture.line}`, () => {
      const result = upgrade(fixture.input)
      expect(result.check).toBe('pass')
      expect(result.records.map((record) => record.entry)).toContain(fixture.entry)
    })
  }
})
