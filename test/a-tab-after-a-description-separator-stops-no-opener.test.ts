import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// CARVE-P2-010 (carve#4610, replacing carve-js#3920 row 3): a tab after `: ` is content, so the body's first line is paragraph text.
const flat = (html: string): string => html.replace(/>\s+</g, '><').trim()

describe('a tab after a description separator', () => {
  const cases: Array<[string, string]> = [
    [':: term\n: \t::: x\n  verse\n  :::\n', '<dl><dt>term</dt><dd><p>\t::: x\nverse</p><div></div></dd></dl>'],
    [':: term\n: \t```\n  code\n  ```\n', '<dl><dt>term</dt><dd><p><code>\ncode</code></p><pre><code></code></pre></dd></dl>'],
    [':: term\n: \t# h\n', '<dl><dt>term</dt><dd>\t# h</dd></dl>'],
    [':: term\n:  \t> q\n', '<dl><dt>term</dt><dd>\t&gt; q</dd></dl>'],
    ['> :: term\n> : \t\t- i\n', '<blockquote><dl><dt>term</dt><dd>\t\t- i</dd></dl></blockquote>'],
    [':: term\n: \tpara\n  more\n', '<dl><dt>term</dt><dd>\tpara\nmore</dd></dl>'],
  ]
  for (const [source, html] of cases) {
    it(`reads the body's first line as text: ${JSON.stringify(source)}`, () => {
      expect(flat(carveToHtml(source))).toBe(html)
    })
  }
})
