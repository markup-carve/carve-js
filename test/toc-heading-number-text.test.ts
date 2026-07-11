import { describe, it, expect } from 'vitest'
import { carveToHtml, tocPlacement, headingNumbers } from '../src/index.js'

describe('TOC entry text with HeadingNumbers active', () => {
  it('shows the title only, excluding the section number', () => {
    const out = carveToHtml('::: toc\n:::\n\n# Alpha\n\n## Beta\n', {
      extensions: [headingNumbers(), tocPlacement()],
    })
    expect(out).toContain('<a href="#Alpha">Alpha</a>')
    expect(out).not.toContain('>1 Alpha<')
  })
})
