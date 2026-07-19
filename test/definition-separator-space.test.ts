import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

const html = (s: string) => carveToHtml(s).trim()

describe('definition separators', () => {
  it('requires a literal space after a link definition colon', () => {
    expect(html('[a]:\t/url\n\n[a][]')).toBe(
      '<p>[a]:\t/url</p>\n<p>[a][]</p>',
    )

    expect(html('[a]:  /url\n\n[a][]')).toBe('<p><a href="/url">a</a></p>')
  })

  it('requires a literal space after a footnote definition colon', () => {
    expect(html('[^a]:\tnote\n\n[^a]')).toBe('<p>[^a]:\tnote</p>\n<p>[^a]</p>')

    expect(html('[^a]:  note\n\n[^a]')).toContain(
      '<p><a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a></p>',
    )
  })

  it('requires a literal space after an abbreviation definition colon', () => {
    expect(html('*[XX]:\tExpanded\n\nXX')).toBe(
      '<p>*[XX]:\tExpanded</p>\n<p>XX</p>',
    )

    expect(html('*[XX]:  Expanded\n\nXX')).toBe(
      '<p><abbr title="Expanded">XX</abbr></p>',
    )
  })
})
