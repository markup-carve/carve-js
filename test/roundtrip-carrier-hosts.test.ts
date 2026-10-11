import { describe, expect, it } from 'vitest'
import { carveToHtml, htmlToAst, htmlToCarve } from '../src/index.js'

describe('roundtrip carriers stay on their defined hosts', () => {
  it.each(['1) a\n', '1. a\n', 'a) a\n'])('ordered markers use ordinary list attributes: %s', source => {
    const html = carveToHtml(source, { roundtrip: true })
    expect(html).not.toContain('data-marker')
    expect(htmlToCarve(html, { mode: 'roundtrip' }).value).toBe(source)
  })

  it.each(['safe', 'semantic', 'roundtrip'] as const)('restores an explicit equal-slug section ID in %s mode', mode => {
    const html = carveToHtml('{#C}\n# C\n', { roundtrip: true })
    const tree = htmlToAst(html, { mode }).value
    expect(tree.children[0]).toMatchObject({ type: 'heading', attrs: { id: 'C' } })
    expect(htmlToCarve(html, { mode }).value).toContain('{#C}')
  })

  it.each(['data-carve', 'data-djot'])('accepts the %s explicit-ID carrier on either host', prefix => {
    for (const mode of ['safe', 'semantic', 'roundtrip'] as const) {
      for (const html of [
        `<section id="C" ${prefix}-explicit-id="1"><h1>C</h1></section>`,
        `<h1 id="C" ${prefix}-explicit-id="1">C</h1>`,
      ]) {
        expect(htmlToAst(html, { mode }).value.children[0]).toMatchObject({ type: 'heading', attrs: { id: 'C' } })
        expect(htmlToCarve(html, { mode }).value).toContain('{#C}')
      }
    }
  })

  it.each(['data-carve', 'data-djot'])('reads %s carrier presence before ID order', prefix => {
    for (const value of ['', '=""', '="1"']) {
      for (const mode of ['safe', 'semantic', 'roundtrip'] as const) {
        for (const html of [
          `<section ${prefix}-explicit-id${value} id="C"><h1>C</h1></section>`,
          `<h1 ${prefix}-explicit-id${value} id="C">C</h1>`,
        ]) {
          const result = htmlToCarve(html, { mode })
          expect(result.value).toContain('{#C}')
          expect(result.report.diagnostics).not.toEqual(expect.arrayContaining([
            expect.objectContaining({ code: 'attribute-dropped', message: expect.stringContaining('explicit-id') }),
          ]))
        }
      }
    }
  })

  it('does not borrow heading attribute slots from its section', () => {
    for (const mode of ['safe', 'semantic', 'roundtrip'] as const) {
      const result = htmlToCarve('<section id="x" constructor="y"><h1 class="c">T</h1></section>', { mode })
      expect(result.value).toContain('#x')
      expect(result.value).toContain('.c')
      expect(result.value).not.toContain('constructor')
    }
  })

  it('keeps a generated section ID generated', () => {
    const html = carveToHtml('# C\n', { roundtrip: true })
    expect(htmlToAst(html, { mode: 'roundtrip' }).value.children[0].attrs?.id).toBeUndefined()
  })
})
