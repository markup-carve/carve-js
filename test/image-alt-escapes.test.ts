import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { carveToHtml, parse, renderCarve, markdownToCarve, migrateCaseOnlyReferences } from '../src/index.js'

const cases = JSON.parse(readFileSync(new URL('./fixtures/image-alt-escapes.json', import.meta.url), 'utf8')) as { name: string; source: string; html: string; table: string }[]

describe('image alt escapes', () => {
  for (const c of cases) {
    it(c.name, () => {
      expect(carveToHtml(c.source).trim().replaceAll('&#39;', '&#039;').replaceAll('&apos;', '&#039;')).toBe(c.html)
      const image = c.html.replace(/^<p>x | y<\/p>$/g, '')
      expect(carveToHtml(c.table).replaceAll('&apos;', '&#039;').replaceAll('&#39;', '&#039;')).toContain(image)
      const tableWritten = renderCarve(parse(c.table))
      expect(carveToHtml(tableWritten).replaceAll('&apos;', '&#039;').replaceAll('&#39;', '&#039;')).toContain(image)
      const written = renderCarve(parse(c.source))
      expect(carveToHtml(written).trim().replaceAll('&#39;', '&#039;').replaceAll('&apos;', '&#039;')).toBe(c.html)
      expect(renderCarve(parse(written))).toBe(written)
    })
  }
  it('keeps a native image in tables with raw HTML disabled', () => {
    const source = '| ![a\\|b](/i) |\n|---|\n| c |\n'
    expect(carveToHtml(source, { allowRawHtml: false })).toContain('<img src="/i" alt="a|b">')
  })
  it('leaves unresolved reference source literal', () => {
    expect(carveToHtml('x ![a\\|b][missing] y')).toContain('![a\\|b][missing]')
  })
})

const gfm = JSON.parse(readFileSync(new URL('./fixtures/markdown-table-image-alt-gfm.json', import.meta.url), 'utf8')) as { md: string; html: string }[]
for (const [index, c] of gfm.entries()) {
  it(`GFM image table ${index}`, () => {
    const normalize = (html: string) => html.replace(/\s+scope="(?:col|row)"/g, '').replaceAll('&quot;', '"').replaceAll(' />', '>').replaceAll('\n', '').trim().replace(/>\s+</g, '><')
    expect(normalize(carveToHtml(markdownToCarve(c.md)))).toBe(normalize(c.html))
  })
}
it('migrates a reference with escaped alt text', () => {
  expect(migrateCaseOnlyReferences('x ![a\\|b][R] y\n\n[r]: /i\n')).toBe('x ![a\\|b][r] y\n\n[r]: /i\n')
})
it('uses the balanced alt boundary during migration', () => {
  const source = 'x ![a\\|b `][]`][R]{title="] [R]"} y\n\n[r]: /i\n'
  expect(migrateCaseOnlyReferences(source)).toBe(source.replace('`][R]', '`][r]'))
})
it('keeps a pipe-bearing reference outside tables', () => {
  const source = '[t][a|b] x\n\n[a|b]: /u "T"\n'
  expect(markdownToCarve(source)).toContain('[t][a|b] x')
})
it('keeps a pipe-bearing URL autolink in one table cell', () => {
  const source = '| <https://x/a\\|b> | c |\n|---|---|\n'
  const html = carveToHtml(markdownToCarve(source))
  expect(html).toContain('<a href="https://x/a%7Cb">https://x/a|b</a>')
  expect(html.match(/<th\b/g)).toHaveLength(2)
})
it('keeps a pipe-bearing email autolink in one table cell', () => {
  const source = '| <a\\|b@x.y> | c |\n|---|---|\n'
  const html = carveToHtml(markdownToCarve(source))
  expect(html).toContain('<a href="mailto:a%7Cb@x.y">a|b@x.y</a>')
  expect(html.match(/<th\b/g)).toHaveLength(2)
})
it('keeps an escaped backtick beside a code cell', () => {
  const source = '| ![a\\`b](/i "c\\`d\\|e") | `x` |\n|---|---|\n'
  const expected = carveToHtml(source)
  expect(expected).toContain('alt="a`b" title="c`d|e"')
  expect(expected).toContain('<code>x</code>')
  expect(carveToHtml(renderCarve(parse(source)))).toBe(expected)
})

for (const [label, body] of [['link', '[t]'], ['image', '![t]']]) {
  it(`keeps an unresolved ${label} pipe reference in one cell`, () => {
    const html = carveToHtml(markdownToCarve(`| ${body}[q\\|r] | c |\n|---|---|\n`))
    expect(html).toContain(`${body}[q|r]`)
    expect(html.match(/<th\b/g)).toHaveLength(2)
  })
}
it('keeps an unmatched escaped definition label in one cell', () => {
  const html = carveToHtml(markdownToCarve('| [t][a\\|b] | c |\n|---|---|\n\n[a\\|b]: /u\n'))
  expect(html).toContain('[t][a|b]')
  expect(html.match(/<th\b/g)).toHaveLength(2)
})
for (const prefix of ['', '!']) {
  it(`keeps the resolved tail of a ${prefix || 'link'} reference chain`, () => {
    const html = carveToHtml(markdownToCarve(`| ${prefix}[t][q\\|r][s] | c |\n|---|---|\n\n[s]: /s\n`))
    expect(html).toContain(`${prefix}[t]<a href="/s">q|r</a>`)
    expect(html.match(/<th\b/g)).toHaveLength(2)
  })
}
it('keeps an unresolved image alt pipe literal during import', () => {
  const html = carveToHtml(markdownToCarve('| ![a\\|b][missing] | c |\n|---|---|\n'))
  expect(html).toContain('![a|b][missing]')
  expect(html.match(/<th\b/g)).toHaveLength(2)
})
