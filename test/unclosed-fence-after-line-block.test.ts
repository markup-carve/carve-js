import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it('opens a code block in a box after a closed nested line block', () => {
  const source = '> - ::: box\n>   - ::: |\n>     ```\n>     :::\n>    ```\n>    :::bad\n>    :::\n- tail'
  const html = carveToHtml(source)
  expect(html).toContain('<pre><code>:::bad\n:::\n</code></pre>')
})

it('keeps deeper colon runs as fence payload after a closed quoted child', () => {
  const source = '> - ::: box\n>   -   ::: |\n>       ```\n>       :::\n>     ```\n>     :::\n>     :::bad\n>     :::\n- tail\n'
  expect(carveToHtml(source)).toContain('<pre><code>:::\n:::bad\n:::\n</code></pre>\n      </div>\n    </li>')
})

it('ends a quote after an unclosed item fence that holds a deeper run', () => {
  const source = '> - a\n>     - child\n>     ```\n>\n>       ```\n>   ~~~\nafter\n'
  const html = carveToHtml(source)
  expect(html).toContain('</blockquote>\n<p>after</p>')
  expect(html.match(/<pre><code>/g)).toHaveLength(1)
})

it('does not revive a child paragraph after its code fence closes', () => {
  const source = '- a\n    - child\n      ```\n      x\n      ```\n    ```\nafter\n'
  expect(carveToHtml(source)).toContain('<pre><code></code></pre>\n  </li>\n</ul>\n<p>after</p>')
})

it('runs an unclosed code fence in a nested div to the end of input', () => {
  const source = ':::: note\n::: tip\n```\nx\n:::\nin note\n::::\n\nafter\n'
  const html = carveToHtml(source)
  expect(html).toContain('<pre><code>x\n:::\nin note\n::::\n\nafter\n</code></pre>')
  expect(html).not.toContain('<p>')
})

it.each([
  [':::: outer\n::: inner\n```\ncode\n::::\n:::\n::::\nafter *b*\n', '<pre><code>code\n::::\n:::\n::::\nafter *b*\n</code></pre>'],
  ['::: outer\n:::: inner\n```\ncode\n:::\n::::\n:::\nafter *b*\n', '<pre><code>code\n:::\n::::\n:::\nafter *b*\n</code></pre>'],
  ['::: a\n:::: b\n::::: c\n```\ncode\n:::\n::::\n:::::\n::::\n:::\nafter *b*\n', '<pre><code>code\n:::\n::::\n:::::\n::::\n:::\nafter *b*\n</code></pre>'],
])('runs an unclosed fence past its own container closer and every ancestor closer', (source, code) => {
  const html = carveToHtml(source)
  expect(html).toContain(code)
  expect(html).not.toContain('<p>after')
})

// carve#4018: an unclosed fence's payload is opaque, so no `:::` closer inside it ends the div.
it.each([
  ["::: outer\n:::: inner\n```\ncode\n:::\n::::\n:::\nafter *b*\n", "<div class=\"outer\">\n  <div class=\"inner\">\n    <pre><code>code\n:::\n::::\n:::\nafter *b*\n</code></pre>\n  </div>\n</div>\n"],
  [":::: outer\n::: inner\n```\ncode\n::::\n:::\n::::\nafter *b*\n", "<div class=\"outer\">\n  <div class=\"inner\">\n    <pre><code>code\n::::\n:::\n::::\nafter *b*\n</code></pre>\n  </div>\n</div>\n"],
  ["::: note\n```\ncode\n::::\n:::\nafter *b*\n", "<aside class=\"admonition note\" aria-label=\"Note\">\n  <pre><code>code\n::::\n:::\nafter *b*\n</code></pre>\n</aside>\n"],
  ["::: outer\n:::: inner\n```\ncode\n:::\n```\n::::\n:::\nafter *b*\n", "<div class=\"outer\">\n  <div class=\"inner\">\n    <pre><code>code\n:::\n</code></pre>\n  </div>\n</div>\n<p>after <strong>b</strong></p>\n"],
])('renders the unclosed-fence-in-container reading the spec ruled', (source, expected) => {
  expect(carveToHtml(source).trim()).toBe(expected.trim())
})

it.each([
  ["::: note\n%% c\n```\ncode\n::::\n:::\nafter *b*\n", "<aside class=\"admonition note\" aria-label=\"Note\">\n  <pre><code>code\n::::\n:::\nafter *b*\n</code></pre>\n</aside>\n"],
  ["::: outer\n:::: inner\n%% c\n```\ncode\n:::\n::::\n:::\nafter *b*\n", "<div class=\"outer\">\n  <div class=\"inner\">\n    <pre><code>code\n:::\n::::\n:::\nafter *b*\n</code></pre>\n  </div>\n</div>\n"],
])('runs an unclosed fence after a comment line to the end of input', (source, expected) => {
  expect(carveToHtml(source).trim()).toBe(expected.trim())
})

