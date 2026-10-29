import { describe, expect, it } from 'vitest'
import { carveToHtml, carveToMarkdown, markdownToCarve } from '../src/index.js'

describe('literal definition markers in Markdown paragraphs', () => {
  it('keeps a description below a nested term as a description', () => {
    const source = ':: a\n: b\n\t:: t\n  : zq\n'
    const markdown = carveToMarkdown(source, { roundtrip: true })
    expect(markdown).toContain('<!-- carve:2 : -->\nzq\n')
    expect(carveToHtml(markdownToCarve(markdown))).toBe(carveToHtml(source))
  })

  it('escapes a literal term marker without a definition host', () => {
    const source = '\\: text\n\n\\:: term\n'
    const markdown = carveToMarkdown(source)
    expect(markdown).toMatch(/^: text$/m)
    expect(markdown).toContain('\\:: term')
    expect(carveToHtml(markdownToCarve(markdown))).toBe(carveToHtml(source))
  })

  it('leaves a colon outside a closed list as a separate paragraph', () => {
    const source = '- one\n  :: term\n:  def\n'
    const markdown = carveToMarkdown(source, { roundtrip: true })
    expect(markdown).toContain('\n:  def\n')
    expect(carveToHtml(markdownToCarve(markdown))).toBe(carveToHtml(source))
  })
})
