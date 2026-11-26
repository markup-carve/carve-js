import { describe, expect, it } from 'vitest'
import { render, renderWithDiagnostics } from '../src/index.ts'

const losses = (source: string, profile: 'minimal' | 'comment') =>
  renderWithDiagnostics(source, { profile }).diagnostics.filter(entry => entry.code === 'profile-construct-degraded')

describe('C2-H-163 and C2-H-166: profile nesting counts containers', () => {
  it('keeps a plain minimal list without losses, including in strict mode', () => {
    const source = '- a\n- b'
    expect(render(source, { profile: 'minimal', strictLosses: true })).toBe('<ul>\n  <li>a</li>\n  <li>b</li>\n</ul>')
    expect(losses(source, 'minimal')).toEqual([])
  })

  it('keeps a second list at the minimal bound and degrades the third list once', () => {
    expect(losses('- a\n  - b `c`', 'minimal')).toEqual([])
    const source = '- a\n  - b\n    - c'
    expect(render(source, { profile: 'minimal' })).toContain('<p>- c</p>')
    expect(losses(source, 'minimal').map(entry => entry.message)).toEqual([
      'Degraded list because it exceeds the nesting limit of profile "minimal"; move it to a shallower level or use a profile that permits the depth.',
    ])
  })

  it('keeps four nested quotes at the comment bound and degrades the fifth quote once', () => {
    expect(render('> > > > `x`', { profile: 'comment' })).toContain('<blockquote><p><code>x</code></p></blockquote>')
    expect(losses('> > > > `x`', 'comment')).toEqual([])
    expect(losses('> > > > > `x`', 'comment').map(entry => entry.message)).toEqual([
      'Degraded block_quote because it exceeds the nesting limit of profile "comment"; move it to a shallower level or use a profile that permits the depth.',
    ])
  })

  it('reports a type exclusion at the allowed depth with the type-exclusion message', () => {
    expect(losses('- a [b](/u)', 'minimal').map(entry => entry.message)).toEqual([
      'Degraded a construct the profile "minimal" does not allow: link.',
    ])
  })
})
