import { expect, it } from 'vitest'
import { carveToHtml, fromAstJson, parse, renderHtml, resolve, toAstJson } from '../src/index.js'
import fixtures from './fixtures/definition-term-floor-text.json'

const normalized = (html: string) => html.replace(/>\s+</g, '><').trim()
for (const row of fixtures) {
  it(`keeps term ownership after floor text: ${row.id}`, () => {
    expect(normalized(carveToHtml(row.source))).toBe(row.html)
    const ast = resolve(parse(row.source))
    expect(normalized(renderHtml(ast))).toBe(row.html)
    expect(normalized(renderHtml(fromAstJson(toAstJson(ast))))).toBe(row.html)
    expect(normalized(renderHtml(resolve(parse(row.source, { positions: true }))))).toBe(row.html)
  })
}
