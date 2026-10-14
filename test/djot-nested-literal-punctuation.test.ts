import { test, expect } from 'vitest'
import { parseFragment } from 'parse5'
import { djotToCarve, carveToHtml } from '../src/index.js'
import controls from './fixtures/djot-nested-literal-punctuation.json'

test('nested image labels preserve literal punctuation during reparsing', () => {
  type HtmlNode = import('parse5').DefaultTreeAdapterMap['node']
  const shape = (node: HtmlNode): unknown => {
    if ('value' in node) {
      const parent = node.parentNode
      let ancestor = parent
      while (ancestor && ancestor.nodeName !== 'code' && ancestor.nodeName !== 'pre') ancestor = 'parentNode' in ancestor ? ancestor.parentNode : null
      let value = ancestor ? node.value : node.value.replace(/[\t\r\n ]+/g, ' ')
      if (parent && 'attrs' in parent && parent.attrs.some(attr => attr.name === 'role' && attr.value === 'doc-backlink')) value = value.replace(/\uFE0E/g, '')
      if (parent && ['p', 'li', 'blockquote', 'td', 'th'].includes(parent.nodeName)) {
        const children = parent.childNodes.filter(child => !('value' in child && /^[\t\r\n ]*$/.test(child.value)))
        if (children[0] === node) value = value.replace(/^ /, '')
        if (children.at(-1) === node) value = value.replace(/ $/, '')
      }
      return value
    }
    const children = 'childNodes' in node ? node.childNodes.filter(child => !(['#document-fragment', 'section', 'blockquote', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr'].includes(node.nodeName) && 'value' in child && /^[\t\r\n ]*$/.test(child.value))).map(shape) : []
    if (node.nodeName === 'thead' || node.nodeName === 'tbody') return children
    const attrs = 'attrs' in node ? node.attrs.filter(attr => !(attr.name === 'scope' && attr.value === 'col') && !['data-delim', 'data-task-state', 'aria-label'].includes(attr.name)).map(attr => [attr.name, attr.value]).sort() : []
    return [node.nodeName, attrs, children.flatMap(child => Array.isArray(child) && Array.isArray(child[0]) ? child : [child])]
  }
  const failures = []
  for (const { source, html } of controls) {
    const converted = djotToCarve(source)
    const actual = shape(parseFragment(carveToHtml(converted)))
    const expected = shape(parseFragment(html))
    if (JSON.stringify(actual) !== JSON.stringify(expected)) failures.push({ source, converted, actual, expected })
  }
  expect(failures).toEqual([])
})
