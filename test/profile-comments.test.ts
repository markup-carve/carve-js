import { describe, expect, it } from 'vitest'
import { renderWithDiagnostics } from '../src/index.ts'

type Profile = 'minimal' | 'comment'
type AnyProfile = Profile | 'article'

const losses = (source: string, profile: AnyProfile, options: { maxLosses?: number } = {}) =>
  renderWithDiagnostics(source, { profile, ...options }).diagnostics
    .filter(entry => entry.code === 'profile-construct-degraded')
    .map(entry => [entry.range?.startOffset, entry.message.replace(/.*: /, '')])

describe('carve#6876: a comment outside the profile is reported once (C2-H-163, C2-H-165, CC-2477)', () => {
  const source = 'x %% c\n\n%%%\nblock\n%%%\n\nb {% c %} d\n'

  it.each<Profile>(['comment', 'minimal'])('reports a line, a block and a braced comment under %s and writes nothing', (profile) => {
    const out = renderWithDiagnostics(source, { profile })
    expect(out.html).toBe('<p>x</p>\n<p>b  d</p>')
    expect(losses(source, profile)).toEqual([[1, 'comment.'], [8, 'comment.'], [25, 'comment.']])
  })

  it('reports comments inside allowed containers, in source order with their siblings', () => {
    const nested = '> q {% c %}\n\n[r]: /u\n\n- i %% c\n- > j {% d %}\n'
    expect(losses(nested, 'comment')).toEqual([[4, 'comment.'], [13, 'link_reference_definition.'], [25, 'comment.'], [37, 'comment.']])
  })

  it('does not report a comment inside a node that is itself degraded', () => {
    expect(losses('# h {% c %}\n\n| a {% c %} |\n', 'comment')).toEqual([[0, 'heading.'], [13, 'table.']])
  })

  it('maxLosses keeps the first report in source order', () => {
    const out = renderWithDiagnostics(source, { profile: 'comment', maxLosses: 1 })
    expect(out.diagnostics.filter(entry => entry.code === 'profile-construct-degraded').map(entry => entry.range?.startOffset)).toEqual([1])
  })

  it('reports nothing for comments under a profile without an allow list', () => {
    expect(losses(source, 'article')).toEqual([])
  })
})
