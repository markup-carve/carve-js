import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

const compact = (source: string): string => carveToHtml(source).replace(/>\s+</g, '><').trim()

// carve#4734, PART 9 §17 L1: `p` has left the nested list, so `q` is the item's second paragraph at any column.
describe('paragraphs after a closed marker-line child', () => {
  it.each([
    ['an unclosed div', '- - :::\n  p\n\n    q\n', '<ul><li><ul><li><div></div></li></ul><p>p</p><p>q</p></li></ul>'],
    ['a heading', '- - # h\n  p\n\n    q\n', '<ul><li><ul><li><h1 id="h">h</h1></li></ul><p>p</p><p>q</p></li></ul>'],
    ['q at the item column', '- - # h\n  p\n\n  q\n', '<ul><li><ul><li><h1 id="h">h</h1></li></ul><p>p</p><p>q</p></li></ul>'],
  ])('loosen the item: %s', (_name, source, html) => {
    expect(compact(source)).toBe(html)
  })

  it('a paragraph that reaches the nested column stays in that list', () => {
    expect(compact('- - a\n\n    q\n')).toBe('<ul><li><ul><li><p>a</p><p>q</p></li></ul></li></ul>')
  })
})
