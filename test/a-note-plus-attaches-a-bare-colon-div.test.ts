import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const html = (source: string) => carveToHtml(source).trim()

// carve-js#4588: a bare `:::` after a note's marker-line `+` opens the attached div; a div's own closer never reaches the note.
it.each([
  '[^m]: +\n:::\na\n:::\n\nsee[^m]\n',
  '::::\n[^m]: +\n:::\na\n:::\n::::\n\nsee[^m]\n',
  '- a\n  [^m]: +\n  :::\n  a\n  :::\n\nsee[^m]\n',
])('attaches the div to the note: %j', (source) => {
  expect(html(source)).toContain('<li id="fn1">\n      <div>\n        <p>a</p>\n      </div>')
})

it('leaves a div closer to the div', () => {
  expect(html('::: note\n[^m]: +\n:::\n\nsee[^m]\n')).toMatch(/^<aside class="admonition note" aria-label="Note">\n\n<\/aside>/)
})
