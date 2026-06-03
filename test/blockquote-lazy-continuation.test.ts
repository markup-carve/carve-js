import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

const html = (s: string) => carveToHtml(s)

describe('blockquote lazy continuation (CommonMark-style, matches carve-php)', () => {
  it('folds a non-`>` line into the quote paragraph', () => {
    expect(html('> quoted\ncontinued')).toBe(
      '<blockquote><p>quoted\ncontinued</p></blockquote>',
    )
  })

  it('folds several lazy lines', () => {
    expect(html('> q\ntext\nmore')).toBe(
      '<blockquote><p>q\ntext\nmore</p></blockquote>',
    )
  })

  it('a blank line still ends the quote', () => {
    expect(html('> q\n\ntext')).toBe(
      '<blockquote><p>q</p></blockquote>\n<p>text</p>',
    )
  })

  it('folds a line that looks like a block marker (paragraphs are never interrupted)', () => {
    expect(html('> a\n# H')).toBe('<blockquote><p>a\n# H</p></blockquote>')
  })

  it('a caption attaches to the quote rather than folding in', () => {
    expect(html('> quote\n^ Caption')).toBe(
      '<figure>\n  <blockquote><p>quote</p></blockquote>\n  <figcaption>Caption</figcaption>\n</figure>',
    )
  })

  it('a `>`-prefixed line still continues the quote', () => {
    expect(html('> a\n> b')).toBe('<blockquote><p>a\nb</p></blockquote>')
  })
})
