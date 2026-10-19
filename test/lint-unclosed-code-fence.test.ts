import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { lintCarve } from '../src/lint.js'

interface Vector { name: string; source: string; expected: { findings: Array<{ line: number; column: number; includes: string[] }> } }
const { vectors } = JSON.parse(readFileSync(new URL('./fixtures/unclosed-code-fence.json', import.meta.url), 'utf8')) as { vectors: Vector[] }

describe('unclosed-code-fence vectors', () => {
  it.each(vectors)('$name', ({ source, expected }) => {
    const findings = lintCarve(source).filter(w => w.rule === 'unclosed-code-fence')
    expect(findings).toHaveLength(expected.findings.length)
    expected.findings.forEach((finding, index) => {
      expect(findings[index]).toMatchObject({ line: finding.line, column: finding.column })
      for (const phrase of finding.includes) expect(findings[index]!.message).toContain(phrase)
    })
  })
})
