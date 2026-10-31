import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const note = (body: string) => `- [^a]: text\n    [^b]: text\n${body}after [^a] [^b]\n`

for (const [name, body, expected] of [
  ['code fence', '\n    ~~~\n    code\n    ~~~\n', '<pre><code>code\n</code></pre>'],
  ['colon container', '    ::: n\n    x\n    :::\n', '<div class="n">\n        <p>x</p>\n      </div>'],
] as const) {
  it(`keeps an outer note's ${name} after a nested note`, () => {
    const html = carveToHtml(note(body))
    const outer = html.split('<li id="fn1">')[1]!.split('</li>')[0]!
    expect(outer).toContain(expected)
    expect(html).toContain('<ul>\n  <li></li>\n</ul>')
    expect(html).toContain('<p>after <a id="fnref1"')
  })
}
