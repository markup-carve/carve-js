import { expect, test } from 'vitest'
import { parseFragment, type DefaultTreeAdapterMap } from 'parse5'
import { migrateDjot, carveToHtml } from '../src/index.js'
import controls from './fixtures/djot-definition-container-ownership.json'

function shape(html: string): unknown[] {
  const result: unknown[] = [], pending: Array<[DefaultTreeAdapterMap['node'], number, boolean]> = [[parseFragment(html), 0, false]]
  while (pending.length) {
    const [node, depth, verbatim] = pending.pop()!
    if ('value' in node) {
      const text = verbatim ? node.value : node.value.replace(/[\t\r\n ]+/g, ' ').trim().replaceAll('↩︎', '↩')
      if (text) result.push(['text', depth, text])
    } else if ('attrs' in node) {
      result.push([node.nodeName, depth, node.attrs.filter(a => !['data-delim', 'aria-label', 'data-task-state'].includes(a.name) && !(a.name === 'role' && a.value === 'math') && !(a.name === 'scope' && a.value === 'col')).map(a => [a.name, a.value]).sort()])
    }
    if ('childNodes' in node) for (const child of [...node.childNodes].reverse()) pending.push([child, depth + Number(node.nodeName !== '#document-fragment'), verbatim || node.nodeName === 'pre' || node.nodeName === 'code'])
  }
  return result
}

test('Djot definition container ownership preserves Native structure', () => {
  for (const row of controls) {
    const result = migrateDjot(row.source)
    expect(shape(carveToHtml(result.value)), row.source).toEqual(shape(row.html))
    expect(result.report.diagnostics.filter(d => /empty definition|definition item with an empty term/i.test(d.message)), row.source).toEqual([])
  }
})

test('joining description paragraphs does not invent an attributed span', () => {
  const result = migrateDjot('- : term\n\n    [x\n\n    ]{.c}')
  const html = carveToHtml(result.value)
  expect(html).not.toContain('<span')
  expect(html.replace(/\s+/g, ' ')).toContain('[x ]{.c}')
})
