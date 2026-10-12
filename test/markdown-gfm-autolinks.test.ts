import { expect, it } from 'vitest'
import { parseFragment, type DefaultTreeAdapterMap } from 'parse5'
import { carveToCarve, carveToHtml, markdownToCarve, migrateMarkdown, parse, renderHtml, resolve } from '../src/index.js'
import controls from './fixtures/markdown-gfm-autolinks.json'

type HtmlNode = DefaultTreeAdapterMap['node']
const containers = new Set(['blockquote', 'ul', 'ol', 'dl', 'table', 'thead', 'tbody', 'tr'])

const htmlTree = (html: string): unknown => {
  const visit = (node: HtmlNode, literal = false): unknown => {
    if ('tagName' in node) literal ||= node.tagName === 'pre' || node.tagName === 'code'
    if ('value' in node) return literal ? node.value : node.value.replace(/[\t\n\r\f ]+/g, ' ')
    if (node.nodeName === '#comment') return null
    const parentContainer = node.nodeName === '#document-fragment' || ('tagName' in node && containers.has(node.tagName))
    const children = 'childNodes' in node ? node.childNodes
      .filter(child => !(parentContainer && 'value' in child && /^[\t\n\r\f ]*$/.test(child.value)))
      .map(child => visit(child, literal)).filter(child => child !== null) : []
    const attributes = 'attrs' in node ? node.attrs.filter(attr => !(node.nodeName === 'th' && attr.name === 'scope' && attr.value === 'col')).map(attr => [attr.name, attr.value]).sort() : []
    const name = node.nodeName === 'del' ? 's' : node.nodeName === 'i' ? 'em' : node.nodeName
    if (name === 'p' && children.length === 1 && 'childNodes' in node && node.childNodes.length === 1 && node.childNodes[0]!.nodeName === 'img') return children[0]
    return [name, attributes, children]
  }
  return visit(parseFragment(html.replace(/(<br\b[^>]*>)[ \t\r]*\n[ \t]*/gi, '$1')))
}

// Native HTML comes from cmark-gfm with unsafe HTML and the GFM extensions enabled.
it.each(controls)('preserves GFM bare autolinks and surrounding emphasis: $source', ({ source: markdown, html }) => {
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

it.each(['http://example.test', 'https://example.test/a', 'FTP://example.test/a', 'www.example.test', 'a@example.test'])(
  'reports verified bare autolinks without a fallback warning: %s', source => {
    const diagnostics = migrateMarkdown(source).report.diagnostics
    expect(diagnostics.some(row => row.code === 'markdown-bare-autolink')).toBe(true)
    expect(diagnostics.every(row => row.confidence === 'exact' && row.fidelity !== 'dropped')).toBe(true)
  },
)

it.each(['', '\n', '\n\n'])(
  'keeps the importer trailing-newline convention for email text: %j', ending => {
    const source = markdownToCarve(`a@example.test${ending}`)
    expect(source.endsWith('\n')).toBe(ending !== '')
    expect(htmlTree(carveToHtml(source))).toEqual(htmlTree('<p><a href="mailto:a@example.test">a@example.test</a></p>'))
  },
)

it.each(['a@example.test', 'a\\_b@example.test', 'a+-b@example.test'])(
  'links email text inside a footnote definition: %s', email => {
    const result = migrateMarkdown(`note[^n]\n\n[^n]: ${email}\n`)
    const address = email.replace(/\\/g, '')
    expect(carveToHtml(result.value)).toContain(`<a href="mailto:${address}">${address}</a>`)
    expect(carveToHtml(carveToCarve(result.value))).toContain(`<a href="mailto:${address}">${address}</a>`)
    expect(result.report.diagnostics.some(row => row.code === 'fidelity-unverified')).toBe(true)
  },
)

it.each(['[a@b.test]()', '![a@b.test]()', 'a@b[]().test', 'a@b![]().test'])(
  'keeps empty destinations from introducing an email link: %s', source => {
    const result = migrateMarkdown(source)
    expect(carveToHtml(result.value)).not.toContain('mailto:')
    expect(result.report.diagnostics.some(row => row.message.includes('empty destination'))).toBe(true)
  },
)

it.each([
  '[a@b.test]()', '![a@b.test]()', 'a@b[]().test', 'a[]()@b.test',
  'a\\@b[]().test', 'a&#64;b[]().test', '*a@b[]().test*',
  '[a@b.test](<> "title")', '![a@b.test](<> "title")',
  '[![a@b.test]()](u)', '[a ![a@b.test]() b]()',
  '[a@b.test]() [c@d.test]()',
  '[x][a@b.test]()', '[a [x](u) b@c.test]()',
  '[a [foo] b@c.test]()\n\n[foo]: /url',
])('removes private scopes and preserves empty-destination email boundaries through formatting: %s', source => {
  const result = migrateMarkdown(source)
  expect(result.value).not.toContain('carve-md-empty-')
  expect(carveToHtml(result.value)).not.toContain('mailto:')
  expect(carveToHtml(carveToCarve(result.value))).not.toContain('mailto:')
})

it('links email outside an empty destination while preserving authored attributes', () => {
  const result = migrateMarkdown('<span carve-md-empty-0="label">keep</span> [a@b.test]() c@d.test')
  const html = carveToHtml(result.value)
  expect(html).toContain('carve-md-empty-0="label"')
  expect(html).not.toContain('carve-md-empty-1')
  expect(html).not.toContain('mailto:a@b.test')
  expect(html).toContain('mailto:c@d.test')
})

it('keeps empty heading and blank-table normalization with email elsewhere', () => {
  expect(carveToHtml(markdownToCarve('# []()\n\nmail c@d.test'))).toContain('<h1></h1>')
  const result = migrateMarkdown('| a |\n|---|\n| []() |\n\nmail c@d.test')
  expect(result.value).not.toContain('carve-md-empty-')
  expect(result.report.diagnostics.some(row => row.message.includes('blank cell'))).toBe(true)
})

it.each(['[foo]()\n\nmail a@b.test\n\n[foo]: /url', '*a [b*]() c@d.test', '- [ ]()\n\na@b.test', 'x [ ]() a@b.test', 'a@b.test *[]()*', '[[]()](u) a@b.test', '<code>[a]()</code> a@b.test', '<code>[a@b.test]()</code>', 'para\n# []()\n\na@b.test', '- para\n  # []()\n\na@b.test', '[]()\n===\n\na@b.test'])('does not expose private empty-link scopes: %s', source => {
  const result = migrateMarkdown(source)
  expect(result.value).not.toContain('carve-md-empty-')
  expect(carveToHtml(result.value)).not.toContain('carve-md-empty-')
})
