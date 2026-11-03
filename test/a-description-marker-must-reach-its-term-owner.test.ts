import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const normalize = (html: string): string => html.split('\n').map(line => line.trim()).join('\n')

const cases = [
  ['list item', '- a\n  :: outer\n  :  detail\n     :: inner\n    :  tail\n1. ordered\n'],
  ['quoted list item', '> - a\n>   :: outer\n>   :  detail\n>      :: inner\n>     :  tail\n> 1. ordered\n'],
  ['nested list item', '- shell\n  - a\n    :: outer\n    :  detail\n       :: inner\n      :  tail\n  1. ordered\n'],
] as const

describe('a definition marker below a nested term column', () => {
  it.each(cases)('%s stays in its surviving description', (_name, source) => {
    const html = carveToHtml(source)
    expect(html).toContain('<dt>inner</dt>')
    // A `: ` line is a sibling at any column where its list's owner reads it (CARVE-P0-024 S3, carve#4180).
    expect(html).toMatch(/<dt>inner<\/dt>\s*<\/dl>\s*<\/dd>\s*<dd>tail<\/dd>/)
  })

  // A block at the outer body's column opens in the outer description after the inner list (#3922, carve#3885).
  it.each([
    ['quote', '> quote', '<blockquote><p>quote</p></blockquote>'],
    ['heading', '# H', '<h1 id="H">H</h1>'],
    ['code fence', '```js\n      code\n      ```', '<pre><code class="language-js">code\n</code></pre>'],
    ['table row', '| A | B |', '<table>\n<tbody>\n<tr><td>A</td><td>B</td></tr>\n</tbody>\n</table>'],
    ['thematic break', '---', '<hr>'],
    ['colon fence', '::: note\n      text\n      :::', '<aside class="admonition note" aria-label="Note">\n<p>text</p>\n</aside>'],
  ])('opens a past-column %s in the outer description', (_name, tail, rendered) => {
    const source = `- a\n  :: outer\n  :  detail\n       :: inner\n      :  tail\n      ${tail}\n`
    expect(normalize(carveToHtml(source))).toContain(`<dt>inner</dt>\n<dd>tail</dd>\n</dl>\n${rendered}\n</dd>\n</dl>\n</li>`)
  })

  it('floats a past-column attribute to no block in the outer description', () => {
    const source = '- a\n  :: outer\n  :  detail\n       :: inner\n      :  tail\n      {#x}\n'
    expect(normalize(carveToHtml(source))).toContain('<dt>inner</dt>\n<dd>tail</dd>\n</dl>\n</dd>\n</dl>\n</li>')
  })

  // As in the spec model: the list ends the inner description and stays in the outer body.
  it('lets a list marker end the inner description past the surviving body column', () => {
    const source = '- a\n  :: outer\n  :  detail\n       :: inner\n      :  tail\n      - item\n'
    expect(normalize(carveToHtml(source))).toContain('<dt>inner</dt>\n<dd>tail</dd>\n</dl>\n<ul>\n<li>item</li>\n</ul>\n</dd>\n</dl>\n</li>')
  })

  it('ends a description sibling at a closed below-column fence', () => {
    const source = '- a\n  :: outer\n  :  detail\n     :: inner\n    :  tail\n    ```js\n    code\n    ```\n'
    expect(normalize(carveToHtml(source))).toContain('<dd>tail</dd>\n</dl>\n<pre><code class="language-js">code\n</code></pre>')
  })

  it.each([
    ['document', ':: t\n: para\n ```js\n code\n ```\n'],
    ['list item', '- a\n  :: t\n  :  para\n    ```js\n    code\n    ```\n'],
  ])('ends an open %s description before a matched fence', (_name, source) => {
    expect(normalize(carveToHtml(source))).toContain('<dd>para</dd>\n</dl>\n<pre><code class="language-js">code\n</code></pre>')
  })
})
