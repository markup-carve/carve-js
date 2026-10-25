import { expect, it } from 'vitest'
import { carveToMarkdown, htmlToCarve, markdownToCarve } from '../src/index.js'

it('keeps unmatched closing parentheses in destinations across Markdown output', () => {
  for (const destination of ['/a)b', '/a]b)c%25', '/a)b)c']) {
    const source = htmlToCarve(`<a href="${destination}">x</a>`).value
    const markdown = carveToMarkdown(source)
    expect(markdown).toContain('\\)')
    expect(markdownToCarve(markdown)).toBe(source)
  }
})
