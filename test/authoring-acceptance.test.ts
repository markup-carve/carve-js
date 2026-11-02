import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { lintCarve } from '../src/lint.js'
import { djotMigrationWarnings } from '../src/djot-migrate.js'
import { run, type CliIO } from '../src/cli.js'

const root = resolve(process.cwd(), 'spec')
const expected = JSON.parse(readFileSync(resolve(root, 'tests/lint-authoring/expectations.json'), 'utf8')) as {
  cases: Array<{ file: string; expected: Array<[string, number]>; optInAheadOfPin?: Array<[string, number]> }>
}
const pairs = (rows: Array<{ rule: string; line: number }>): Array<[string, number]> =>
  rows.map(row => [row.rule, row.line] as [string, number]).sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
const newRules = new Set([
  'table-shaped-paragraph', 'table-row-cell-count', 'table-separator-near-miss',
  'list-marker-without-blank-line', 'unclosed-inline-emphasis', 'link-gap-before-destination',
  'markdown-italic-underline', 'heading-level-skip', 'bare-html-tag',
  'markdown-definition-paragraph', 'github-alert-marker', 'caption-looking-paragraph',
  'setext-heading-underline', 'heading-closing-hashes', 'indented-code-block',
])

describe('authoring acceptance suite', () => {
  it('enables caption hints through the CLI only when requested', async () => {
    const source = '|= A |\n| x |\n\nTable 1: caption\n'
    let output = ''
    const io: CliIO = {
      readStdin: async () => source, readFile: () => source, writeFile: () => {},
      write: value => { output += value }, writeErr: () => {},
    }
    expect(await run(['lint'], io)).toBe(0)
    expect(output).toBe('')
    expect(await run(['lint', '--caption-hints'], io)).toBe(1)
    expect(output).toContain('caption-looking-paragraph')
  })
  for (const entry of expected.cases) {
    it(entry.file, () => {
      const source = readFileSync(resolve(root, 'tests/lint-authoring', entry.file), 'utf8')
      const actual = pairs([
        ...djotMigrationWarnings(source).filter(warning => warning.category === 'carve-breakage'),
        ...lintCarve(source),
      ])
      expect(actual).toEqual(pairs(entry.expected.map(([rule, line]) => ({ rule, line }))))
      if (entry.optInAheadOfPin?.length) {
        const optIn = pairs(lintCarve(source, { captionLookingParagraph: true })
          .filter(warning => warning.rule === 'caption-looking-paragraph'))
        expect(optIn).toEqual(pairs(entry.optInAheadOfPin.map(([rule, line]) => ({ rule, line }))))
      }
    })
  }

  for (const file of readdirSync(resolve(root, 'tests/lint-rule-vectors')).filter(name => name.endsWith('.json'))) {
    const data = JSON.parse(readFileSync(resolve(root, 'tests/lint-rule-vectors', file), 'utf8')) as {
      rule: string; vectors: Array<{ name: string; source: string; expected: {
        findings: Array<{ line: number; column: number; includes?: string[] }>
      } }>
    }
    if (!newRules.has(data.rule)) continue
    for (const vector of data.vectors) {
      it(`${data.rule}: ${vector.name}`, () => {
        const findings = lintCarve(vector.source, { captionLookingParagraph: data.rule === 'caption-looking-paragraph' })
          .filter(warning => warning.rule === data.rule)
        const actual = findings.map(warning => [warning.line, warning.column])
        expect(actual).toEqual(vector.expected.findings.map(finding => [finding.line, finding.column]))
        vector.expected.findings.forEach((finding, index) => {
          expect(findings[index]!.message.length).toBeGreaterThan(0)
          for (const phrase of finding.includes ?? []) expect(findings[index]!.message).toContain(phrase)
        })
      })
    }
  }
})