// carve#4018: a fence opener interrupts an open paragraph, a quote's or an item's included.
it.each([
  ['para', '  <p>para</p>\n'],
  ['> quote', '  <blockquote><p>quote</p></blockquote>\n'],
  ['- item', '  <ul>\n    <li>item</li>\n  </ul>\n'],
])('interrupts an open %s paragraph with an unclosed fence', (first, block) => {
  const source = '::: note\n' + first + '\n```\ncode\n::::\n:::\nafter *b*\n'
  const expected = '<aside class="admonition note" aria-label="Note">\n' + block +
    '  <pre><code>code\n::::\n:::\nafter *b*\n</code></pre>\n</aside>\n'
  expect(carveToHtml(source).trim()).toBe(expected.trim())
})

it.each([
  '- a\n    - ```\n      x\n    ```\nafter\n',
  '- a\n    - child\n      - # h\n    ```\nafter\n',
  '- a\n    - child\n\n        - g\n\n          ```\n          x\n          ```\n    ```\nafter\n',
])('does not retain a child paragraph after structural content', source => {
  expect(carveToHtml(source)).toContain('<pre><code></code></pre>\n  </li>\n</ul>\n<p>after</p>')
})

it.each([
  ['> %% c', '  <blockquote>\n\n  </blockquote>\n'],
  ['- %% c', '  <ul>\n    <li></li>\n  </ul>\n'],
])('runs an unclosed fence after a comment-only %s to the end of input', (first, block) => {
  const source = '::: note\n' + first + '\n```\ncode\n::::\n:::\nafter *b*\n'
  const expected = '<aside class="admonition note" aria-label="Note">\n' + block +
    '  <pre><code>code\n::::\n:::\nafter *b*\n</code></pre>\n</aside>\n'
  expect(carveToHtml(source).trim()).toBe(expected.trim())
})

it.each([
  ['{#x}', '  <pre id="x"><code>code\n::::\n:::\nafter *b*\n</code></pre>\n'],
  ['> {#x}', '  <blockquote>\n\n  </blockquote>\n  <pre><code>code\n::::\n:::\nafter *b*\n</code></pre>\n'],
  ['- {#x}', '  <ul>\n    <li></li>\n  </ul>\n  <pre><code>code\n::::\n:::\nafter *b*\n</code></pre>\n'],
])('runs an unclosed fence after the attribute line %s to the end of input', (first, block) => {
  const source = '::: note\n' + first + '\n```\ncode\n::::\n:::\nafter *b*\n'
  const expected = '<aside class="admonition note" aria-label="Note">\n' + block +
    '</aside>\n'
  expect(carveToHtml(source).trim()).toBe(expected.trim())
})

it('runs an unclosed fence after an attribute line past a nested container closer', () => {
  const source = '::: outer\n:::: inner\n{.c}\n```\ncode\n:::\n::::\n:::\nafter *b*\n'
  expect(carveToHtml(source).trim()).toBe('<div class="outer">\n  <div class="inner">\n    <pre class="c"><code>code\n:::\n::::\n:::\nafter *b*\n</code></pre>\n  </div>\n</div>')
})

it.each([
  ['> para\n> more', '  <blockquote><p>para\nmore</p></blockquote>\n'],
  ['> a\n> b\n> c\n> d', '  <blockquote><p>a\nb\nc\nd</p></blockquote>\n'],
])('interrupts a multi-line quote paragraph with an unclosed fence', (first, block) => {
  const source = '::: note\n' + first + '\n```\ncode\n::::\n:::\nafter *b*\n'
  const expected = '<aside class="admonition note" aria-label="Note">\n' + block +
    '  <pre><code>code\n::::\n:::\nafter *b*\n</code></pre>\n</aside>\n'
  expect(carveToHtml(source).trim()).toBe(expected.trim())
})

it('runs an unclosed fence after a quoted comment to the end of input', () => {
  const source = '::: note\n> para\n> %% c\n```\ncode\n::::\n:::\nafter *b*\n'
  expect(carveToHtml(source).trim()).toBe('<aside class="admonition note" aria-label="Note">\n  <blockquote><p>para</p></blockquote>\n  <pre><code>code\n::::\n:::\nafter *b*\n</code></pre>\n</aside>')
})

it('runs an unclosed fence after a quoted attribute line to the end of input', () => {
  const source = '::: note\n> para\n> {#x}\n```\ncode\n::::\n:::\nafter *b*\n'
  expect(carveToHtml(source).trim()).toBe('<aside class="admonition note" aria-label="Note">\n  <blockquote><p>para</p></blockquote>\n  <pre><code>code\n::::\n:::\nafter *b*\n</code></pre>\n</aside>')
})
