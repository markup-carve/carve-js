import { readFileSync } from 'node:fs'
import { parseFragment } from 'parse5'
import { expect, it } from 'vitest'
import { carveToHtml, migrateMarkdown } from '../src/index.js'

const cases: Array<{ template: string; value: string; markdown: string; ancestors: string[] }> = JSON.parse(readFileSync(new URL('./fixtures/markdown-html-code-payloads.json', import.meta.url), 'utf8'))

type Node = ReturnType<typeof parseFragment>['childNodes'][number]
const text = (node: Node): string => 'value' in node ? node.value : 'childNodes' in node ? node.childNodes.map(text).join('') : ''
const records = (html: string) => {
  const codes: Array<{ value: string; ancestors: string[]; elements: string[] }> = []
  const roots: Array<{ tag: string; value: string }> = []
  const visit = (node: Node, ancestors: string[] = []) => {
    const tag = 'tagName' in node ? node.tagName : undefined
    const next = tag && tag !== 'section' ? [...ancestors, tag] : ancestors
    if (tag === 'code' && 'childNodes' in node) codes.push({ value: text(node), ancestors: next, elements: node.childNodes.flatMap(child => 'tagName' in child ? [child.tagName] : []) })
    if (tag && ['p', 'h1', 'h2', 'td', 'th'].includes(tag)) roots.push({ tag, value: text(node) })
    if ('childNodes' in node) for (const child of node.childNodes) visit(child, next)
  }
  for (const node of parseFragment(html).childNodes) visit(node)
  return { codes, roots }
}

it.each(cases)('preserves imported code payload in $template: $value', item => {
  const result = migrateMarkdown(item.markdown)
  expect(records(carveToHtml(result.value)).codes).toEqual([{ value: item.value, ancestors: item.ancestors, elements: [] }])
  const fallback = result.report.diagnostics.filter(row => row.code === 'raw-code-fallback')
  expect(fallback).toHaveLength(item.value === '' || /[\n\r]/.test(item.value) ? 1 : 0)
  for (const row of fallback) expect(row).toMatchObject({ fidelity: 'degraded', confidence: 'exact', severity: 'warning' })
})

const controls: Array<{ markdown: string; codes: ReturnType<typeof records>['codes']; roots: ReturnType<typeof records>['roots'] }> = JSON.parse(readFileSync(new URL('./fixtures/markdown-html-code-controls.json', import.meta.url), 'utf8'))
it.each(controls)('matches native code and surrounding text: $markdown', item => {
  expect(records(carveToHtml(migrateMarkdown(item.markdown).value))).toEqual({ codes: item.codes, roots: item.roots })
})
