import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const normalize = (html: string) => html.replace(/\s+/g, ' ').replace(/ ?(<[^>]+>) ?/g, '$1').trim()
const lineBlock = (body: string) => `<div class="line-block"><p>${body}</p></div>`

// A payload line opens no fence in a line block (CARVE-P9-047), at any marker depth (carve-js#4254).
it.each([
  ['- a\n  - - ::: |\n      ~~~\nb\n', `<ul><li>a<ul><li><ul><li>${lineBlock('~~~<br>b')}</li></ul></li></ul></li></ul>`],
  ['- a\n  - ::: |\n    ~~~\nb\n', `<ul><li>a<ul><li>${lineBlock('~~~<br>b')}</li></ul></li></ul>`],
  ['- a\n  - - - ::: |\n        ~~~\nb\n', `<ul><li>a<ul><li><ul><li><ul><li>${lineBlock('~~~<br>b')}</li></ul></li></ul></li></ul></li></ul>`],
  ['- a\n  - - ::: |\n      ```\nb\n', `<ul><li>a<ul><li><ul><li>${lineBlock('<code>b</code>')}</li></ul></li></ul></li></ul>`],
])('keeps the lazy line of %j', (source, html) => {
  expect(normalize(carveToHtml(source))).toBe(normalize(html))
})

it('opens a fence below the line block column in the middle item', () => {
  expect(normalize(carveToHtml('- a\n  - - ::: |\n     ~~~\nb\n'))).toBe(normalize(
    `<ul><li>a<ul><li><ul><li><div class="line-block"></div></li></ul><pre><code></code></pre></li></ul></li></ul><p>b</p>`,
  ))
})
