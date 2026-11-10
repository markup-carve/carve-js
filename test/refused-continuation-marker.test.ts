import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { lintCarve } from '../src/lint.js'

interface Vector {
  name: string
  source: string
  expected: { findings: Array<{ line: number; column: number; includes: string[] }> }
}
const { vectors } = JSON.parse(readFileSync(new URL('../spec/tests/lint-rule-vectors/refused-continuation-marker.json', import.meta.url), 'utf8')) as { vectors: Vector[] }

describe('refused-continuation-marker', () => {
  it.each(vectors)('$name', ({ source, expected }) => {
    const findings = lintCarve(source).filter(warning => warning.rule === 'refused-continuation-marker')
    expect(findings.map(({ line, column }) => ({ line, column }))).toEqual(
      expected.findings.map(({ line, column }) => ({ line, column })),
    )
    expected.findings.forEach(({ includes }, index) => {
      for (const phrase of includes) expect(findings[index]?.message).toContain(phrase)
    })
  })
})
