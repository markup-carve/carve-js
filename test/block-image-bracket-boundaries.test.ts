import { parseFragment, type DefaultTreeAdapterTypes } from 'parse5'
import { expect, it } from 'vitest'
import { carveToHtml, parse, renderHtml, renderCarveWithReport, resolve, markdownToCarve, htmlToCarve } from '../src/index.js'
import { buildBracketMap } from '../src/parse.js'
import controls from './fixtures/block-image-bracket-boundaries.json'

function htmlTree(html: string): unknown {
  const containers = new Set(['#document-fragment', 'blockquote', 'ul', 'ol', 'dl', 'dd', 'li'])
  const visit = (node: DefaultTreeAdapterTypes.Node): unknown => {
    if (node.nodeName === '#text') return ['text', (node as DefaultTreeAdapterTypes.TextNode).value]
    if (node.nodeName === '#comment') return ['comment', (node as DefaultTreeAdapterTypes.CommentNode).data]
    const children = 'childNodes' in node ? node.childNodes : []
    const attributes = 'attrs' in node ? node.attrs.map(attr => [attr.name, attr.value]).sort() : []
    return [node.nodeName, attributes, children.filter((child, index) => {
      const atEdge = index === 0 || index === children.length - 1
      return !(containers.has(node.nodeName) && atEdge && child.nodeName === '#text'
        && /^[\t\n\r ]*$/.test((child as DefaultTreeAdapterTypes.TextNode).value))
    }).map(visit)]
  }
  return visit(parseFragment(html))
}

// These goldens were checked separately against native Carve bracket boundaries.
it.each(controls)('keeps block-image bracket boundaries: $source', ({ source, html }) => {
  expect(htmlTree(carveToHtml(source))).toEqual(htmlTree(html))
  const ast = resolve(parse(source))
  expect(htmlTree(renderHtml(ast))).toEqual(htmlTree(html))
  const formatted = renderCarveWithReport(ast)
  expect(formatted.losses).toEqual([])
  expect(formatted.totalLosses).toBe(0)
  expect(htmlTree(carveToHtml(formatted.value))).toEqual(htmlTree(html))
})

it.each(controls.filter(({ source }) => source.startsWith('![') && !source.includes('\n') && source.includes('{% ') && !source.includes('{data-')))(
  'preserves literal comment-shaped image alt through imports: $source', ({ source, html }) => {
    expect(carveToHtml(markdownToCarve(source))).toContain(html)
    const imported = htmlToCarve(html)
    expect(imported.report.diagnostics).toEqual([])
    expect(htmlTree(carveToHtml(imported.value))).toEqual(htmlTree(html))
  },
)

it('restores ordinary link comment context after a nested image', () => {
  expect(carveToHtml('[a {% ] %} b](/u)').trim()).toBe('<p><a href="/u">a  b</a></p>')
  expect(carveToHtml('[![x](/i) {% ] %} c](/u)').trim()).toBe('<p><a href="/u"><img src="/i" alt="x">  c</a></p>')
})

it('keeps an editorial opener in imported image alt from consuming its title', () => {
  const html = '<img src="/image" alt="{# x" title="t #}">'
  const markdown = '![{# x](/image "t #}")'
  expect(htmlTree(carveToHtml(markdownToCarve(markdown)))).toEqual(htmlTree(html))
  const imported = htmlToCarve(html)
  expect(imported.report.diagnostics).toEqual([])
  expect(htmlTree(carveToHtml(imported.value))).toEqual(htmlTree(html))
})

it('uses escape-aware image context when rescanning openers inside a closed span', () => {
  const image = '[m](u`) ![a {% ] %} b](`v)'
  const imageOpen = image.indexOf('![') + 1
  expect(buildBracketMap(image)(imageOpen)).toBe(image.indexOf(']', imageOpen))
  const link = '[m](u`) \\![a {% ] %} b](`v)'
  const linkOpen = link.indexOf('![') + 1
  expect(buildBracketMap(link)(linkOpen)).toBe(link.indexOf('](`v)'))
  const nested = '`[a ![b {% ] %} c](i) d]`'
  expect(buildBracketMap(nested)(1)).toBe(nested.indexOf('](i)'))
})
