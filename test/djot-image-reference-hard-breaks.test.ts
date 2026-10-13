import { expect, it } from 'vitest'
import { carveToHtml, djotToCarve } from '../src/index.js'
import fixtures from './fixtures/djot-image-reference-hard-breaks.json'

it.each(fixtures)('preserves image reference line breaks: $name', ({ source, alt }) => {
  const html = carveToHtml(djotToCarve(source))
  expect(html.match(/<img\b[^>]*\balt="([^"]*)"/)?.[1]).toBe(alt)
})
