import { test, expect } from 'vitest'
import { parseFragment } from 'parse5'
import { djotToCarve, carveToHtml } from '../src/index.js'
import controls from './fixtures/djot-nul-heading-references.json'

test('NUL heading references preserve Native destinations', () => {
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
    const attrs = 'attrs' in node ? node.attrs.filter(attr => !(attr.name === 'scope' && attr.value === 'col') && !['data-delim', 'data-task-state', 'aria-label'].includes(attr.name)).map(attr => [attr.name, ['href', 'src'].includes(attr.name) ? attr.value.replace(/ /g, '%20') : attr.value]).sort() : []
    return [node.nodeName, attrs, children.flatMap(child => Array.isArray(child) && Array.isArray(child[0]) ? child : [child])]
  }
  const failures = []
  for (const row of controls) {
    const { source, html } = row
    const converted = djotToCarve(source)
    const rendered = carveToHtml(converted)
    if ('destinationOnly' in row) {
      const destinations = (html: string): string[] => [...html.matchAll(/\b(?:href|src)="([^"]*)"/g)].map(match => match[1]!.replaceAll('\0', '�').replace(/ /g, '%20'))
      expect(destinations(rendered), source).toEqual(destinations(html))
      continue
    }
    const actual = shape(parseFragment(rendered))
    const expected = shape(parseFragment(html.replaceAll('\0', '�')))
    if (JSON.stringify(actual) !== JSON.stringify(expected)) failures.push({ source, converted, actual, expected })
  }
  expect(failures).toEqual([])
})

test.each([
  { source: '# A b\0\n\n# A-b\0\n\n[A-b\0][]', target: 1 },
  { source: '# a�b\n\n# a\0b\n\n[a\0b][]', target: 1 },
  { source: '# H\0\n\n[H\0][]\n\n{#H�}', target: 0 },
  { source: '# H\0\n\n[H\0][]\n\n{#H�}\n{.x}', target: 0 },
])('a heading reference points to its actual heading: $source', ({ source, target }) => {
  const document = parseFragment(carveToHtml(djotToCarve(source)))
  const ids: string[] = [], links: string[] = []
  const pending: import('parse5').DefaultTreeAdapterMap['node'][] = [document]
  while (pending.length) {
    const node = pending.pop()!
    if ('attrs' in node) {
      const id = node.attrs.find(attr => attr.name === 'id')?.value
      if (id && (node.nodeName === 'section' || /^h[1-6]$/.test(node.nodeName))) ids.push(id)
      const href = node.attrs.find(attr => attr.name === 'href')?.value
      if (href) links.push(href)
    }
    if ('childNodes' in node) for (let i = node.childNodes.length - 1; i >= 0; i--) pending.push(node.childNodes[i]!)
  }
  expect(links).toEqual(['#' + ids[target]])
})
