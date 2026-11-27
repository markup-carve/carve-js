import { describe, expect, it } from 'vitest'
import { upgrade } from '../src/index.ts'

const unrelated = '~~~ js "a`b"\nx\n~~~\n'

describe('C2-I-090, U-073: a sigil form after a letter or number explains its HTML difference', () => {
  it.each([
    'café#tag\n',
    'see config:items[0] and :smile: and x:smile:, and café#tag\n',
    'mail café@user and x\n',
    'x:foo["q"]\n',
    'x é#a and é@b y\n',
  ])('%j', (source) => {
    const result = upgrade(source)
    expect(result.output).toBe(source)
    expect(result.check).toBe('explained')
    const reports = result.records.filter((record) => record.entry === 'U-073')
    expect(reports.length).toBeGreaterThan(0)
    for (const report of reports) {
      expect(report.class).toBe('report')
      expect(report.lint).toBe('sigil-after-letter')
    }
  })

  it('does not hide an unrelated difference', () => {
    const result = upgrade('café#tag\n\n' + unrelated)
    expect(result.check).toBe('mismatch')
    expect(result.records.map((record) => record.entry)).toContain('upgrade-mismatch')
  })
})

describe('C2-W-156: a record names the rule of its entry that fires on its line', () => {
  it.each([
    ['U-023', '- item text\n 3. child\n', 'list-marker-without-blank-line'],
    ['U-037', '```js{1,3}\na\n```\n', 'fence-title-syntax'],
    ['U-128', ' :: t\n: x', 'description-separator-below-content-column'],
    ['U-131', '* [d]:', 'empty-reference-definition'],
    ['U-132', '[r]:', 'empty-reference-definition'],
    ['U-134', '> [f]:', 'empty-reference-definition'],
    ['U-044', 'para\n\n---\n', 'thematic-break-spelling'],
  ])('%s %j', (entry, source, rule) => {
    const records = upgrade(source).records.filter((record) => record.entry === entry)
    expect(records.length).toBeGreaterThan(0)
    for (const record of records) expect(record.lint).toBe(rule)
  })

  it('keeps the first rule when no rule of the entry fires', () => {
    const record = upgrade('1. outer\n  1. inner\n').records.find((item) => item.entry === 'U-023')
    expect(record?.lint).toBe('list-marker-below-content-column')
  })

  it('takes the finding nearest the record line', () => {
    const records = upgrade('```js{1,3}\na\n```\n\n- item text\n 3. child\n').records
    expect(records.find((record) => record.entry === 'U-037')?.lint).toBe('fence-title-syntax')
    expect(records.find((record) => record.entry === 'U-023')?.lint).toBe('list-marker-without-blank-line')
  })
})
