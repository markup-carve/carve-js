/*
 * markup-carve/carve#5191: the line a refused brace run keeps, and a fence
 * opener's lines through its closer, are paragraph text (CARVE-P2-035), so a
 * following line that misses its container folds into that paragraph (PART 0 S4).
 */
import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

const html = (lines: string[]): string => carveToHtml(lines.join('\n') + '\n').trim()

describe("a refused brace run's kept line", () => {
  it('leaves a quote paragraph open', () => {
    expect(html(['> a', '> {x', '> y}', '> # c', 'more'])).toBe('<blockquote><p>a\n{x\ny}\n# c\nmore</p></blockquote>')
  })

  it("leaves a plus paragraph open", () => {
    expect(html(['- a', '+', '{x', 'y}', '  # c', 'more'])).toBe('<ul>\n  <li>a\n    {x\ny}\n# c\nmore\n  </li>\n</ul>')
  })

  it.each([['***'], ['| c |'], ['```', 'b', '```']])('leaves a nested item paragraph open after %s', (...follower) => {
    const out = html(['- x', '  - a', '    {x', '    y}', ...follower.map(l => '    ' + l), 'more'])
    expect(out).toMatch(/more<\/li>\n {4}<\/ul>/)
    expect(out).not.toContain('<p>more</p>')
  })

  it.each(['- ', '> '])('keeps a fence through its closer behind %s', (prefix) => {
    const out = html([prefix + 'a', ...['{x', 'y}', '```', 'b', '```'].map(l => (prefix === '- ' ? '  ' : prefix) + l), 'more'])
    expect(out).toContain('<code>\nb\n</code>\nmore')
  })

  it('still ends the paragraph at a block after an unclosed fence opener', () => {
    expect(html(['> a', '> {x', '> y}', '> ```', '> b', '> # h', 'more'])).toBe(
      '<blockquote>\n  <p>a\n{x\ny}\n<code>\nb</code></p>\n  <h1 id="h">h</h1>\n</blockquote>\n<p>more</p>')
  })
})
