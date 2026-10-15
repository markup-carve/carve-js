import { expect, test } from 'vitest'
import { parseFragment, type DefaultTreeAdapterMap } from 'parse5'
import { migrateDjot, carveToHtml } from '../src/index.js'
import controls from './fixtures/djot-opaque-reference-targets.json'

function shape(html: string): unknown[] {
  const result: unknown[] = [], pending: [DefaultTreeAdapterMap['node'], number][] = [[parseFragment(html), 0]]
  while (pending.length) {
    const [node, depth] = pending.pop()!
    if ('value' in node) {
      const text = node.value.replace(/[\t\r\n ]+/g, ' ').trim()
      if (text) result.push(['text', depth, text])
    } else if ('attrs' in node) result.push([node.nodeName, depth, node.attrs.filter(a => !['data-delim', 'data-task-state', 'aria-label'].includes(a.name)).map(a => [a.name, a.value]).sort()])
    if ('childNodes' in node) for (const child of [...node.childNodes].reverse()) pending.push([child, depth + Number(node.nodeName !== '#document-fragment')])
  }
  return result
}

test('reference targets preserve Native data and unresolved-reference guards', () => {
  for (const row of controls) {
    const result = migrateDjot(row.source)
    expect(shape(carveToHtml(result.value)), row.source).toEqual(shape(row.html))
    expect(result.report.diagnostics.filter(d => d.code === 'structure-unspellable').length, row.source).toEqual(row.lossCount)
  }
}, 30000)

