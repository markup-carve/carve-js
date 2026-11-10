import { describe, expect, it } from 'vitest'
import { carveToHtml, parse } from '../src/index.js'

// A refused opener's `{` is the only literal byte: the paragraph stays one inline parse (carve#5830 rule A).
describe('a refused brace opener inside an inline span', () => {
  it.each([
    ['*x\n{.a\n.b}\ny*\n', '<p><strong>x\n{.a\n.b}\ny</strong></p>'],
    ['[x\n{.a\n.b}\ny](url)\n', '<p><a href="url">x\n{.a\n.b}\ny</a></p>'],
    ['`x\n{.a\n.b}\ny`\n', '<p><code>x\n{.a\n.b}\ny</code></p>'],
  ])('pairs the span around %j', (source, html) => {
    expect(carveToHtml(source).trim()).toBe(html)
  })

  it('keeps the brace in one text node', () => {
    const paragraph = parse('{.a\n.b}\n').children[0] as { children: Array<{ type: string; value?: string }> }
    expect(paragraph.children.map((n) => [n.type, n.value])).toEqual([['text', '{.a'], ['soft_break', undefined], ['text', '.b}']])
  })
})
