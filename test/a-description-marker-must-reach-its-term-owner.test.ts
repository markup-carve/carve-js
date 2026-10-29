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
    expect(html).toMatch(/<dt>inner<\/dt>\s*<\/dl>\s*<p>:  tail<\/p>/)
    expect(html).not.toContain('<dd>tail</dd>')
  })

  it('folds a later quote past the surviving body column into the term', () => {
    const source = '- a\n  :: outer\n  :  detail\n       :: inner\n      :  tail\n      > quote\n'
    const html = carveToHtml(source)
    expect(html).toMatch(/<dt>inner\s+:  tail\s+&gt; quote<\/dt>/)
    expect(html).not.toContain('<blockquote>')
  })

  it.each([
    ['heading', '# H', '# H'],
    ['code fence', '```js\n      code\n      ```', '<code>js\ncode\n</code>'],
    ['table row', '| A | B |', '| A | B |'],
    ['attribute', '{#x}', '{<span class="tag"><strong>#x</strong></span>}'],
    ['thematic break', '---', '—'],
    ['colon fence', '::: note\n      text\n      :::', '::: note\ntext\n:::'],
  ])('folds a past-column %s into the open term', (_name, tail, rendered) => {
    const source = `- a\n  :: outer\n  :  detail\n       :: inner\n      :  tail\n      ${tail}\n`
    expect(normalize(carveToHtml(source))).toContain(`<dt>inner\n:  tail\n${rendered}</dt>`)
  })

  it('lets a list marker end a term even past the surviving body column', () => {
    const source = '- a\n  :: outer\n  :  detail\n       :: inner\n      :  tail\n      - item\n'
    const html = normalize(carveToHtml(source))
    expect(html).toContain('<dt>inner\n:  tail</dt>')
    expect(html).toMatch(/<\/dl>\n<ul>\n<li>item<\/li>/)
  })

  it('folds a closed below-column fence into an open outer description paragraph', () => {
    const source = '- a\n  :: outer\n  :  detail\n     :: inner\n    :  tail\n    ```js\n    code\n    ```\n'
    expect(normalize(carveToHtml(source))).toContain('<p>:  tail\n<code>js\ncode\n</code></p>')
  })

  it.each([
    ['document', ':: t\n: para\n ```js\n code\n ```\n'],
    ['list item', '- a\n  :: t\n  :  para\n    ```js\n    code\n    ```\n'],
  ])('ends an open %s description before a matched fence', (_name, source) => {
    expect(normalize(carveToHtml(source))).toContain('<dd>para</dd>\n</dl>\n<pre><code class="language-js">code\n</code></pre>')
  })
})
