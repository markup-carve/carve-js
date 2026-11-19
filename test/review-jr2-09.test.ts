import { expect, it } from 'vitest'
import { render } from '../src/index.ts'

it('C2-H-152: table widths retain significant decimal places', () => {
  const html = render('{widths=30.000000000001}\n| a |\n')
  expect(html).toContain('<col style="width: 30.000000000001%;">')
  expect(render('{widths=0.000000000001}\n| a |\n')).toContain('<col style="width: 0.000000000001%;">')
})
