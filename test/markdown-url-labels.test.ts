import { expect, it } from 'vitest'
import { parseFragment, type DefaultTreeAdapterMap } from 'parse5'
import { carveToCarve, carveToHtml, markdownToCarve, migrateMarkdown, parse, renderHtml, resolve } from '../src/index.js'
import controls from './fixtures/markdown-url-labels.json'

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

// Native HTML comes from cmark-gfm with unsafe HTML and the GFM extensions enabled.
it.each(controls)('preserves Markdown URL label text and emphasis: $source', ({ source: markdown, html }) => {
  const source = markdownToCarve(markdown)
  const migration = migrateMarkdown(markdown)
  expect(migration.value).toBe(source)
  expect(migration.report.diagnostics.length).toBeGreaterThan(0)
  if (migration.report.diagnostics.some(row => row.confidence !== 'exact')) {
    expect(migration.report.diagnostics.some(row => row.code === 'fidelity-unverified')).toBe(true)
  }
  for (const row of migration.report.diagnostics) {
    expect(row.confidence === 'exact' && row.fidelity === 'dropped').toBe(false)
    if (row.code === 'fidelity-unverified') {
      expect(row).toMatchObject({ severity: 'warning', fidelity: 'dropped', confidence: 'fallback' })
    }
  }
  const expected = htmlTree(html)
  expect(htmlTree(carveToHtml(source))).toEqual(expected)
  expect(htmlTree(renderHtml(resolve(parse(source))))).toEqual(expected)
  expect(htmlTree(carveToHtml(carveToCarve(source)))).toEqual(expected)
})

it.each([
  '[https://e.test](x)\n',
  '[*https://e.test*](x)\n',
  '[https://x.test/_a_](x)\n',
  '[a/b](x)\n',
  '[src/index.ts](x)\n',
  '[*https://example.test/a/_v1_/x*](u)\n',
])('verifies supported URL labels exactly: %s', source => {
  const diagnostics = migrateMarkdown(source).report.diagnostics
  expect(diagnostics.some(row => row.code === 'markdown-link')).toBe(true)
  expect(diagnostics.every(row => row.confidence === 'exact')).toBe(true)
  expect(diagnostics.some(row => row.fidelity === 'dropped')).toBe(false)
})


it.each([
  ['[a/b](x)\n', '[a/b](x)\n'],
  ['https://x.test/[r]\n\n[r]: /u\n', 'https://x.test/[r]\n\n[r]: /u\n'],
  ['https://x.test/a\\_b/[r]\n\n[r]: /u\n', 'https://x.test/a\\_b/[r]\n\n[r]: /u\n'],
  ['[src/index.ts](x)\n', '[src/index.ts](x)\n'],
  ['[https://e.test](https://e.test)\n', '[https://e.test](https://e.test)\n'],
  ['see https://x.test/a\\_b/_c_\n', 'see https://x.test/a\\_b/_c_\n'],
])('keeps literal path spelling for %s', (source, expected) => {
  expect(markdownToCarve(source)).toBe(expected)
})

it.each(['https://x.test/[r]\n\n[r]: /u\n', 'https://x.test/a\\_b/[r]\n\n[r]: /u\n'])('reports unverified fidelity for preserved bare URL spelling: %s', source => {
  const rows = migrateMarkdown(source).report.diagnostics
  expect(rows.some(row => row.code === 'fidelity-unverified' && row.confidence === 'fallback' && row.fidelity === 'dropped')).toBe(true)
})


it.each([
  ['[r](<> "t")\n\n[r]: /u\n', '[r]{title=t}\n\n[r]: /u\n'],
  ['[https://x.test](<> "t")\n\n[https://x.test]: /u\n', '[https://x.test]{title=t}\n\n[https://x.test]: /u\n'],
])('keeps titled empty destinations lossy without resolving another reference: %s', (source, expected) => {
  const migration = migrateMarkdown(source)
  expect(migration.value).toBe(expected)
  expect(migration.report.diagnostics.some(row => row.code === 'structure-unspellable' && row.fidelity === 'dropped')).toBe(true)
})

it('braces HTML emphasis after an escaped URL slash and reports the remaining URL fidelity gap', () => {
  const migration = migrateMarkdown('https://x.test/a\\/<em>b</em>\n')
  expect(migration.value).toBe('https://x.test/a\\/{/b/}\n')
  expect(migration.report.diagnostics.some(row => row.code === 'fidelity-unverified' && row.confidence === 'fallback')).toBe(true)
})


it.each([
  ['https://x.test/?a=1&amp;b=_c_\n', 'https://x.test/?a=1&amp;b=_c_\n'],
  ['https://x.test/?a=1&amp;b=*c*\n', 'https://x.test/?a=1&amp;b=*c*\n'],
  ['https://x.test/?a=1&amp;[r]\n\n[r]: /u\n', 'https://x.test/?a=1&amp;[r]\n\n[r]: /u\n'],
])('preserves unverified URL migration spelling across a character reference: %s', (source, expected) => {
  const migration = migrateMarkdown(source)
  expect(migration.value).toBe(expected)
  expect(migration.report.diagnostics.some(row => row.code === 'fidelity-unverified' && row.confidence === 'fallback')).toBe(true)
})
