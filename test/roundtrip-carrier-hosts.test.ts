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

  it('keeps a generated section ID generated', () => {
    const html = carveToHtml('# C\n', { roundtrip: true })
    expect(htmlToAst(html, { mode: 'roundtrip' }).value.children[0].attrs?.id).toBeUndefined()
  })
})
