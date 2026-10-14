import { expect, test } from 'vitest'
import { parseFragment } from 'parse5'
import { carveToHtml, djotToCarve } from '../src/index.js'
import controls from './fixtures/djot-div-openers.json'

type HtmlNode = import('parse5').DefaultTreeAdapterMap['node']
function content(node: HtmlNode, parent = ''): unknown {
  if (node.nodeName === '#text' && 'value' in node) {
    if (['#document-fragment', 'div', 'blockquote', 'section', 'ul', 'ol', 'li'].includes(parent) && /^\s*$/.test(node.value)) return null
    return ['text', node.value]
  }
  if (node.nodeName === '#comment' && 'data' in node) return ['comment', node.data]
  return [node.nodeName, 'attrs' in node ? node.attrs.map(attr => [attr.name, attr.value]).sort() : [],
    'childNodes' in node ? node.childNodes.map(child => content(child, node.nodeName)).filter(child => child !== null) : []]
}

test('Djot DIV openers normalize compact and tab-separated classes', () => {
  const failures = []
  for (const { source, html } of controls) {
    const converted = djotToCarve(source)
    const actual = content(parseFragment(carveToHtml(converted)))
    const expected = content(parseFragment(html))
    if (JSON.stringify(actual) !== JSON.stringify(expected)) failures.push({ source, converted, actual, expected })
  }
  expect(failures).toEqual([])
})
