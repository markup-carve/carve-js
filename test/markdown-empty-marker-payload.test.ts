import { expect, test } from 'vitest'
import { markdownToCarve, carveToHtml } from '../src/index.js'

test('empty Markdown markers take their immediate paragraph and code payloads', () => {
  const source = '-\n  foo\n-\n  ```\n  bar\n  ```\n-\n      baz\n'
  expect(carveToHtml(markdownToCarve(source)).trim()).toBe('<ul>\n  <li>foo</li>\n  <li>\n    <pre><code>bar\n</code></pre>\n  </li>\n  <li>\n    <pre><code>baz\n</code></pre>\n  </li>\n</ul>')
})

test('a loose inner list leaves its outer list tight', () => {
  const html = carveToHtml(markdownToCarve('- a\n  - b\n\n    c\n- d\n'))
  expect(html).toContain('<li>a\n')
  expect(html).toContain('<li>d</li>')
  expect(html).toContain('<li><p>b</p>')
  expect(html).toContain('<p>c</p>')
})

test.each([
  ['1.\n   text', '<ol>\n  <li>text</li>\n</ol>'],
  ['-\n\ttext', '<ul>\n  <li>text</li>\n</ul>'],
  ['-\n  - nested', '<ul>\n  <li>\n    <ul>\n      <li>nested</li>\n    </ul>\n  </li>\n</ul>'],
  ['heading\n-', '<section id="heading">\n  <h2>heading</h2>\n</section>'],
])('empty-marker payload controls: %s', (source, expected) => {
  expect(carveToHtml(markdownToCarve(source)).trim()).toBe(expected)
})

test('empty nested markers keep their list payload', () => {
  const html = carveToHtml(markdownToCarve('-\n  -\n    foo'))
  expect(html.trim()).toBe('<ul>\n  <li>\n    <ul>\n      <li>foo</li>\n    </ul>\n  </li>\n</ul>')
})

test.each(['-\n  ---', '*\n  ***'])('a held thematic break stays in its empty-marker item: %s', source => {
  expect(carveToHtml(markdownToCarve(source)).trim()).toBe('<ul>\n  <li>\n    <hr>\n  </li>\n</ul>')
})

test('a tabbed nested thematic payload keeps both items', () => {
  const html = carveToHtml(markdownToCarve('-\n\t-\n\t  ---'))
  expect(html.match(/<ul>/g)).toHaveLength(2)
  expect(html).toContain('<hr>')
})

test('a tab after a nested marker still opens its item', () => {
  const html = carveToHtml(markdownToCarve('-\n  -\tfoo'))
  expect(html.match(/<ul>/g)).toHaveLength(2)
  expect(html).toContain('<li>foo</li>')
})

test('a held HTML block preserves its contents', () => {
  const source = '-\n  <script>\n  a *b* <c>\n  </script>'
  const written = markdownToCarve(source)
  expect(written).toContain('```=html')
  expect(written).toContain('a *b* <c>')
  expect(written).not.toContain('a /b/')
})

test.each(['---', '***', '<div>', '-'])('indented code after an empty marker stays code: %s', payload => {
  const html = carveToHtml(markdownToCarve(`-\n      ${payload}`))
  expect(html).toContain(`<pre><code>${payload.replace('<', '&lt;').replace('>', '&gt;')}\n</code></pre>`)
})

test('an empty sibling after nested payload keeps its item', () => {
  const html = carveToHtml(markdownToCarve('-\n  - a\n  -\n    b'))
  expect(html).toContain('<li>a</li>')
  expect(html).toContain('<li>b</li>')
  expect(html.match(/<ul>/g)).toHaveLength(2)
})

test('code after an empty marker leaves the following sibling tight', () => {
  const html = carveToHtml(markdownToCarve('-\n      ---\n- b'))
  expect(html).toContain('<pre><code>---\n</code></pre>')
  expect(html).toContain('<li>b</li>')
})

test('payload slack leaves the original item content column in place', () => {
  const html = carveToHtml(markdownToCarve('-\n    foo\n\n  bar'))
  expect(html.match(/<li>/g)).toHaveLength(1)
  expect(html).toContain('<p>foo</p>')
  expect(html).toContain('<p>bar</p>')
})

test('ordered siblings after an immediate code payload stay tight', () => {
  const html = carveToHtml(markdownToCarve('1.\n       code\n2. b'))
  expect(html).toContain('<pre><code>code\n</code></pre>')
  expect(html).toContain('<li>b</li>')
})
