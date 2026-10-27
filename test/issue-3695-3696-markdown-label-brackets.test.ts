import { describe, expect, it } from 'vitest'
import { carveToHtml, carveToMarkdown, markdownToCarve } from '../src/index.js'

describe('Markdown link label brackets', () => {
  it('escapes a closing bracket in an unresolved cross-reference inside a link', () => {
    const markdown = carveToMarkdown('[a </#x]> b](u)\n')
    expect(markdown).toContain('\\]')
    expect(carveToHtml(markdownToCarve(markdown))).toContain('<a href="u">')
  })

  it('keeps an unescaped bracket in Markdown source as literal text', () => {
    const carve = markdownToCarve('[</#x]>](u)')
    expect(carveToHtml(carve)).not.toContain('<a href=')
  })

  it('keeps an escaped bracket in Markdown source inside the link', () => {
    const carve = markdownToCarve('[</#x\\]>](u)')
    expect(carveToHtml(carve)).toContain('<a href="u">')
  })
})
