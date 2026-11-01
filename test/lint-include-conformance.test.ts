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
  it('uses UTF-16 for include warnings and every site in a nested chain', () => {
    const root = '😀😀 {{ part.crv }}\n'
    const part = '😀 {{ absent.crv }}\n'
    const [finding] = lintCarve(root, { includes: { resolve: path => path === 'part.crv' ? part : null, sourcePath: 'root.crv' } })
    expect(finding).toMatchObject({ rule: 'include-unresolved', file: 'part.crv' })
    expect(part.slice(finding!.start, finding!.end)).toBe('{{ absent.crv }}')
    expect(root.slice(finding!.includedBy![0]!.start, finding!.includedBy![0]!.end)).toBe('{{ part.crv }}')
  })

  it('uses UTF-16 for an unresolved directive in the root', () => {
    const source = '😀😀 {{ absent.crv }}\n'
    const [finding] = lintCarve(source, { includes: { resolve: () => null } })
    expect(source.slice(finding!.start, finding!.end)).toBe('{{ absent.crv }}')
  })

  it('accepts cross-references to included headings', () => {
    const source = '# T\n\n{{ part.crv }}\n\nSee </#Inc>.\n'
    const findings = lintCarve(source, { includes: { resolve: path => path === 'part.crv' ? '# Inc\n\nBody.\n' : null } })
    expect(findings.some(finding => finding.rule === 'broken-crossref')).toBe(false)
    expect(lintCarve(source).some(finding => finding.rule === 'broken-crossref')).toBe(true)
  })

  it('accepts cross-references to numbered captions supplied by includes', () => {
    const source = 'See </#fig>.\n\n{{ part.crv }}\n'
    const part = '{#fig}\n![x](x.jpg)\n^ Figure #: A\n'
    const findings = lintCarve(source, { includes: { resolve: path => path === 'part.crv' ? part : null } })
    expect(findings.some(finding => finding.rule === 'broken-crossref')).toBe(false)
  })

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
