import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it('opens a code block in a box after a closed nested line block', () => {
  const source = '> - ::: box\n>   - ::: |\n>     ```\n>     :::\n>    ```\n>    :::bad\n>    :::\n- tail'
  const html = carveToHtml(source)
  expect(html).toContain('<pre><code>:::bad\n:::\n</code></pre>')
})

it('keeps deeper colon runs as code after a closed quoted child', () => {
  const source = '> - ::: box\n>   -   ::: |\n>       ```\n>       :::\n>     ```\n>     :::\n>     :::bad\n>     :::\n- tail\n'
  expect(carveToHtml(source)).toContain('<pre><code>:::\n:::bad\n:::\n</code></pre>')
})

it('ends a quote after unclosed child and outer item fences', () => {
  const source = '> - a\n>     - child\n>     ```\n>\n>       ```\n>   ~~~\nafter\n'
  const html = carveToHtml(source)
  expect(html).toContain('</blockquote>\n<p>after</p>')
  expect(html.match(/<pre><code>/g)).toHaveLength(2)
})

it('does not revive a child paragraph after its code fence closes', () => {
  const source = '- a\n    - child\n      ```\n      x\n      ```\n    ```\nafter\n'
  expect(carveToHtml(source)).toContain('<pre><code>after\n</code></pre>')
})

it('stops an unclosed code fence at its nested container closer', () => {
  const source = ':::: note\n::: tip\n```\nx\n:::\nin note\n::::\n\nafter\n'
  const html = carveToHtml(source)
  expect(html).toContain('<pre><code>x\n</code></pre>')
  expect(html).toContain('<p>in note</p>')
  expect(html).toContain('</aside>\n<p>after</p>')
})

it.each([
  [':::: outer\n::: inner\n```\ncode\n::::\n:::\n::::\nafter *b*\n', '<pre><code>code\n::::\n</code></pre>'],
  ['::: outer\n:::: inner\n```\ncode\n:::\n::::\n:::\nafter *b*\n', '<pre><code>code\n:::\n</code></pre>'],
  ['::: a\n:::: b\n::::: c\n```\ncode\n:::\n::::\n:::::\n::::\n:::\nafter *b*\n', '<pre><code>code\n:::\n::::\n</code></pre>'],
])('ends an unclosed fence only at its own container closer, not an ancestor width', (source, code) => {
  const html = carveToHtml(source)
  expect(html).toContain(code)
  expect(html).toContain('</div>\n<p>after <strong>b</strong></p>')
})

// Spec corpus 597: inside an unclosed fence only the innermost container's
// own closer is structural; a closed fence stays opaque.
it.each([
  ["::: outer\n:::: inner\n```\ncode\n:::\n::::\n:::\nafter *b*\n", "<div class=\"outer\">\n  <div class=\"inner\">\n    <pre><code>code\n:::\n</code></pre>\n  </div>\n</div>\n<p>after <strong>b</strong></p>\n"],
  [":::: outer\n::: inner\n```\ncode\n::::\n:::\n::::\nafter *b*\n", "<div class=\"outer\">\n  <div class=\"inner\">\n    <pre><code>code\n::::\n</code></pre>\n  </div>\n</div>\n<p>after <strong>b</strong></p>\n"],
  ["::: note\n```\ncode\n::::\n:::\nafter *b*\n", "<aside class=\"admonition note\" aria-label=\"Note\">\n  <pre><code>code\n::::\n</code></pre>\n</aside>\n<p>after <strong>b</strong></p>\n"],
  ["::: outer\n:::: inner\n```\ncode\n:::\n```\n::::\n:::\nafter *b*\n", "<div class=\"outer\">\n  <div class=\"inner\">\n    <pre><code>code\n:::\n</code></pre>\n  </div>\n</div>\n<p>after <strong>b</strong></p>\n"],
])('renders the unclosed-fence-in-container reading the spec ruled', (source, expected) => {
  expect(carveToHtml(source).trim()).toBe(expected.trim())
})

it.each([
  '- a\n    - ```\n      x\n    ```\nafter\n',
  '- a\n    - child\n      - # h\n    ```\nafter\n',
  '- a\n    - child\n\n        - g\n\n          ```\n          x\n          ```\n    ```\nafter\n',
])('does not retain a child paragraph after structural content', source => {
  expect(carveToHtml(source)).toContain('<pre><code>after\n</code></pre>')
})
