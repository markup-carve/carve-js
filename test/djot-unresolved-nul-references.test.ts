import { expect, test } from 'vitest'
import { carveToHtml } from '../src/index.js'
import { djotToCarveWithLosses } from '../src/import/djot/djot-import.js'
import controls from './fixtures/djot-unresolved-nul-references.json'

test('unresolved NUL references do not select replacement-character destinations', () => {
  for (const { source, html, image, own, heading, linked, keyLiteral, quoteOwn, resolvedNested, noAlias, emptyHeading } of controls) {
    if (emptyHeading !== undefined) {
      expect(djotToCarveWithLosses(source).losses.some(loss => loss.message.includes('empty heading')), source).toBe(emptyHeading)
      continue
    }
    if (noAlias) {
      expect(carveToHtml(djotToCarveWithLosses(source).value), source).not.toContain('carve-djot-reference-')
      if (!linked) continue
    }
    if (heading || linked) {
      const report = djotToCarveWithLosses(source)
      const destinations = (value: string) => [...value.matchAll(/\b(?:href|src)="([^"]*)"/g)].map(match => match[1])
      expect(destinations(carveToHtml(report.value)), source).toEqual(destinations(html.replaceAll('\0', '�')))
      expect(report.losses.some(loss => loss.message.includes('unresolved Djot')), source).toBe(!heading && !resolvedNested)
      continue
    }
    expect(html, source).not.toMatch(/<(?:a|img)\b[^>]*\b(?:href|src)=/)
    const report = djotToCarveWithLosses(source)
    expect(carveToHtml(report.value), source).not.toMatch(/<(?:a|img)\b[^>]*\b(?:href|src)=/)
    if (quoteOwn !== undefined) {
      const actual = carveToHtml(report.value)
      expect((actual.match(/<blockquote>/g) ?? []).length, source).toBe((html.match(/<blockquote>/g) ?? []).length)
      if (quoteOwn > 0) expect(actual, source).not.toContain('&gt;')
    }
    if (own || keyLiteral) expect(carveToHtml(report.value), source).not.toMatch(/<(?:span|em|strong|code)\b/)
    const message = image
      ? 'An unresolved Djot image reference has no src; Carve cannot spell that image.'
      : 'An unresolved Djot reference has no href; Carve cannot spell that link.'
    expect(report.losses.some(loss => loss.message === message), source).toBe(true)
  }
})
