import { expect, it } from 'vitest'
import { render } from '../src/index.ts'

it('C2-B-137: a comment-only line leaves the ordered-list blank count intact', () => {
  const input = 'v. a\n\n\n%% c\n\nvi. b\n'
  expect(render(input)).toContain('<ol type="a" start="22">')
})
