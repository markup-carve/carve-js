import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { htmlToAst, htmlToCarve, parse, toAstJson } from '../src/index.js'

/** Empty headings have no Carve spelling and lose their level on import. */
describe('an empty heading is dropped on import', () => {
  it.each([
    ['<h1></h1>', 'Dropped <h1> holding no content'],
    ['<h1> </h1>', 'Dropped whitespace-only <h1> holding no content character'],
  ])('drops %s from both exits', (html, message) => {
    const ast = htmlToAst(html)
    const source = htmlToCarve(html)
    expect(ast.value.children).toEqual([])
    // A document left with no block writes the one newline a bare empty `<p>` writes.
    expect(source.value).toBe('\n')
    for (const result of [ast, source]) {
      expect(result.report.diagnostics).toMatchObject([
        { code: 'element-dropped', message, severity: 'warning', path: '/h1[1]', fidelity: 'dropped', confidence: 'exact' },
      ])
    }
  })

  it('drops the id with the heading instead of attaching it to the next paragraph', () => {
    const html = '<h2 id="k"></h2><p>b</p>'
    expect(htmlToAst(html).value.children).toEqual([{ type: 'paragraph', children: [{ type: 'text', value: 'b' }] }])
    expect(htmlToCarve(html).value).toBe('b\n')
    for (const result of [htmlToAst(html), htmlToCarve(html)]) {
      expect(result.report.diagnostics).toMatchObject([
        { code: 'element-dropped', message: 'Dropped <h2> holding no content', severity: 'warning', path: '/h2[1]' },
      ])
    }
  })

  it('leaves a bare empty paragraph unchanged', () => {
    expect(htmlToCarve('<p></p>').value).toBe('\n')
    expect(htmlToAst('<p></p>').report.diagnostics).toEqual([])
  })

  it('keeps a heading with content', () => {
    const html = '<h3>x</h3>'
    expect(htmlToAst(html).value.children).toEqual([{ type: 'heading', level: 3, children: [{ type: 'text', value: 'x' }] }])
    expect(htmlToCarve(html).value).toBe('### x\n')
    expect(htmlToAst(html).report.diagnostics).toEqual([])
    expect(htmlToCarve(html).report.diagnostics).toEqual([])
  })

  it('makes both exits agree for the shared fixture', () => {
    const fixture = (name: string) => readFileSync(new URL(`../spec/tests/html-import/empty-heading/${name}`, import.meta.url), 'utf8')
    const html = fixture('input.html')
    const source = htmlToCarve(html)
    expect(source.value).toBe(fixture('expected.crv'))
    expect(toAstJson(parse(source.value)).children).toMatchObject(JSON.parse(fixture('expected.ast.json')).children)
    expect(toAstJson(htmlToAst(html).value).children).toEqual(JSON.parse(fixture('expected.ast.json')).children)
    expect(source.report.diagnostics).toMatchObject(JSON.parse(fixture('expected.report.json')).diagnostics)
  })
})
