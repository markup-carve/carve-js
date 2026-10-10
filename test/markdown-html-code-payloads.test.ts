import { readFileSync } from 'node:fs'
import { parseFragment, type DefaultTreeAdapterMap } from 'parse5'
import { expect, it } from 'vitest'
import { carveToHtml, migrateMarkdown } from '../src/index.js'

const cases: Array<{ template: string; value: string; markdown: string; ancestors: string[] }> = JSON.parse(readFileSync(new URL('./fixtures/markdown-html-code-payloads.json', import.meta.url), 'utf8'))

type Node = DefaultTreeAdapterMap['childNode']
const text = (node: Node): string => 'value' in node ? node.value : 'childNodes' in node ? node.childNodes.map(text).join('') : ''
const records = (html: string) => {
  const codes: Array<{ value: string; ancestors: string[]; elements: string[] }> = []
  const roots: Array<{ tag: string; value: string }> = []
  const attributes: Array<Record<string, string>> = []
  const visit = (node: Node, ancestors: string[] = []) => {
    const tag = 'tagName' in node ? node.tagName === 's' ? 'del' : node.tagName : undefined
    const next = tag && tag !== 'section' ? [...ancestors, tag] : ancestors
    if (tag && ['a', 'img'].includes(tag) && 'attrs' in node) attributes.push({ tag, ...Object.fromEntries(node.attrs.filter(attr => ['href', 'title', 'src', 'alt'].includes(attr.name)).map(attr => [attr.name, attr.value])) })
    if (tag === 'code' && 'childNodes' in node) codes.push({ value: text(node), ancestors: next, elements: node.childNodes.flatMap(child => 'tagName' in child ? [child.tagName === 's' ? 'del' : child.tagName] : []) })
    if (tag && ['p', 'h1', 'h2', 'td', 'th'].includes(tag)) roots.push({ tag, value: text(node) })
    if ('childNodes' in node) for (const child of node.childNodes) visit(child, next)
  }
  for (const node of parseFragment(html).childNodes) visit(node)
  return { codes, roots, attributes }
}

it.each(cases)('preserves imported code payload in $template: $value', item => {
  const result = migrateMarkdown(item.markdown)
  expect(records(carveToHtml(result.value)).codes).toEqual([{ value: item.value, ancestors: item.ancestors, elements: [] }])
  const fallback = result.report.diagnostics.filter(row => row.code === 'raw-code-fallback')
  expect(fallback).toHaveLength(result.value.includes('{=html}') ? 1 : 0)
  for (const row of fallback) expect(row).toMatchObject({ fidelity: 'degraded', confidence: 'exact', severity: 'warning' })
})

const controls: Array<{ markdown: string; codes: ReturnType<typeof records>['codes']; roots: ReturnType<typeof records>['roots']; attributes: ReturnType<typeof records>['attributes'] }> = JSON.parse(readFileSync(new URL('./fixtures/markdown-html-code-controls.json', import.meta.url), 'utf8'))
it.each(controls)('matches native code and surrounding text: $markdown', item => {
  expect(records(carveToHtml(migrateMarkdown(item.markdown).value))).toEqual({ codes: item.codes, roots: item.roots, attributes: item.attributes })
})

it('keeps a spellable paragraph code payload native', () => {
  const result = migrateMarkdown('<code>a<!---->&#10;<!---->b</code>')
  expect(result.value).not.toContain('{=html}')
  expect(result.report.diagnostics.some(row => row.code === 'raw-code-fallback')).toBe(false)
  expect(carveToHtml(result.value, { allowRawHtml: false })).toBe('<p><code>a\nb</code></p>')
})

it('does not report losses from the discarded native-code probe', () => {
  const result = migrateMarkdown('<code>&#32;a_b</code>')
  expect(result.report.diagnostics.filter(row => row.code === 'structure-unspellable')).toEqual([])
  expect(carveToHtml(result.value, { allowRawHtml: false })).toBe('<p><code> a_b</code></p>')
})

it.each(['café_au', '名前_id', 'größ_e'])('keeps intraword underscores native: %s', value => {
  const result = migrateMarkdown(`<code>${value}</code>`)
  expect(result.report.diagnostics.filter(row => row.code === 'raw-code-fallback')).toEqual([])
  expect(carveToHtml(result.value, { allowRawHtml: false })).toBe(`<p><code>${value}</code></p>`)
})
