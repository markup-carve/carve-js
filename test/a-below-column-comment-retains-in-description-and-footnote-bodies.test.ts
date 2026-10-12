import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

describe('a below-column comment retains description and footnote bodies', () => {
  it('starts a new paragraph in a description body', () => {
    expect(carveToHtml(`:: t
:  x
%% c
z
`)).toBe('<dl>\n  <dt>t</dt>\n  <dd>\n    <p>x</p>\n    <p>z</p>\n  </dd>\n</dl>')
  })

  it('starts a new paragraph in a footnote body', () => {
    const html = carveToHtml(`[^a]: intro
%% c
 more

see[^a]
`)
    expect(html).toContain('<p>intro</p>\n      <p>more')
    expect(html).not.toContain('<p>more</p>\n<p>see')
  })

  it('retains a footnote after an unmatched comment fence', () => {
    expect(carveToHtml(`[^a]: intro
%%%
 more

see[^a]
`)).toContain('<p>intro</p>\n      <p>more')
  })

  it('clears retention at a blank line', () => {
    expect(carveToHtml(`:: t
:  x
%% c

z
`)).toBe('<dl>\n  <dt>t</dt>\n  <dd>x</dd>\n</dl>\n<p>z</p>')
  })

  it('grants no retention for a comment at the content column', () => {
    expect(carveToHtml(`:: t
:  x
   %% c
z
`)).toBe('<dl>\n  <dt>t</dt>\n  <dd>x</dd>\n</dl>\n<p>z</p>')
  })
})
