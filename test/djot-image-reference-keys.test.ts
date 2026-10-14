import { expect, test } from 'vitest'
import { parseFragment, type DefaultTreeAdapterMap } from 'parse5'
import { migrateDjot, carveToHtml } from '../src/index.js'
import controls from './fixtures/djot-image-reference-keys.json'

function images(html: string): Array<Record<string, string>> {
  const rows: Array<Record<string, string>> = []
  const pending: DefaultTreeAdapterMap['node'][] = [parseFragment(html)]
  while (pending.length) {
    const node = pending.pop()!
    if ('attrs' in node && node.nodeName === 'img') rows.push(Object.fromEntries(node.attrs.map(attr => [attr.name, attr.value])))
    if ('childNodes' in node) pending.push(...node.childNodes)
  }
  return rows
}

test.each(controls)('resolves a Native image reference: $source', row => {
  const result = migrateDjot(row.source)
  const expected = images(row.html)
  const blank = expected.some(image => /\n[ \t]*\n/.test(image.alt ?? ''))
  for (const image of expected) image.alt = image.alt?.replace(/\n(?:[ \t]*\n)+/g, '\n') ?? ''
  expect(images(carveToHtml(result.value))).toEqual(expected)
  expect(result.report.diagnostics.some(d => /unresolved Djot reference/.test(d.message))).toBe(false)
  if (blank) expect(result.report.diagnostics.some(d => /image alternative text with a blank line/.test(d.message))).toBe(true)
})

test('keeps an unresolved collapsed image unresolved', () => {
  const result = migrateDjot('![a [b](u)\nc][]\n\n[other]: img')
  expect(images(carveToHtml(result.value))).toEqual([])
})

test('keeps an explicit reference name separate from its label', () => {
  const result = migrateDjot('![a [b](u)\nc][named]\n\n[named]: img')
  expect(images(carveToHtml(result.value))).toEqual([{alt: 'a b\nc', src: 'img'}])
})

test('keeps the loss report for an unsupported collapsed outer link', () => {
  const result = migrateDjot('[a [b](u\nv) c][]\n\n[a b c]: x')
  expect(result.report.diagnostics.some(d => /unresolved Djot reference/.test(d.message))).toBe(true)
  expect(result.report.diagnostics.some(d => /link inside another link/.test(d.message))).toBe(true)
})

test('keeps a footnote-shaped label out of image reference resolution', () => {
  const result = migrateDjot('![^a][]\n\n[^a]: note')
  expect(result.value).toContain('[]')
  expect(images(carveToHtml(result.value))).toEqual([])
})
