import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseFragment } from 'parse5'
import {
  carveToHtml, carveToHtmlWithReport, carveToMarkdown, carveToMarkdownWithReport,
  htmlToAst, htmlToCarve, migrateMarkdown, parse, renderHtml,
} from '../src/index.js'
import type { BlockNode, Document } from '../src/ast.js'

const modes = ['safe', 'semantic', 'roundtrip'] as const
const rt = (source: string) => carveToHtml(source, { roundtrip: true })
const first = (html: string, mode: (typeof modes)[number] = 'safe') => htmlToAst(html, { mode }).value.children[0]
const headingAttrs = (html: string, mode: (typeof modes)[number] = 'safe') => first(html, mode).attrs
const dropped = (html: string, mode: (typeof modes)[number]) => htmlToAst(html, { mode }).report.diagnostics.filter(row => row.code === 'attribute-dropped')
const attributes = (html: string) => {
  const attrs: { name: string; value: string; host: string }[] = []
  const walk = (node: Record<string, any>) => {
    attrs.push(...(node.attrs ?? []).map((attr: { name: string; value: string }) => ({ ...attr, host: node.tagName })))
    for (const child of node.childNodes ?? []) walk(child)
    if (node.content) walk(node.content)
  }
  walk(parseFragment(html))
  return attrs
}
const inventory = ['explicit-id', 'generated-id', 'ref', 'autolink', 'footnote-label', 'inline-footnote', 'raw', 'escaped', 'abbreviations', 'col-widths', 'label', 'id-slot', 'tight']
const reserved = new Set(['data-marker', 'data-char', ...inventory.map(name => `data-carve-${name}`), 'data-carve-src', 'data-djot-src'])
const nested = ':: Outer\n: body\n\n  :: Inner\n  : inner body\n'

describe('rule 1: generated heading ids have a carrier on their own host', () => {
  it('marks wrappers and unwrapped headings, while authored ids remain explicit', () => {
    expect(rt('# C\n')).toBe('<section id="C" data-carve-generated-id="1">\n  <h1>C</h1>\n</section>')
    expect(rt('> # Q\n')).toBe('<blockquote>\n  <h1 id="Q" data-carve-generated-id="1">Q</h1>\n</blockquote>')
    expect(rt('> {.c #Z}\n> # Q\n')).toBe('<blockquote>\n  <h1 class="c" id="Z" data-carve-explicit-id="1">Q</h1>\n</blockquote>')
    expect(carveToHtml('# C\n', { roundtrip: true, sections: false })).toBe('<h1 id="C" data-carve-generated-id="1">C</h1>')
    expect(rt('{#mine}\n# C\n')).not.toMatch(/generated-id|id-slot|data-carve-ext/)
    expect(renderHtml({ type: 'document', children: [{ type: 'heading', level: 1, children: [{ type: 'text', value: 'C' }] }] } as Document, { roundtrip: true, sections: false })).not.toContain('generated-id')
  })
})

describe('rule 2: tight is a presence carrier', () => {
  it('writes 1 and reads every value without a diagnostic', () => {
    expect(rt('- {.x}\n  a\n')).toContain('data-carve-tight="1"')
    expect(first('<ul><li><p>a</p></li></ul>')).toMatchObject({ tight: false })
    for (const mode of modes) for (const prefix of ['data-carve', 'data-djot']) for (const value of ['', '1', 'false', 'anything']) {
      const html = `<ul ${prefix}-tight="${value}"><li><p>a</p></li></ul>`
      expect(first(html, mode)).toMatchObject({ tight: true })
      expect(htmlToAst(html, { mode }).report.diagnostics).toEqual([])
    }
  })
})

describe('rule 3: heading ids are authored unless marked generated', () => {
  it('keeps bare ids in every mode and applies wrapper slug inference only to wrappers', () => {
    for (const mode of modes) {
      expect(headingAttrs('<h2 id="T">T</h2>', mode)).toEqual({ id: 'T' })
      expect(headingAttrs('<section id="T"><h2>T</h2></section>', mode)).toBeUndefined()
      expect(headingAttrs('<section id="T-2"><h2>T</h2></section>', mode)).toBeUndefined()
      expect(headingAttrs('<section id="T-02"><h2>T</h2></section>', mode)).toEqual({ id: 'T-02' })
      for (const prefix of ['data-carve', 'data-djot']) for (const [open, close] of [['<h2', '>T</h2>'], ['<section', '><h2>T</h2></section>']]) {
        expect(headingAttrs(`${open} id="other" ${prefix}-generated-id="false"${close}`, mode)).toBeUndefined()
        expect(dropped(`${open} id="other" ${prefix}-generated-id="false"${close}`, mode)).toEqual([])
        expect(headingAttrs(`${open} id="T" ${prefix}-explicit-id${close}`, mode)?.id).toBe('T')
      }
    }
  })
})

