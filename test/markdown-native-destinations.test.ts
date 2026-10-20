import { expect, it } from 'vitest'
import { parseFragment, type DefaultTreeAdapterMap } from 'parse5'
import { carveToCarve, carveToHtml, markdownToCarve, migrateMarkdown } from '../src/index.js'
import controls from './fixtures/markdown-native-destinations.json'

type HtmlNode = DefaultTreeAdapterMap['node']
const shape = (node: HtmlNode): unknown => {
  if ('value' in node) return node.value.replace(/[\t\n\r\f ]+/g, ' ')
  const children = 'childNodes' in node ? node.childNodes
    .filter(child => !(['#document-fragment', 'blockquote', 'ul', 'ol', 'table', 'thead', 'tbody', 'tr'].includes(node.nodeName) && 'value' in child && /^[\t\n\r\f ]*$/.test(child.value)))
    .map(shape) : []
  const attrs = 'attrs' in node ? node.attrs.filter(attr => !(attr.name === 'scope' && attr.value === 'col')).map(attr => {
    // Carve keeps brackets in URL paths; cmark percent-encodes those bytes.
    const value = (attr.name === 'href' || attr.name === 'src') && attr.value.startsWith('/')
      ? attr.value.replace(/%5b/gi, '[').replace(/%5d/gi, ']') : attr.value
    return [attr.name, value]
  }).sort() : []
  if (node.nodeName === 'p' && children.length === 1 && 'childNodes' in node && node.childNodes[0]!.nodeName === 'img') return children[0]
  return [node.nodeName, attrs, children]
}

it.each(controls as Array<{ source: string; html: string; carveHtml?: string; dropped?: number }>)('preserves native destination boundaries: $source', ({ source, html, carveHtml, dropped = 0 }) => {
  const written = markdownToCarve(source)
  const expected = shape(parseFragment(carveHtml ?? html))
  expect(shape(parseFragment(carveToHtml(written)))).toEqual(expected)
  expect(shape(parseFragment(carveToHtml(carveToCarve(written))))).toEqual(expected)
  expect(migrateMarkdown(source).report.diagnostics.filter(row => row.confidence === 'exact' && row.fidelity === 'dropped')).toHaveLength(dropped)
})

it.each(['[a](<a\\\nb>)\n---', '[a]( <a\\\nb>)\n---', '> [a](<a\\\n> b>)\n> ---', '- [a](<a\\\n  b>)\n  ---'])('preserves the escaped destination newline in a setext heading: %s', source => {
  const written = markdownToCarve(source)
  for (const rendered of [written, carveToCarve(written)]) {
    const html = carveToHtml(rendered)
    expect(html).toContain('<a href="a\\%0Ab">a</a>')
    expect(html).toMatch(/<h2(?: [^>]*)?><a /)
  }
  expect(migrateMarkdown(source).report.diagnostics.filter(row => row.confidence === 'exact' && row.fidelity === 'dropped')).toHaveLength(0)
})

it.each(['> [a](<a\\\n> b>)\n> ---\n> tail', '- [a](<a\\\n  b>)\n  ---\n  tail'])('keeps the paragraph after a multiline destination heading: %s', source => {
  const written = markdownToCarve(source)
  for (const rendered of [written, carveToCarve(written)]) {
    const html = carveToHtml(rendered)
    expect(html).toContain('<a href="a\\%0Ab">a</a>')
    expect(html).toContain('tail')
    expect(html.match(/<h2(?: |>)/g)).toHaveLength(1)
  }
})

it.each(['<http://x/[a>](<b\\\nc>)\n---', '[o [r] p](<a\\\nb>)\n---\n\n[r]: /u'])('keeps an inactive destination inside one heading: %s', source => {
  const written = markdownToCarve(source)
  for (const rendered of [written, carveToCarve(written)]) {
    const html = carveToHtml(rendered)
    expect(html.match(/<h2(?: |>)/g)).toHaveLength(1)
    expect(html).not.toContain('<p>')
  }
})

it('keeps spaces in a lazy quote continuation inside a heading', () => {
  const written = markdownToCarve('> [a](<a\\\n   b>)\n> ---')
  expect(carveToHtml(written)).toContain('<a href="a\\%0A%20%20%20b">a</a>')
  expect(carveToHtml(carveToCarve(written))).toContain('<a href="a\\%0A%20%20%20b">a</a>')
})

it.each(['https://example.com/', 'www.example.com/'])('keeps a bare URL inside one setext heading: %s', url => {
  const source = `${url}[a](<b\\\nc>)\n---`
  const written = markdownToCarve(source)
  for (const rendered of [written, carveToCarve(written)]) {
    const html = carveToHtml(rendered)
    expect(html.match(/<h2(?: |>)/g)).toHaveLength(1)
    expect(html).not.toContain('<p>')
  }
})

it.each(['https://example.com/', 'www.example.com/'])('keeps the paragraph after a bare URL heading: %s', url => {
  const source = `> ${url}[a](<b\\\n> c>)\n> ---\n> tail`
  const written = markdownToCarve(source)
  for (const rendered of [written, carveToCarve(written)]) {
    const html = carveToHtml(rendered)
    expect(html.match(/<h2(?: |>)/g)).toHaveLength(1)
    expect(html).toContain('<p>tail</p>')
  }
})

it('keeps lazy indentation after a soft line in a folded heading', () => {
  const written = markdownToCarve('> first\n> [a](<a\\\n   b>)\n> ---\n> tail')
  for (const rendered of [written, carveToCarve(written)]) {
    const html = carveToHtml(rendered)
    expect(html).toContain('<a href="a\\%0A%20%20%20b">a</a>')
    expect(html).toContain('<p>tail</p>')
  }
})

it('keeps malformed angle email text and its code span before a destination heading', () => {
  const written = markdownToCarve('x <a`@b.> http://x.y/`[k](<p\\\nq>)\n===')
  for (const rendered of [written, carveToCarve(written)]) {
    const html = carveToHtml(rendered)
    expect(html).toContain('x &lt;a<code>@b.&gt; http://x.y/</code><a href="p\\%0Aq">k</a>')
    expect(html.match(/<h1(?: |>)/g)).toHaveLength(1)
    expect(html).not.toContain('<p>')
  }
})

it('keeps lazy indentation in a later list paragraph heading', () => {
  const written = markdownToCarve('- x\n\n  [a](<a\\\n b>)\n  ---')
  for (const rendered of [written, carveToCarve(written)]) {
    const html = carveToHtml(rendered)
    expect(html).toContain('<a href="a\\%0A%20b">a</a>')
    expect(html).toContain('<h2')
  }
})
