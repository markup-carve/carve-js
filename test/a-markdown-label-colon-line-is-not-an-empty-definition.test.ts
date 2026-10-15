import { describe, expect, it } from 'vitest'
import { carveToHtml, markdownToCarve } from '../src/index.js'

// CommonMark needs a destination, so `[foo]:` alone is paragraph text (spec
// example 199). Carve reads the same line as an empty definition, which would
// drop the text, so the importer escapes the bracket.

const written = (markdown: string) => markdownToCarve(markdown).replace(/\n+$/, '')

describe('a Markdown `[label]:` line with no destination', () => {
  it.each([
    ['a top-level paragraph', '[foo]:\n\n[foo]\n', '\\[foo]:\n\n[foo]', '<p>[foo]:</p><p>[foo]</p>'],
    ['trailing spaces after the colon', '[foo]:   \n', '\\[foo]:   ', '<p>[foo]:</p>'],
    ['a block quote', '> [foo]:\n', '> \\[foo]:', '<blockquote><p>[foo]:</p></blockquote>'],
    ['a list item', '* [foo]:\n', '* \\[foo]:', '<ul><li>[foo]:</li></ul>'],
  ])('stays text in %s', (_name, markdown, carve, html) => {
    expect(written(markdown)).toBe(carve)
    expect(carveToHtml(written(markdown)).replace(/>\s+</g, '><').trim()).toBe(html)
  })

  it('leaves a real definition and an empty pointy definition alone', () => {
    expect(written('[foo]: /u\n\n[foo]\n')).toBe('[foo][]\n\n[foo]: /u')
    expect(written('[foo]: <>\n\n[foo]\n')).toBe('[foo][]\n\n[foo]:')
  })
})
