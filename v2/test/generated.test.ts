// The generated tables in src/ must match the data files they are written from, and the data
// files are copies of spec/0.2/data of the spec repository.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { generateAstTables } from '../scripts/generate-ast-tables.ts'
import { generateOptionTables } from '../scripts/generate-option-tables.ts'
import { generateTreeTables } from '../scripts/generate-tree-tables.ts'
import { generateCatalog } from '../lint/generate-catalog.ts'

const root = join(import.meta.dirname, '..')
const read = (path: string): string => readFileSync(join(root, path), 'utf8')

it('src/ast-tables.ts is what scripts/generate-ast-tables.ts writes', () => {
  expect(read('src/ast-tables.ts')).toBe(generateAstTables(read('data/ast-results.json'), read('data/node-slots.json')))
})

it('src/tree-tables.ts is what scripts/generate-tree-tables.ts writes', () => {
  expect(read('src/tree-tables.ts')).toBe(generateTreeTables(read('data/div-names.json'), read('data/task-states.json')))
})

it('src/option-tables.ts is what scripts/generate-option-tables.ts writes', () => {
  expect(read('src/option-tables.ts')).toBe(generateOptionTables(read('data/options.json')))
})

it('C2-W-106 lint/catalog.ts is generated from the specification table', () => {
  expect(read('lint/catalog.ts')).toBe(generateCatalog(read('data/lint-rules.json')))
})

// The spec checkout is the `spec` submodule, or the directory CARVE_SPEC_DIR names. Until its pin
// holds the 0.2 data files the comparison is skipped.
const specData = join(process.env['CARVE_SPEC_DIR'] ?? join(root, '../spec'), 'spec/0.2/data')
const specPresent = existsSync(join(specData, 'options.json'))

it.skipIf(!specPresent)(
  specPresent ? 'the copied data files equal the spec files' : `no spec data files at ${specData}: comparison skipped`,
  () => {
    for (const name of [
      'ast-results.json', 'ast-schema.json', 'div-names.json', 'layout-schema.json', 'node-slots.json',
      'options.json', 'task-states.json',
    ]) {
      expect(read(`data/${name}`)).toBe(readFileSync(join(specData, name), 'utf8'))
    }
  },
)

it.skipIf(!specPresent)('C2-W-106, C2-A-178: lint and migration tables equal the specification', () => {
  for (const name of ['lint-rules.json', 'upgrade-map.json']) {
    expect(read(`data/${name}`)).toBe(readFileSync(join(specData, name), 'utf8'))
  }
})
