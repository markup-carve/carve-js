import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { lintCarve } from '../src/lint.js'

interface Vector { name: string; source: string; expected: { findings: Array<{ line: number; column: number; includes: string[] }> } }
const { vectors } = JSON.parse(readFileSync(new URL('./fixtures/ordered-list-split-by-indent.json', import.meta.url), 'utf8')) as { vectors: Vector[] }

const findings = (source: string) => lintCarve(source).filter(w => w.rule === 'ordered-list-split-by-indent')

describe('ordered-list-split-by-indent vectors', () => {
  it.each(vectors)('$name', ({ source, expected }) => {
    const actual = findings(source)
    expect(actual).toHaveLength(expected.findings.length)
    expected.findings.forEach((finding, index) => {
      expect(actual[index]).toMatchObject({ line: finding.line, column: finding.column })
      for (const phrase of finding.includes) expect(actual[index]!.message).toContain(phrase)
    })
  })

  it('says nothing about the second marker with CRLF', () => {
    expect(findings(' 9. nine\r\n10. ten\r\n')).toEqual([])
  })

  it('says nothing about the second marker inside a block quote', () => {
    expect(findings('>  9. nine\n> 10. ten\n')).toEqual([])
  })
})
