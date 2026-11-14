import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { defaultTreeAdapter, parseFragment, type DefaultTreeAdapterTypes as Html } from 'parse5'
import { format, parseTree, render, type DocumentNode } from '../../v2/src/index.ts'
import { importDocument, type Format, type ImportResult } from '../src/index.ts'
import { commonmarkCases, djotCases, gfmCases, type Case } from './suites.ts'

type HtmlVerdict = 'same' | 'same-text' | 'different'
type TreeVerdict = 'exact' | 'same-meaning' | 'same-rendering' | 'same-text' | 'lossy'
interface Tally { same: number, 'same-text': number, different: number }
interface TreeTally { exact: number, 'same-meaning': number, 'same-rendering': number, 'same-text': number, lossy: number }
interface Example { file: string, number: number, input: string, html: string }
const outputPath = join(import.meta.dirname, '../docs/conformance.md')
const blockTags = ['p', 'pre', 'blockquote', 'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'figure', 'figcaption',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'div', 'section']

function canonicalNode(node: Html.ChildNode, blocksOnly: boolean): string {
  if (defaultTreeAdapter.isTextNode(node)) return blocksOnly || !node.value.trim() ? '' : JSON.stringify(node.value)
  if (defaultTreeAdapter.isCommentNode(node)) return blocksOnly ? '' : `<!--${node.data}-->`
  if (!defaultTreeAdapter.isElementNode(node)) return ''
  const children = node.childNodes.map(child => canonicalNode(child, blocksOnly)).join('')
  if (node.tagName === 'section') return children
  if (blocksOnly && !blockTags.includes(node.tagName)) return children
  const attrs = blocksOnly ? '' : node.attrs.filter(attr => !(attr.name === 'id' && node.tagName.startsWith('h')))
    .map(attr => `${attr.name}=${JSON.stringify(attr.value)}`).sort().join(' ')
  return `<${node.tagName}${attrs ? ` ${attrs}` : ''}>${children}</${node.tagName}>`
}

function canonicalHtml(html: string, blocksOnly = false): string {
  return parseFragment(html).childNodes.map(node => canonicalNode(node, blocksOnly)).join('')
}

function visibleText(html: string): string {
  const walk = (node: Html.ChildNode): string => {
    if (defaultTreeAdapter.isTextNode(node)) return node.value
    if (!defaultTreeAdapter.isElementNode(node) || ['script', 'style'].includes(node.tagName)) return ''
    return node.childNodes.map(walk).join('')
  }
  return parseFragment(html).childNodes.map(walk).join('').replace(/\s+/gu, ' ').trim()
}

function verdict(expected: string, actual: string): HtmlVerdict {
  if (canonicalHtml(expected) === canonicalHtml(actual)) return 'same'
  if (visibleText(expected) === visibleText(actual) && canonicalHtml(expected, true) === canonicalHtml(actual, true)) {
    return 'same-text'
  }
  return 'different'
}

function cause(result: ImportResult | undefined, error: unknown, expected: string, actual: string): string {
  if (error !== undefined) return `exception: ${String(error)}`
  const codes = result?.diagnostics.map(item => item.code) ?? []
  if (codes.includes('import-unsupported')) return 'unsupported foreign node'
  if (codes.includes('import-degraded')) return 'degraded foreign node'
  if (codes.some(code => code.endsWith('unspellable'))) return 'writer cannot spell tree field'
  if (visibleText(expected) !== visibleText(actual)) return 'visible text differs'
  if (canonicalHtml(expected, true) !== canonicalHtml(actual, true)) return 'block structure differs'
  return 'inline structure or attributes differ'
}

function measureHtmlSuite(title: string, formatName: Format, cases: Case[], limit: number): string[] {
  const sections = new Map<string, Tally>()
  const different = new Map<string, string[]>()
  let raw = 0
  let stable = 0
  for (const entry of cases.slice(0, limit)) {
    let result: ImportResult | undefined
    let error: unknown
    let actual = ''
    try {
      result = importDocument(entry.input, { from: formatName })
      actual = render(result.source, { rawHtml: true })
      if (format(result.source) === result.source) stable++
      if (JSON.stringify(result.document).includes('"type":"raw_')) raw++
    } catch (caught) { error = caught }
    const kind = error === undefined ? verdict(entry.html, actual) : 'different'
    const tally = sections.get(entry.section) ?? { same: 0, 'same-text': 0, different: 0 }
    tally[kind]++
    sections.set(entry.section, tally)
    if (kind === 'different') {
      const reason = cause(result, error, entry.html, actual)
      different.set(reason, [...(different.get(reason) ?? []), entry.id])
    }
  }
  const lines = [`## ${title}`, '',
    `Cases: ${Math.min(cases.length, limit)}; canonical round trips: ${stable}; raw HTML nodes: ${raw}.`, '',
    '| Section | Same | Same text | Different |', '| --- | ---: | ---: | ---: |']
  for (const [section, tally] of sections) {
    lines.push(`| ${section.replaceAll('|', '\\|')} | ${tally.same} | ${tally['same-text']} | ${tally.different} |`)
  }
  lines.push('', 'Different examples by cause:', '')
  for (const [reason, ids] of different) lines.push(`- ${reason}: ${ids.join(', ')}`)
  return [...lines, '']
}

function normalizeTree(document: DocumentNode, meaning: boolean): string {
  const clone = structuredClone(document)
  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(visit)
    if (typeof value !== 'object' || value === null) return value
    const record = Object.fromEntries(Object.entries(value).filter(([key]) => !['data', 'extensions', 'pos',
      'srcByteLength', 'stages', 'generatedId', 'resolvedAlign', ...(meaning ? ['attrs', 'role'] : [])].includes(key))
      .map(([key, item]) => [key, visit(item)]))
    if (meaning && record['type'] === 'section' && Array.isArray(record['children'])) return record['children']
    return record
  }
  return JSON.stringify(visit(clone))
}

