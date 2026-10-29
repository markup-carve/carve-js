import { describe, it, expect } from 'vitest'
import { carveToCarve, carveToHtml } from '../src/index.js'

// PART 9 §17 L3 and §10 I4: an attached fence keeps its caption; a folded opener is paragraph text.
describe('an attached fence keeps its caption', () => {
  it.each([
    ['backtick bullet', '- x\n+\n```\nx\n```\n^ cap\n- c\n', '<pre><code>x\n</code></pre>'],
    ['tilde bullet', '- x\n+\n~~~\nx\n~~~\n^ cap\n- c\n', '<pre><code>x\n</code></pre>'],
    ['backtick first block', '- +\n```\nx\n```\n^ cap\n- c\n', '<pre><code>x\n</code></pre>'],
    ['tilde first block', '- +\n~~~\nx\n~~~\n^ cap\n- c\n', '<pre><code>x\n</code></pre>'],
    ['ordered', '1. x\n+\n```\nx\n```\n^ cap\n2. c\n', '<pre><code>x\n</code></pre>'],
    ['colon figure', '- x\n+\n::: figure\n![a](b.png)\n:::\n^ cap\n- c\n', '<figure class="carve-figure-group">'],
    ['colon first block', '- +\n::: figure\n![a](b.png)\n:::\n^ cap\n- c\n', '<figure class="carve-figure-group">'],
  ])('%s', (_name, src, block) => {
    const html = carveToHtml(src)
    expect(html).toContain(block)
    expect(html).toContain('<figcaption>cap</figcaption>')
    expect(html).toContain('<li>c</li>')
    expect(html).not.toContain('<p>^ cap')
  })

  it.each([
    '- x\n  ```\n  x\n  ```\n\n  ^ cap\n- c\n',
    '- - text\n  ```\n  x\n  ```\n\n  ^ cap\n- c\n',
    '- x\n  ~~~\n  x\n  ~~~\n\n  ^ cap\n- c\n',
  ])('round-trips the formatted fence and caption', src => {
    const formatted = carveToCarve(src)
    expect(carveToHtml(formatted)).toBe(carveToHtml(src))
    expect(carveToCarve(formatted)).toBe(formatted)
  })

  it('a blank detaches the caret', () => {
    expect(carveToHtml('- x\n+\n```\nx\n```\n\n^ cap\n')).not.toContain('<figcaption>')
  })

  it.each([
    ['note', '<aside class="admonition note" aria-label="Note">'],
    ['aside', '<div class="aside">'],
  ])('a %s fence leaves the caption outside the list', (kind, block) => {
    const html = carveToHtml(`- x\n+\n::: ${kind}\nhi\n:::\n^ cap\n- c\n`)
    expect(html).toContain(block)
    expect(html).toContain('<p>hi</p>')
    expect(html).toContain('</li>\n</ul>\n<p>^ cap\n- c</p>')
  })

  it.each([
    ['label', '::: figure [label]', '<p class="div-label">label</p>'],
    ['title', '::: figure "t"', '<p class="admonition-title">t</p>'],
  ])('a figure fence with a %s leaves the caption outside the list', (_kind, opener, metadata) => {
    const html = carveToHtml(`- x\n+\n${opener}\nhi\n:::\n^ cap\n- c\n`)
    expect(html).toContain('<div class="figure">')
    expect(html).toContain(metadata)
    expect(html).toContain('<p>hi</p>')
    expect(html).toContain('</li>\n</ul>\n<p>^ cap\n- c</p>')
    expect(html).not.toContain('<figcaption>')
  })

  it('an unclosed attached fence consumes the remaining lines', () => {
    const html = carveToHtml('- x\n+\n```\nx\n^ cap\n- c\n')
    expect(html).toContain('<pre><code>x\n^ cap\n- c\n</code></pre>')
    expect(html.match(/<li>/g)).toHaveLength(1)
  })

})

describe('a lazily folded fence line leaves the outer list loose', () => {
  it.each(['```', '~~~'])('%s opens a fence, so its blank leaves the list tight', fence => {
    const src = `- - text\n  ${fence}\n  x\n\n  cap\n- c\n`
    expect(carveToHtml(src)).toContain('<pre><code>x\n\ncap\n</code></pre>\n  </li>\n  <li>c</li>')
  })

  it('a block image control remains loose', () => {
    expect(carveToHtml('- - text\n  ![i](x.png)\n  x\n\n  cap\n- c\n'))
      .toContain('    <p>cap</p>\n  </li>\n  <li><p>c</p></li>')
  })

  it('without the blank the list stays tight', () => {
    expect(carveToHtml('- - text\n  ```\n  x\n  cap\n- c\n')).toContain('  <li>c</li>')
  })
})
