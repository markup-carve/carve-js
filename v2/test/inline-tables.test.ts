// The inline tables in src/ are generated from the data files in data/ and must match them.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { generateInlineTables } from '../scripts/generate-inline.ts'

const root = join(import.meta.dirname, '..')
const FILES = [
  'attribute-block.json', 'inline-atoms.json', 'inline-braces.json', 'inline-brackets.json', 'inline-delimiters.json',
  'inline-scan.json', 'inline-sigils.json', 'limits.json', 'smart-punctuation.json',
]

it('src/inline-tables.ts is what scripts/generate-inline.ts writes', () => {
  const generated = generateInlineTables((file) => readFileSync(join(root, 'data', file), 'utf8'))
  expect(readFileSync(join(root, 'src/inline-tables.ts'), 'utf8')).toBe(generated)
})

const specData = join(process.env['CARVE_SPEC_DIR'] ?? join(root, '../spec'), 'spec/0.2/data')

it(
  'the inline data files equal the spec files',
  () => {
    for (const file of FILES) expect(readFileSync(join(root, 'data', file), 'utf8'), file).toBe(readFileSync(join(specData, file), 'utf8'))
  },
)
