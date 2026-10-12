import { expect, it } from 'vitest'
import { parseFragment, type DefaultTreeAdapterMap } from 'parse5'
import { carveToCarve, carveToHtml, markdownToCarve, migrateMarkdown } from '../src/index.js'
import controls from './fixtures/markdown-native-destinations.json'

type HtmlNode = DefaultTreeAdapterMap['node']
const shape = (node: HtmlNode): unknown => {
  if ('value' in node) return node.value.replace(/[\t\n\r\f ]+/g, ' ')
  const children = 'childNodes' in node ? node.childNodes
    .filter(child => !(['#document-fragment', 'blockquote', 'ul', 'ol', 'table', 'thead', 'tbody', 'tr'].includes(node.nodeName) && 'value' in child && /^[\t\n\r\f ]*$/.test(child.value)))
    .map(shape) : []
  const attrs = 'attrs' in node ? node.attrs.filter(attr => !(attr.name === 'scope' && attr.value === 'col')).map(attr => {
    // Carve keeps brackets in URL paths; cmark percent-encodes those bytes.
    const value = (attr.name === 'href' || attr.name === 'src') && attr.value.startsWith('/')
      ? attr.value.replace(/%5b/gi, '[').replace(/%5d/gi, ']') : attr.value
    return [attr.name, value]
  }).sort() : []
  if (node.nodeName === 'p' && children.length === 1 && 'childNodes' in node && node.childNodes[0]!.nodeName === 'img') return children[0]
  return [node.nodeName, attrs, children]
}

it.each(controls as Array<{ source: string; html: string; carveHtml?: string; dropped?: number }>)('preserves native destination boundaries: $source', ({ source, html, carveHtml, dropped = 0 }) => {
  const written = markdownToCarve(source)
  const expected = shape(parseFragment(carveHtml ?? html))
  expect(shape(parseFragment(carveToHtml(written)))).toEqual(expected)
  expect(shape(parseFragment(carveToHtml(carveToCarve(written))))).toEqual(expected)
  expect(migrateMarkdown(source).report.diagnostics.filter(row => row.confidence === 'exact' && row.fidelity === 'dropped')).toHaveLength(dropped)
})
