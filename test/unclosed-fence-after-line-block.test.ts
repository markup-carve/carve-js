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

// A comment line leaves no paragraph open, so the unclosed fence below it
// still ends at the innermost container's own closer (spec corpus 597).
it.each([
  ["::: note\n%% c\n```\ncode\n::::\n:::\nafter *b*\n", "<aside class=\"admonition note\" aria-label=\"Note\">\n  <pre><code>code\n::::\n</code></pre>\n</aside>\n<p>after <strong>b</strong></p>\n"],
  ["::: outer\n:::: inner\n%% c\n```\ncode\n:::\n::::\n:::\nafter *b*\n", "<div class=\"outer\">\n  <div class=\"inner\">\n    <pre><code>code\n:::\n</code></pre>\n  </div>\n</div>\n<p>after <strong>b</strong></p>\n"],
])('ends an unclosed fence after a comment line at the innermost closer', (source, expected) => {
  expect(carveToHtml(source).trim()).toBe(expected.trim())
})

// Under an open paragraph, a quote's or an item's included, an unclosed fence
// opens nothing (§10 I4), so the colon lines below it are openers, as at the
// top level (spec corpus 604).
it.each([
  ['para', '  <p>para\n<code>\ncode</code></p>\n'],
  ['> quote', '  <blockquote><p>quote\n<code>\ncode</code></p></blockquote>\n'],
  ['- item', '  <ul>\n    <li>item\n<code>\ncode</code></li>\n  </ul>\n'],
])('keeps an unclosed fence under an open %s paragraph as text', (first, block) => {
  const source = '::: note\n' + first + '\n```\ncode\n::::\n:::\nafter *b*\n'
  const expected = '<aside class="admonition note" aria-label="Note">\n' + block +
    '  <div>\n    <div>\n      <p>after <strong>b</strong></p>\n    </div>\n  </div>\n</aside>\n'
  expect(carveToHtml(source).trim()).toBe(expected.trim())
})

it.each([
  '- a\n    - ```\n      x\n    ```\nafter\n',
  '- a\n    - child\n      - # h\n    ```\nafter\n',
  '- a\n    - child\n\n        - g\n\n          ```\n          x\n          ```\n    ```\nafter\n',
])('does not retain a child paragraph after structural content', source => {
  expect(carveToHtml(source)).toContain('<pre><code>after\n</code></pre>')
})

// A quote or item whose only content is a comment leaves no paragraph open
// either (spec corpus 597).
it.each([
  ['> %% c', '  <blockquote>\n\n  </blockquote>\n'],
  ['- %% c', '  <ul>\n    <li></li>\n  </ul>\n'],
])('ends an unclosed fence after a comment-only %s at the innermost closer', (first, block) => {
  const source = '::: note\n' + first + '\n```\ncode\n::::\n:::\nafter *b*\n'
  const expected = '<aside class="admonition note" aria-label="Note">\n' + block +
    '  <pre><code>code\n::::\n</code></pre>\n</aside>\n<p>after <strong>b</strong></p>\n'
  expect(carveToHtml(source).trim()).toBe(expected.trim())
})

// A block-attribute line leaves no paragraph open either, bare or as the only
// content of a quote or item (spec corpus 606).
it.each([
  ['{#x}', '  <pre id="x"><code>code\n::::\n</code></pre>\n'],
  ['> {#x}', '  <blockquote>\n\n  </blockquote>\n  <pre><code>code\n::::\n</code></pre>\n'],
  ['- {#x}', '  <ul>\n    <li></li>\n  </ul>\n  <pre><code>code\n::::\n</code></pre>\n'],
])('ends an unclosed fence after the attribute line %s at the innermost closer', (first, block) => {
  const source = '::: note\n' + first + '\n```\ncode\n::::\n:::\nafter *b*\n'
  const expected = '<aside class="admonition note" aria-label="Note">\n' + block +
    '</aside>\n<p>after <strong>b</strong></p>\n'
  expect(carveToHtml(source).trim()).toBe(expected.trim())
})

it('ends an unclosed fence after an attribute line at a nested container closer', () => {
  const source = '::: outer\n:::: inner\n{.c}\n```\ncode\n:::\n::::\n:::\nafter *b*\n'
  expect(carveToHtml(source).trim()).toBe('<div class="outer">\n  <div class="inner">\n    <pre class="c"><code>code\n:::\n</code></pre>\n  </div>\n</div>\n<p>after <strong>b</strong></p>')
})
