import { expect, it } from 'vitest'
import { parse, renderHtml } from '../src/index.js'

it('ends a quoted term before a closed fence below the quote column', () => {
  expect(renderHtml(parse('> :: t\n```\n```'))).toBe('<blockquote>\n  <dl>\n    <dt>t</dt>\n  </dl>\n</blockquote>\n<pre><code></code></pre>')
})

it('ends a quoted term before an unclosed fence below the quote column', () => {
  expect(renderHtml(parse('> :: t\n```'))).toBe('<blockquote>\n  <dl>\n    <dt>t</dt>\n  </dl>\n</blockquote>\n<pre><code></code></pre>')
})
