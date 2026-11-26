import { expect, it } from 'vitest'
import { parse, render } from '../src/index.ts'

it('C2-I-023: a percent run directly after a braced opener is text', () => {
  const input = '![{*%%]*}]()\n'
  expect(parse(input).children[0]).toMatchObject({ type: 'paragraph' })
  expect(render(input)).toBe('<p>![<strong>%%]</strong>]()</p>')
})
