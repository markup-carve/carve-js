import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const table = (rows: string[], indent: string) =>
  `${indent}<table>\n${indent}  <tbody>\n${rows.map((r) => `${indent}    <tr><td>${r}</td></tr>\n`).join('')}${indent}  </tbody>\n${indent}</table>`

it('keeps a table a stacked + attached under a task item whole (carve#5586)', () => {
  expect(carveToHtml('- [ ] - +\n      | a |\n      | b |\n\n      q\n').trim()).toBe(
    `<ul class="task-list">\n  <li><input type="checkbox" disabled> \n    <ul>\n      <li>\n${table(['a', 'b'], '        ')}\n      </li>\n    </ul>\n    <p>q</p>\n  </li>\n</ul>`)
})

it('keeps a quote attached the same way whole', () => {
  expect(carveToHtml('- [ ] - +\n      > a\n      > b\n').trim()).toBe(
    '<ul class="task-list">\n  <li><input type="checkbox" disabled> \n    <ul>\n      <li>\n        <blockquote><p>a\nb</p></blockquote>\n      </li>\n    </ul>\n  </li>\n</ul>')
})

it('keeps the table whole under an ordered inner item', () => {
  expect(carveToHtml('- [x] 1. +\n      | a |\n      | b |\n').trim()).toBe(
    `<ul class="task-list">\n  <li data-task-state="x"><input type="checkbox" checked disabled> \n    <ol>\n      <li>\n${table(['a', 'b'], '        ')}\n      </li>\n    </ol>\n  </li>\n</ul>`)
})
