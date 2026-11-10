/*
 * A refused brace run claims no lines (carve#5830 rule A, replacing the kept-line
 * reading of carve#5191): the line after it is read normally, so a block there
 * ends the paragraph and a line that misses its container does not fold back.
 */
import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

const html = (lines: string[]): string => carveToHtml(lines.join('\n') + '\n').trim()

describe('the line after a refused brace run', () => {
  it('ends a quote paragraph at a heading', () => {
    expect(html(['> a', '> {x', '> y}', '> # c', 'more'])).toBe('<blockquote>\n  <p>a\n{x\ny}</p>\n  <h1 id="c">c</h1>\n</blockquote>\n<p>more</p>')
  })

  it('ends a plus paragraph at a heading', () => {
    expect(html(['- a', '+', '{x', 'y}', '  # c', 'more'])).toBe('<ul>\n  <li>a\n    {x\ny}\n    <h1 id="c">c</h1>\n  </li>\n</ul>\n<p>more</p>')
  })

  it.each([
    [['***'], '<hr>'],
    [['| c |'], '<table>\n          <tbody>\n            <tr><td>c</td></tr>\n          </tbody>\n        </table>'],
    [['```', 'b', '```'], '<pre><code>b\n</code></pre>'],
  ])('ends a nested item paragraph at %j', (follower, block) => {
    expect(html(['- x', '  - a', '    {x', '    y}', ...follower.map(l => '    ' + l), 'more'])).toBe(
      `<ul>\n  <li>x\n    <ul>\n      <li>a\n{x\ny}\n        ${block}\n      </li>\n    </ul>\n  </li>\n</ul>\n<p>more</p>`)
  })

  it.each([['b'], ['# h']])('opens a fence in an item whose payload is %s', (line) => {
    expect(html(['- a', ...['{x', 'y}', '```', line, '```'].map(l => '  ' + l), 'more'])).toBe(
      `<ul>\n  <li>a\n{x\ny}\n    <pre><code>${line}\n</code></pre>\n  </li>\n</ul>\n<p>more</p>`)
  })

  it.each([['b'], ['# h']])('opens a fence in a quote whose payload is %s', (line) => {
    expect(html(['> a', ...['{x', 'y}', '```', line, '```'].map(l => '> ' + l), 'more'])).toBe(
      `<blockquote>\n  <p>a\n{x\ny}</p>\n  <pre><code>${line}\n</code></pre>\n</blockquote>\n<p>more</p>`)
  })

  it('keeps an unclosed fence inside its quote', () => {
    expect(html(['> a', '> {x', '> y}', '> ```', '> # h', '- x', '  ```', 'more'])).toBe(
      '<blockquote>\n  <p>a\n{x\ny}</p>\n  <pre><code># h\n</code></pre>\n</blockquote>\n<ul>\n  <li>x\n    <pre><code></code></pre>\n  </li>\n</ul>\n<p>more</p>')
  })

  it('takes block-shaped lines into an unclosed fence', () => {
    expect(html(['> a', '> {x', '> y}', '> ```', '> b', '> # h', 'more'])).toBe(
      '<blockquote>\n  <p>a\n{x\ny}</p>\n  <pre><code>b\n# h\n</code></pre>\n</blockquote>\n<p>more</p>')
  })
})
