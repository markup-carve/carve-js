import { describe, expect, it } from 'vitest'
import { carveToHtml, htmlToCarve, renderCarve, renderHtml, SourceUnspellableError } from '../src/index.js'

const paragraph = (mark: Record<string, unknown>) => ({
  type: 'document',
  children: [{
    type: 'paragraph',
    children: [{ type: 'text', value: 'a ' }, mark, { type: 'text', value: ' b' }],
  }],
}) as never

const MARKS = ['emphasis', 'strong', 'underline', 'strike', 'highlight', 'superscript', 'subscript', 'insert', 'delete']

describe('an empty mark has no Carve spelling', () => {
  // `{//}` is literal text and `{--}` the braced en dash (markup-carve/carve#1608).
  it.each(MARKS)('refuses an empty %s', (type) => {
    expect(() => renderCarve(paragraph({ type, children: [] }))).toThrow(SourceUnspellableError)
  })

  it('refuses a flagged bold-italic around an empty emphasis', () => {
    const strong = { type: 'strong', boldItalic: true, children: [{ type: 'emphasis', children: [] }] }
    expect(() => renderCarve(paragraph(strong))).toThrow(SourceUnspellableError)
  })

  it('still writes whitespace-only content', () => {
    const tree = paragraph({ type: 'emphasis', children: [{ type: 'text', value: ' ' }] })
    expect(carveToHtml(renderCarve(tree))).toBe(renderHtml(tree))
  })
})

describe('the HTML importer drops an empty mark without a row', () => {
  // Ruling markup-carve/carve-rs#1719: it holds nothing a reader sees.
  it.each(['em', 'i', 'strong', 'b', 's', 'strike', 'u', 'mark', 'sub', 'sup', 'ins', 'del'])('drops <%s></%s>', (tag) => {
    const result = htmlToCarve(`<p>a <${tag}></${tag}> b</p>`)
    expect(result.value).toBe('a  b\n')
    expect(result.report.diagnostics).toEqual([])
  })
})

describe('an empty mark carrying attributes', () => {
  it('keeps them on an empty span, so an id still resolves', () => {
    const result = htmlToCarve('<p>a <em id="t"></em> b</p>')
    expect(result.value).toBe('a []{#t} b\n')
    expect(carveToHtml(result.value)).toContain('id="t"')
  })
})

describe('a mark whose content starts with a line break', () => {
  it.each(MARKS)('keeps a %s', (type) => {
    const tree = paragraph({ type, children: [{ type: 'soft_break' }, { type: 'text', value: 'x' }] })
    expect(carveToHtml(renderCarve(tree))).toBe(renderHtml(tree))
  })

  it.each(MARKS)('braces a %s edged by a tab, which the grammar counts as ws', (type) => {
    for (const value of ['\tx', 'x\t']) {
      const out = renderCarve(paragraph({ type, children: [{ type: 'text', value }] }))
      expect(out).toMatch(/^a \{/)
    }
  })

  it('keeps it inside a bold-italic', () => {
    const tree = paragraph({
      type: 'strong',
      children: [{ type: 'emphasis', children: [{ type: 'soft_break' }, { type: 'text', value: 'x' }] }],
    })
    expect(carveToHtml(renderCarve(tree))).toBe(renderHtml(tree))
  })
})
