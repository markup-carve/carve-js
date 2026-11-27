import { expect, it } from 'vitest'
import { lint } from '../public/index.ts'

it('names an unknown include key when an earlier option also has a bad value', () => {
  const source = '{{ a.crv @shift:x @size:2 }}'
  const findings = lint(source, { includes: () => ({ text: 'x', id: 'a.crv' }) })
  expect(findings.filter((entry) => entry.code === 'include-option-invalid').map((entry) => entry.message))
    .toEqual(['The include option @size:2 has a key that is not an include option, so the include is not expanded. Correct it or remove it.'])
})
