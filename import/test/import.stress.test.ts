// An importer case that takes seconds; outside the everyday run, `npm --prefix import run test:stress` runs it, and CI does.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { format, validateTree } from '../../src/index.ts'
import { importDocument } from '../src/index.ts'

it('C2-A-167 keeps the saved inline importer case valid in every format', () => {
  const input = readFileSync(join(import.meta.dirname, '../../proptest/regressions/import-inline-timeout.crv'), 'utf8')
  for (const from of ['markdown', 'gfm', 'djot', 'html'] as const) {
    const result = importDocument(input, { from })
    expect(() => validateTree(result.document)).not.toThrow()
    if (from === 'markdown') expect(format(result.source)).toBe(result.source)
  }
})
