import { expect, test } from 'vitest'
import { parseFragment, type DefaultTreeAdapterMap } from 'parse5'
import { carveToHtml, migrateDjot } from '../src/index.js'
import controls from './fixtures/djot-image-deletion.json'

function alt(html: string): string | undefined {
  const pending: Array<DefaultTreeAdapterMap['node']> = [parseFragment(html)]
  while (pending.length) {
    const node = pending.shift()!
    if ('attrs' in node && node.nodeName === 'img') return node.attrs.find(attribute => attribute.name === 'alt')?.value
    if ('childNodes' in node) pending.unshift(...node.childNodes)
  }
}

test('deletion spans contribute their child text to Djot image alternatives', () => {
  for (const row of controls) {
    const result = migrateDjot(row.source)
    const expected = row.trailingLoss ? row.alt.replace(/[ \t]+\n/g, '\n') : row.alt
    expect(alt(carveToHtml(result.value)), row.source).toBe(expected)
    expect(result.report.diagnostics.some(diagnostic => diagnostic.message.includes('trailing spaces before a line break')), row.source).toBe(row.trailingLoss)
  }
})
