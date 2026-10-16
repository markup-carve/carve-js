import { describe, expect, it } from 'vitest'
import { carveToMarkdown } from '../src/index.js'
import { citations } from '../src/citations.js'

const extensions = [citations()]

describe('Markdown citation export', () => {
  it('keeps authored citation source by default', () => {
    expect(carveToMarkdown('See [@a, p. 3] and [+@b].\n', { extensions })).toBe('See [@a, p. 3] and [+@b].\n')
  })

  it('writes simple integral citations in Pandoc syntax', () => {
    expect(carveToMarkdown('See [@a, p. 3] and [+@b].\n', {
      extensions,
      citationMode: 'pandoc',
    })).toBe('See [@a, p. 3] and @b.\n')
  })

  it('braces keys whose punctuation Pandoc could cut short', () => {
    expect(carveToMarkdown('See [+@b.] and [+@a--b].\n', {
      extensions,
      citationMode: 'pandoc',
    })).toBe('See @{b.} and @{a--b}.\n')
  })

  it('keeps ordinary mentions from becoming Pandoc citations', () => {
    expect(carveToMarkdown('Ask @alice about [+@paper].\n', {
      extensions,
      citationMode: 'pandoc',
    })).toBe('Ask \\@alice about @paper.\n')
  })

  it('refuses integral groups that cannot be mapped to one bare citation', () => {
    expect(() => carveToMarkdown('[+@a; @b]\n', { extensions, citationMode: 'pandoc' })).toThrow(TypeError)
  })

  it.each([
    '[+@b]x\n', '[+@b].x\n', 'foo[+@b]\n', '[+@b]é\n', 'café[+@b]\n',
    'a -[+@b] now\n', '([+@b]) text\n', 'a.[+@b] now\n', 'see *a*[+@b] now\n',
  ])(
    'refuses an integral citation that would merge with adjacent text: %s',
    (source) => {
      expect(() => carveToMarkdown(source, { extensions, citationMode: 'pandoc' })).toThrow(TypeError)
    },
  )
})
