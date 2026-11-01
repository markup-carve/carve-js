import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { lintCarve } from '../src/lint.js'

interface Vector { name: string; source: string; expected: { findings: Array<{ line: number; column: number; includes: string[] }> } }
const { vectors } = JSON.parse(readFileSync(new URL('./fixtures/continuation-marker-refused.json', import.meta.url), 'utf8')) as { vectors: Vector[] }

describe('continuation-marker-refused vectors', () => {
  it.each(vectors)('$name', ({ source, expected }) => {
    const findings = lintCarve(source).filter(w => w.rule === 'continuation-marker-refused')
    expect(findings).toHaveLength(expected.findings.length)
    expected.findings.forEach((finding, index) => {
      expect(findings[index]).toMatchObject({ line: finding.line, column: finding.column })
      for (const phrase of finding.includes) expect(findings[index]!.message).toContain(phrase)
    })
  })

  it('reports an unattached stacked first-block marker', () => {
    expect(lintCarve('* * +\n x\n').filter(w => w.rule === 'continuation-marker-refused')).toEqual([
      expect.objectContaining({ line: 1, column: 5, message: expect.stringContaining('left of its column') }),
    ])
  })

  it('reports a separate plus after a quote when a blank line follows', () => {
    const findings = lintCarve('> q\n+\n\npara\n').filter(w => w.rule === 'continuation-marker-refused')
    expect(findings).toEqual([
      expect.objectContaining({ line: 2, column: 1, message: expect.stringContaining('+') }),
    ])
  })

  it('handles trailing spaces and the end of a quote', () => {
    expect(lintCarve('> q\n+ \n\npara').filter(w => w.rule === 'continuation-marker-refused'))
      .toEqual([expect.objectContaining({ line: 2, column: 1, message: expect.stringContaining('blank line') })])
    expect(lintCarve('> q\n+').filter(w => w.rule === 'continuation-marker-refused'))
      .toEqual([expect.objectContaining({ line: 2, column: 1, message: expect.stringContaining('end of the document') })])
  })

  it('does not mistake glued markers for quote hosts', () => {
    for (const line of ['>= x', '>>= op', '>+', '>>+']) {
      // A document-level `+` is a letter under PART 0 S2, so it is quiet (carve#4648).
      expect(lintCarve(`${line}\n+\n\npara`).filter(w => w.rule === 'continuation-marker-refused')).toEqual([])
    }
  })
})
