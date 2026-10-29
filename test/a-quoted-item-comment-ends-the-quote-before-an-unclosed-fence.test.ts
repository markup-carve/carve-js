import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const prefix = '<aside class="admonition note" aria-label="Note">\n'
const tail = '  <pre><code>code\n::::\n:::\nafter *b*\n</code></pre>\n</aside>\n'
const unordered = '  <blockquote>\n    <ul>\n      <li>para</li>\n      <li></li>\n    </ul>\n  </blockquote>\n'

it.each([
  ['> - para\n> - %% c', unordered],
  ['> - para\n> - {#x}', unordered],
  ['> 1. para\n> 2. %% c', '  <blockquote>\n    <ol>\n      <li>para</li>\n      <li></li>\n    </ol>\n  </blockquote>\n'],
  ['> - para\n>   - %% c', '  <blockquote>\n    <ul>\n      <li>para\n        <ul>\n          <li></li>\n        </ul>\n      </li>\n    </ul>\n  </blockquote>\n'],
])('ends the quote after %s', (lead, quote) => {
  const source = `::: note\n${lead}\n\`\`\`\ncode\n::::\n:::\nafter *b*\n`
  expect(carveToHtml(source).trim()).toBe((prefix + quote + tail).trim())
})

it('ends a plain quoted paragraph too', () => {
  const source = '::: note\n> para\n> - %% c\n```\ncode\n::::\n:::\nafter *b*\n'
  const expected = prefix + '  <blockquote><p>para\n-</p></blockquote>\n' + tail
  expect(carveToHtml(source).trim()).toBe(expected.trim())
})
