import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

describe('a cross-reference label derived from a heading', () => {
  it('does not clone a following footnote reference into the link label', () => {
    const html = carveToHtml('# H</#h>[^f]\n')

    expect(html).toContain('<h1>H<a href="#H">H</a>[^f]</h1>')
    expect(html).not.toContain('<a href="#H">H[^f]</a>')
  })

  it('does not duplicate resolved footnote apparatus either', () => {
    const html = carveToHtml('# H[^f]\n\nSee </#h>.\n\n[^f]: note\n')

    expect(html).toContain('See <a href="#H">H</a>.')
    expect(html.match(/role="doc-noteref"/g)).toHaveLength(1)
  })
})
