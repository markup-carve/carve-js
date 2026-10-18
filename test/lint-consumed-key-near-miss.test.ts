import { describe, expect, it } from 'vitest'
import { lintCarve } from '../src/lint.js'

const warnings = (source: string) => lintCarve(source)
  .filter(warning => warning.rule === 'consumed-key-near-miss')

describe('consumed-key-near-miss', () => {
  it.each(['tabel', 'tables', 'Table'])('suggests table for %s on CSV', word => {
    const [warning] = warnings(`{${word}}\n\`\`\`csv\na,b\n1,2\n\`\`\`\n`)
    expect(warning?.message).toBe(`"${word}" is not a consumed key here; did you mean {table}?`)
  })

  it('suggests table on TSV and on a figure', () => {
    expect(warnings('{tabel}\n```tsv\na\tb\n```\n')).toHaveLength(1)
    expect(warnings('{tabel}\n```csv\na,b\n1,2\n```\n^ Caption\n')).toHaveLength(1)
  })

  it('suggests loose on lists and definition lists', () => {
    expect(warnings('{lose}\n- item\n')[0]?.message).toContain('{loose}')
    expect(warnings('{lose}\n:: term\n:  definition\n')).toHaveLength(1)
  })

  it('ignores distant, valued, correctly spelled, and unrelated attributes', () => {
    expect(warnings('{disabled}\n```csv\na,b\n1,2\n```\n')).toEqual([])
    expect(warnings('{tabel=foo}\n```csv\na,b\n1,2\n```\n')).toEqual([])
    expect(warnings('{table}\n```csv\na,b\n1,2\n```\n')).toEqual([])
    expect(warnings('{tabel}\n```js\ncode\n```\n')).toEqual([])
    expect(warnings('{lose}\nParagraph.\n')).toEqual([])
    expect(warnings('{tabel}\n- item\n')).toEqual([])
    expect(warnings('{lose}\n```csv\na,b\n1,2\n```\n')).toEqual([])
    expect(warnings('{close}\n- item\n')).toEqual([])
    expect(warnings('{tab}\n```csv\na,b\n1,2\n```\n')).toEqual([])
  })
})
