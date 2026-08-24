import { describe, expect, it } from 'vitest'
import { migrateDjot, migrateHtml, migrateMarkdown } from '../src/index.js'

describe('shared migration result', () => {
  it('uses one result shape for every source format', () => {
    expect(migrateMarkdown('**strong**')).toMatchObject({
      value: '*strong*',
      report: { schemaVersion: 1, sourceFormat: 'markdown', diagnostics: [] },
    })
    expect(migrateDjot('_emphasis_')).toMatchObject({
      value: '/emphasis/',
      report: { schemaVersion: 1, sourceFormat: 'djot', diagnostics: [] },
    })
    expect(migrateHtml('<p>text</p>')).toMatchObject({
      value: 'text\n',
      report: { schemaVersion: 1, sourceFormat: 'html' },
    })
  })

  it('classifies HTML losses', () => {
    const result = migrateHtml('<p><kbd kbd=lit>text</kbd></p>')
    expect(result.report.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'attribute-dropped', fidelity: 'dropped', confidence: 'exact' }),
    )
  })
})
