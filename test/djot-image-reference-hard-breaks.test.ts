import { expect, it } from 'vitest'
import { carveToHtml, djotToCarve } from '../src/index.js'
import fixtures from './fixtures/djot-image-reference-hard-breaks.json'

it.each(fixtures)('preserves image reference line breaks: $name', row => {
  const { source, alt } = row
  const html = carveToHtml(djotToCarve(source))
  if ('href' in row) expect(html.match(/<a\b[^>]*\bhref="([^"]*)"/)?.[1] ?? null).toBe(row.href)
  if ('code' in row) expect(html.match(/<code\b[^>]*>(.*?)<\/code>/s)?.[1] ?? null).toBe(row.code)
  if ('text' in row) expect(html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()).toBe(row.text)
  const actual = html.match(/<img\b[^>]*\balt="([^"]*)"/)?.[1] ?? null
  expect(actual?.replaceAll('&apos;', "'") ?? null).toBe(alt?.replaceAll('&apos;', "'") ?? null)
})
