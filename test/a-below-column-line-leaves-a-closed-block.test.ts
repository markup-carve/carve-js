import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// PART 0 S4: a line that missed its frames folds only into the deepest open paragraph.
const flat = (html: string): string => html.replace(/>\s+</g, '><').trim()

describe('a below-column line leaves a closed block', () => {
  it.each([
    ['- - +\n  # h\nafter\n', '<ul><li><ul><li><h1 id="h">h</h1></li></ul></li></ul><p>after</p>'],
    ['- - +\n  :::\nafter\n', '<ul><li><ul><li><div></div></li></ul></li></ul><p>after</p>'],
    ['- - +\n  ---\nafter\n', '<ul><li><ul><li><hr></li></ul></li></ul><p>after</p>'],
    ['- - +\n  > q\n> z\n', '<ul><li><ul><li><blockquote><p>q</p></blockquote></li></ul></li></ul><blockquote><p>z</p></blockquote>'],
    ['- - +\n  ```\n  x\nafter\n', '<ul><li><ul><li><pre><code>x\n</code></pre></li></ul></li></ul><p>after</p>'],
  ])('%j: the block a stacked + takes', (source, html) => {
    expect(flat(carveToHtml(source))).toBe(html)
  })

  it('still folds into a paragraph the stacked + takes', () => {
    expect(flat(carveToHtml('- - +\n  p\nafter\n'))).toBe('<ul><li><ul><li>p\nafter</li></ul></li></ul>')
  })

  // markup-carve/carve#4086: a matched span changes no ownership, wherever its closer stands.
  it.each([
    ['- a\n  %%%\n  hidden\n%%%\n x\n', '<ul><li>a</li></ul><p>x</p>'],
    ['- a\n  %%%\n  hidden\n %%%\n x\n', '<ul><li>a</li></ul><p>x</p>'],
    ['- a\n  - %%%\n    hidden\n%%%\n { - x\n', '<ul><li>a<ul><li></li></ul></li></ul><p>{ - x</p>'],
  ])('%j: after a span closed below the column', (source, html) => {
    expect(flat(carveToHtml(source)).replace('a\n    <ul>', 'a<ul>')).toBe(html)
  })
})
