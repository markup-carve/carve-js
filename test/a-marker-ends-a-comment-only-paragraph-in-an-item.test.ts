import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// carve#4890 ruling B: in an item body a marker ends the paragraph (§24 C3), so `{% c %}` alone
// reads as a `%%` line (§21a). In a quote the marker stays paragraph text (S3).
const html = (source: string) => carveToHtml(source).replace(/\s+</g, '<').replace(/>\s+/g, '>').trim()

describe('a marker after a comment-only paragraph in an item (carve#4890)', () => {
  it('keeps one loose sublist and a tight outer item', () => {
    expect(carveToHtml('- p\n\n  - a\n\n  {% c %}\n  - b\n')).toBe(
      "<ul>\n  <li><p>p</p>\n    <ul>\n      <li><p>a</p></li>\n      <li><p>b</p></li>\n    </ul>\n  </li>\n</ul>",
    )
  })

  it.each([
    ['{% c %}', '%% c'],
    ['{% c %} {% d %}', '%% c'],
    ['{% c %}\n  {% d %}', '%% c\n  %% d'],
  ])('reads %j as its %% twin', (comment, twin) => {
    const shape = (c: string) => `- p\n  1. a\n\n  ${c}\n  2. b\n`
    expect(html(shape(comment))).toBe(html(shape(twin)))
  })

  it.each([
    '- a\n\n{% c %}\n- b\n',
    '> - a\n>\n> {% c %}\n> - b\n',
  ])('keeps the marker visible outside an item body: %j', (source) => {
    expect(html(source)).toContain('- b')
  })
})
