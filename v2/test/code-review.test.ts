// Defects of the review of commit ee68ffaa (F1 to F5, F9), each named by the clause it breaks.
import { describe, expect, it } from 'vitest'
import { includeDependencies, parse, parseWithDiagnostics, render, tabsExtensions, tabsRenderer } from '../src/index.ts'

const child = (text: string) => ({ resolver: () => ({ id: 'child', text }) })
const FENCE = '```'

describe('the review of commit ee68ffaa', () => {
  it('C2-N-054, C2-H-141: an included reference takes title and attributes from the definition that resolved it (F1)', () => {
    const text = '{.inner}\n[k]: /inner "Inner"\n\n[go][k] ![alt][k]'
    const expected = '<p><a href="/inner" title="Inner" class="inner">go</a> <img src="/inner" alt="alt" title="Inner" class="inner"></p>'
    expect(render('{.outer}\n[k]: /outer "Outer"\n\n{{ child }}', { includes: child(text) })).toBe(expected)
    expect(render('{{ child }}', { includes: child(text) })).toBe(expected)
  })

  it('C2-H-062: text of more than one UTF-8 byte before a caption keeps the line of the inner block (F2)', () => {
    for (const letter of ['é', '😀', 'a']) {
      const html = render(`${letter.repeat(10)}\n\n{#x}\n${FENCE}js\nx\n${FENCE}\n^ cap`, { sourceLines: true })
      expect(html, letter).toContain('<pre data-source-line="4">')
    }
  })

  it('C2-N-048, C2-N-049, C2-N-065: a shifted include of 150,000 headings below the size cap is read (F4)', () => {
    const result = parseWithDiagnostics('{{ child @shift:auto }}', { positions: false, includes: child('# x\n\n'.repeat(150000)) })
    const include = result.document.children[0]
    expect(include?.type === 'include' ? include.children : []).toHaveLength(150000)
  })

  it('C2-N-003, C2-A-173: repeated no-resolver diagnostics are capped (F5)', () => {
    const result = parseWithDiagnostics('{{ x }}\n\n'.repeat(150000), { positions: false })
    expect(result.diagnostics.filter(entry => entry.code === 'include-no-resolver')).toHaveLength(100)
    expect(result.suppressedIncludeDiagnostics).toBe(149900)
  })

  it('C2-N-083: a document of 150,000 headings has no include dependencies (F5)', () => {
    expect(includeDependencies(parse('# x\n\n'.repeat(150000), { positions: false }))).toEqual([])
  })

  it('C2-X-044, C2-H-016: a generated tab id passes over an authored id it would repeat (F9)', () => {
    const html = render('{#tabs-1-0}\nhello\n\n::: tabs\n:::: tab "A"\nx\n::::\n:::',
      { extensions: tabsExtensions, renderers: { 'carve.tabs': tabsRenderer } })
    expect(html.match(/id="tabs-1-0"/g)).toHaveLength(1)
    expect(html).toContain('id="tabs-2-0"')
  })
})
