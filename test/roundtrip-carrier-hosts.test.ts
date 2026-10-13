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

  it.each(['safe', 'semantic', 'roundtrip'] as const)('maps the section carrier to the surviving heading in %s mode', mode => {
    const kept = htmlToCarve('<section id="X" data-carve-explicit-id><script>x</script><h1>X</h1></section>', { mode })
    expect(kept.value).toContain('{#X}')
    expect(kept.report.diagnostics).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ message: expect.stringContaining('explicit-id') }),
    ]))
    const own = htmlToAst('<section id="X" data-carve-explicit-id><h1 id="Y">T</h1></section>', { mode })
    expect(own.value.children[0]).toMatchObject({ type: 'heading', attrs: { id: 'Y' } })
    expect(own.report.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: expect.stringContaining('explicit-id') }),
    ]))
    for (const later of ['h1', 'h2']) {
      const dropped = htmlToAst(`<section id="X" data-carve-explicit-id><h1></h1><${later}>X</${later}></section>`, { mode })
      expect(dropped.value.children[0].attrs?.id).toBeUndefined()
      expect(dropped.report.diagnostics).toEqual(expect.arrayContaining([
        expect.objectContaining({ message: expect.stringContaining('explicit-id') }),
      ]))
    }
  })

  it.each(['header', 'div'])('preserves section IDs through an unwrapped %s', tag => {
    for (const mode of ['safe', 'semantic', 'roundtrip'] as const) {
      for (const marker of ['', 'data-carve-explicit-id', 'data-djot-explicit-id']) {
        const id = marker ? 'Setup' : 'install'
        const result = htmlToCarve(`<section id="${id}" ${marker}><${tag}><h2>Setup</h2></${tag}></section>`, { mode })
        expect(result.value).toContain(`#${id}`)
        expect(result.report.diagnostics).not.toEqual(expect.arrayContaining([
          expect.objectContaining({ message: expect.stringContaining('explicit-id') }),
        ]))
      }
    }
  })

  it('preserves an hgroup ID on the heading when the wrapper unwraps', () => {
    for (const mode of ['safe', 'semantic'] as const) {
      const result = htmlToCarve('<section id="Setup" data-carve-explicit-id><hgroup><h2>Setup</h2></hgroup></section>', { mode })
      expect(result.value).toContain('#Setup')
    }
    const raw = htmlToCarve('<section id="Setup" data-carve-explicit-id><hgroup><h2>Setup</h2></hgroup></section>', { mode: 'roundtrip' })
    expect(raw.value).toContain('<hgroup><h2>Setup</h2></hgroup>')
  })

  it('keeps section refusal priority under the diagnostic cap', () => {
    const result = htmlToAst('<section onclick="x()"><p bad="a">x</p><p bad="b">y</p></section>', { maxDiagnostics: 2 })
    expect(result.report.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: expect.stringContaining('onclick') }),
    ]))
  })

  it('keeps a generated section ID generated', () => {
    const html = carveToHtml('# C\n', { roundtrip: true })
    expect(htmlToAst(html, { mode: 'roundtrip' }).value.children[0].attrs?.id).toBeUndefined()
  })
})

it('publishes an unwrapped explicit id in its element slot order', () => {
  for (const mode of ['safe', 'semantic', 'roundtrip'] as const) {
    expect(htmlToAst('<h1 class="c" id="C" data-carve-explicit-id>C</h1>', { mode }).value.children[0].attrs?.order).toEqual(['.class', '#id'])
  }
})
