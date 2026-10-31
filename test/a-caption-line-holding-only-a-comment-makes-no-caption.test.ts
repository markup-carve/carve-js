import { describe, expect, it } from 'vitest'

import { carveToHtml, parse, renderCarve } from '../src/index.js'

// carve#4559: a caret whose content is only comments opens no caption.
describe('a caption line holding only a comment', () => {
  it.each([
    ["| a |\n^ %% x\n", "<table>\n  <tbody>\n    <tr><td>a</td></tr>\n  </tbody>\n</table>\n<p>^</p>"],
    ["> q\n\n^ %% x\n", "<blockquote><p>q</p></blockquote>\n<p>^</p>"],
    ["| a |\n^ {% x %}\n", "<table>\n  <tbody>\n    <tr><td>a</td></tr>\n  </tbody>\n</table>\n<p>^ </p>"],
    ["| a |\n^ {% x %} %% y\n", "<table>\n  <tbody>\n    <tr><td>a</td></tr>\n  </tbody>\n</table>\n<p>^ </p>"],
    ["```\nc\n```\n^ {% a %}{% b %}\n", "<pre><code>c\n</code></pre>\n<p>^ </p>"],
    ["> q\n^ %% x\nmore\n", "<blockquote><p>q\n^\nmore</p></blockquote>"],
    ["| a |\n^ {% x %}y\n", "<table>\n  <caption>y</caption>\n  <tbody>\n    <tr><td>a</td></tr>\n  </tbody>\n</table>"],
    ["> q\n^ {% x %} y\n", "<figure>\n  <blockquote><p>q</p></blockquote>\n  <figcaption> y</figcaption>\n</figure>"],
    ["| a |\n^ a %% x\n", "<table>\n  <caption>a</caption>\n  <tbody>\n    <tr><td>a</td></tr>\n  </tbody>\n</table>"],
  ])('%j', (source, html) => {
    expect(carveToHtml(source)).toBe(html)
  })

  it('keeps the blank line above a comment-only caret line when formatting', () => {
    const source = '> q\n\n^ %% x\n'
    expect(carveToHtml(renderCarve(parse(source)))).toBe(carveToHtml(source))
  })
})
