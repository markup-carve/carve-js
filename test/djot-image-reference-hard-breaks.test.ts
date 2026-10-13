import { expect, it } from 'vitest'
import { carveToHtml, djotToCarve } from '../src/index.js'
import fixtures from './fixtures/djot-image-reference-hard-breaks.json'

it.each(fixtures)('preserves image reference line breaks: $name', row => {
  const { source, alt } = row
  const html = carveToHtml(djotToCarve(source))
  if ('href' in row) expect(html.match(/<a\b[^>]*\bhref="([^"]*)"/)?.[1] ?? null).toBe(row.href)
  const actual = html.match(/<img\b[^>]*\balt="([^"]*)"/)?.[1] ?? null
  expect(actual?.replaceAll('&apos;', "'") ?? null).toBe(alt?.replaceAll('&apos;', "'") ?? null)
})
