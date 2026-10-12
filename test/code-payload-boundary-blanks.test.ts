import { expect, it } from 'vitest'
import { carveToHtml, parse, renderHtml, resolve } from '../src/index.js'
import fixtures from './fixtures/code-payload-boundary-blanks.json'

for (const row of fixtures) {
  it(`keeps CODE payload blanks at container boundaries: ${row.id}`, () => {
    for (const html of [
      carveToHtml(row.source),
      renderHtml(resolve(parse(row.source))),
      renderHtml(resolve(parse(row.source, { positions: true }))),
    ]) {
      expect(html.replace(/>\s+</g, '><').trim()).toBe(row.html)
      const payloads = [...html.matchAll(/<pre><code[^>]*>([\s\S]*?)<\/code><\/pre>/g)]
        .map(match => match[1]!)
      expect(payloads).toEqual(row.codePayloads)
    }
  })
}
