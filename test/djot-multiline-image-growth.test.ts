import { expect, test } from 'vitest'
import { parseFragment, type DefaultTreeAdapterMap } from 'parse5'
import { migrateDjot, carveToHtml } from '../src/index.js'
import controls from './fixtures/djot-multiline-image-growth.json'

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

test('multiline image chains preserve Native output and loss guards', () => {
  for (const row of controls) {
    const result = migrateDjot(row.source)
    expect(shape(carveToHtml(result.value)), row.source).toEqual(shape(row.html))
    expect(result.report.diagnostics.filter(d => d.code === 'structure-unspellable').map(d => d.message), row.source).toEqual(row.losses)
  }
}, 30000)

test('deep multiline image chains preserve all alternative text', () => {
  for (const depth of [256, 512]) {
    const result = migrateDjot('![x\n'.repeat(depth) + 'z' + '](u)'.repeat(depth))
    const pending: DefaultTreeAdapterMap['node'][] = [parseFragment(carveToHtml(result.value))]
    let alt: string | undefined
    while (pending.length) {
      const node = pending.pop()!
      if ('attrs' in node && node.nodeName === 'img') alt = node.attrs.find(a => a.name === 'alt')?.value
      if ('childNodes' in node) pending.push(...node.childNodes)
    }
    expect(alt).toEqual('x\n'.repeat(depth) + 'z')
    expect(result.report.diagnostics.filter(d => d.code === 'structure-unspellable')).toEqual([])
  }
}, 30000)

test('image growth rewriting preserves site frontmatter', () => {
  const header = '---\nalt: ![a\n  ![b](u)](v)\n---'
  expect(migrateDjot(header + '\n\ntext').value.startsWith(header)).toBe(true)
})
