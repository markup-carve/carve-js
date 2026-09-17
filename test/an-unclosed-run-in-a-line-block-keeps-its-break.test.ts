import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// An unclosed run ended at a forced or editorial closer drops the trailing
// whitespace a block end drops, except in a line block, where a line break is
// content (markup-carve/carve#2089, corpus 12-inline-code-11).

const html = (source: string) => carveToHtml(source).trim()

describe('an unclosed run ended at a pair closer', () => {
  it.each([
    ['a code span in a forced span', '::: |\nx{*`a\n*}\n:::', '<div class="line-block">\n  <p>x<strong><code>a\n</code></strong></p>\n</div>'],
    ['a code span in an insertion', '::: |\nx{+`a\n+}\n:::', '<div class="line-block">\n  <p>x<ins><code>a\n</code></ins></p>\n</div>'],
    ['a code span in a deletion', '::: |\nx{-`a\n-}\n:::', '<div class="line-block">\n  <p>x<del><code>a\n</code></del></p>\n</div>'],
    ['inline math', '::: |\nx{*$`a\n*}\n:::', '<div class="line-block">\n  <p>x<strong><span class="math inline" role="math">\\(a\n\\)</span></strong></p>\n</div>'],
    ['an inline literal', '::: |\nx{*!`a\n*}\n:::', '<div class="line-block">\n  <p>x<strong>a\n</strong></p>\n</div>'],
  ])('keeps the line break in a line block for %s', (_, source, expected) => {
    expect(html(source)).toBe(expected)
  })

  it('drops the line break in a paragraph', () => {
    expect(html('x{*`a\n*}')).toBe('<p>x<strong><code>a</code></strong></p>')
  })

  it('drops nothing new at the end of a line block stanza', () => {
    expect(html('::: |\nx`a\n:::')).toBe('<div class="line-block">\n  <p>x<code>a</code></p>\n</div>')
  })

  it('drops it again in a paragraph after a line block', () => {
    expect(html('::: |\nx\n:::\n\ny{*`a\n*}')).toBe('<div class="line-block">\n  <p>x</p>\n</div>\n<p>y<strong><code>a</code></strong></p>')
  })
})
