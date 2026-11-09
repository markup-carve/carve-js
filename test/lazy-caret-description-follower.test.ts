import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

describe('a lazy caret line in a description does not open a caption', () => {
  it('keeps a shifted same-owner term as a sibling', () => {
    expect(carveToHtml(':: t\n : a\n^ cap\n  :: u\n').trim()).toBe(
      '<dl>\n  <dt>t</dt>\n  <dd>a\n^ cap</dd>\n  <dt>u</dt>\n</dl>',
    )
  })

  it('lets a following list marker open outside the description', () => {
    expect(carveToHtml(':: t\n : a\n^ cap\n  - u\n').trim()).toBe(
      '<dl>\n  <dt>t</dt>\n  <dd>a\n^ cap</dd>\n</dl>\n<ul>\n  <li>u</li>\n</ul>',
    )
  })

  it('does not mistake an unbound caret at the body column for a caption', () => {
    expect(carveToHtml(':: t\n : a\n   ^ cap\n  - u\n').trim()).toBe(
      '<dl>\n  <dt>t</dt>\n  <dd>a\n^ cap</dd>\n</dl>\n<ul>\n  <li>u</li>\n</ul>',
    )
  })
})
