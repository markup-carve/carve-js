import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml, htmlToAst, htmlToCarve, HtmlImportLimitError } from '../src/index.js'

// Ruling A on carve-js#4135: the importer's default depth limit is the parser's
// nesting cap (200), counted in element levels.
const spans = (n: number, leaf = 'x'): string => `<p>${'<span class="a">'.repeat(n)}${leaf}${'</span>'.repeat(n)}</p>`

describe('the HTML importer admits what the parser nests at its cap', () => {
  it('imports the HTML of 200 bracket span openers back to a writer fixed point', () => {
    const source = `${'['.repeat(200)}x${']{.a}'.repeat(200)}\n`
    const html = carveToHtml(source)
    expect(html.match(/<span class="a">/g)).toHaveLength(199)
    const imported = htmlToCarve(html).value
    expect(carveToCarve(imported)).toBe(imported)
    expect(carveToHtml(imported)).toBe(html)
  })

  it('refuses one element level past the cap', () => {
    expect(() => htmlToAst(spans(199))).not.toThrow()
    expect(() => htmlToAst(spans(200))).toThrow(HtmlImportLimitError)
  })

  it('counts a text or comment leaf toward maxNodes but not as a level', () => {
    expect(() => htmlToAst(spans(199, 'x<!--c-->y'))).not.toThrow()
    expect(() => htmlToAst(spans(2), { maxDepth: 3 })).not.toThrow()
    expect(() => htmlToAst(spans(3), { maxDepth: 3 })).toThrow(HtmlImportLimitError)
    expect(() => htmlToAst(spans(2), { maxNodes: 3 })).toThrow(HtmlImportLimitError)
  })
})
