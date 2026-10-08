import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { carveToHtml, parse, renderCarve } from '../src/index.js'

const cases = JSON.parse(readFileSync(new URL('./fixtures/image-alt-escapes.json', import.meta.url), 'utf8')) as { name: string; source: string; html: string; table: string }[]

describe('image alt escapes', () => {
  for (const c of cases) {
    it(c.name, () => {
      expect(carveToHtml(c.source).trim().replaceAll('&#39;', '&#039;').replaceAll('&apos;', '&#039;')).toBe(c.html)
      const image = c.html.replace(/^<p>x | y<\/p>$/g, '')
      expect(carveToHtml(c.table).replaceAll('&apos;', '&#039;').replaceAll('&#39;', '&#039;')).toContain(image)
      const tableWritten = renderCarve(parse(c.table))
      expect(carveToHtml(tableWritten).replaceAll('&apos;', '&#039;').replaceAll('&#39;', '&#039;')).toContain(image)
      const written = renderCarve(parse(c.source))
      expect(carveToHtml(written).trim().replaceAll('&#39;', '&#039;').replaceAll('&apos;', '&#039;')).toBe(c.html)
      expect(renderCarve(parse(written))).toBe(written)
    })
  }
  it('keeps a native image in tables with raw HTML disabled', () => {
    const source = '| ![a\\|b](/i) |\n|---|\n| c |\n'
    expect(carveToHtml(source, { allowRawHtml: false })).toContain('<img src="/i" alt="a|b">')
  })
  it('leaves unresolved reference source literal', () => {
    expect(carveToHtml('x ![a\\|b][missing] y')).toContain('![a\\|b][missing]')
  })
})
