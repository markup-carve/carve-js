import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml } from '../src/index.js'

const indent = (source: string, width: number): string =>
  source.split('\n').map((line) => `${' '.repeat(width)}${line}`).join('\n')

const footnote = (body: string, width: number): string =>
  `[^n]: intro\n\n${indent(body, width)}\n\nsee[^n]\n`

describe('non-definition-list authored-base edges', () => {
  it('does not rebase a fence-shaped code payload as a second block', () => {
    const body = '~~~~\n ```\n~~~~'
    const exact = carveToCarve(footnote(body, 2))
    const over = carveToCarve(footnote(body, 3))

    expect(over).toBe(exact)
    expect(carveToCarve(exact)).toBe(exact)
    expect(over).toContain('\n  ````\n   ```\n  ````\n')
  })

  for (const [name, body, captionHtml] of [
    ['image', '![alt](image.png)\n^ Caption', '<figcaption>Caption</figcaption>'],
    ['table', '| H |\n| x |\n^ Caption', '<caption>Caption</caption>'],
    ['code block', '```\ncode\n```\n^ Caption', '<figcaption>Caption</figcaption>'],
  ]) {
    it(`carries an over-indented ${name} caption with its target`, () => {
      const exact = footnote(body, 2)
      const over = footnote(body, 4)
      expect(carveToCarve(over)).toBe(carveToCarve(exact))
      expect(carveToHtml(over)).toBe(carveToHtml(exact))
      expect(carveToHtml(over)).toContain(captionHtml)
    })
  }
})
