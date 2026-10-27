import { expect, it } from 'vitest'
import { parse, renderHtml } from '../src/index.js'

it('ends a quoted term before a closed fence below the quote column', () => {
  expect(renderHtml(parse('> :: t\n```\n```'))).toBe('<blockquote>\n  <dl>\n    <dt>t</dt>\n  </dl>\n</blockquote>\n<pre><code></code></pre>')
})

it('keeps a fence without a closer in the quoted term', () => {
  expect(renderHtml(parse('> :: t\n```'))).toBe('<blockquote>\n  <dl>\n    <dt>t\n<code></code></dt>\n  </dl>\n</blockquote>')
})
