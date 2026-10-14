import { expect, test } from 'vitest'
import { parseFragment, type DefaultTreeAdapterMap } from 'parse5'
import { migrateDjot, carveToHtml } from '../src/index.js'
import controls from './fixtures/djot-image-alt-losses.json'

function alternatives(html: string): string[] {
  const pending: DefaultTreeAdapterMap['node'][] = [parseFragment(html)], values: string[] = []
  while (pending.length) {
    const node = pending.pop()!
    if ('attrs' in node && node.nodeName === 'img') values.push(node.attrs.find(a => a.name === 'alt')?.value ?? '')
    if ('childNodes' in node) pending.push(...node.childNodes)
  }
  return values
}

test('image alternative losses use the rendered child text and source line', () => {
  for (const row of controls) {
    const result = migrateDjot(row.source)
    const losses = result.report.diagnostics.filter(d => d.code === 'structure-unspellable' && d.message.startsWith('An image alternative text'))
    expect(losses.length, row.source).toBe(row.kind === 'none' ? 0 : 1)
    const actual = alternatives(carveToHtml(result.value))
    if (row.kind === 'none') expect(actual, row.source).toEqual([row.alt])
    else {
      expect(losses[0]?.path, row.source).toBe(`line:${row.line}`)
      expect(losses[0]?.confidence, row.source).toBe('exact')
      expect(losses[0]?.message, row.source).toContain(row.kind === 'blank' ? 'blank line' : 'trailing spaces')
      expect(actual, row.source).not.toEqual([row.alt])
    }
  }
})
