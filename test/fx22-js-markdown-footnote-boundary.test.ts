import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'
import { markdownToCarveWithLosses } from '../src/markdown-migrate.js'

it.each([
  ['- item', '<ul>'],
  ['* item', '<ul>'],
  ['1. item', '<ol>'],
  ['  9) item', '<ol start="9"'],
  ['   - item', '<ul>'],
  ['- [x] item', '<ul class="task-list">'],
])('keeps a Markdown %s outside the preceding footnote', (marker, listTag) => {
  const { value, losses } = markdownToCarveWithLosses(`See[^a].\n\n[^a]: one\n${marker}\n`)
  const html = carveToHtml(value)
  expect(losses).toEqual([])
  expect(html).toContain(listTag)
  expect(html.indexOf(listTag)).toBeLessThan(html.indexOf('<section role="doc-endnotes"'))
  expect(html).toContain('<p>one<a href="#fnref1"')
})
