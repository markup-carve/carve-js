// The generated tables in src/ must match the data files they are written from, and the data
// files are copies of spec/0.2/data of the spec repository.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { generateOptionTables } from '../scripts/generate-option-tables.ts'
import { generateTreeTables } from '../scripts/generate-tree-tables.ts'

const root = join(import.meta.dirname, '..')
const read = (path: string): string => readFileSync(join(root, path), 'utf8')

it('src/tree-tables.ts is what scripts/generate-tree-tables.ts writes', () => {
  expect(read('src/tree-tables.ts')).toBe(generateTreeTables(read('data/div-names.json'), read('data/task-states.json')))
})

it('src/option-tables.ts is what scripts/generate-option-tables.ts writes', () => {
  expect(read('src/option-tables.ts')).toBe(generateOptionTables(read('data/options.json')))
})

// The spec checkout is the `spec` submodule, or the directory CARVE_SPEC_DIR names. Until its pin
// holds the 0.2 data files the comparison is skipped.
const specData = join(process.env['CARVE_SPEC_DIR'] ?? join(root, '../spec'), 'spec/0.2/data')
const specPresent = existsSync(join(specData, 'options.json'))

it.skipIf(!specPresent)(
  specPresent ? 'the copied data files equal the spec files' : `no spec data files at ${specData}: comparison skipped`,
  () => {
    for (const name of ['div-names.json', 'options.json', 'task-states.json']) {
      expect(read(`data/${name}`)).toBe(readFileSync(join(specData, name), 'utf8'))
    }
  },
)
