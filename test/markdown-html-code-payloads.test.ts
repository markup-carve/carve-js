import { readFileSync } from 'node:fs'
import { parseFragment, type DefaultTreeAdapterMap } from 'parse5'
import { expect, it } from 'vitest'
import { carveToHtml, migrateMarkdown, parse } from '../src/index.js'

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
  if (item.value !== '' && !/[\r\n]/.test(item.value)) {
    expect(fallback).toHaveLength(0)
    expect(records(carveToHtml(result.value, { allowRawHtml: false })).codes).toEqual([{ value: item.value, ancestors: item.ancestors, elements: [] }])
  }
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

it('reads a footnote-shaped label with a destination as a link', () => {
  const result = migrateMarkdown('x[^1](u<code>a</code>)\n\n[^1]: note')
  expect(carveToHtml(result.value)).toBe('<p>x<a href="u%3Ccode%3Ea%3C/code%3E">^1</a></p>')
})

it.each(['Title\n<code>*a*</code>\n=====', 'a\nb <code></code>'])('reports the original code line: %s', markdown => {
  const result = migrateMarkdown(markdown)
  const rows = result.report.diagnostics.filter(row => row.code === 'raw-code-fallback')
  expect(rows).toHaveLength(1)
  expect(rows[0]?.path).toBe('line:2')
})

it('keeps a code fallback line after a multiline link title', () => {
  const result = migrateMarkdown('[x](u\n"t") <code></code>')
  expect(result.report.diagnostics.filter(row => row.code === 'raw-code-fallback')[0]?.path).toBe('line:2')
})

it.each(cases)('keeps unrelated code native after $template: $value', item => {
  const result = migrateMarkdown(item.markdown + '\n\n`keep`\n')
  const last = parse(result.value).children.at(-1)
  expect(last?.type).toBe('paragraph')
  if (last?.type === 'paragraph') expect(last.children.some(node => node.type === 'code' && node.value === 'keep')).toBe(true)
  expect(result.report.diagnostics.filter(row => row.code === 'raw-code-fallback').length).toBeLessThanOrEqual(1)
})

it('does not degrade code because of a delimiter in an autolink', () => {
  const result = migrateMarkdown('<code>*a</code> <http://e.test/b*>')
  expect(result.report.diagnostics.filter(row => row.code === 'raw-code-fallback')).toEqual([])
  expect(carveToHtml(result.value, { allowRawHtml: false })).toContain('<code>*a</code>')
})

it('keeps the code line after an invalid destination in a setext heading', () => {
  const result = migrateMarkdown('Title [a](b c) <code></code>\n=====')
  expect(result.report.diagnostics.filter(row => row.code === 'raw-code-fallback')[0]?.path).toBe('line:1')
})

it.each([
  ['<em><strong>x</strong></em>', '<p><em><strong>x</strong></em></p>'],
  ['<b>x<sup>2</sup></b>', '<p><strong>x<sup>2</sup></strong></p>'],
  ['<em>H<sub>2</sub>O</em>', '<p><em>H<sub>2</sub>O</em></p>'],
  ['<strong><del>x</del></strong>', '<p><strong><del>x</del></strong></p>'],
])('preserves formatting outside code: %s', (markdown, expected) => {
  const html = carveToHtml(migrateMarkdown(markdown!).value).replace(/<(\/?)(b|i|s)>/g, (_tag, close: string, tag: string) => '<' + close + (tag === 'b' ? 'strong' : tag === 'i' ? 'em' : 'del') + '>')
  expect(html).toBe(expected)
})

it('keeps a code delimiter in a link from pairing with outside text', () => {
  const result = migrateMarkdown('[<code>*a</code>](u) b*')
  expect(result.report.diagnostics.filter(row => row.code === 'raw-code-fallback')).toEqual([])
  expect(carveToHtml(result.value, { allowRawHtml: false })).toBe('<p><a href="u"><code>*a</code></a> b*</p>')
})

it('keeps the code line after a reference label spanning lines', () => {
  const result = migrateMarkdown('[x][a\nb] <code></code>\n\n[a b]: /u\n')
  expect(result.report.diagnostics.filter(row => row.code === 'raw-code-fallback')[0]?.path).toBe('line:2')
})

it('keeps many entity newline continuations in one code fallback', () => {
  const count = 16000
  const result = migrateMarkdown('> <code>a&#13;\n' + '> b&#13;\n'.repeat(count))
  const rows = result.report.diagnostics.filter(row => row.code === 'raw-code-fallback')
  expect(rows).toHaveLength(1)
  expect(rows[0]?.path).toBe('line:1')
  expect(records(carveToHtml(result.value)).codes[0]?.value).toBe('a\n' + 'b\n'.repeat(count))
})
