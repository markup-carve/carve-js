import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const prefix = '<aside class="admonition note" aria-label="Note">\n'
const suffix = '  <pre><code>code\n::::\n</code></pre>\n</aside>\n<p>after <strong>b</strong></p>\n'

it.each([
  ['- para\n- %% c', '  <ul>\n    <li>para</li>\n    <li></li>\n  </ul>\n'],
  ['- para\n- {#x}', '  <ul>\n    <li>para</li>\n    <li></li>\n  </ul>\n'],
  ['1. para\n2. %% c', '  <ol>\n    <li>para</li>\n    <li></li>\n  </ol>\n'],
  ['1. para\n2. {#x}', '  <ol>\n    <li>para</li>\n    <li></li>\n  </ol>\n'],
  ['- para\n  - %% c', '  <ul>\n    <li>para\n      <ul>\n        <li></li>\n      </ul>\n    </li>\n  </ul>\n'],
  ['- para\n  - {#x}', '  <ul>\n    <li>para\n      <ul>\n        <li></li>\n      </ul>\n    </li>\n  </ul>\n'],
])('closes an item paragraph after %s', (items, list) => {
  const source = `::: note\n${items}\n\`\`\`\ncode\n::::\n:::\nafter *b*\n`
  expect(carveToHtml(source).trim()).toBe((prefix + list + suffix).trim())
})

it.each([
  ['- para\n- text', '  <ul>\n    <li>para</li>\n    <li>text\n<code>\ncode</code></li>\n  </ul>\n'],
  ['para\n- %% c', '  <p>para\n-\n<code>\ncode</code></p>\n'],
  ['> para\n> - %% c', '  <blockquote><p>para\n-\n<code>\ncode</code></p></blockquote>\n'],
  ['> para\n> - {#x}', '  <blockquote><p>para\n- {<span class="tag"><strong>#x</strong></span>}\n<code>\ncode</code></p></blockquote>\n'],
])('keeps a paragraph open after %s', (lead, block) => {
  const source = `::: note\n${lead}\n\`\`\`\ncode\n::::\n:::\nafter *b*\n`
  const expected = prefix + block + '  <div>\n    <div>\n      <p>after <strong>b</strong></p>\n    </div>\n  </div>\n</aside>\n'
  expect(carveToHtml(source).trim()).toBe(expected.trim())
})