describe('rule 4: id slots are bounded, decimal and wrapper-only', () => {
  it('rejects oversized slots and slots without explicit-id', () => {
    for (const mode of modes) {
      const html = (slot: string, explicit = true) => `<section id="mine" ${explicit ? 'data-carve-explicit-id' : ''} ${slot}><h1 class="c">H</h1></section>`
      const valid = html('data-carve-id-slot="1"')
      expect(headingAttrs(valid, mode)?.order).toEqual(['.class', '#id'])
      for (const value of ['5', '90071992547409930', '-1', '1.0', ' 1', '']) {
        const invalid = html(`data-carve-id-slot="${value}"`)
        expect(headingAttrs(invalid, mode)?.order).toEqual(['#id', '.class'])
        expect(dropped(invalid, mode).length).toBeGreaterThan(dropped(valid, mode).length)
      }
      expect(headingAttrs(html('data-carve-id-slot="1"', false), mode)?.order).toBeUndefined()
      expect(dropped(html('data-carve-id-slot="1"', false), mode).length).toBeGreaterThan(dropped(html('', false), mode).length)
      expect(dropped('<h1 id="mine" data-carve-explicit-id data-carve-id-slot="1" class="c">H</h1>', mode)).toHaveLength(1)
    }
  })
})

describe('rule 4 with rule 7: the slot counts the attributes that survive', () => {
  it('writes a slot its own import accepts when a reserved name precedes the id', () => {
    const html = carveToHtml('{data-carve-ref=x .c #mine}\n# H\n', { roundtrip: true })
    expect(html).toContain('data-carve-id-slot="1"')
    const result = htmlToAst(html)
    expect(JSON.stringify(result.report.diagnostics)).not.toContain('id-slot')
    expect(JSON.stringify(result.value)).toContain('"order":[".class","#id"]')
    expect(carveToHtml('{data-carve-ref=x #mine .c}\n# H\n', { roundtrip: true })).not.toContain('data-carve-id-slot')
  })
})

describe('rule 5: only four validated carrier pairs contradict', () => {
  it('refuses each pair once, including aliases and roundtrip raw mode', () => {
    for (const mode of modes) for (const prefix of ['data-carve', 'data-djot']) {
      for (const html of [
        `<section id="mine" ${prefix}-explicit-id ${prefix}-generated-id><h1>H</h1></section>`,
        `<h1 id="mine" ${prefix}-explicit-id ${prefix}-generated-id>H</h1>`,
      ]) {
        expect(headingAttrs(html, mode)).toEqual({ id: 'mine' })
        expect(dropped(html, mode)).toEqual([expect.objectContaining({ code: 'attribute-dropped', severity: 'warning' })])
      }
      const span = `<p><span ${prefix}-escaped ${prefix}-raw="latex">*</span></p>`
      expect(first(span, mode)).toMatchObject({ type: 'paragraph', children: [{ type: 'text', value: '*' }] })
      expect(dropped(span, mode)).toEqual([expect.objectContaining({ severity: 'warning' })])
      const htmlRaw = `<p><span ${prefix}-escaped ${prefix}-raw="html">*</span></p>`
      expect(first(htmlRaw, mode)).toMatchObject({ children: [{ type: 'text', value: '*' }] })
      expect(dropped(htmlRaw, mode)).toHaveLength(1)
      const auto = `<p><a href="https://e.com" ${prefix}-autolink ${prefix}-ref="r">https://e.com</a></p>`
      expect(first(auto, mode)).toMatchObject({ children: [{ type: 'link' }] })
      expect(dropped(auto, mode)).toEqual([expect.objectContaining({ severity: 'warning' })])
      const note = `<p>x<a href="#fn1" role="doc-noteref"><sup>1</sup></a></p><section role="doc-endnotes"><ol><li id="fn1" ${prefix}-footnote-label="n" ${prefix}-inline-footnote><p>note</p></li></ol></section>`
      expect(dropped(note, mode)).toEqual([expect.objectContaining({ severity: 'warning' })])
      expect(htmlToCarve(note, { mode }).value).toContain('[^1]')
      expect(headingAttrs(`<section id="mine" ${prefix}-explicit-id ${prefix}-ext="section"><h1>H</h1></section>`, mode)?.order).toEqual(['#id'])
      for (const html of [
        `<p><span ${prefix}-escaped ${prefix}-raw="latex">ab</span></p>`,
        `<p><span ${prefix}-escaped ${prefix}-raw="bad format">*</span></p>`,
      ]) expect(dropped(html, mode).some(row => row.message.includes('contradictory'))).toBe(false)
      expect(first(`<p><span ${prefix}-escaped>*</span></p>`, mode)).toMatchObject({ children: [{ type: 'escaped_text' }] })
      expect(first(`<p><span ${prefix}-raw="latex">ab</span></p>`, mode)).toMatchObject({ children: [{ type: 'raw_inline' }] })
    }
  })
})

