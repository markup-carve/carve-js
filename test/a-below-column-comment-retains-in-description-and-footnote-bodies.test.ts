import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

describe('a below-column comment does not retain description and footnote bodies', () => {
  it('ends a description body', () => {
    expect(carveToHtml(`:: t
:  x
%% c
z
`)).toBe('<dl>\n  <dt>t</dt>\n  <dd>x</dd>\n</dl>\n<p>z</p>')
  })

  it('ends a footnote body', () => {
    const html = carveToHtml(`[^a]: intro
%% c
 more

see[^a]
`)
    expect(html).not.toContain('<p>intro</p>\n      <p>more')
    expect(html).toContain('<p>more</p>\n<p>see')
  })

  it('ends a footnote after an unmatched comment fence', () => {
    expect(carveToHtml(`[^a]: intro
%%%
 more

see[^a]
`)).toContain('<p>more</p>\n<p>see')
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
