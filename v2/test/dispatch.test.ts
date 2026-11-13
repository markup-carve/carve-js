// The dispatch table in src/ is generated from data/line-shapes.json and must match it.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { generateDispatch } from '../scripts/generate-dispatch.ts'

it('src/dispatch.ts is what scripts/generate-dispatch.ts writes', () => {
  const root = join(import.meta.dirname, '..')
  const generated = generateDispatch(readFileSync(join(root, 'data/line-shapes.json'), 'utf8'))
  expect(readFileSync(join(root, 'src/dispatch.ts'), 'utf8')).toBe(generated)
})
