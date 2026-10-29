import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// carve-js#3920 row 3: a tab after `: ` is leading whitespace before the body's first block (PART 0 S3).
const flat = (html: string): string => html.replace(/>\s+</g, '><').trim()

describe('a tab after a description separator', () => {
  const cases: Array<[string, string]> = [
    [':: term\n: \t::: x\n  verse\n  :::\n', '<dl><dt>term</dt><dd><div class="x"><p>verse</p></div></dd></dl>'],
    [':: term\n: \t```\n  code\n  ```\n', '<dl><dt>term</dt><dd><pre><code>code\n</code></pre></dd></dl>'],
    [':: term\n: \t# h\n', '<dl><dt>term</dt><dd><h1 id="h">h</h1></dd></dl>'],
    [':: term\n:  \t> q\n', '<dl><dt>term</dt><dd><blockquote><p>q</p></blockquote></dd></dl>'],
    ['> :: term\n> : \t\t- i\n', '<blockquote><dl><dt>term</dt><dd><ul><li>i</li></ul></dd></dl></blockquote>'],
    [':: term\n: \tpara\n  more\n', '<dl><dt>term</dt><dd>para\nmore</dd></dl>'],
  ]
  for (const [source, html] of cases) {
    it(`opens the body's first block: ${JSON.stringify(source)}`, () => {
      expect(flat(carveToHtml(source))).toBe(html)
    })
  }
})
