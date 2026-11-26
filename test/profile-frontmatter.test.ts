import { describe, expect, it } from 'vitest'
import { renderWithDiagnostics } from '../src/index.ts'

type Profile = 'minimal' | 'comment'

const losses = (source: string, profile: Profile | 'article') =>
  renderWithDiagnostics(source, { profile }).diagnostics
    .filter(entry => entry.code === 'profile-construct-degraded')
    .map(entry => [entry.range?.startOffset, entry.message.replace(/.*: /, '')])

describe('carve#6877: frontmatter outside the profile writes nothing and is reported once (C2-H-070, C2-H-129, C2-H-163)', () => {
  it.each<Profile>(['comment', 'minimal'])('reports leading frontmatter under %s', (profile) => {
    const source = '---\na: 1\n---\n\nx\n'
    const out = renderWithDiagnostics(source, { profile })
    expect(out.html).toBe('<p>x</p>')
    expect(losses(source, profile)).toEqual([[0, 'frontmatter.']])
  })

  it('reports a later block at its first attribute line, in source order', () => {
    const source = '{#m}\n---yaml\na: 1\n---\n\nx\n\n{#late}\n---toml\nz = 1\n---\n'
    const out = renderWithDiagnostics(source, { profile: 'comment' })
    expect(out.html).toBe('<p>x</p>')
    expect(losses(source, 'comment')).toEqual([[0, 'frontmatter.'], [26, 'frontmatter.']])
  })

  it('reports nothing under a profile without an allow list', () => {
    expect(losses('---\na: 1\n---\n\nx\n', 'article')).toEqual([])
  })
})
