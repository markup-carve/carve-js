// The dispatch table in src/ is generated from data/line-shapes.json and must match it.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { generateDispatch } from '../scripts/generate-dispatch.ts'

const root = join(import.meta.dirname, '..')

it('src/dispatch.ts is what scripts/generate-dispatch.ts writes', () => {
  const generated = generateDispatch(readFileSync(join(root, 'data/line-shapes.json'), 'utf8'))
  expect(readFileSync(join(root, 'src/dispatch.ts'), 'utf8')).toBe(generated)
})

// The data file is a copy of spec/0.2/data/line-shapes.json of the spec repository. The spec
// checkout is the `spec` submodule, or the directory CARVE_SPEC_DIR names. Until its pin holds the
// 0.2 data files the comparison is skipped.
const specFile = join(process.env['CARVE_SPEC_DIR'] ?? join(root, '../spec'), 'spec/0.2/data/line-shapes.json')
const specPresent = existsSync(specFile)

it.skipIf(!specPresent)(
  specPresent ? 'data/line-shapes.json equals the spec file' : `no spec data file at ${specFile}: comparison skipped`,
  () => {
    expect(readFileSync(join(root, 'data/line-shapes.json'), 'utf8')).toBe(readFileSync(specFile, 'utf8'))
  },
)
