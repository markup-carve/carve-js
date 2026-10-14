import { expect, test } from 'vitest'
import { parseFragment, type DefaultTreeAdapterMap } from 'parse5'
import { migrateDjot, carveToHtml } from '../src/index.js'
import controls from './fixtures/djot-empty-definitions.json'

function shape(html: string): unknown[] {
  const result: unknown[] = [], pending: Array<[DefaultTreeAdapterMap['node'], number, boolean]> = [[parseFragment(html), 0, false]]
  while (pending.length) {
    const [node, depth, verbatim] = pending.pop()!
    if ('value' in node) {
      const text = verbatim ? node.value : node.value.replace(/[\t\r\n ]+/g, ' ').trim()
      if (text) result.push(['text', depth, text])
    } else if ('attrs' in node) {
      result.push([node.nodeName, depth, node.attrs.filter(a => !['data-delim', 'aria-label', 'data-task-state'].includes(a.name)).map(a => [a.name, a.value]).sort()])
    }
    if ('childNodes' in node) for (const child of [...node.childNodes].reverse()) pending.push([child, depth + Number(node.nodeName !== '#document-fragment'), verbatim || node.nodeName === 'pre' || node.nodeName === 'code'])
  }
  return result
}

test('empty Djot definition terms and descriptions preserve Native structure', () => {
  for (const row of controls) {
    const result = migrateDjot(row.source)
    expect(shape(carveToHtml(result.value)), row.source).toEqual(shape(row.html))
    expect(result.report.diagnostics.filter(d => /empty definition|definition item with an empty term/i.test(d.message)), row.source).toEqual([])
  }
})

test('empty description carriers preserve authored placeholder text', () => {
  const source = ': \0DJOTEMPTYTERM\0'
  const result = migrateDjot(source)
  expect(result.value).toContain('\0DJOTEMPTYTERM\0')
  expect(carveToHtml(result.value)).toContain('<dd></dd>')
})

test('reports definition code fallback at its original continuation opener', () => {
  const result = migrateDjot('before\n\n: term\n  `code\n  : x`{.x}\n\n  body')
  expect(result.report.diagnostics).toContainEqual(expect.objectContaining({
    code: 'structure-unspellable',
    message: 'Multiline inline code uses raw HTML; plain-text export omits it.',
    path: 'line:4',
  }))
})
