import { describe, expect, it } from 'vitest'
import { parse, renderHtml } from '../src/index.js'

describe('placed endnote title order', () => {
  it('numbers body titles before titles in endnote bodies', () => {
    const html = renderHtml(parse('a[^n]\n\n::: footnotes\n:::\n\n::: note "B"\n:::\n\n[^n]: ::: note "N"\n    :::\n'))
    expect(html).toContain('<p class="admonition-title" id="adm-2">N</p>')
    expect(html).toContain('<p class="admonition-title" id="adm-1">B</p>')
    expect(html.indexOf('>N</p>')).toBeLessThan(html.indexOf('>B</p>'))
  })
})
