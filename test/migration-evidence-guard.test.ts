import { afterEach, expect, it, vi } from 'vitest'
import * as markdown from '../src/markdown-migrate.js'
import { migrateMarkdown } from '../src/migration.js'

afterEach(() => vi.restoreAllMocks())

it('does not verify literal source when the importer changes its value', () => {
  vi.spyOn(markdown, 'markdownToCarveWithLosses').mockReturnValue({ value: 'changed', losses: [] })
  expect(migrateMarkdown('hello').report.diagnostics.map(row => row.code)).toEqual(['fidelity-unverified'])
})

it('does not verify literal source when the importer reports a known loss', () => {
  vi.spyOn(markdown, 'markdownToCarveWithLosses').mockReturnValue({
    value: 'hello', losses: [{ code: 'structure-unspellable', message: 'Known loss' }],
  })
  expect(migrateMarkdown('hello').report.diagnostics.map(row => row.code)).toEqual([
    'fidelity-unverified', 'structure-unspellable',
  ])
})
