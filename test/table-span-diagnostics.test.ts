import { describe, expect, it } from 'vitest'
import { carveToHtml, djotMigrationWarnings, lintCarve, parse } from '../src/index.js'

const table = [
  '|= 2-col header|<|= header|',
  '|some long content|foo|bar|',
  '+and even more content|||',
  '|^|spans 4 cells|<|',
  '|^|^|<|',
].join('\n') + '\n'

describe('table span diagnostics', () => {
  it('accepts whole-cell span markers after a continuation row', () => {
    expect(parse(table).children[0]).toMatchObject({
      type: 'table',
      rows: [
        { cells: [{ header: true }, { span: 'colspan' }, { header: true }] },
        { continuationLines: 1 },
        { cells: [{ span: 'rowspan' }, {}, { span: 'colspan' }] },
        { cells: [{ span: 'rowspan' }, { span: 'rowspan' }, { span: 'colspan' }] },
      ],
    })
    expect(carveToHtml(table)).toContain('<td rowspan="3">some long content and even more content</td>')
    expect(lintCarve(table)).toEqual([])
    expect(djotMigrationWarnings(table).filter(w => w.rule === 'djot-superscript-caret')).toEqual([])
  })

  it('maps parser offsets after an astral character', () => {
    expect(djotMigrationWarnings(`😀\n\n${table}`).filter(w => w.rule === 'djot-superscript-caret')).toEqual([])
  })

  it('accepts span cells inside block quotes and list items', () => {
    for (const prefix of ['> ', '- ']) {
      const nested = table.trimEnd().split('\n').map(line => `${prefix}${line}`).join('\n') + '\n'
      expect(djotMigrationWarnings(nested).filter(w => w.rule === 'djot-superscript-caret')).toEqual([])
    }
  })

  it('still reports malformed alignment and real caret pairs', () => {
    expect(lintCarve('|<text|\n').map(w => w.rule)).toContain('table-marker-run-padding')
    expect(djotMigrationWarnings('|^a|b^|\n').map(w => w.rule)).toContain('djot-superscript-caret')
  })
})
