import { describe, expect, it } from 'vitest'
import { parseFragment } from 'parse5'
import { carveToHtml, htmlToAst, htmlToCarve, renderHtml, type Document } from '../src/index.js'

const payloads = ['<b>x</b>', '<b>unclosed', '</span><script>alert(1)</script>', '&lt;b&gt; & "quoted"', '<!-- unclosed', '\u202e<b>x</b>\u2069']
const source = (content: string): string => `lead \`${content}\`{=html} tail *strong*\n`
const document = (content: string): Document => ({
  type: 'document', children: [{ type: 'paragraph', children: [
    { type: 'text', value: 'lead ' }, { type: 'raw_inline', format: 'html', content },
    { type: 'text', value: ' tail ' }, { type: 'strong', children: [{ type: 'text', value: 'strong' }] },
  ] }],
})

function elements(html: string): string[] {
  const names: string[] = []
  type Node = { nodeName: string; childNodes?: Node[] }
  const visit = (node: Node): void => {
    if (!node.nodeName.startsWith('#')) names.push(node.nodeName)
    for (const child of node.childNodes ?? []) visit(child)
  }
  visit(parseFragment(html))
  return names
}

describe('raw HTML roundtrip carriers contain text', () => {
  it.each(payloads)('contains the source and AST payload %j without changing adjacent nodes', (payload) => {
    const html = renderHtml(document(payload), { roundtrip: true })
    expect(carveToHtml(source(payload), { roundtrip: true })).toBe(html)
    expect(elements(html)).toEqual(['p', 'span', 'strong'])
    for (const mode of ['safe', 'semantic', 'roundtrip'] as const) {
      const expected = mode === 'roundtrip' ? document(payload) : {
        type: 'document', children: [{ type: 'paragraph', children: [
          { type: 'text', value: `lead ${payload} tail ` },
          { type: 'strong', children: [{ type: 'text', value: 'strong' }] },
        ] }],
      }
      expect(htmlToAst(html, { mode }).value).toEqual(expected)
      if (mode === 'roundtrip') expect(htmlToCarve(html, { mode }).value).toBe(source(payload))
    }
    expect(renderHtml(document(payload), { roundtrip: true, allowRawHtml: false })).toBe(html)
  })

  it('keeps ordinary HTML passthrough and the disabled-raw rendering choice', () => {
    expect(carveToHtml(source('<b>x</b>'))).toBe('<p>lead <b>x</b> tail <strong>strong</strong></p>')
    expect(carveToHtml(source('<b>x</b>'), { allowRawHtml: false })).toBe('<p>lead &lt;b&gt;x&lt;/b&gt; tail <strong>strong</strong></p>')
  })

  it.each(['safe', 'semantic', 'roundtrip'] as const)('keeps live-child legacy reader compatibility in %s mode', (mode) => {
    const html = '<p><span data-djot-raw="html"><b>x</b></span> tail</p>'
    const ast = htmlToAst(html, { mode }).value
    expect(ast).toEqual(htmlToAst(html.replace('data-djot-', 'data-carve-'), { mode }).value)
    expect(renderHtml(ast)).toBe(mode === 'roundtrip' ? '<p><b>x</b> tail</p>' : '<p><strong>x</strong> tail</p>')
  })
})
