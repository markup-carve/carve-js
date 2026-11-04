import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const compact = (html: string): string => html.replace(/>\s+</g, '><').trim()

// carve#5132 (option 1): a `> +` right after the paragraph a quote's `+` attached continues that quote, so its `+` is a letter.
describe('a quote plus after a quote-attached paragraph is a letter', () => {
  it.each([
    ['> +\nq\n> +\n', '<blockquote><p>q</p><p>+</p></blockquote>'],
    ['> +\nq\n> +\n\nz\n', '<blockquote><p>q</p><p>+</p></blockquote><p>z</p>'],
    ['> +\nq\n> +\nr\n', '<blockquote><p>q</p><p>+\nr</p></blockquote>'],
    ['> +\nq\n> +\n> x\n', '<blockquote><p>q</p><p>+\nx</p></blockquote>'],
    ['> +\nq\n> +\n# h\n', '<blockquote><p>q</p><p>+</p></blockquote><section id="h"><h1>h</h1></section>'],
  ])('%j', (source, html) => {
    expect(compact(carveToHtml(source))).toBe(html)
  })

  it('reads as a quote paragraph followed by a plus line', () => {
    expect(compact(carveToHtml('> a\n> +\n'))).toBe('<blockquote><p>a\n+</p></blockquote>')
  })
})
