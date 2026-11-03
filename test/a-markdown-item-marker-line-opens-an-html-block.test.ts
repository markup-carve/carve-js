import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml, markdownToCarve } from '../src/index.js'

// markup-carve/carve#4932: no paragraph is open at an item's start, so every
// HTML block start condition counts there, 7 included. Expected HTML is what
// cmark 0.31.2 and commonmark.js give for the source.
describe('a Markdown item marker line opens an HTML block', () => {
  const cases: Array<[string, string, string, string]> = [
    [
      'block tag, then a lazy-looking line that leaves the item',
      '- <div>\n  *a*\n<footer>y</footer>\n',
      '- ```=html\n  <div>\n  *a*\n  ```\n\n```=html\n<footer>y</footer>\n```\n',
      '<ul>\n  <li>\n    <div>\n*a*\n  </li>\n</ul>\n<footer>y</footer>',
    ],
    [
      'quoted item',
      '> - <div>\n>   *a*\n',
      '> - ```=html\n>   <div>\n>   *a*\n>   ```\n',
      '<blockquote>\n  <ul>\n    <li>\n      <div>\n*a*\n    </li>\n  </ul>\n</blockquote>',
    ],
    [
      'condition 7 in a quoted item',
      '> - <span>\n>   *a*\n',
      '> - ```=html\n>   <span>\n>   *a*\n>   ```\n',
      '<blockquote>\n  <ul>\n    <li>\n      <span>\n*a*\n    </li>\n  </ul>\n</blockquote>',
    ],
    [
      'second item of a quoted list',
      '> - a\n> - <div>\n',
      '> - a\n> - ```=html\n>   <div>\n>   ```\n',
      '<blockquote>\n  <ul>\n    <li>a</li>\n    <li>\n      <div>\n    </li>\n  </ul>\n</blockquote>',
    ],
    [
      'item in a quote an item holds',
      '- > - <div>\nx\n',
      '- > - ```=html\n  >   <div>\n  >   ```\n\nx\n',
      '<ul>\n  <li>\n    <blockquote>\n      <ul>\n        <li>\n          <div>\n        </li>\n      </ul>\n    </blockquote>\n  </li>\n</ul>\n<p>x</p>',
    ],
    [
      'blank line, then item content',
      '- <div>\n\n  x\n',
      '- ```=html\n  <div>\n  ```\n\n  x\n',
      '<ul>\n  <li>\n    <div>\n    <p>x</p>\n  </li>\n</ul>',
    ],
    [
      'empty marker line, condition 7 below it',
      '-\n  <span>\n  *a*\n',
      '- ```=html\n  <span>\n  *a*\n  ```\n',
      '<ul>\n  <li>\n    <span>\n*a*\n  </li>\n</ul>',
    ],
    [
      'an unclosed raw block keeps its blank, so the outer item stays tight',
      '- - <script>\n\n  x\n',
      '- - ```=html\n    <script>\n\n    ```\n  x\n',
      '<ul>\n  <li>\n    <ul>\n      <li>\n        <script>\n\n      </li>\n    </ul>\n    x\n  </li>\n</ul>',
    ],
  ]
  it.each(cases)('%s', (_name, markdown, carve, html) => {
    const written = markdownToCarve(markdown)
    expect(written).toBe(carve)
    expect(carveToCarve(written)).toBe(written)
    expect(carveToHtml(written)).toBe(html)
  })

  it('writes a lone comment on the marker line as a Carve comment', () => {
    expect(markdownToCarve('- <!-- note -->\n- b\n')).toBe('- %% note\n- b\n')
    expect(markdownToCarve('- > - <!-- c -->\nx\n')).toBe('- > - %% c\n\nx\n')
  })

  it('leaves an ordered marker that cannot interrupt a quoted paragraph in it', () => {
    expect(markdownToCarve('> hello\n> 2. <span>\n> world\n')).toBe('> hello\n> 2\\. `<span>`{=html}\n> world\n')
  })

  it('sets an item apart from the quoted paragraph it interrupts', () => {
    const written = markdownToCarve('> hello\n> - <div>\n>   x\n')
    expect(written).toBe('> hello\n>\n> - ```=html\n>   <div>\n>   x\n>   ```\n')
    expect(carveToHtml(written)).toBe('<blockquote>\n  <p>hello</p>\n  <ul>\n    <li>\n      <div>\nx\n    </li>\n  </ul>\n</blockquote>')
  })

  it('sets an item apart from a quoted paragraph a lazy line continued', () => {
    expect(markdownToCarve('> hello\nlazy\n> - <div>\n')).toBe('> hello\n> lazy\n>\n> - ```=html\n>   <div>\n>   ```\n')
  })

  it('counts a tab after the content column as the columns it covers', () => {
    const written = markdownToCarve('- a\n\n  \t<div>\n')
    expect(written).toBe('- a\n\n  ```=html\n  <div>\n  ```\n')
    expect(carveToHtml(written)).toBe('<ul>\n  <li><p>a</p>\n    <div>\n  </li>\n</ul>')
  })
})
