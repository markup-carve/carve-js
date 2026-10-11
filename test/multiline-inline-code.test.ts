import { expect, it } from 'vitest'
import { parseFragment, type DefaultTreeAdapterMap } from 'parse5'
import { carveToCarve, carveToHtml, parse, renderCarve, renderHtml, resolve } from '../src/index.js'
import controls from './fixtures/multiline-inline-code.json'

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
it.each(controls)('preserves multiline verbatim payloads across render and format paths: $source', ({ source, html }) => {
  const expected = htmlTree(html)
  expect(htmlTree(carveToHtml(source))).toEqual(expected)
  expect(htmlTree(renderHtml(resolve(parse(source))))).toEqual(expected)
  expect(htmlTree(carveToHtml(carveToCarve(source)))).toEqual(expected)
})

it.each(['a\rb`` end', 'a\r\nb`` end', 'a\rb\r\nc``` end', '\ue001\ue002\ue003\ue004\ue005\ue006\ue007\ue008\n[r]: /url'])('preserves a constructed Code value after line-ending normalization: %j', (value) => {
  const written = renderCarve({
    type: 'document',
    children: [{ type: 'paragraph', children: [{ type: 'code', value }] }],
  })
  const paragraph = parse(written).children[0]
  expect(paragraph?.type).toBe('paragraph')
  if (paragraph?.type !== 'paragraph') throw new Error('expected a paragraph')
  expect(paragraph.children).toHaveLength(1)
  expect(paragraph.children[0]).toMatchObject({ type: 'code', value: value.replace(/\r\n?/g, '\n') })
})
