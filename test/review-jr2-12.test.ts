import { expect, it } from 'vitest'
import { render } from '../src/index.ts'

it('C2-H-167: a filtered uppercase rel key leaves no empty attribute', () => {
  expect(render('[x](/u){REL="javascript:x"}')).toBe('<p><a href="/u">x</a></p>')
})
