import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { carveToHtml, parse, renderCarve, markdownToCarve, migrateCaseOnlyReferences } from '../src/index.js'

const cases = JSON.parse(readFileSync(new URL('./fixtures/image-alt-escapes.json', import.meta.url), 'utf8')) as { name: string; source: string; html: string; table: string }[]

const footnotes = JSON.parse(readFileSync(new URL('./fixtures/markdown-table-footnotes.json', import.meta.url), 'utf8')) as { name: string; md: string; refs: number; html: string }[]
for (const c of footnotes) {
  it(`imports ${c.name} without changing footnote identity`, () => {
    const html = carveToHtml(markdownToCarve(c.md))
    expect(html.match(/role="doc-noteref"/g) ?? []).toHaveLength(c.refs)
    expect(html).toContain(c.html)
  })
}

it('leaves an unresolved reference pair literal in an image description', () => {
  expect(carveToHtml(markdownToCarve('![s [a][b]][r]\n\n[a]: /a\n[r]: /r\n'))).toContain('alt="s [a][b]"')
})

it('keeps authored footnote text in an image scalar', () => {
  const html = carveToHtml(markdownToCarve('![x [^a|b]][i]\n\n[i]: /i\n[^a|b]: Note.\n'))
  expect(html).toContain('alt="x [^a|b]"')
  expect(html).not.toContain('alt="x [^carve-import-footnote-')
})

for (const tag of ['x-y', 'div']) {
  it(`keeps footnote-looking content opaque inside ${tag} blocks`, () => {
    const md = `<${tag}>\n[^a|b]: Note.\n[^empty]:\n\nRef[^a|b]\n`
    const written = markdownToCarve(md)
    expect(written).not.toContain('FNEMPTY')
    expect(written).not.toContain('carve-import-footnote-')
    const html = carveToHtml(written)
    expect(html).toContain('[^empty]:')
    expect(html).not.toContain('role="doc-noteref"')
    expect(html).toContain('Ref[^a|b]')
  })
}

it('ends a table at a footnote definition', () => {
  const html = carveToHtml(markdownToCarve('| [^a\\|b] |\n|---|\n| b |\n[^a|b]:\n'))
  expect(html).toContain('role="doc-noteref"')
  expect(html).not.toContain('{empty}')
  expect(html.match(/<td\b/g)).toHaveLength(1)
})

it('keeps a reference definition inside a footnote continuation', () => {
  const html = carveToHtml(markdownToCarve('See [r] and[^a].\n\n[^a]: Two words\n[r]: /u\n'))
  expect(html).not.toContain('href="/u"')
  expect(html).toContain('[r]: /u')
})

it('flattens resolved reference chains inside image descriptions', () => {
  const written = markdownToCarve('![s [a][b][c]][r]\n\n[b]: /b\n[r]: /image\n')
  expect(carveToHtml(written)).toContain('alt="s a[c]"')
})

it('renames table footnotes consistently without label collisions or code edits', () => {
  const md = '| Note[^a\\|b] | c |\n|---|---|\n\nText[^a|b].\n\n`[^a|b]`\n\n[^a|b]: Note.\n\n[^carve-import-footnote-1]: Existing.\n'
  const written = markdownToCarve(md)
  expect(written.match(/\[\^carve-import-footnote-2\]/g)).toHaveLength(3)
  expect(written).toContain('`[^a|b]`')
  expect(written).toContain('[^carve-import-footnote-1]: Existing.')
  const html = carveToHtml(written)
  expect(html.match(/role="doc-noteref"/g)).toHaveLength(2)
  expect(html).toContain('<code>[^a|b]</code>')
  expect(html).toContain('Note.<a href="#fnref1"')
})

for (const [body, definitions, expected] of [
  ['![p\\|q]', '[c]: /c', '![p|q]'],
  ['![p\\|q][]', '[c]: /c', '![p|q][]'],
  ['![p\\|q][c]', '[c]: /c', 'alt="p|q"'],
  ['[p\\|q][missing]', '[c]: /c', '[p|q][missing]'],
  ['[t][q\\|r][s]', '[q|r]: /q', '<a href="/q">t</a>[s]'],
  ['[t][q\\|r][s]', '[q|r]: /q\n[s]: /s', '<a href="/q">t</a><a href="/s">s</a>'],
  ['[t][q\\|r][s][z]', '[s]: /s\n[z]: /z', '[t]<a href="/s">q|r</a><a href="/z">z</a>'],
  ['[a\\|b][]', '', '[a|b][]'],
  ['[a\\|b][]', '[a\\|b]: /u', '[a|b][]'],
  ['[a\\|b]', '[a\\|b]: /u', '[a|b]'],
]) {
  it(`resolves authored table labels in ${body} with ${definitions}`, () => {
    const html = carveToHtml(markdownToCarve(`| ${body} | c |\n|---|---|\n\n${definitions}\n`))
    expect(html).toContain(expected)
    expect(html.match(/<th\b/g)).toHaveLength(2)
  })
}

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

it('ends quoted HTML at a quoted blank line before footnotes', () => {
  const html = carveToHtml(markdownToCarve('| T[^a\\|b] |\n|---|\n\n> <div>\n>\n> [^a|b]: N\n'))
  expect(html).toContain('role="doc-noteref"')
  expect(html).toContain('N')
  expect(html).not.toContain('[^a|b]')
})

it('keeps a deeper quote marker inside an open HTML block', () => {
  const written = markdownToCarve('| T[^a\\|b] |\n|---|\n\n> <div>\n>>\n> [^a|b]: N\n')
  expect(carveToHtml(written)).not.toContain('role="doc-noteref"')
  expect(written).not.toContain('carve-import-footnote-')
  expect(written).toContain('[^a|b]: N')
})

it('retains unfinished footnote markers beside a valid multiline link title', () => {
  const source = '[^a'.repeat(16384) + '\n\n[t](/u "one\ntwo")\n'
  const written = markdownToCarve(source)
  expect(written).toContain('[^a'.repeat(16384))
  expect(carveToHtml(written)).toContain('title="one\ntwo"')
  expect(carveToHtml(written)).toContain('href="/u"')
})

for (const destination of ['/u', '/u "t"', '</u>', '</u> "t"']) {
  it(`keeps an unbalanced image label literal before ${destination}`, () => {
    const html = carveToHtml(markdownToCarve(`![a [[b] c](${destination})\n`))
    expect(html).not.toContain('<img')
    expect(html).toContain('![a ')
    expect(html).toContain('href="/u"')
  })
}
it('retains a long run of unfinished image labels', () => {
  const source = '![a'.repeat(16384) + '\n'
  expect(markdownToCarve(source)).toBe(source)
})
