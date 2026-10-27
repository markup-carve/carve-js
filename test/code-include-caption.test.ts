import { describe, expect, it } from 'vitest'
import { expandIncludes, parse, renderCarve, renderHtml, renderMarkdownWithReport, resolve } from '../src/index.js'

const csv = 'Plan,Seats,Price\nStarter,1,"$0"\nTeam,10,"$49, billed yearly"\n'

function run(source: string, files: Record<string, string>) {
  return expandIncludes(parse(source, { positions: true }), source, {
    resolve: path => files[path] ?? null,
    sourcePath: 'doc.crv',
  }).doc
}

describe('block code include caption', () => {
  it.each([0, 1])('captions a promoted table across %i blanks', blanks => {
    const source = `{table}\n{{ data/plans.csv @code:csv }}\n${'\n'.repeat(blanks)}^ Plans`
    const doc = run(source, { 'data/plans.csv': csv })
    expect(doc.children).toHaveLength(1)
    expect(doc.children[0]?.type).toBe('table')
    expect(doc.children[0]?.pos?.file).toBe('data/plans.csv')
    if (doc.children[0]?.type === 'table') {
      expect(doc.children[0].caption?.[0]?.pos?.file).toBe('doc.crv')
      expect(doc.children[0].caption?.[0]?.pos?.startLine).toBe(3 + blanks)
    }
    expect(renderHtml(resolve(doc))).toContain('<caption>Plans</caption>')
    const md = renderMarkdownWithReport(resolve(doc))
    expect(md.value).toContain('| Plan | Seats | Price |')
    expect(md.value).toContain('\n\nPlans\n')
    expect(md.value).not.toContain('^ Plans')
    expect(md.losses.map(loss => loss.code)).toContain('markdown-caption-flattened')
    expect(renderCarve(parse(source))).toContain('{{ data/plans.csv @code:csv }}\n^ Plans')
  })

  it('keeps malformed delimited data as captioned code', () => {
    const doc = run('{table}\n{{ data.csv @code:csv }}\n^ Plans', { 'data.csv': 'a,b\n"bad\n' })
    expect(doc.children[0]?.type).toBe('figure')
    expect(renderHtml(resolve(doc))).toContain('<figcaption>Plans</figcaption>')
  })

  it('keeps an unresolved directive and caption as separate paragraphs', () => {
    const doc = run('{table}\n{{ missing.csv @code:csv }}\n^ Plans', {})
    expect(doc.children.map(node => node.type)).toEqual(['paragraph', 'paragraph'])
    expect(renderHtml(resolve(doc))).toBe('<p table="">{{ missing.csv @code:csv }}</p>\n<p>^ Plans</p>')
    expect(renderHtml(resolve(parse('{{ missing.csv @code:csv }}\n^ Plans')))).toBe(
      '<p>{{ missing.csv @code:csv }}</p>\n<p>^ Plans</p>',
    )
    expect(renderHtml(resolve(parse('{{ "a}}b" @code }}\n^ Plans')))).toBe(
      '<p>{{ “a}}b” <span class="mention"><strong>@code</strong></span> }}</p>\n<p>^ Plans</p>',
    )
  })

  it('leaves a caption detached after two blanks', () => {
    const source = '{{ data.csv @code }}\n\n\n^ Plans'
    const doc = run(source, { 'data.csv': 'x' })
    expect(doc.children.map(node => node.type)).toEqual(['code_block', 'paragraph'])
    const formatted = renderCarve(parse(source))
    expect(run(formatted, { 'data.csv': 'x' }).children.map(node => node.type)).toEqual(['code_block', 'paragraph'])
  })

  it('attaches inside a quote without a language', () => {
    const source = '> {{ data.txt @code }}\n> ^ Note'
    expect(renderHtml(resolve(run(source, { 'data.txt': 'x\n' })))).toContain('<figcaption>Note</figcaption>')
  })

  it('keeps a Carve-content include followed by a caret on its old boundary', () => {
    expect(parse('{{ child.crv }}\n^ Note').children).toHaveLength(1)
  })
})
