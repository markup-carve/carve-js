import { describe, expect, it } from 'vitest'

import { carveToHtml } from '../src/index.js'

describe('sourceLine stamping', () => {
  it('is off by default', () => {
    expect(carveToHtml('# Heading\n\nPara one.\n')).not.toContain('data-source-line')
  })

  it('stamps top-level blocks with their 1-based source line', () => {
    // 1-based source lines: 1 "# Heading", 3 "Para one.", 5 "Para two."
    const html = carveToHtml('# Heading\n\nPara one.\n\nPara two.\n', { sourceLine: true })
    expect(html).toContain('<h1 data-source-line="1">')
    expect(html).toContain('<p data-source-line="3">')
    expect(html).toContain('<p data-source-line="5">')
  })

  it('renders data-source-line after author attributes (parity with php/rs)', () => {
    const html = carveToHtml('{.note}\nPara with class.\n\n---\n', { sourceLine: true })
    expect(html).toContain('<p class="note" data-source-line="2">')
    expect(html).toContain('<hr data-source-line="4">')
  })

  it('keeps the heading id on the section and stamps the h element', () => {
    const html = carveToHtml('# Heading\n', { sourceLine: true })
    expect(html).toContain('<section id="Heading">')
    expect(html).toContain('<h1 data-source-line="1">')
  })
})
