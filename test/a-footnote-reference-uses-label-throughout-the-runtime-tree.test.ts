import { describe, expect, it } from 'vitest'
import {
  fromAstJson, htmlToAst, lintCarve, parse, renderAnsi, renderCarve,
  renderHtml, renderMarkdown, renderPlainText, toAstJson,
} from '../src/index.js'
import type { Document, FootnoteRef } from '../src/ast.js'

const source = 'See[^named].\n\n[^named]: Note.\n'
const reference = (doc: Document): FootnoteRef => {
  const paragraph = doc.children.find((node) => node.type === 'paragraph')!
  if (paragraph.type !== 'paragraph') throw new Error('Expected a paragraph')
  return paragraph.children.find((node): node is FootnoteRef => node.type === 'footnote_ref')!
}

function expectLabel(doc: Document, label: string): void {
  expect(reference(doc).label).toBe(label)
  expect(reference(doc)).not.toHaveProperty('id')
}

describe('a footnote reference uses label throughout the runtime tree', () => {
  it.each(['See[^named].\n', source, '[^named]^[inline]\n'])('parses %j with its published field', (input) => {
    expectLabel(parse(input), 'named')
  })

  it('decodes the wire field without translating it to id', () => {
    const wire = toAstJson(parse(source))
    const decoded = fromAstJson(JSON.parse(JSON.stringify(wire)))
    expectLabel(decoded, 'named')
    expect(toAstJson(decoded)).toEqual(wire)
    expect(renderCarve(decoded)).toBe(source)
    expect(renderHtml(decoded)).toContain('href="#fn1"')
  })

  it('imports the authored label from roundtrip HTML', () => {
    const html = renderHtml(parse(source), { roundtrip: true })
    const doc = htmlToAst(html, { mode: 'roundtrip' }).value
    expectLabel(doc, 'named')
    expect(renderCarve(doc)).toBe(source)
  })

  it('keeps unresolved labels in every output target', () => {
    for (const render of [renderHtml, renderCarve, renderMarkdown, renderPlainText, renderAnsi]) {
      expect(render(parse('See[^missing].\n')).replaceAll('\\', '')).toContain('[^missing]')
    }
    expect(lintCarve('See[^missing].\n').map((warning) => warning.rule)).toContain('unresolved-footnote')
    expect(lintCarve(source).map((warning) => warning.rule)).not.toContain('unresolved-footnote')
  })

  it('numbers repeated labels and inline notes independently', () => {
    const input = 'A[^named] B^[inline] C[^named].\n\n[^named]: Note.\n'
    const html = renderHtml(parse(input))
    expect(html.match(/href="#fn1"/g)).toHaveLength(2)
    expect(html.match(/href="#fn2"/g)).toHaveLength(1)
    expect(renderCarve(parse(input))).toBe(input)
  })
})
