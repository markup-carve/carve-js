import { describe, expect, it } from 'vitest'
import { markdownToCarve, parse, renderHtml } from '../src/index.js'

describe('Markdown literal text imports', () => {
  it.each([
    ['\\`not code`', '<p>`not code`</p>'],
    ['<https://x/\\`a`>', '<p><a href="https://x/%5C%60a%60">https://x/\\`a`</a></p>'],
    ['&#34; &#39;', '<p>" \'</p>'],
    ['&#0; &#xD800; &#1114112;', '<p>� � �</p>'],
    ['&#87654321; &#x1234567;', '<p>&amp;#87654321; &amp;#x1234567;</p>'],
    ['&notanentity; &angmsdaa;', '<p>&amp;notanentity; ⦨</p>'],
  ])('preserves %s', (source, expected) => {
    expect(renderHtml(parse(markdownToCarve(source))).trim()).toBe(expected)
  })
})
