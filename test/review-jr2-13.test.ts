import { expect, it } from 'vitest'
import { render } from '../src/index.ts'

it('C2-H-167: rel words split at ASCII whitespace', () => {
  expect(render('[x](/u){rel="\t"}')).toBe('<p><a href="/u">x</a></p>')
  expect(render('[x](/u){rel="nofollow\tugc"}', { profile: 'comment' }))
    .toContain('rel="nofollow ugc"')
})
