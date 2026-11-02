import { describe, expect, it } from 'vitest'
import { carveToHtml, markdownToCarve } from '../src/index.js'
import { markdownToCarveWithLosses } from '../src/markdown-migrate.js'

// markup-carve/carve#4905: three CommonMark 0.30/0.31 readings, checked
// against the HTML commonmark.js 0.31.2 renders for the same input.

const written = (markdown: string) => markdownToCarve(markdown).replace(/\n+$/, '')
const html = (markdown: string) => carveToHtml(markdownToCarve(markdown)).replace(/\n+$/, '')

describe('a fence info word that already starts with language-', () => {
  it.each([
    ['backtick fence', '``` language-js\nx\n```', '```js\nx\n```'],
    ['tilde fence', '~~~language-c++\nx\n~~~', '```c++\nx\n```'],
    ['only one prefix is stripped', '```language-language-js\nx\n```', '```language-js\nx\n```'],
    ['other prefixes stay', '```xlanguage-js\nx\n```', '```xlanguage-js\nx\n```'],
    ['the prefix is case-sensitive', '```LANGUAGE-js\nx\n```', '```LANGUAGE-js\nx\n```'],
    ['inside a list item', '- ```language-js\n  x\n  ```', '- ```js\n  x\n  ```'],
    ['a tilde fence in a quote inside a list item', '- > ~~~language-js\n  > x\n  > ~~~', '- > ```js\n  > x\n  > ```'],
  ])('%s', (_name, markdown, carve) => {
    expect(written(markdown)).toBe(carve)
  })

  it('renders the class commonmark.js renders', () => {
    expect(html('``` language-js\nx\n```')).toBe('<pre><code class="language-js">x\n</code></pre>')
  })

  it('reports the bare prefix as a language Carve cannot spell', () => {
    const { value, losses } = markdownToCarveWithLosses('```language-\nx\n```\n')
    expect(value.trimEnd()).toBe('```\nx\n```')
    expect(losses.map(loss => loss.message)).toContain('Dropped code-block language "language-"; Carve cannot spell this language token.')
  })
})

describe('a declaration opens an HTML block in any case', () => {
  it.each([
    ['lowercase doctype', '<!doctype html>', '```=html\n<!doctype html>\n```'],
    ['mixed case doctype', '<!DocType html>', '```=html\n<!DocType html>\n```'],
    ['any declaration name', '<!element br EMPTY>', '```=html\n<!element br EMPTY>\n```'],
    ['after a paragraph', 'x\n<!doctype html>', 'x\n\n```=html\n<!doctype html>\n```'],
    ['in a block quote', '> <!doctype html>', '> ```=html\n> <!doctype html>\n> ```'],
  ])('%s', (_name, markdown, carve) => {
    expect(written(markdown)).toBe(carve)
  })

  it('renders as the block commonmark.js renders', () => {
    expect(html('x\n<!doctype html>')).toBe('<p>x</p>\n<!doctype html>')
  })
})

describe('a reference label that spans lines or holds a literal backslash', () => {
  it('a backslash before the newline keeps the link and its hard break', () => {
    expect(written('[a\\\nb]\n\n[a\\\nb]: /u')).toBe('[a\\\nb](/u)')
    expect(html('[a\\\nb]\n\n[a\\\nb]: /u')).toBe('<p><a href="/u">a<br>\nb</a></p>')
  })

  it.each([
    ['a shortcut over two lines', '[a\nb]\n\n[a\nb]: /u', '<p><a href="/u">a\nb</a></p>'],
    ['a collapsed reference over two lines', '[a\nb][]\n\n[a\nb]: /u', '<p><a href="/u">a\nb</a></p>'],
    ['a one-line definition, case folded', '[a\nb]\n\n[A B]: /u', '<p><a href="/u">a\nb</a></p>'],
    ['a backslash newline against a backslash space', 'see [a\\\nb] here\n\n[A\\ B]: /u', '<p>see <a href="/u">a<br>\nb</a> here</p>'],
    ['a literal backslash, collapsed', '[a\\ b][]\n\n[a\\ b]: /u', '<p><a href="/u">a\\ b</a></p>'],
    ['a literal backslash, full', '[t][a\\ b]\n\n[a\\ b]: /u', '<p><a href="/u">t</a></p>'],
    ['a quote inside a list item', '- > [a\n  > b]\n\n[a\nb]: /u', '<ul>\n  <li>\n    <blockquote><p><a href="/u">a\nb</a></p></blockquote>\n  </li>\n</ul>'],
    ['a collapsed reference in a quote inside a list item', '- > [a\n  > b][]\n\n[A B]: /u', '<ul>\n  <li>\n    <blockquote><p><a href="/u">a\nb</a></p></blockquote>\n  </li>\n</ul>'],
  ])('%s', (_name, markdown, rendered) => {
    expect(html(markdown)).toBe(rendered)
  })

  it('an escaped backslash is still an ordinary label', () => {
    expect(written('[a\\\\ b]\n\n[a\\\\ b]: /u')).toBe('[a\\\\ b][a\\\\ b]\n\n[a\\\\ b]: /u')
  })
})
