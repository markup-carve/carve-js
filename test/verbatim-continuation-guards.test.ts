import { expect, it } from 'vitest'
import { parseFragment, type DefaultTreeAdapterMap } from 'parse5'
import { carveToCarve, carveToHtml, parse, renderCarve, renderHtml, resolve } from '../src/index.js'
import type { InlineNode } from '../src/ast.js'
import { SourceUnspellableError } from '../src/source-unspellable-error.js'
import controls from './fixtures/verbatim-continuation-guards.json'

type HtmlNode = DefaultTreeAdapterMap['node']
const containers = new Set(['blockquote', 'ul', 'ol', 'dl', 'table', 'tbody', 'tr'])

const htmlTree = (html: string): unknown => {
  const visit = (node: HtmlNode, literal = false): unknown => {
    if ('tagName' in node) literal ||= node.tagName === 'pre' || node.tagName === 'code'
    if ('value' in node) return literal ? node.value : node.value.replace(/[\t\n\r\f ]+/g, ' ')
    if (node.nodeName === '#comment') return null
    const parentContainer = node.nodeName === '#document-fragment' || ('tagName' in node && containers.has(node.tagName))
    const children = 'childNodes' in node ? node.childNodes
      .filter(child => !(parentContainer && 'value' in child && /^[\t\n\r\f ]*$/.test(child.value)))
      .map(child => visit(child, literal)).filter(child => child !== null) : []
    const attributes = 'attrs' in node ? node.attrs.map(attr => [attr.name, attr.value]).sort() : []
    return [node.nodeName, attributes, children]
  }
  return visit(parseFragment(html.replace(/(<br\b[^>]*>)[ \t\r]*\n[ \t]*/gi, '$1')))
}

// Native HTML comes from layout.mjs and html.mjs at spec 3bf1fc98d56012d2a5096c7ff9ee2544028aad34.
it.each(controls)('preserves definition-shaped continuations inside raw, literal and math spans: $source', ({ source, html }) => {
  const expected = htmlTree(html)
  expect(htmlTree(carveToHtml(source))).toEqual(expected)
  expect(htmlTree(renderHtml(resolve(parse(source))))).toEqual(expected)
  expect(htmlTree(carveToHtml(carveToCarve(source)))).toEqual(expected)
})


it.each(['raw_inline', 'literal_inline', 'math'] as const)('reports the actual %s node when a continuation cannot stay inside a term', (type) => {
  const node: InlineNode = type === 'raw_inline'
    ? { type, content: 'x\n[r]: /url', format: 'html' }
    : type === 'math'
      ? { type, content: 'x\n[r]: /url', display: false }
      : { type, content: 'x\n[r]: /url' }
  const document = parse(':: term\n: body\n')
  const list = document.children[0]
  if (list?.type !== 'definition_list') throw new Error('expected a description list')
  list.items[0]!.terms = [[node]]
  try {
    renderCarve(document)
    expect.fail('expected a source refusal')
  } catch (error) {
    expect(error).toBeInstanceOf(SourceUnspellableError)
    expect(error).toMatchObject({ nodeType: type, reason: 'a block marker on a continuation line ends the definition term' })
  }
})
