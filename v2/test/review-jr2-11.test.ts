import { expect, it } from 'vitest'
import { parse, render } from '../src/index.ts'

it('C2-B-197: a braced comment closer leaves the outer image bracket open', () => {
  const input = '![{*%%]*}]()\n'
  expect(parse(input).children[0]).toMatchObject({ type: 'paragraph', role: 'image' })
  expect(render(input)).toBe('<img src="" alt="{*%%]*}">')
})
