import { describe, expect, it } from 'vitest'
import { lint, renderWithDiagnostics } from '../src/index.ts'

describe('readiness diagnostic messages', () => {
  it('states the actual profile restriction', () => {
    const excluded = renderWithDiagnostics('> a', { profile: 'minimal' }).diagnostics
    expect(excluded.find(entry => entry.code === 'profile-construct-degraded')?.message).toBe(
      'Degraded a construct the profile "minimal" does not allow: block_quote.',
    )
    const nested = renderWithDiagnostics('> > > > `x`', { profile: 'comment' }).diagnostics
    expect(nested.find(entry => entry.code === 'profile-construct-degraded')?.message).toBe(
      'Degraded code because it exceeds the nesting limit of profile "comment"; move it to a shallower level or use a profile that permits the depth.',
    )
    const captioned = renderWithDiagnostics('![x](a)\n^ caption', { profile: 'comment' }).diagnostics
    expect(captioned.find(entry => entry.code === 'profile-construct-degraded')?.message).toBe(
      'Degraded a construct the profile "comment" does not allow: figure.',
    )
  })

  it('names the text owner of a table-shaped line', () => {
    expect(lint('| a').find(entry => entry.code === 'table-shaped-paragraph')?.message).toContain('paragraph text')
    expect(lint('# H\n  | a').find(entry => entry.code === 'table-shaped-paragraph')?.message).toContain('heading text')
    expect(lint('![x](a)\n^ cap\n  | a').find(entry => entry.code === 'table-shaped-paragraph')?.message).toContain('caption text')
    expect(lint('::: |\n| a\n:::').find(entry => entry.code === 'table-shaped-paragraph')?.message).toContain('line-block line text')
    expect(lint(':: term\n| a').find(entry => entry.code === 'table-shaped-paragraph')?.message).toContain('term text')
  })
})
