import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const html = (source: string) => carveToHtml(source).replace(/\s*\n\s*/g, ' ').replace(/> /g, '>').replace(/ </g, '<')

const captioned = '<figure><blockquote><ul><li>t</li></ul></blockquote><figcaption>p</figcaption></figure>'

// CARVE-P2-008: a caption attaches to the quote and ends it, so a quote after it keeps none of its containers.
describe('a quote after a caption starts fresh', () => {
  it.each([
    ['> - t\n^ p\n>   # h\nl\n', `${captioned}<blockquote><h1 id="h">h</h1></blockquote><p>l</p>`],
    ['> - t\n^ p\n>   [^f]: n\nl\n', `${captioned}<blockquote></blockquote>`],
    ['> - t\n^ p\n> b\nl\n', `${captioned}<blockquote><p>b l</p></blockquote>`],
  ])('%j', (source, expected) => expect(html(source)).toBe(expected))

  it('keeps a caret line past a note as lazy text', () => {
    expect(html('> [^f]: n\n^ p\n\nr[^f]\n')).toContain('^ p')
  })
})
