import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { lintCarve } from '../src/lint.js'

interface Vector { name: string; source: string; expected: { findings: Array<{ line: number; column: number; includes: string[] }> } }
const { vectors } = JSON.parse(readFileSync(new URL('./fixtures/list-marker-below-content-column.json', import.meta.url), 'utf8')) as { vectors: Vector[] }

const findings = (source: string) => lintCarve(source).filter(w => w.rule === 'list-marker-below-content-column')

describe('list-marker-below-content-column vectors', () => {
  it.each(vectors)('$name', ({ source, expected }) => {
    const actual = findings(source)
    expect(actual).toHaveLength(expected.findings.length)
    expected.findings.forEach((finding, index) => {
      expect(actual[index]).toMatchObject({ line: finding.line, column: finding.column })
      for (const phrase of finding.includes) expect(actual[index]!.message).toContain(phrase)
    })
  })

  it.each([
    ['CRLF', '10. c\r\n   - d\r\n', 2, 4],
    ['block quote', '> 10. c\n>    - d\n', 2, 6],
    ['tab indent', '100. c\n\t- d\n', 2, 2],
    ['task item', '10. c\n   - [ ] d\n', 2, 4],
    ['alpha marker', '10. c\n   a.  d\n', 2, 4],
    ['after a blank, CRLF', '10. c\r\n\r\n   - d\r\n', 3, 4],
    ['after a blank, block quote', '> 10. c\n>\n>    - d\n', 3, 6],
    ['after a blank, tab indent', '100. c\n\n\t- d\n', 3, 2],
    ['after a blank, alpha marker', '10. c\n\n   a.  d\n', 3, 4],
  ])('%s', (_name, source, line, column) => {
    expect(findings(source as string)).toMatchObject([{ line, column }])
  })

  it.each(['10. c\n\n   `a\n   - d`\n', '10. c\n\n   %% x\n   - d\n'])
    ('ignores an after-blank line that is no detached list', source => {
      expect(findings(source)).toEqual([])
    })

  it.each(['10. c\n\t- d\n', '> 10. c\n> \t- d\n', 'x[^a]\n\n[^a]: note\n   - d\n', ':: term\n: description\n   - d\n'])
    ('ignores a line outside the item content-column gap', source => {
      expect(findings(source)).toEqual([])
    })
})
