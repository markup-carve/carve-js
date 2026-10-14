import { describe, expect, it } from 'vitest'
import { carveToHtml, markdownToCarve } from '../src/index.js'

// CommonMark and Carve both keep an explicitly empty destination on a link
// or image. The importer preserves the node and its text.

describe('a Markdown link or image with an empty destination', () => {
  it.each([
    ['an empty link', '[x]()', '[x]()', '<p><a href="">x</a></p>'],
    ['an empty image', '![y]()', '![y]()', '<img src="" alt="y">'],
    ['an empty angle destination', '[z](<>)', '[z]()', '<p><a href="">z</a></p>'],
    ['an empty image angle destination', '![a](<>)', '![a]()', '<img src="" alt="a">'],
    ['markup in the text', 'a [*b*]() c', 'a [{/b/}]() c', '<p>a <a href=""><em>b</em></a> c</p>'],
    ['nested brackets in the text', '[a [b] c]()', '[a [b] c]()', '<p><a href="">a [b] c</a></p>'],
    ['a link after it', '[x]()[y](u)', '[x]()[y](u)', '<p><a href="">x</a><a href="u">y</a></p>'],
  ])('imports %s as a native node', (_, markdown, carve, html) => {
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
