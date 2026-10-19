import { describe, expect, it } from 'vitest'
import { expandIncludes, lintCarve, parse } from '../src/index.js'

const files: Record<string, string> = { 'block.crv': '# H\n\nPara.\n', 'part.crv': 'a {{ gone.crv }} b\n' }
const resolve = (path: string): string | null => files[path] ?? null

function expand(source: string) {
  return expandIncludes(parse(source, { positions: true }), source, { resolve, sourcePath: 'doc.crv' })
}

// carve-js#3254: a directive that is not the first thing on its line reports
// its own column, not the column of the text node it starts in.
describe('a mid-line include directive', () => {
  it.each([
    ['unresolved', 'Some text {{ missing.crv }} more text.\n', 'include-unresolved', 11],
    ['block in inline', 'Some text {{ block.crv }} more text.\n', 'include-block-in-inline', 11],
    ['after inline markup', 'Some *é* text {{ missing.crv #a #b }} more.\n', 'include-selection-conflict', 15],
  ])('reports %s at the directive', (_label, source, rule, column) => {
    const [warning] = expand(source).warnings
    expect(warning).toMatchObject({ rule, line: 1, column })
    expect([...source].slice(warning!.start, warning!.end).join('')).toMatch(/^\{\{.*\}\}$/)
    expect(lintCarve(source, { includes: { resolve, sourcePath: 'doc.crv' } })).toMatchObject([{ rule, line: 1, column }])
  })

  it('names the directive column in the include chain', () => {
    const [finding] = lintCarve('Intro {{ part.crv }} end.\n', { includes: { resolve, sourcePath: 'doc.crv' } })
    expect(finding).toMatchObject({ rule: 'include-unresolved', file: 'part.crv', line: 1, column: 3 })
    expect(finding!.includedBy).toMatchObject([{ file: 'doc.crv', line: 1, column: 7 }])
  })
})
