import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml } from '../src/index.js'

// Confirmation-round findings N-M6, N-M8 and N-M12 (markup-carve/carve#4566,
// #4568, #4573). Each expected string is the spec model's output at carve main
// 26baf86b.
const html = (source: string): string => carveToHtml(source).trim()

describe('a continuation cell past the last column reads the header a < extends (carve#4566)', () => {
  it.each([
    ['one < marker', '|= a | < |\n+ | | c |\n', '<thead>\n    <tr><th scope="col" colspan="2">a</th><th scope="col">c</th></tr>\n  </thead>'],
    ['two < markers', '|= a | < | < |\n+ | | | c |\n', '<tr><th scope="col" colspan="3">a</th><th scope="col">c</th></tr>'],
    ['a ^ marker counts as itself', '|= a | ^ |\n+ | | c |\n', '<tr><th scope="row">a</th><td></td><td>c</td></tr>'],
    ['a body cell under the <', '| a | < |\n+ | | c |\n', '<tr><td colspan="2">a</td><td>c</td></tr>'],
  ])('%s', (_name, source, expected) => {
    expect(html(source)).toContain(expected)
  })
})

describe('a comment after an image does not keep its caption from binding (carve#4568)', () => {
  it.each([
    ['a line comment', '![a](/i) %% c\n^ cap\n'],
    ['a glued braced comment', '![b](/j){%%}\n^ cap\n'],
    ['two glued braced comments', '![b](/j){%%}{% x %}\n^ cap\n'],
  ])('%s', (_name, source) => {
    expect(html(source)).toMatch(/^<figure>\n {2}<img [^>]*>\n {2}<figcaption>cap<\/figcaption>\n<\/figure>$/)
    // The formatter keeps the paragraph, so the comment is written back.
    const formatted = carveToCarve(source)
    expect(formatted).toMatch(/%/)
    expect(html(formatted)).toBe(html(source))
  })

  it('keeps the paragraph when a space precedes a braced comment', () => {
    expect(html('![a](/i) {% c %}\n^ cap\n')).toBe('<p><img src="/i" alt="a"> \n^ cap</p>')
  })
})

describe('a quote holding only empty quotes or bare divs takes no caption (carve#4573)', () => {
  it.each([
    ['a nested empty quote', '> >\n^ cap\n'],
    ['a nested comment-only quote', '> > %%\n^ cap\n'],
    ['a bare div pair', '> :::\n> :::\n^ cap\n'],
  ])('%s', (_name, source) => {
    expect(html(source)).not.toContain('<figure>')
    expect(html(source)).toMatch(/<p>\^ cap<\/p>$/)
  })

  it.each([
    ['a nested quote with text', '> > a\n^ cap\n'],
    ['an admonition', '> ::: warning\n> :::\n^ cap\n'],
  ])('%s keeps its caption', (_name, source) => {
    expect(html(source)).toContain('<figcaption>cap</figcaption>')
  })
})
