import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { lintCarve } from '../src/lint.js'

// carve#4849 (A'): raw-block-syntax retires; fence-title-syntax suggests the raw opener.
const vectors = JSON.parse(
  readFileSync(resolve(process.cwd(), 'spec/tests/lint-rule-vectors/fence-title-syntax.json'), 'utf8'),
) as { vectors: Array<{ name: string; source: string; expected: { findings: Array<{ line: number; column: number; includes?: string[] }> } }> }

describe('fence-title-syntax shared vectors', () => {
  for (const vector of vectors.vectors) {
    it(vector.name, () => {
      const all = lintCarve(vector.source)
      const findings = all.filter((w) => w.rule === 'fence-title-syntax')
      expect(findings.map((w) => [w.line, w.column])).toEqual(
        vector.expected.findings.map((f) => [f.line, f.column]),
      )
      vector.expected.findings.forEach((f, i) => {
        for (const phrase of f.includes ?? []) expect(findings[i]!.message).toContain(phrase)
      })
      expect(all.map((w) => w.rule)).not.toContain('raw-block-syntax')
    })
  }
})

describe('legacy raw fence hint', () => {
  const variants: string[] = []
  for (const run of ['```', '````', '~~~']) {
    for (const space of ['', ' ']) {
      for (const format of ['html', 'latex', 'docbook', 'x_y-z']) {
        for (const host of ['', '> ', '- ', '1. ', '> > ', '- > ']) {
          variants.push(`${host}${run}${space}raw ${format}\n`)
        }
      }
    }
  }

  it.each(variants)('suggests the raw opener with the format word: %j', (source) => {
    const findings = lintCarve(source).filter((w) => w.rule === 'fence-title-syntax')
    expect(findings).toHaveLength(1)
    const m = /(`{3,}|~{3,}) ?raw (\S+)/.exec(source)!
    expect(findings[0]!.message).toContain(`${m[1]}=${m[2]}`)
    expect(lintCarve(source).map((w) => w.rule)).not.toContain('raw-block-syntax')
  })

  it('keeps the generic message for other recovered languages', () => {
    const [finding] = lintCarve('```js html\nx\n```\n').filter((w) => w.rule === 'fence-title-syntax')
    expect(finding!.message).not.toContain('=html')
  })
})
