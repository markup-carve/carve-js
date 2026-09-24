import { describe, expect, it } from 'vitest'
import { carveToHtml, markdownToCarve } from '../src/index.js'

describe('Markdown import keeps a code block\'s blank lines', () => {
  it.each([
    ['a fenced block', '```\na\n\n\nb\n```\n', '```\na\n\n\nb\n```\n'],
    ['a fenced block with a language', '``` js\nx\n\n\ny\n```\n', '```js\nx\n\n\ny\n```\n'],
    ['an indented block', '    a\n\n\n    b\n', '```\na\n\n\nb\n```\n'],
    ['a tilde fence', '~~~\na\n\n\nb\n~~~\n', '```\na\n\n\nb\n```\n'],
    ['a raw HTML block', '<pre>\na\n\n\nb\n</pre>\n', '```=html\n<pre>\na\n\n\nb\n</pre>\n```\n'],
  ])('keeps the run in %s', (_name, source, expected) => {
    expect(markdownToCarve(source)).toBe(expected)
  })

  it('carries the blank lines through to the render', () => {
    expect(carveToHtml(markdownToCarve('```\na\n\n\nb\n```\n')))
      .toBe('<pre><code>a\n\n\nb\n</code></pre>')
  })

  it('reads a quoted block the same way as a bare one', () => {
    expect(carveToHtml(markdownToCarve('> ```\n> a\n>\n>\n> b\n> ```\n')))
      .toBe('<blockquote>\n  <pre><code>a\n\n\nb\n</code></pre>\n</blockquote>')
  })

  it('still collapses a blank run between two blocks', () => {
    expect(markdownToCarve('a\n\n\n\nb\n')).toBe('a\n\nb\n')
    expect(markdownToCarve('```\na\n```\n\n\n\nb\n')).toBe('```\na\n```\n\nb\n')
  })
})
