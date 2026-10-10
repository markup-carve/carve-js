import { expect, it } from 'vitest'
import { carveToMarkdown, fromAstJson, renderMarkdown } from '../src/index.js'
import cases from './fixtures/markdown-terminal-hard-break.json'

it.each(cases)('keeps hard breaks for $template with $name', ({ document, markdown }) => {
  expect(renderMarkdown(fromAstJson(document))).toBe(markdown)
})

it.each([
  ['a\\\n', 'a<br>\n'],
  ['\\\n', '<br><!-- -->\n'],
  ['a\\\nb\n', 'a\\\nb\n'],
  ['a\\\n\\\n', 'a\\\n<br>\n'],
])('keeps parser-produced hard breaks for %s', (source, markdown) => {
  expect(carveToMarkdown(source)).toBe(markdown)
})