describe('rule 6: both source names remain reserved', () => {
  it('consumes each source name and reports each authored export drop', () => {
    for (const name of ['data-carve-src', 'data-djot-src']) {
      for (const mode of modes) expect(headingAttrs(`<h1 ${name}="x">H</h1>`, mode)).toBeUndefined()
      const result = carveToHtmlWithReport(`{${name}=x}\n# H\n`, { roundtrip: true })
      expect(result.value).not.toContain(name)
      expect(result.losses).toEqual([expect.objectContaining({ code: 'carrier-attribute-dropped', attribute: name })])
    }
  })
})

describe('rule 7: roundtrip drops every reserved authored name on every node', () => {
  it('sweeps the captured source and reports every authored slot exactly once', () => {
    const pin = JSON.parse(readFileSync(new URL('fixtures/roundtrip-default-export-pin.json', import.meta.url), 'utf8'))
    const result = carveToHtmlWithReport(pin.source, { roundtrip: true, maxRenderLosses: 1000 })
    const attrs = attributes(result.value)
    expect(attrs.filter(attr => reserved.has(attr.name) && attr.value === 'x')).toEqual([])
    for (const name of ['data-keep', 'data-carve-ext']) {
      expect(attrs.filter(attr => attr.name === name && attr.value === 'x')).toHaveLength(attributes(pin.html).filter(attr => attr.name === name && attr.value === 'x').length)
    }
    const authoredCount = [...pin.source.matchAll(/\b(data-[a-z-]+)=x\b/g)].filter(match => reserved.has(match[1])).length
    expect(result.losses.filter(row => row.code === 'carrier-attribute-dropped')).toHaveLength(authoredCount)
    expect(carveToHtmlWithReport(pin.source).losses.filter(row => row.code === 'carrier-attribute-dropped')).toEqual([])
    const link = carveToHtmlWithReport('[a](/u){data-carve-ref=x}\n', { roundtrip: true })
    expect(link.value).toBe('<p><a href="/u">a</a></p>')
    expect(link.losses).toEqual([expect.objectContaining({ code: 'carrier-attribute-dropped', nodeType: 'inline', attribute: 'data-carve-ref' })])
    for (const name of ['data-carve-tight', 'data-marker']) {
      const report = carveToHtmlWithReport(`{${name}=x}\n# T\n`, { roundtrip: true })
      expect(report.value).not.toContain(`${name}="x"`)
      expect(report.losses).toHaveLength(1)
    }
    expect(rt('{data-keep=x}\n# T\n')).toContain('data-keep="x"')
    const reference = carveToHtmlWithReport('[r]: /u\n\n[t][r]{data-carve-ref=Z}\n', { roundtrip: true })
    expect(reference.value).toBe('<p><a href="/u" data-carve-ref="r">t</a></p>')
    expect(reference.losses).toHaveLength(1)
  })

  it('covers table group attributes, mixed-case keys and deprecated carrier spellings', () => {
    const ast = parse('| a |\n|---|\n| b |\n')
    const table = ast.children[0] as Extract<BlockNode, { type: 'table' }>
    const attrs = () => ({ keyValues: { 'DATA-CARVE-REF': 'x', 'data-keep': 'x', 'data-carve-ext': 'x', 'data-djot-ref': 'x', 'data-djot-ext': 'x' } })
    table.rowGroups = { headRows: 1, footRows: 0, headAttrs: attrs(), footAttrs: attrs(), bodies: [{ headRows: 0, bodyRows: 1, attrs: attrs() }] }
    const losses: unknown[] = []
    const html = renderHtml(ast, { roundtrip: true, onRenderLoss: row => losses.push(row) })
    expect(html).not.toContain('DATA-CARVE-REF')
    expect(attributes(html).filter(attr => attr.name === 'data-djot-ref')).toHaveLength(0)
    expect(losses).toHaveLength(6)
    for (const name of ['data-keep', 'data-carve-ext', 'data-djot-ext']) expect(attributes(html).filter(attr => attr.name === name)).toHaveLength(3)
    for (const prefix of ['data-carve', 'data-djot']) expect(first(`<p ${prefix}-ext="x">a</p>`).attrs?.keyValues).toEqual({ [`${prefix}-ext`]: 'x' })
  })
})

