import { expect, it } from 'vitest'
import { importDocument } from '../import/src/index.ts'
import { render } from '../src/index.ts'

it('keeps a link when a backtick in its label pairs with one after its tail', () => {
  for (const [html, source] of [
    ['<p><a href="https://x.y">a`b</a>`</p>', '[a\\`b](https://x.y)\\`\n'],
    ['<blockquote><p><a href="https://x.y">a`b</a>`</p></blockquote>', '> [a\\`b](https://x.y)\\`\n'],
    ['<ul><li><a href="https://x.y">a`b</a>`</li></ul>', '- [a\\`b](https://x.y)\\`\n'],
  ] as const) {
    const result = importDocument(html, { from: 'html' })
    expect(result.source).toBe(source)
    expect(result.diagnostics).toEqual([])
    expect(render(result.source)).toContain('<a href="https://x.y">a`b</a>`')
  }
})

it.each([
  ['markdown', '<https://foo.bar.`baz>`\n', '[https://foo.bar.\\`baz](https://foo.bar.%60baz)\\`\n'],
  ['gfm', '<http://foo.bar.`baz>`\n', '[http://foo.bar.\\`baz](http://foo.bar.%60baz)\\`\n'],
] as const)('writes the %s autolink import without a link loss', (from, input, source) => {
  const result = importDocument(input, { from })
  expect(result.source).toBe(source)
  expect(result.diagnostics).toEqual([])
})
