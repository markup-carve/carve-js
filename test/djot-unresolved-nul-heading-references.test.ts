import { expect, test } from 'vitest'
import { parseFragment } from 'parse5'
import { carveToHtml } from '../src/index.js'
import { djotToCarveWithLosses } from '../src/djot-import.js'
import controls from './fixtures/djot-unresolved-nul-heading-references.json'

test('unresolved NUL heading references do not select replacement-character headings', () => {
  for (const { source, html, image } of controls) {
    expect(html, source).not.toMatch(/<(?:a|img)\b[^>]*\b(?:href|src)=/)
    const report = djotToCarveWithLosses(source)
    const actual = carveToHtml(report.value)
    expect(actual, source).not.toMatch(/<(?:a|img)\b[^>]*\b(?:href|src)=/)
    expect(actual, source).not.toContain('carve-djot-reference-')
    expect(actual, source).not.toMatch(/<(?:span|em|strong|code)\b/)
    expect(actual, source).not.toContain('class="c"')
    expect(actual, source).not.toContain('id="i"')
    expect(actual, source).not.toContain('{%comment%}')
    const message = image
      ? 'An unresolved Djot image reference has no src; Carve cannot spell that image.'
      : 'An unresolved Djot reference has no href; Carve cannot spell that link.'
    expect(report.losses.some(loss => loss.message === message), source).toBe(true)
  }
})

test.each([
  { source: '# a\0\n\n# a�\n\n[a�][]', target: 1 },
  { source: '# a�\n\n# a\0\n\n[a\0][]', target: 1 },
  { source: '# a\0\n\n# a�\n\n[a\0][]', target: 0 },
])('resolved NUL heading references select their own heading: $source', ({ source, target }) => {
  const document = parseFragment(carveToHtml(djotToCarveWithLosses(source).value))
  const ids: string[] = [], links: string[] = []
  const pending: import('parse5').DefaultTreeAdapterMap['node'][] = [document]
  while (pending.length) {
    const node = pending.pop()!
    if ('attrs' in node) {
      const id = node.attrs.find(attr => attr.name === 'id')?.value
      if (id && node.nodeName === 'section') ids.push(id)
      const href = node.attrs.find(attr => attr.name === 'href')?.value
      if (href) links.push(href)
    }
    if ('childNodes' in node) for (let i = node.childNodes.length - 1; i >= 0; i--) pending.push(node.childNodes[i]!)
  }
  expect(ids).toHaveLength(2)
  expect(links).toEqual(['#' + ids[target]])
})

test('an explicit NUL or replacement-character definition takes precedence over heading guards', () => {
  for (const key of ['a\0', 'a�']) {
    const source = '# a\0\n\n[x][' + key + ']\n\n[' + key + ']: /real'
    const report = djotToCarveWithLosses(source)
    expect(carveToHtml(report.value)).toContain('href="/real"')
    expect(report.losses.some(loss => loss.message.includes('unresolved Djot'))).toBe(false)
  }
})
