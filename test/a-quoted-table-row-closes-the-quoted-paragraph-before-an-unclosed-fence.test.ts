import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const table = '    <table>\n      <tbody>\n        <tr><td>t</td></tr>\n      </tbody>\n    </table>\n'
const tail = '  <pre><code>code\n::::\n</code></pre>\n</aside>\n<p>after <strong>b</strong></p>\n'

it('closes a quoted paragraph at a quoted table row, so the fence ends at the note closer', () => {
  const source = '::: note\n> para\n> | t |\n```\ncode\n::::\n:::\nafter *b*\n'
  const expected = '<aside class="admonition note" aria-label="Note">\n  <blockquote>\n    <p>para</p>\n' +
    table + '  </blockquote>\n' + tail
  expect(carveToHtml(source).trim()).toBe(expected.trim())
})

it('keeps a quoted paragraph open at a quoted line that is not a table row', () => {
  const source = '::: note\n> para\n> | t\n```\ncode\n::::\n:::\nafter *b*\n'
  expect(carveToHtml(source)).not.toContain('<table>')
  expect(carveToHtml(source)).toContain('<p>after <strong>b</strong></p>\n    </div>')
})
