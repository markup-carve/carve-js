import { imageParagraphsAsImages } from './legacy-image-paragraph.js'
import { test, expect } from 'vitest'
import { parseFragment } from 'parse5'
import { carveToHtml } from '../src/index.js'
import { djotToCarveWithLosses } from '../src/import/djot/djot-import.js'
import controls from './fixtures/djot-collapsed-image-keys.json'

test('collapsed image keys preserve native child text and report unresolved destinations', () => {
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
  for (const { source, html, loss, blankAlt } of controls) {
    const report = djotToCarveWithLosses(source)
    const unresolved = report.losses.filter(item => item.message === 'An unresolved Djot image reference has no src; Carve cannot spell that image.')
    expect(unresolved.length > 0, source).toBe(loss)
    const blank = report.losses.filter(item => item.message === 'An image alternative text with a blank line cannot be spelled in Carve.')
    expect(blank.length > 0, source).toBe(blankAlt)
    const converted = report.value
    if (loss) {
      const destinations = (value: string) => [...value.matchAll(/<img\b[^>]*\bsrc="([^"]*)"/g)].map(match => match[1])
      expect(destinations(carveToHtml(converted)), source).toEqual(destinations(html))
    }
    if (loss || blankAlt) continue
    const actual = shape(parseFragment(carveToHtml(converted)))
    const expected = shape(parseFragment(imageParagraphsAsImages(html)))
    if (JSON.stringify(actual) !== JSON.stringify(expected)) failures.push({ source, converted, actual, expected })
  }
  expect(failures).toEqual([])
})

test('escaped collapsed brackets remain literal', () => {
  const source = '\\[a][]\n\n[a]: img'
  expect(carveToHtml(djotToCarveWithLosses(source).value).trim()).toBe('<p>[a][]</p>')
})

test('multiline image keys inside list quotes retain their destination and report blank alternatives', () => {
  for (const source of ['- > ![a\n  > b][]\n\n[a b]: img', '> - ![a\n>   b][]\n\n[a b]: img']) {
    const report = djotToCarveWithLosses(source)
    expect(report.losses).toEqual([])
    expect(carveToHtml(report.value)).toContain('alt="a\nb"')
    expect(carveToHtml(report.value)).toContain('src="img"')
  }
  expect(djotToCarveWithLosses('- > ![a\n  > {.x}\n  > b](img)').losses.some(item => item.message === 'An image alternative text with a blank line cannot be spelled in Carve.')).toBe(true)
})
