import { describe, expect, it } from 'vitest'
import {
  fromAstJson, parse, resolve, renderHtml, renderMarkdown, renderPlainText,
  renderAnsi, renderCarve, renderCarveWithConversionReport, renderCarveWithReport,
  toAstJson, AstJsonSchemaError,
} from '../src/index.js'
import type { Document, Math } from '../src/ast.js'

function equation(source = '$$`x`{#eq}\n'): Document {
  const doc = parse(source)
  const paragraph = doc.children.find((block) => block.type === 'paragraph')
  if (!paragraph || paragraph.type !== 'paragraph') throw new Error('missing paragraph')
  const math = paragraph.children.find((node): node is Math => node.type === 'math')
  if (!math) throw new Error('missing math')
  math.label = 'Equation'
  return doc
}

function labelMath(doc: Document): Math {
  const visit = (value: unknown): Math | undefined => {
    if (!value || typeof value !== 'object') return undefined
    if (Array.isArray(value)) {
      for (const item of value) { const found = visit(item); if (found) return found }
      return undefined
    }
    const node = value as Record<string, unknown>
    if (node.type === 'math') return node as unknown as Math
    for (const [key, child] of Object.entries(node)) {
      if (key === 'attrs' || key === 'pos') continue
      const found = visit(child)
      if (found) return found
    }
    return undefined
  }
  const math = visit(doc.children)
  if (!math) throw new Error('missing math')
  math.label = 'Equation'
  return math
}

describe('labeled display equations', () => {
  it('numbers and renders a direct equation on every target', () => {
    const doc = resolve(equation('$$`x`{#eq}\n\nSee </#eq>.\n'))
    const json = toAstJson(doc)
    expect(JSON.stringify(json)).toContain('"number":1')
    expect(renderHtml(doc)).toContain('<span class="equation-number">Equation 1</span>')
    expect(renderHtml(doc)).toContain('<a href="#eq">Equation 1</a>')
    expect(renderMarkdown(doc)).toContain('Equation 1')
    expect(renderPlainText(doc)).toContain('Equation 1')
    expect(renderAnsi(doc)).toContain('Equation 1')
  })

  it('shares a caption bucket in document order', () => {
    const doc = equation('![x](x.jpg)\n^ Equation #: first\n\n$$`x`{#eq}\n')
    resolve(doc)
    const json = toAstJson(doc)
    expect(JSON.stringify(json)).toContain('"number":2')
  })

  it('numbers target math before math in a following caption', () => {
    const doc = parse('$$`A`\n^ Caption $$`B`\n')
    const figure = doc.children[0]
    if (!figure || figure.type !== 'figure' || figure.target.type !== 'paragraph') throw new Error('missing figure')
    const target = figure.target.children[0] as Math
    const caption = figure.caption.find((node): node is Math => node.type === 'math')
    if (!caption) throw new Error('missing caption math')
    target.label = 'Equation'
    caption.label = 'Equation'
    resolve(doc)
    expect([target.number, caption.number]).toEqual([1, 2])
  })

  it('resolves equation ids with NFC normalization and case folding', () => {
    const doc = equation('$$`x`{#eq}\n\nSee </#eq>.\n')
    const first = doc.children[0]
    const second = doc.children[1]
    if (first?.type !== 'paragraph' || second?.type !== 'paragraph') throw new Error('missing paragraphs')
    const math = first.children[0] as Math
    math.attrs!.id = 'Éq'
    const ref = second.children.find((node) => node.type === 'heading_ref')
    if (!ref || ref.type !== 'heading_ref') throw new Error('missing reference')
    ref.target = 'e\u0301Q'
    resolve(doc)
    expect(renderHtml(doc)).toContain('<a href="#Éq">Equation 1</a>')
  })

  it('recomputes a published number after AST ingest', () => {
    const json = toAstJson(resolve(equation()))
    const paragraph = json.children[0] as { children: Math[] }
    paragraph.children[0]!.number = 42
    const decoded = fromAstJson(json)
    expect(JSON.stringify(toAstJson(decoded))).toContain('"number":1')
  })

  it('does not clone a derived equation number into heading link text', () => {
    const doc = parse('{#h}\n# A $$`x`\n\nSee </#h>.\n')
    labelMath(doc)
    resolve(doc)
    const html = renderHtml(doc)
    expect(html).toContain('<span class="equation-number">Equation 1</span>')
    expect(html).toContain('<a href="#h">A <span class="math display" role="math">\\[x\\]</span></a>')
  })

  it('numbers math in a table caption and leaves inline labeled math unnumbered', () => {
    const caption = parse('|= H |\n| c |\n^ Table: $$`x`{#eq}\n')
    const math = labelMath(caption)
    resolve(caption)
    expect(math.number).toBe(1)

    const inline = parse('An $`x` equation.\n')
    const inlineMath = labelMath(inline)
    resolve(inline)
    expect(inlineMath.number).toBeUndefined()
  })

  it('keeps the label but suppresses numbering under a numbered figure', () => {
    const doc = parse('$$`x`{#eq}\n^ Equation #: caption\n')
    const figure = doc.children[0]
    if (!figure || figure.type !== 'figure') throw new Error('missing figure')
    const target = figure.target
    if (target.type !== 'paragraph') throw new Error('missing paragraph')
    const math = target.children[0] as Math
    math.label = 'Equation'
    resolve(doc)
    expect(math.number).toBeUndefined()
  })

  it('rejects invalid numbers and labels during ingest', () => {
    const json = toAstJson(equation())
    const paragraph = json.children[0] as { children: Math[] }
    const math = paragraph.children[0]!
    math.display = false
    math.number = 1
    expect(() => fromAstJson(json)).toThrow(AstJsonSchemaError)
    math.display = true
    delete math.label
    expect(() => fromAstJson(json)).toThrow(AstJsonSchemaError)
    math.label = ' Equation '
    expect(() => fromAstJson(json)).toThrow(AstJsonSchemaError)
  })

  it('reports fields that canonical Carve cannot spell on the diagnostics channel, not as render losses', () => {
    const doc = resolve(equation())
    const report = renderCarveWithReport(doc)
    expect(report.value).toContain('$$`x`')
    expect(report.losses).toEqual([])
    const { report: diagnostics } = renderCarveWithConversionReport(resolve(equation()), renderCarve)
    expect(diagnostics.diagnostics.filter((entry) => entry.node === 'math').map((entry) => entry.field)).toEqual(['label', 'number'])
  })
})
