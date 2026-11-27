import { expect, it } from 'vitest'
import { lint } from '../public/index.ts'

it('uses the catalog message for each later snippet definition', () => {
  const findings = lint('{$v}: X\n\n{$v}: Y')
  expect(findings.find((entry) => entry.code === 'duplicate-snippet')?.message)
    .toBe('Duplicate snippet "$v": the first definition of the name wins. Rename or remove this one.')
})
