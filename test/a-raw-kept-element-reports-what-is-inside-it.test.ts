/*
 * `roundtrip` keeps an element with no Carve spelling as raw HTML, and
 * everything inside it goes along. The report names every refused attribute in
 * those bytes as `attribute-preserved`: the element's own rows, its
 * `raw-preserved` row, then each descendant's rows in document order
 * (ruling markup-carve/carve#2261).
 */
import { describe, expect, it } from 'vitest'
import { htmlToCarve } from '../src/index.js'

const rows = (html: string, mode: 'roundtrip' | 'safe' | 'semantic' = 'roundtrip') =>
  htmlToCarve(html, { mode }).report.diagnostics.map((d) => [d.code, d.severity, d.path, d.message])

describe('a raw-kept element reports what is inside it', () => {
  it('reports the own denied destination and every refused descendant attribute', () => {
    const html = '<p>x</p><form onclick="a()" action="javascript:b()"><a href="javascript:alert(1)" onclick="y()">t</a></form>'
    const result = htmlToCarve(html, { mode: 'roundtrip' })
    expect(result.value).toContain('href="javascript:alert(1)"')
    expect(rows(html)).toEqual([
      ['attribute-preserved', 'error', '/form[2]', 'Preserved event-handler attribute onclick on <form> in the raw HTML this element is kept as'],
      ['attribute-preserved', 'error', '/form[2]', 'Preserved action with a denied URL scheme on <form> in the raw HTML this element is kept as'],
      ['raw-preserved', 'warning', '/form[2]', 'Preserved unsupported <form> element as raw HTML'],
      ['attribute-preserved', 'error', '/form[2]/a[1]', 'Preserved href with a denied URL scheme on <a> inside the raw HTML <form> is kept as'],
      ['attribute-preserved', 'error', '/form[2]/a[1]', 'Preserved event-handler attribute onclick on <a> inside the raw HTML <form> is kept as'],
    ])
    const fidelities = new Set(
      result.report.diagnostics.filter((d) => d.code === 'attribute-preserved').map((d) => d.fidelity),
    )
    expect(fidelities.size).toBe(1)
  })

  it('reaches a nested descendant, and gives a harmless attribute the own-attribute treatment', () => {
    const html = '<form><div 9x="1"><img src="data:image/png;base64,AA" alt="a" onerror="z()"></div></form>'
    expect(rows(html)).toEqual([
      ['raw-preserved', 'warning', '/form[1]', 'Preserved unsupported <form> element as raw HTML'],
      ['attribute-preserved', 'info', '/form[1]/div[1]', 'Preserved unsupported attribute 9x on <div> inside the raw HTML <form> is kept as: not spellable as a Carve attribute name'],
      ['attribute-preserved', 'error', '/form[1]/div[1]/img[1]', 'Preserved src with a denied URL scheme on <img> inside the raw HTML <form> is kept as'],
      ['attribute-preserved', 'error', '/form[1]/div[1]/img[1]', 'Preserved event-handler attribute onerror on <img> inside the raw HTML <form> is kept as'],
    ])
  })

  it('denies the OS-handler schemes too', () => {
    const html = '<form><a href="ms-msdt:/id">t</a></form>'
    expect(rows(html)[1]).toEqual([
      'attribute-preserved',
      'error',
      '/form[1]/a[1]',
      'Preserved href with a denied URL scheme on <a> inside the raw HTML <form> is kept as',
    ])
  })

  it('never reports a drop for what the inline preserve arm keeps', () => {
    const html = '<p><video onclick="a()"><a href="javascript:x" onclick="y()">t</a></video></p>'
    expect(rows(html)).toEqual([
      ['attribute-preserved', 'error', '/p[1]/video[1]', 'Preserved event-handler attribute onclick on <video> in the raw HTML this element is kept as'],
      ['raw-preserved', 'warning', '/p[1]/video[1]', 'Preserved unsupported <video> element as raw HTML'],
      ['attribute-preserved', 'error', '/p[1]/video[1]/a[1]', 'Preserved href with a denied URL scheme on <a> inside the raw HTML <video> is kept as'],
      ['attribute-preserved', 'error', '/p[1]/video[1]/a[1]', 'Preserved event-handler attribute onclick on <a> inside the raw HTML <video> is kept as'],
    ])
  })

  it('reports inside a figure kept raw', () => {
    const html = '<figure><ul><li onclick="q()">a</li></ul><figcaption>Cap</figcaption></figure>'
    expect(rows(html)).toEqual([
      ['raw-preserved', 'warning', '/figure[1]', 'Preserved a <figure> as raw HTML: no Carve spelling reproduces a figure around this target'],
      ['attribute-preserved', 'error', '/figure[1]/ul[1]/li[1]', 'Preserved event-handler attribute onclick on <li> inside the raw HTML <figure> is kept as'],
    ])
  })

  it('reaches inside a kept template', () => {
    const html = '<form><template><span onclick="x()">hi</span></template></form><p onclick="z()">after</p>'
    expect(htmlToCarve(html, { mode: 'roundtrip' }).value).toContain('onclick="x()"')
    expect(rows(html).map((row) => row[2])).toEqual(['/form[1]', '/form[1]/template[1]/span[1]', '/p[2]'])
    expect(rows(html)[1]![3]).toBe('Preserved event-handler attribute onclick on <span> inside the raw HTML <form> is kept as')
  })

  it('charges only the rows it reports against the diagnostics cap', () => {
    const denied = htmlToCarve('<form><a href="javascript:x">t</a></form>', { mode: 'roundtrip', maxDiagnostics: 2 })
    expect(denied.report.diagnostics.map((d) => d.code)).toEqual(['raw-preserved', 'attribute-preserved'])
    const styled = htmlToCarve('<form><div style="color:red">x</div></form>', { mode: 'roundtrip', maxDiagnostics: 1 })
    expect(styled.report.diagnostics.map((d) => d.code)).toEqual(['raw-preserved'])
  })

  it('adds no row for a denied value on an element the import rewrites', () => {
    expect(rows('<p data-x="javascript:1">x</p>')).toEqual([])
  })

  it('leaves safe and semantic unchanged', () => {
    const html = '<p>x</p><form onclick="a()" action="javascript:b()"><a href="javascript:alert(1)" onclick="y()">t</a></form>'
    for (const mode of ['safe', 'semantic'] as const) {
      expect(rows(html, mode)).toEqual([
        ['element-unwrapped', 'info', '/form[2]', 'Unwrapped unsupported <form> element'],
        ['attribute-dropped', 'warning', '/form[2]', 'Dropped event-handler attribute onclick on <form>'],
        ['attribute-dropped', 'info', '/form[2]', 'Dropped action with the unwrapped <form>: there is no element left to carry it'],
        ['attribute-dropped', 'warning', '/form[2]/a[1]', 'Dropped event-handler attribute onclick on <a>'],
        ['attribute-dropped', 'warning', '/form[2]/a[1]', 'Dropped href with a denied URL scheme on <a>'],
      ])
    }
  })
})
