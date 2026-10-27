import { expect, it } from 'vitest'
import { carveToHtml, carveToMarkdown, markdownToCarve } from '../src/index.js'

it.each([
  '> - | a |\n>   | b |\n> +\n> | c |\n> | d |',
  '> - | a |\n> +\n> | b |\n> +\n> | c |',
])('keeps each table in a quoted list item: %s', source => {
  const markdown = carveToMarkdown(source)
  const imported = markdownToCarve(markdown)
  expect(carveToHtml(imported)).toBe(carveToHtml(source))
  expect(imported).not.toContain('\\-\\-\\-')
})
