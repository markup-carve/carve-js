import { expect, it } from 'vitest'
import { lintCarve } from '../src/lint.js'

it.each([
  ['# A\n\n{#A}\n# X\n', 1],
  ['x[^n]\n\n[^n]: text\n\n  # A\n\n# A\n', 5],
  ['{#same}\n# First\n\n{#same}\n# Second\n', 5],
] as const)('locates the heading whose rendered id collides: %j', (source, line) => {
  const warnings = lintCarve(source).filter((w) => w.rule === 'duplicate-heading-id')
  expect(warnings).toHaveLength(1)
  expect(warnings[0]!.line).toBe(line)
})
