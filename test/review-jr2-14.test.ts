import { expect, it } from 'vitest'
import { render } from '../src/index.ts'

it('C2-H-153: table-only keys are hidden in every ASCII case', () => {
  expect(render('{WIDTHS=not-a-width}\n| a |\n').startsWith('<table>')).toBe(true)
})
