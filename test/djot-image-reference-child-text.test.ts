import { expect, it } from 'vitest'
import { carveToHtml, djotToCarve } from '../src/index.js'
import fixtures from './fixtures/djot-image-reference-child-text.json'

it.each(fixtures)('preserves image child text: $name', ({ source, alt }) => {
  const html = carveToHtml(djotToCarve(source))
  expect(html.match(/<img\b[^>]*\balt="([^"]*)"/)?.[1]).toBe(alt)
})
