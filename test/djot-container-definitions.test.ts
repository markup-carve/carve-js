import { imageParagraphsAsImages } from './legacy-image-paragraph.js'
import { expect, test } from 'vitest'
import { parseFragment, type DefaultTreeAdapterMap } from 'parse5'
import { migrateDjot, carveToHtml, djotToCarve } from '../src/index.js'
import controls from './fixtures/djot-container-definitions.json'

function shape(html: string): unknown[] {
  const result: unknown[] = [], pending: Array<[DefaultTreeAdapterMap['node'], number, boolean]> = [[parseFragment(html), 0, false]]
  while (pending.length) {
    const [node, depth, verbatim] = pending.pop()!
    if ('value' in node) {
      const text = verbatim ? node.value : node.value.replace(/[\t\r\n ]+/g, ' ').trim()
      if (text) result.push(['text', depth, text])
    } else if ('attrs' in node) {
      result.push([node.nodeName, depth, node.attrs.filter(a => !['data-delim', 'aria-label', 'data-task-state'].includes(a.name) && !(a.name === 'role' && a.value === 'math') && !(a.name === 'scope' && a.value === 'col')).map(a => [a.name, a.value]).sort()])
    }
    if ('childNodes' in node) for (const child of [...node.childNodes].reverse()) pending.push([child, depth + Number(node.nodeName !== '#document-fragment'), verbatim || node.nodeName === 'pre' || node.nodeName === 'code'])
  }
  return result
}

test('Djot definitions preserve quote, list and DIV ownership', () => {
  for (const row of controls) {
    const result = migrateDjot(row.source)
    expect(shape(carveToHtml(result.value)), row.source).toEqual(shape(imageParagraphsAsImages(row.html)))
    expect(result.report.diagnostics.filter(d => /empty definition|definition item with an empty term/i.test(d.message)), row.source).toEqual([])
  }
})


test('deep definition hosts stay within the conversion budget', () => {
  for (const marker of ['> ', '- ']) {
    const first = djotToCarve(marker.repeat(1024) + ': term')
    const second = djotToCarve(marker.repeat(2048) + ': term')
    expect(second.length).toBeLessThanOrEqual(first.length * 2)
  }
})
