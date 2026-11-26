import { describe, expect, it } from 'vitest'
import { type DocumentNode, renderWithDiagnostics } from '../src/index.ts'

type Profile = 'minimal' | 'comment'

const losses = (source: string | DocumentNode, profile: Profile) =>
  renderWithDiagnostics(source, { profile }).diagnostics
    .filter(entry => entry.code === 'profile-construct-degraded')
    .map(entry => [entry.range?.startOffset, entry.message.replace(/.*: /, '')])

describe('carve#6876: a definition outside the profile is reported (C2-H-129, C2-H-163, C2-H-165)', () => {
  const source = '[r]: /u\n\nSee [x][r] and[^n].\n\n[^n]: note\n'

  it.each<Profile>(['comment', 'minimal'])('reports the link reference definition, the reference and the note under %s', (profile) => {
    const out = renderWithDiagnostics(source, { profile })
    expect(out.html).toBe(profile === 'comment'
      ? '<p>See <a href="/u" rel="nofollow ugc">x</a> and[^n].</p>'
      : '<p>See x and[^n].</p>')
    expect(losses(source, profile)).toEqual(profile === 'comment'
      ? [[0, 'link_reference_definition.'], [23, 'footnote_ref.'], [30, 'footnote.']]
      : [[0, 'link_reference_definition.'], [13, 'link.'], [23, 'footnote_ref.'], [30, 'footnote.']])
  })

  it('reports a definition nothing references', () => {
    expect(losses('Plain.\n\n[q]: /v\n\n[^m]: lone\n', 'comment')).toEqual([[8, 'link_reference_definition.'], [17, 'footnote.']])
  })

  it('reports a snippet definition', () => {
    expect(losses('{$x}: Hi\n\nUse it.\n', 'comment')).toEqual([[0, 'snippet_definition.']])
  })

  it('reports a citation definition', () => {
    const document: DocumentNode = {
      type: 'document',
      astVersion: '2.0',
      children: [{ type: 'citation_definition', key: 'a', namespace: 'citation', children: [{ type: 'text', value: 'A book' }] }],
    }
    expect(renderWithDiagnostics(document, { profile: 'minimal' }).diagnostics.map(entry => [entry.path, entry.message])).toEqual([
      ['/children/0', 'Degraded a construct the profile "minimal" does not allow: citation_definition.'],
    ])
  })

  it('C2-H-178: does not report an abbreviation definition', () => {
    expect(losses('*[HTML]: Hyper\n\nPlain.\n', 'comment')).toEqual([])
  })

  it('reports nothing for definitions the profile admits', () => {
    expect(renderWithDiagnostics(source, { profile: 'article' }).diagnostics
      .filter(entry => entry.code === 'profile-construct-degraded')).toEqual([])
  })
})
