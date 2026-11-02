import { expect, it } from 'vitest'
import { carveToHtml, markdownToCarve } from '../src/index.js'

// carve#4921: a continuation line inside a code span takes no block-opener escape.
it.each([
  ['` tag\n    *   x\n    *   `\n', '`tag *   x *  `\n', '<p><code>tag *   x *  </code></p>'],
  ['`a\n    - b`\n', '`a - b`\n', '<p><code>a - b</code></p>'],
  ['``a\n    > b``\n', '`a > b`\n', '<p><code>a &gt; b</code></p>'],
  ['x `a\n    * b` and `c\n    1. d`\n', 'x `a * b` and `c 1. d`\n', '<p>x <code>a * b</code> and <code>c 1. d</code></p>'],
  ['`a\n    \\* b`\n', '`a \\* b`\n', '<p><code>a \\* b</code></p>'],
])('joins a code span over a continuation line: %j', (markdown, carve, html) => {
  const written = markdownToCarve(markdown)
  expect(written).toBe(carve)
  expect(carveToHtml(written)).toBe(html)
})

it('keeps the escape on a continuation line outside a code span', () => {
  expect(markdownToCarve('x `a\n    * b` *em\n    * c*\n')).toBe('x `a * b` /em\n\\* c/\n')
})

// carve#4939 reproduction 5: a closing tag whose `>` sits on a continuation line.
it.each([
  ['a </t\n\t> b\n', 'a `</t\n>`{=html} b\n', '<p>a </t\n> b</p>'],
  ['a <b\n    c=d> e\n', 'a `<b\nc=d>`{=html} e\n', '<p>a <b\nc=d> e</p>'],
])('keeps raw HTML over a continuation line: %j', (markdown, carve, html) => {
  const written = markdownToCarve(markdown)
  expect(written).toBe(carve)
  expect(carveToHtml(written)).toBe(html)
})

it('keeps the escape where the raw HTML line would open a Carve block', () => {
  expect(markdownToCarve('a <!--\n    # x --> d\n')).toBe('a `<!--\n\\# x -->`{=html} d\n')
})

// carve#4925: an image description flattens autolinks and hard breaks.
it.each([
  ['![<http://example.com>](logo.png)\n', '![http://example.com](logo.png)\n', '<img src="logo.png" alt="http://example.com">'],
  ['![<a@b.co>](u)\n', '![a@b.co](u)\n', '<img src="u" alt="a@b.co">'],
  ['![a\\\nb](u)\n', '![a\nb](u)\n', '<img src="u" alt="a\nb">'],
  ['![\\<http://a.b>](u)\n', '![<http://a.b>](u)\n', '<img src="u" alt="&lt;http://a.b&gt;">'],
  ['![a\\\\\nb](u)\n', '![a\\\nb](u)\n', '<img src="u" alt="a\\\nb">'],
  ['![a`\\`\nb](u)\n', '![a\\\nb](u)\n', '<img src="u" alt="a\\\nb">'],
])('flattens image alt text: %j', (markdown, carve, html) => {
  const written = markdownToCarve(markdown)
  expect(written).toBe(carve)
  expect(carveToHtml(written)).toBe(html)
})
