import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const source = (lead: string, indent: number, fence: string) => {
  const pad = ' '.repeat(indent)
  return `x[^1]\n\n[^1]: ${lead}\n\n${pad}${fence}\n${pad}c\n${pad}\`\`\`\n`
}

describe('CARVE-P0-004: a fence after a footnote quote has its own base', () => {
  for (const lead of ['> q', 'q']) {
    for (const fence of ['```js', '```=latex']) {
      for (let indent = 2; indent <= 8; indent++) {
        it(`${lead}, ${fence}, column ${indent}`, () => {
          const html = carveToHtml(source(lead, indent, fence))
          expect(html).toBe(carveToHtml(source(lead, 2, fence)))
          if (fence === '```js') expect(html).toContain('<pre><code class="language-js">c\n</code></pre>')
          else {
            const backlink = '<a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a>'
            const body = lead === '> q'
              ? `<blockquote><p>q</p></blockquote>\n      <p>${backlink}</p>`
              : `<p>q${backlink}</p>`
            expect(html.match(/<li id="fn1">([\s\S]*?)<\/li>/)?.[1]?.trim()).toBe(body)
          }
        })
      }
    }
  }


  for (const indent of [2, 3, 8]) {
    it(`keeps the no-blank quote boundary at column ${indent}`, () => {
      const html = carveToHtml(source('> q', indent, '```js').replace('> q\n\n', '> q\n'))
      if (indent === 2) expect(html).toContain('<pre><code class="language-js">c\n</code></pre>')
      else expect(html).toContain('<blockquote><p>q\n<code>js\nc\n</code></p></blockquote>')
    })
  }

  it('keeps quoted fence payload indentation', () => {
    const html = carveToHtml('x[^1]\n\n[^1]: > ~~~\n  >  ```\n  > ~~~\n')
    expect(html).toContain('<pre><code> ```\n</code></pre>')
  })

  it('rebases a fence after a shifted quote too', () => {
    const html = carveToHtml('x[^1]\n\n[^1]: p\n\n   > q\n\n    ```js\n    c\n    ```\n')
    expect(html).toContain('<blockquote><p>q</p></blockquote>')
    expect(html).toContain('<pre><code class="language-js">c\n</code></pre>')
  })
})
