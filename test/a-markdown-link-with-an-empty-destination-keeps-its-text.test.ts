import { describe, expect, it } from 'vitest'
import { carveToHtml, markdownToCarve } from '../src/index.js'

// CommonMark reads an empty destination as a link; Carve reads `[t]()` as
// literal text (markup-carve/carve#2069). The importer keeps the link's text
// or the image's alt, as the HTML importer does for an empty href
// (carve-js#1800).

describe('a Markdown link or image with an empty destination', () => {
  it.each([
    ['an empty link', '[x]()', 'x', '<p>x</p>'],
    ['an empty image', '![y]()', 'y', '<p>y</p>'],
    ['an empty angle destination', '[z](<>)', 'z', '<p>z</p>'],
    ['an empty image angle destination', '![a](<>)', 'a', '<p>a</p>'],
    ['a title with no destination', '[x]( "t")', 'x', '<p>x</p>'],
    ['markup in the text', 'a [*b*]() c', 'a /b/ c', '<p>a <em>b</em> c</p>'],
    ['nested brackets in the text', '[a [b] c]()', 'a [b] c', '<p>a [b] c</p>'],
    ['a link after it', '[x]()[y](u)', 'x[y](u)', '<p>x<a href="u">y</a></p>'],
  ])('imports %s as its text', (_, markdown, carve, html) => {
    const written = markdownToCarve(markdown)
    expect(written).toBe(carve)
    expect(carveToHtml(written).trim()).toBe(html)
  })

  it.each([
    ['a link with a destination', '[x](u)', '[x](u)'],
    ['an escaped bracket', '\\[x]()', '\\[x]()'],
    ['a code span', '`[x]()`', '`[x]()`'],
  ])('leaves %s alone', (_, markdown, carve) => {
    expect(markdownToCarve(markdown)).toBe(carve)
  })
})
