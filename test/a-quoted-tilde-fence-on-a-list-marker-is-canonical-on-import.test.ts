import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml, markdownToCarve } from '../src/index.js'

describe('a quoted tilde fence on a list marker is canonical on import', () => {
  const cases: Array<[string, string, string]> = [
    ['bullet', '- > ~~~\n  > /y/\n  > ~~~\n', '- > ```\n  > \\/y/\n  > ```\n'],
    ['ordered', '1. > ~~~\n   > /y/\n   > ~~~\n', '1. > ```\n   > \\/y/\n   > ```\n'],
    ['quoted bullet', '> - > ~~~\n>   > /y/\n>   > ~~~\n', '> - > ```\n>   > \\/y/\n>   > ```\n'],
    ['language', '- > ~~~js\n  > a ` b\n  > ~~~\n', '- > ```js\n  > a \\` b\n  > ```\n'],
  ]

  it.each(cases)('%s', (_name, source, expected) => {
    const imported = markdownToCarve(source)
    expect(imported).toBe(expected)
    expect(carveToCarve(imported)).toBe(imported)
    expect(carveToHtml(imported)).toContain('<pre><code')
  })

  it('leaves an unclosed quoted fence to the existing container rule', () => {
    const source = '- > ~~~\n  > a\n\n  b\n'
    expect(markdownToCarve(source)).toBe('- > ```\n  > a\n  > ```\n\n  b\n')
  })

  it('keeps the public no-final-newline behavior', () => {
    expect(markdownToCarve('- > ~~~\n  > x\n  > ~~~')).toBe('- > ```\n  > x\n  > ```')
  })
})
