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
it.each(controls)('preserves GFM bare autolinks and surrounding emphasis: $source', ({ source: markdown, html, emptyDestinationLoss }) => {
  const source = markdownToCarve(markdown)
  const migration = migrateMarkdown(markdown)
  expect(migration.value).toBe(source)
  expect(migration.report.diagnostics.length).toBeGreaterThan(0)
  if (migration.report.diagnostics.some(row => row.confidence !== 'exact')) {
    expect(migration.report.diagnostics.some(row => row.code === 'fidelity-unverified')).toBe(true)
  }
  for (const row of migration.report.diagnostics) {
    if (emptyDestinationLoss && row.code === 'structure-unspellable' && row.message.includes('empty destination')) continue
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
  '[x][a@b.test]()',
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

it.each(['[foo]()\n\nmail a@b.test\n\n[foo]: /url', '*a [b*]() c@d.test', '- [ ]()\n\na@b.test', 'x [ ]() a@b.test', 'a@b.test *[]()*', '[[]()](u) a@b.test', '<code>[a]()</code> a@b.test', '<code>[a@b.test]()</code>', 'para\n# []()\n\na@b.test', '- para\n  # []()\n\na@b.test', '[]()\n===\n\na@b.test', '~~[]()~~ a@b.test', '<mark>[]()</mark> a@b.test', '<u>[]()</u> a@b.test', '<s>[]()</s> a@b.test', '<sup>[]()</sup> a@b.test', '<sub>[]()</sub> a@b.test', '<ins>[]()</ins> a@b.test', '![x [a]() y](u) m@n.o', '[x](u "t [a]() t") c@d.e'])('does not expose private empty-link scopes: %s', source => {
  const result = migrateMarkdown(source)
  expect(result.value).not.toContain('carve-md-empty-')
  expect(carveToHtml(result.value)).not.toContain('carve-md-empty-')
})

it.each([
  ['[a [x](u) b@c.test]()', '<p>[a <a href="u">x</a> <a href="mailto:b@c.test">b@c.test</a>]()</p>'],
  ['[a [foo] b@c.test]()\n\n[foo]: /url', '<p>[a <a href="/url">foo</a> <a href="mailto:b@c.test">b@c.test</a>]()</p>'],
  ['*a [b*]() c@d.test', '<p>*a b* <a href="mailto:c@d.test">c@d.test</a></p>'],
  ['[https://a.b]() c@d.test', '<p>https://a.b <a href="mailto:c@d.test">c@d.test</a></p>'],
  ['[www.a.b]() c@d.test', '<p>www.a.b <a href="mailto:c@d.test">c@d.test</a></p>'],
  ['[<https://a.b>]() c@d.test', '<p><a href="https://a.b">https://a.b</a> <a href="mailto:c@d.test">c@d.test</a></p>'],
  ['[http://a.b/*x*]() c@d.test', '<p>http://a.b/<em>x</em> <a href="mailto:c@d.test">c@d.test</a></p>'],
  ['~~[]()~~ a@b.test', '<p><del></del> <a href="mailto:a@b.test">a@b.test</a></p>'],
  ['<mark>[]()</mark> a@b.test', '<p><mark></mark> <a href="mailto:a@b.test">a@b.test</a></p>'],
])('preserves native structure after dropping an empty destination: %s', (source, expected) => {
  const result = migrateMarkdown(source)
  expect(htmlTree(carveToHtml(result.value))).toEqual(htmlTree(expected))
  expect(htmlTree(carveToHtml(carveToCarve(result.value)))).toEqual(htmlTree(expected))
  expect(result.value).not.toContain('carve-md-empty-')
})

it.each(['$[a]() + 1$ x@y.z', '$$[a]() + 1$$ x@y.z'])('keeps opt-in math bodies opaque to empty-destination conversion: %s', source => {
  const result = migrateMarkdown(source, { dialect: { math: true } })
  expect(result.value).not.toContain('carve-md-empty-')
  const paragraph = parse(result.value).children[0]
  expect(paragraph?.type).toBe('paragraph')
  if (paragraph?.type === 'paragraph') expect(paragraph.children.find(node => node.type === 'math')).toMatchObject({ content: '[a]() + 1' })
  expect(result.report.diagnostics.some(row => row.message.includes('empty destination'))).toBe(false)
})

it('preserves an authored escaped boundary-like key as ordinary text', () => {
  const result = migrateMarkdown('carve\\-md\\-empty\\-0=label [a@b.test]() c@d.test')
  expect(carveToHtml(result.value)).toContain('carve-md-empty-0=label')
  expect(result.value).not.toContain('carve-md-empty-1')
  expect(carveToHtml(result.value)).not.toContain('mailto:a@b.test')
  expect(carveToHtml(result.value)).toContain('mailto:c@d.test')
})

it.each([
  ['<code>[a]()</code> a@b.test', 'code'],
  ['<span class="critic-comment">[a]()</span> a@b.test', 'critic_comment'],
])('keeps native scalar HTML conversion when email appears elsewhere: %s', (source, type) => {
  const result = migrateMarkdown(source)
  const paragraph = parse(result.value).children[0]
  expect(paragraph?.type).toBe('paragraph')
  if (paragraph?.type === 'paragraph') expect(paragraph.children[0]?.type).toBe(type)
  expect(result.value).not.toContain('carve-md-empty-')
  expect(result.report.diagnostics.some(row => row.code === 'raw-code-fallback')).toBe(false)
})

it('does not mistake joined authored text for a surviving private attribute', () => {
  const result = migrateMarkdown('carve-md-empty-[]()0=x a@b.test')
  expect(carveToHtml(result.value)).toContain('carve-md-empty-0=x')
  expect(carveToHtml(result.value)).toContain('mailto:a@b.test')
})

it('keeps an empty heading after consecutive empty destinations', () => {
  const result = migrateMarkdown('# []()[]()\n\na@b.test')
  expect(carveToHtml(result.value)).toContain('<h1></h1>')
  expect(carveToHtml(carveToCarve(result.value))).toContain('<h1></h1>')
})

it.each(['| a |\n|---|\n| []()[]() |\n\na@b.test', '[]()[]()\n\na@b.test', '- []()[]()\n\na@b.test'])('handles blocks emptied by consecutive destinations: %s', source => {
  const result = migrateMarkdown(source)
  expect(result.value).not.toContain('carve-md-empty-')
  expect(carveToHtml(result.value)).toContain('mailto:a@b.test')
  expect(carveToHtml(carveToCarve(result.value))).toContain('mailto:a@b.test')
})

it('keeps native code conversion across empty comments', () => {
  const result = migrateMarkdown('<code>a<!---->[b]()</code> x@y.z')
  const paragraph = parse(result.value).children[0]
  expect(paragraph?.type).toBe('paragraph')
  if (paragraph?.type === 'paragraph') expect(paragraph.children[0]).toMatchObject({ type: 'code', value: 'ab' })
  expect(result.report.diagnostics.some(row => row.code === 'raw-code-fallback')).toBe(false)
})

it.each(['a[^1][^2]', '[x][^1]', '[ref][^1]', '[2^n][^1]', '[a [b]][^1]'])('keeps footnote references after a closing bracket: %s', label => {
  const result = migrateMarkdown(`${label}\n\n[^1]: one\n\n[^2]: two`)
  const count = label.startsWith('a') ? 2 : 1
  for (const value of [result.value, carveToCarve(result.value)]) {
    expect((carveToHtml(value).match(/role="doc-noteref"/g) ?? []).length).toBe(count)
  }
})

it.each(['', '\n\n[^x]: n'])('keeps a caret empty-link label literal without aborting: %s', definition => {
  const result = migrateMarkdown(`[^x]() a@b.test${definition}`)
  expect(carveToHtml(result.value)).toContain('^x')
  expect(carveToHtml(result.value)).toContain('mailto:a@b.test')
  expect(carveToHtml(result.value)).not.toContain('doc-noteref')
  expect(carveToHtml(carveToCarve(result.value))).toBe(carveToHtml(result.value))
})

it('keeps a full reference immediately before a footnote', () => {
  const result = migrateMarkdown('[a][b][^1]\n\n[b]: /u\n\n[^1]: note')
  for (const value of [result.value, carveToCarve(result.value)]) {
    expect(carveToHtml(value)).toContain('href="/u"')
    expect(carveToHtml(value)).toContain('role="doc-noteref"')
  }
})

it.each(['[$a*b*c$]()', '[$$a*b*c$$]()'])('keeps opt-in math inside an empty label unchanged: %s', source => {
  const result = migrateMarkdown(source, { dialect: { math: true } })
  const paragraph = parse(result.value).children[0]
  expect(paragraph?.type).toBe('paragraph')
  if (paragraph?.type === 'paragraph') expect(paragraph.children[0]).toMatchObject({ type: 'math', content: 'a*b*c' })
  expect(carveToHtml(carveToCarve(result.value))).toBe(carveToHtml(result.value))
})