describe('rule 8: unrecovered reference forms return collapsed', () => {
  it('collapses matching labels and preserves distinct text and attribute suffixes', () => {
    for (const mode of modes) {
      expect(htmlToCarve(rt('[r]: /u\n\n[r][] and [r][r]\n'), { mode }).value).toContain('[r][] and [r][]')
      expect(htmlToCarve(rt('[r]: /u\n\n![r][r] and [t][r]{.c}\n'), { mode }).value).toContain('![r][] and [t][r]{.c}')
    }
  })
})

describe('rule 9: published order requires an id carrier', () => {
  it('publishes element order only for explicit ids and wrapper slot order', () => {
    for (const mode of modes) {
      expect(headingAttrs('<h1 class="c" id="mine" data-carve-explicit-id>H</h1>', mode)?.order).toEqual(['.class', '#id'])
      expect(headingAttrs('<section id="mine" data-carve-explicit-id><h1 class="c">H</h1></section>', mode)?.order).toEqual(['#id', '.class'])
      for (const html of ['<h1 class="c" id="mine">H</h1>', '<section id="mine"><h1 class="c">H</h1></section>', '<h1 class="c" id="mine" data-carve-generated-id>H</h1>', '<h1 class="c">H</h1>']) expect(headingAttrs(html, mode)?.order).toBeUndefined()
      expect(first('<p class="c" id="mine" data-x="y">p</p>', mode).attrs?.order).toBeUndefined()
    }
  })
})

describe('rule 10: nested definition lists carry their depth in their markers', () => {
  it('writes depth markers, reports no loss and imports the nesting back', () => {
    expect(carveToMarkdownWithReport(nested).losses).toEqual([])
    const report = carveToMarkdownWithReport(nested, { roundtrip: true })
    expect(report.value).toBe(carveToMarkdown(nested, { roundtrip: true }))
    expect(report.losses).toEqual([])
    expect(report.value.match(/<!-- carve:2 [^>]*-->/g)).toEqual(['<!-- carve:2 :: Inner -->', '<!-- carve:2 : -->', '<!-- carve:2 -->'])
    expect(carveToHtml(migrateMarkdown(report.value).value)).toBe(carveToHtml(nested))
    const attributed = ':: Outer\n: body\n\n  {.inner}\n  :: Inner\n  : inner body\n'
    expect(carveToHtml(migrateMarkdown(carveToMarkdown(attributed, { roundtrip: true })).value)).toBe(carveToHtml(attributed))
  })

  it('reads a depth marker with no list one level up as a damaged set', () => {
    const exported = carveToMarkdown(nested, { roundtrip: true })
    for (const damaged of [
      exported.replace('<!-- carve:2 :: Inner -->', '<!-- carve:3 :: Inner -->').replace(/carve:2 /g, 'carve:3 '),
      exported.replace('<!-- carve:2 -->\n', ''),
      exported.replace('<!-- carve: :: Outer -->', '<!-- carve:2 :: Outer -->'),
    ]) {
      const imported = migrateMarkdown(damaged)
      expect(imported.report.diagnostics.map(row => row.code)).toContain('carrier-markers-damaged')
    }
    expect(migrateMarkdown('<!-- carve:2 {.x} -->\npara\n').report.diagnostics.map(row => row.code))
      .toContain('carrier-marker-dropped')
  })
})

describe('rule 11: foreign raw inline loss remains independent of roundtrip', () => {
  it('reports raw-format-dropped with the option off and on', () => {
    for (const roundtrip of [false, true]) {
      expect(carveToHtmlWithReport('`x`{=latex}\n', { roundtrip }).losses).toEqual([expect.objectContaining({ code: 'raw-format-dropped', format: 'latex' })])
      expect(carveToHtmlWithReport('`<b>x</b>`{=html}\n', { roundtrip }).losses).toEqual([])
    }
  })
})
