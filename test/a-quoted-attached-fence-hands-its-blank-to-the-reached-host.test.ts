import { describe, expect, it } from 'vitest'
import { carveToHtml, decisionTrace } from '../src/index.js'

// carve#5401: quote prefixes are stripped before columns are measured, so the
// line after the blank that ends an unclosed attached fence opens a block in the
// deepest host it reaches, inside a quote exactly as at top level.
const strip = (source: string): string => source.replace(/^> ?/gm, '')

describe('an unclosed fence attached by a nested marker-line plus inside a quote', () => {
  it('opens a quote in the outer item one column past its content column', () => {
    const source = '> - a\n>   * +\n>   ```\n>\n>    > q\n'
    const trace = decisionTrace(source)
    expect(trace.find((record) => record.line === 4)?.owner).toBe('doc/quote:1/item:1')
    expect(trace.find((record) => record.line === 5)?.owner).toBe('doc/quote:1/item:1/quote:5')
    expect(carveToHtml(source)).toBe(`<blockquote>
  <ul>
    <li><p>a</p>
      <ul>
        <li>
          <pre><code></code></pre>
        </li>
      </ul>
      <blockquote><p>q</p></blockquote>
    </li>
  </ul>
</blockquote>`)
  })

  it.each([
    ['> q'], ['# h'], ['| a |'], ['::: n'], ['```'], ['- q'], ['1. q'], ['tail'],
  ])('reads %s as the top-level form does, at every quote depth and fence', (follower) => {
    for (const fence of ['```', '~~~', '```js']) {
      for (const prefix of ['> ', '> > ']) {
        const quoted = `- a\n  * +\n  ${fence}\n\n   ${follower}\n`.split('\n')
          .map((line) => line === '' ? prefix.trimEnd() : prefix + line).join('\n')
        const top = carveToHtml(strip(strip(quoted)))
        const html = carveToHtml(quoted).replace(/\s+/g, ' ')
        expect(html).toContain(top.replace(/\s+/g, ' '))
      }
    }
  })
})
