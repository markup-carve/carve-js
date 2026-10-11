import { expect, it } from 'vitest'
import { parseFragment, type DefaultTreeAdapterMap } from 'parse5'
import { carveToCarve, carveToHtml, htmlToCarve, parse, renderCarve, renderCarveWithReport, renderHtml, resolve } from '../src/index.js'
import type { InlineNode } from '../src/ast.js'
import { SourceUnspellableError } from '../src/source-unspellable-error.js'
import controls from './fixtures/verbatim-continuation-guards.json'

function payloads(root: unknown): unknown[] {
  const records: Record<string, unknown>[] = []
  const seen = new WeakSet<object>()
  const stack: { node: unknown; path: string }[] = [{ node: root, path: '' }]
  while (stack.length > 0) {
    const entry = stack.pop()!
    if (entry.node === null || typeof entry.node !== 'object' || seen.has(entry.node)) continue
    seen.add(entry.node)
    const node = entry.node as Record<string, unknown>
    if (typeof node.type === 'string' && ['code', 'raw_inline', 'literal_inline', 'math', 'code_block', 'raw_block'].includes(node.type)) {
      records.push({ path: entry.path, type: node.type, payload: node.content ?? node.value, format: node.format, display: node.display })
    }
    for (const [key, value] of Object.entries(node).sort(([a], [b]) => a.localeCompare(b))) {
      if (value !== null && typeof value === 'object') stack.push({ node: value, path: `${entry.path}.${key}` })
    }
  }
  return records.sort((a, b) => String(a.path).localeCompare(String(b.path)))
}


type HtmlNode = DefaultTreeAdapterMap['node']
const containers = new Set(['blockquote', 'ul', 'ol', 'dl', 'table', 'tbody', 'tr'])

const htmlTree = (html: string): unknown => {
  const visit = (node: HtmlNode, literal = false): unknown => {
    if ('tagName' in node) literal ||= node.tagName === 'pre' || node.tagName === 'code'
    if ('value' in node) return literal ? node.value : node.value.replace(/[\t\n\r\f ]+/g, ' ')
    if (node.nodeName === '#comment') return null
    const parentContainer = node.nodeName === '#document-fragment' || ('tagName' in node && containers.has(node.tagName))
    const children = 'childNodes' in node ? node.childNodes
      .filter(child => !(parentContainer && 'value' in child && /^[\t\n\r\f ]*$/.test(child.value)))
      .map(child => visit(child, literal)).filter(child => child !== null) : []
    const attributes = 'attrs' in node ? node.attrs.map(attr => [attr.name, attr.value]).sort() : []
    return [node.nodeName, attributes, children]
  }
  return visit(parseFragment(html.replace(/(<br\b[^>]*>)[ \t\r]*\n[ \t]*/gi, '$1')))
}

// Native HTML comes from layout.mjs and html.mjs at spec 3bf1fc98d56012d2a5096c7ff9ee2544028aad34.
it.each(controls)('preserves definition-shaped continuations inside raw, literal and math spans: $source', ({ source, html }) => {
  const expected = htmlTree(html)
  expect(htmlTree(carveToHtml(source))).toEqual(expected)
  expect(htmlTree(renderHtml(resolve(parse(source))))).toEqual(expected)
  expect(htmlTree(carveToHtml(carveToCarve(source)))).toEqual(expected)
  const ast = resolve(parse(source))
  const result = renderCarveWithReport(ast)
  expect(result.losses).toEqual([])
  expect(result.totalLosses).toBe(0)
  expect(result.truncated).toBe(false)
  expect(payloads(resolve(parse(result.value)))).toEqual(payloads(ast))
  expect(carveToCarve(result.value)).toBe(result.value)
})


it.each(['raw_inline', 'literal_inline', 'math'] as const)('reports the actual %s node when a continuation cannot stay inside a term', (type) => {
  const node: InlineNode = type === 'raw_inline'
    ? { type, content: 'x\n[r]: /url', format: 'html' }
    : type === 'math'
      ? { type, content: 'x\n[r]: /url', display: false }
      : { type, content: 'x\n[r]: /url' }
  const document = parse(':: term\n: body\n')
  const list = document.children[0]
  if (list?.type !== 'definition_list') throw new Error('expected a description list')
  list.items[0]!.terms = [[node]]
  try {
    renderCarve(document)
    expect.fail('expected a source refusal')
  } catch (error) {
    expect(error).toBeInstanceOf(SourceUnspellableError)
    expect(error).toMatchObject({ nodeType: type, reason: 'a block marker on a continuation line ends the definition term' })
  }
})

it.each(['code', 'raw_inline', 'literal_inline', 'math'] as const)('retains the %s node on a footnote continuation refusal', type => {
  const node: InlineNode = type === 'code'
    ? { type, value: 'x\n> y' }
    : type === 'raw_inline'
      ? { type, content: 'x\n> y', format: 'html' }
      : type === 'math'
        ? { type, content: 'x\n> y', display: false }
        : { type, content: 'x\n> y' }
  const document = parse('text\n\n[^n]: body\n')
  document.footnoteDefs = { n: [{ type: 'paragraph', children: [node] }] }
  try {
    renderCarve(document)
    expect.fail('expected a footnote source refusal')
  } catch (error) {
    expect(error).toBeInstanceOf(SourceUnspellableError)
    expect(error).toMatchObject({ nodeType: type, node, reason: 'a block-marker continuation cannot stay inside a footnote paragraph' })
  }
})

it.each(['[r]: /target', '> continuation'])('preserves display math around %s continuations', continuation => {
  const document = resolve(parse('paragraph\n'))
  const paragraph = document.children[0]
  if (paragraph?.type !== 'paragraph') throw new Error('expected a paragraph')
  paragraph.children = [{ type: 'math', display: true, content: `x\n${continuation}` }]
  const result = renderCarveWithReport(document)
  expect(result.totalLosses).toBe(0)
  expect(payloads(resolve(parse(result.value)))).toEqual(payloads(document))
  expect(carveToCarve(result.value)).toBe(result.value)
})

it('refuses an unspellable imported verbatim leaf without deleting its payload', () => {
  const html = '<dl><dt><code>x\n[r]: /target</code></dt><dd>body</dd></dl>'
  try {
    htmlToCarve(html)
    expect.fail('expected a typed source refusal')
  } catch (error) {
    expect(error).toBeInstanceOf(SourceUnspellableError)
    expect(error).toMatchObject({ nodeType: 'code', node: { type: 'code', value: 'x\n[r]: /target' } })
  }
})
