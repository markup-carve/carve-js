import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'
import { citations } from '../src/extension/citations.js'

describe('P3 title padding', () => {
  it.each([
    ['[t]( "T"  )', '<p><a href="" title="T">t</a></p>'],
    ['[t](/u "T" )', '<p><a href="/u" title="T">t</a></p>'],
    ["[t](/u 'T'   )", '<p><a href="/u" title="T">t</a></p>'],
    ['![t](/img "T"  )', '<img src="/img" alt="t" title="T">'],
  ])('accepts ASCII spaces after a title in %s', (source, html) => {
    expect(carveToHtml(source)).toBe(html)
  })

  it('keeps a tab after a title outside the link', () => {
    expect(carveToHtml('[t](/u "T"\t)')).not.toContain('<a ')
  })
})

describe('P3 citation definition separator', () => {
  it('accepts a run of ASCII spaces', () => {
    expect(carveToHtml('[@a]\n\n[@a]:  Alpha.', { extensions: [citations()] }))
      .toContain('<li id="ref-a">Alpha.</li>')
  })

  it('does not accept a tab or absent separator', () => {
    for (const source of ['[@a]:\tAlpha.', '[@a]:Alpha.']) {
      expect(carveToHtml(source, { extensions: [citations()] })).not.toContain('<li id="ref-a">')
    }
  })
})
