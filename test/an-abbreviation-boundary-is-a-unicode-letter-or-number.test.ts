import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

// PART 9R R3 (markup-carve/carve#4729): a neighbor in Unicode L or N blocks the match, anything else is a boundary.
describe('an abbreviation boundary is a Unicode letter or number', () => {
  const defs = '*[HTML]: Hypertext\n\n'
  it.each(['αHTMLβ', 'éHTML', 'HTMLé', '1HTML', 'HTML٣', 'ⅫHTML', '𝐀HTML', 'HTML中'])('expands nothing in %s', (text) => {
    expect(carveToHtml(defs + text + '\n')).not.toContain('<abbr')
  })

  it.each(['HTML_x', 'x-HTML', '(HTML)', 'HTMĹ', '😀HTML', 'HTML'])('expands %s', (text) => {
    expect(carveToHtml(defs + text + '\n')).toContain('<abbr title="Hypertext">HTML</abbr>')
  })
})
