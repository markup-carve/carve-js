import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { lintCarve } from '../src/lint.js'

interface Finding { line: number; column: number; includes: string[] }
interface Vector { name: string; source: string; expected: { findings: Finding[] } }
const { vectors } = JSON.parse(readFileSync(new URL('./fixtures/description-separator-below-content-column.json', import.meta.url), 'utf8')) as { vectors: Vector[] }
const rule = 'description-separator-below-content-column'
const findings = (source: string) => lintCarve(source).filter(warning => warning.rule === rule)

describe(rule, () => {
  it.each(vectors)('$name', ({ name, source, expected }) => {
    const warnings = lintCarve(source)
    const actual = warnings.filter(warning => warning.rule === rule)
    expect(actual).toHaveLength(expected.findings.length)
    expected.findings.forEach((finding, index) => {
      expect(actual[index]).toMatchObject({ line: finding.line, column: finding.column })
      for (const phrase of finding.includes) expect(actual[index]!.message).toContain(phrase)
    })
    // These vectors already trigger list-item-block-overindented on origin/main.
    if (name !== 'within-description' && name !== 'correct-document') expect(warnings).toEqual(actual)
  })

  it.each([
    ['CRLF', '- a\r\n  :: term\r\n : detail\r\n', 3, 2, ':', 2],
    ['tab', '- a\n\t:: term\n : detail\n', 3, 2, ':', 4],
    ['quote', '> - a\n>   :: term\n>  : detail\n', 3, 4, ':', 4],
    ['quoted blank', '> - a\n>   :: term\n>\n>  : detail\n', 4, 4, ':', 4],
    ['term marker', '- a\n  :: term\n :: next\n', 3, 2, '::', 2],
  ])('%s marker range', (_name, source, line, column, marker, target) => {
    const actual = findings(source as string)
    expect(actual).toHaveLength(1)
    const warning = actual[0]!
    expect(warning).toMatchObject({ line, column })
    expect(warning.message).toContain(`column ${target}`)
    expect((source as string).slice(warning.start, warning.end)).toBe(marker)
    expect(warning.end - warning.start).toBe((marker as string).length)
  })

  it.each([
    '- a\n  :: term\n \\: detail\n',
    '- a\n  :: term\n ::: note\n',
    '- a\n  :: term\n  ```\n  : detail\n  ```\n',
  ])('ignores literal and payload lines', source => {
    expect(findings(source)).toEqual([])
  })
})
