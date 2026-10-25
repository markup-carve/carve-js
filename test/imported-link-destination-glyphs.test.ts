import { expect, it } from 'vitest'
import { carveToHtml, carveToMarkdown, htmlToCarve, markdownToCarve } from '../src/index.js'

it.each(['/a[b]c%25)d', '/[x]%00)', '/x]y[z%'])('keeps literal destination glyphs: %s', destination => {
  const imported = htmlToCarve(`<a href="${destination}">x</a>`).value
  expect(carveToHtml(imported)).toContain(`href="${destination}"`)
  const markdown = carveToMarkdown(imported)
  if (destination.includes(')')) expect(markdown).toContain('\\)')
  expect(carveToHtml(markdownToCarve(markdown))).toContain(`href="${destination}"`)
})