function treeVerdict(expected: DocumentNode, imported: ImportResult, expectedHtml: string): TreeVerdict {
  if (normalizeTree(expected, false) === normalizeTree(imported.document, false)) return 'exact'
  if (normalizeTree(expected, true) === normalizeTree(imported.document, true)) return 'same-meaning'
  const actual = render(imported.source, { rawHtml: true })
  if (canonicalHtml(expectedHtml) === canonicalHtml(actual)) return 'same-rendering'
  if (visibleText(expectedHtml) === visibleText(actual)) return 'same-text'
  return 'lossy'
}

function measureTreeSuite(limit: number): string[] {
  const examples = JSON.parse(readFileSync(join(import.meta.dirname, '../../v2/data/examples.json'), 'utf8')) as Example[]
  const tally: TreeTally = { exact: 0, 'same-meaning': 0, 'same-rendering': 0, 'same-text': 0, lossy: 0 }
  const lossy: string[] = []
  for (const example of examples.slice(0, limit)) {
    try {
      const imported = importDocument(example.html, { from: 'html' })
      const kind = treeVerdict(parseTree(example.input).document, imported, example.html)
      tally[kind]++
      if (kind === 'lossy') lossy.push(`${example.file}:${example.number}`)
    } catch { tally.lossy++; lossy.push(`${example.file}:${example.number} (exception)`) }
  }
  return ['## HTML rendered specification round trip', '', `Cases: ${Math.min(examples.length, limit)}.`, '',
    '| Exact | Same meaning | Same rendering | Same text | Lossy |', '| ---: | ---: | ---: | ---: | ---: |',
    `| ${tally.exact} | ${tally['same-meaning']} | ${tally['same-rendering']} | ${tally['same-text']} | ${tally.lossy} |`,
    '', `Lossy examples: ${lossy.join(', ') || 'none'}.`, '']
}

const sample = process.argv.includes('--sample')
const limit = sample ? 20 : Number.POSITIVE_INFINITY
const mutationRecord = readFileSync(join(import.meta.dirname, '../docs/mutations.json'), 'utf8')
const mutations = JSON.parse(mutationRecord) as { suiteInputs: number, mutations: number, trees: number, typedErrors: number }
const lines = ['# Import conformance', '',
  'Versions: CommonMark `commonmark.json` 0.31.0; GFM `cmark-gfm` 0.29.0.gfm.13 `test/spec.txt`; ' +
    'Djot `@djot/djot` 0.3.2 (`fa7a699`).', '',
  'HTML normalization parses with parse5, orders attributes, removes whitespace only text between tags, ' +
    'removes `section` wrappers and heading ids, and treats entity spelling and void closing forms equally. ' +
    '`same-text` requires equal visible text and equal block element structure after removing inline elements. ' +
    'The HTML tree ladder removes provenance, source positions, generated fields and, for `same-meaning`, ' +
    'attributes, paragraph role and section wrappers. `same-rendering` compares normalized HTML; ' +
    '`same-text` compares visible text alone.', '',
  'Raw HTML dependent examples count an imported `raw_block` or `raw_inline`; comparisons render with `rawHtml: true`.', '',
  `Mutation campaign: ${mutations.suiteInputs} suite inputs imported without error; ${mutations.mutations} byte mutations ` +
    `returned ${mutations.trees} trees and ${mutations.typedErrors} typed errors.`, '',
  ...measureHtmlSuite('CommonMark', 'markdown', commonmarkCases(), limit),
  ...measureHtmlSuite('GFM', 'gfm', gfmCases(), limit),
  ...measureHtmlSuite('Djot', 'djot', djotCases(), limit),
  ...measureTreeSuite(limit)]
if (!sample) writeFileSync(outputPath, `${lines.join('\n').trimEnd()}\n`)
process.stdout.write(`${lines.join('\n')}\n`)
