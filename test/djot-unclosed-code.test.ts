import { expect, it } from 'vitest'
import { carveToHtml, djotToCarve } from '../src/index.js'
import fixtures from './fixtures/djot-unclosed-code.json'

it.each(fixtures)('preserves unfinished code: $name', ({ source, html }) => {
  const actual = carveToHtml(djotToCarve(source)).trim()
    .replace(/<\/?tbody>/g, '').replace(/>\s+</g, '><').replace(/<li>\n/g, '<li>').replace(/\n<\/li>/g, '</li>')
  expect(actual).toBe(html)
})
