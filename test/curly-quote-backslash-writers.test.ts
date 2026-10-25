import { expect, it } from 'vitest'
import { carveToCarve, carveToHtml, carveToMarkdown } from '../src/index.js'

it.each([
  { name: 'double curly quotes', source: String.raw`\“word\”`, written: String.raw`\\“word\\”`, html: String.raw`<p>\“word\”</p>` },
  { name: 'single curly quotes', source: String.raw`before \‘word\’ after`, written: String.raw`before \\‘word\\’ after`, html: String.raw`<p>before \‘word\’ after</p>` },
  { name: 'curly quotes beside a link', source: String.raw`\“[link](u)\”`, written: String.raw`\\“[link](u)\\”`, html: String.raw`<p>\“<a href="u">link</a>\”</p>` },
])('keeps a literal backslash before $name', ({ source, written, html }) => {
  expect(carveToHtml(source)).toBe(html)
  expect(carveToMarkdown(source)).toBe(`${written}\n`)
  expect(carveToCarve(source)).toBe(`${source}\n`)
  expect(carveToCarve(`${source}\n`)).toBe(`${source}\n`)
})
