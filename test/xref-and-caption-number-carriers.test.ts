import { expect, it } from 'vitest'
import { carveToHtml, htmlToAst, parse, resolve, renderHtmlWithReport } from '../src/index.js'

const modes = ['safe', 'semantic', 'roundtrip'] as const
function nodes(value: unknown): Record<string, any>[] {
  if (!value || typeof value !== 'object') return []
  const record = value as Record<string, any>
  return [...(typeof record.type === 'string' ? [record] : []), ...Object.values(record).flatMap(nodes)]
}
function noReservedAttrs(value: unknown) {
  for (const node of nodes(value)) {
    expect(Object.keys(node.attrs?.keyValues ?? {}).filter(key => /^data-(carve|djot)-(xref|caption-number|ref|autolink|footnote-label)$/.test(key))).toEqual([])
  }
}

it('exports resolved crossrefs only under roundtrip export', () => {
  const source = '# H\n\n</#H>\n'
  const ordinary = carveToHtml(source)
  expect(ordinary).toContain('<p><a href="#H">H</a></p>')
  expect(carveToHtml(source, { roundtrip: false })).toBe(ordinary)
  expect(carveToHtml(source, { roundtrip: true })).toContain('<p><a href="#H" data-carve-xref>H</a></p>')
  expect(carveToHtml('</#missing>\n', { roundtrip: true })).toBe('<p>&lt;/#missing&gt;</p>')
})

it('wraps a resolved caption number only under roundtrip export', () => {
  const source = '![x](x.jpg)\n^ Figure #: A\n'
  const ordinary = carveToHtml(source)
  expect(ordinary).toContain('<figcaption>Figure 1: A</figcaption>')
  expect(carveToHtml(source, { roundtrip: false })).toBe(ordinary)
  expect(carveToHtml(source, { roundtrip: true })).toContain('<figcaption>Figure <span data-carve-caption-number>1</span>: A</figcaption>')
})

for (const mode of modes) {
  for (const prefix of ['data-carve', 'data-djot']) {
    it(`imports ${prefix} carriers in ${mode}`, () => {
      const result = htmlToAst(`<p><a href="#H" ${prefix}-xref="anything" title="tip" class="c">generated <em>label</em></a><span ${prefix}-caption-number>arbitrary text</span></p>`, { mode })
      expect(nodes(result.value).find(node => node.type === 'heading_ref')).toMatchObject({ target: 'H', attrs: { classes: ['c'], keyValues: { title: 'tip' } } })
      expect(nodes(result.value).find(node => node.type === 'caption_number')).toEqual({ type: 'caption_number' })
      expect(nodes(result.value).some(node => node.type === 'heading_ref' && ('children' in node || 'title' in node))).toBe(false)
      expect(result.report.diagnostics).toEqual([])
      noReservedAttrs(result.value)
    })
    for (const href of ['x', '#a b']) it(`rejects ${prefix} xref href ${href} in ${mode}`, () => {
      const result = htmlToAst(`<p><a href="${href}" ${prefix}-xref>x</a></p>`, { mode })
      expect(nodes(result.value).some(node => node.type === 'heading_ref')).toBe(false)
      expect(nodes(result.value).find(node => node.type === 'link')).toMatchObject({ href })
      expect(result.report.diagnostics).toHaveLength(1)
      noReservedAttrs(result.value)
    })
    for (const content of [`<span ${prefix}-caption-number class="c">1</span>`, `<span ${prefix}-caption-number><em>1</em></span>`]) {
      it(`rejects non-bare caption number ${content} in ${mode}`, () => {
        const result = htmlToAst(`<p>${content}</p>`, { mode })
        expect(nodes(result.value).some(node => node.type === 'caption_number')).toBe(false)
        expect(result.report.diagnostics.some(row => row.message.includes('caption-number'))).toBe(true)
        noReservedAttrs(result.value)
      })
    }
    for (const other of ['ref="r"', 'autolink', 'footnote-label="n"']) {
      it(`refuses ${prefix} xref with ${other} in ${mode}`, () => {
        const result = htmlToAst(`<p><a href="#H" ${prefix}-xref ${prefix}-${other}>H</a></p>`, { mode })
        expect(nodes(result.value).find(node => node.type === 'link')).toMatchObject({ href: '#H', children: [{ type: 'text', value: 'H' }] })
        expect(nodes(result.value).some(node => ['heading_ref', 'autolink', 'footnote_ref'].includes(node.type) || node.ref !== undefined)).toBe(false)
        expect(result.report.diagnostics).toHaveLength(1)
        expect(result.report.diagnostics[0]).toMatchObject({ code: 'attribute-dropped', severity: 'warning' })
        noReservedAttrs(result.value)
      })
    }
    it(`invalid ${prefix} xref contradicts no reference in ${mode}`, () => {
      const result = htmlToAst(`<p><a href="x" ${prefix}-xref ${prefix}-ref="r">x</a></p>`, { mode })
      expect(nodes(result.value).find(node => node.type === 'link')).toMatchObject({ ref: 'r' })
      expect(result.report.diagnostics).toHaveLength(1)
      expect(result.report.diagnostics[0].message).not.toContain('contradictory')
      noReservedAttrs(result.value)
    })
  }
}

it('drops and reports an authored xref carrier and preserves attribute order', () => {
  const doc = resolve(parse('# H\n\n</#H>\n'))
  const ref = nodes(doc).find(node => node.type === 'heading_ref')!
  ref.attrs = { keyValues: { 'data-carve-xref': '1', title: 'tip' }, order: ['data-carve-xref', 'title'] }
  const result = renderHtmlWithReport(doc, { roundtrip: true })
  expect(result.value).toContain('<a href="#H" data-carve-xref title="tip">H</a>')
  expect(result.losses.filter(row => row.code === 'carrier-attribute-dropped' && row.attribute === 'data-carve-xref')).toHaveLength(1)
  expect(renderHtmlWithReport(doc).value).toContain('<a href="#H" data-carve-xref="1" title="tip">H</a>')
})

it('reads a crossref target holding a tab, as crossref_id admits', () => {
  const result = htmlToAst('<p><a href="#a&#9;b" data-carve-xref>x</a></p>', { mode: 'safe' })
  expect(nodes(result.value).find(node => node.type === 'heading_ref')).toMatchObject({ target: 'a\tb' })
})
