import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { lintCarve } from '../src/lint.js'

interface Vector { name: string; resolver: 'virtual' | 'none'; entry: string; files?: Record<string, string>; expected: { findings: unknown[] } }
const suite = JSON.parse(readFileSync(new URL('../spec/tests/lint-include-conformance/vectors.json', import.meta.url), 'utf8')) as { sourcePath: string; vectors: Vector[] }
const order = (a: { file: string; line: number; column: number; rule: string }, b: { file: string; line: number; column: number; rule: string }): number =>
  a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column || a.rule.localeCompare(b.rule)

describe('lint include conformance', () => {
  for (const vector of suite.vectors) it(vector.name, () => {
    const includes = vector.resolver === 'virtual'
      ? { resolve: (path: string) => vector.files?.[path] ?? null, sourcePath: suite.sourcePath }
      : undefined
    const actual = lintCarve(vector.entry, includes ? { includes } : {}).map(w => ({
      rule: w.rule, file: w.file ?? suite.sourcePath, line: w.line, column: w.column,
      ...(w.includedBy ? { includedBy: w.includedBy.map(site => ({ file: site.file, line: site.line, column: site.column })) } : {}),
    })).sort(order)
    expect(actual).toEqual([...vector.expected.findings].sort(order as (a: unknown, b: unknown) => number))
  })
})

describe('lint include offsets', () => {
  it('measures a sliced child finding in UTF-16 of the included file', () => {
    const part = '\u{1F600}\r\n%% #region r\n>q\n%% #endregion\n'
    const [finding] = lintCarve('{{ part.crv @region:r }}\n', { includes: { resolve: () => part, sourcePath: 'doc.crv' } })
    expect(finding).toMatchObject({ file: 'part.crv', line: 3, column: 1 })
    expect(part.slice(finding!.start, finding!.start + 2)).toBe('>q')
  })

  it('spans the whole offending record line of a payload finding', () => {
    const csv = 'a,b\nc,d\n"x"y\n'
    const [finding] = lintCarve('{table}\n{{ data.csv @code:csv }}\n', { includes: { resolve: () => csv, sourcePath: 'doc.crv' } })
    expect(finding).toMatchObject({ rule: 'delimited-table-malformed', line: 3 })
    expect(csv.slice(finding!.start, finding!.end)).toBe('"x"y\n')
  })
})
