import { expect, it } from 'vitest'
import { djotToCarve, carveToHtml, migrateDjot } from '../src/index.js'
import { djotReferenceLayout } from '../src/djot-reference-layout.js'
import { parse, renderHTML } from '@djot/djot'

it.each(['title', 'class', 'data-long'])('keeps a long inherited %s shared', (attribute) => {
  const value = 'v'.repeat(32768)
  const source = `{${attribute}="${value}"}\n[r]: /u\n\n` + '[x][r] '.repeat(1024)
  const result = djotToCarve(source)
  expect(result.length).toBeLessThan(source.length * 2)
  expect(result.split(value).length - 1).toBe(1)
})

it('shares inherited attributes when individual references override their classes', () => {
  const value = 'v'.repeat(32768)
  const source = `{.base title="${value}"}\n[r]: /u\n\n[x][r] ` + '[x][r]{.own} '.repeat(1024)
  const result = djotToCarve(source)
  expect(result.length).toBeLessThan(source.length * 3)
  expect(result.split(value).length - 1).toBeLessThanOrEqual(2)
  const small = '{.base title="a|b"}\n[r]: /u\n\n| [x][r] | [x][r]{.own} |\n'
  const normalize = (html: string): string => html.replace(/<\/?tbody>/g, '').replace(/>\s+</g, '><').trim()
  expect(normalize(carveToHtml(djotToCarve(small)))).toBe(normalize(renderHTML(parse(small))))
})

it.each([
  ['[a [b]][r]\n\n{.c}\n[r]: /u', '[a [b]](/u){.c}\n'],
  ['\\[a][r] [b][r]\n\n{.c}\n[r]: /u', '\\[a][r] [b](/u){.c}\n'],
  ['[a `[` b][r]\n\n{.c}\n[r]: /u', '[a `[` b](/u){.c}\n'],
  ['[a][r\\]x] [b][r]\n\n{.c}\n[r]: /u', '[a][r\\]x] [b](/u){.c}\n'],
  ['[_link_][]\n\n[link]: /u', '[_link_](/u)\n'],
])('preserves reference label boundaries: %s', (source, expected) => {
  expect(carveToHtml(djotReferenceLayout(source, () => 0))).toBe(carveToHtml(expected))
})

it('resolves a formatted reference after many unfinished labels', () => {
  const prefix = '[a '.repeat(8192)
  expect(djotReferenceLayout(prefix + '[_link_][]\n\n[link]: /u', () => 0))
    .toBe(prefix + '[_link_][link]\n\n[link]: /u')
})

it.each([
  ['[a\n b][r]\n\n[r]: /u', '[a b][r]\n\n[r]: /u'],
  ['[a][r\nname]\n\n[r name]: /u', '[a][r name]\n\n[r name]: /u'],
  ['[b][^unknown\nlabel][c\nd]\n\n[c d]: /u', '[b][^unknown\nlabel][c\nd]\n\n[c d]: /u'],
])('preserves multiline reference matching: %s', (source, expected) => {
  expect(djotReferenceLayout(source, () => 0)).toBe(expected)
})

it('preserves a long unmatched multiline label', () => {
  const source = '[a][b\n' + 'prose line\n'.repeat(8192)
  expect(djotReferenceLayout(source, () => 0)).toBe(source)
})

it('keeps whitespace inside a multiline label', () => {
  const spaces = ' '.repeat(32768)
  const source = `[a${spaces}b\nc][r]\n\n[r]: /u`
  expect(djotReferenceLayout(source, () => 0)).toBe(`[a${spaces}b c][r]\n\n[r]: /u`)
})

it('merges definition attributes in source order', () => {
  const source = '[a][r]\n\n{x=first}\n{y=middle x=last}\n[r]: /u'
  expect(carveToHtml(djotReferenceLayout(source, () => 0))).toBe(carveToHtml('[a](/u){x=last y=middle}\n'))
})

it('uses a short override instead of a long definition attribute', () => {
  const uses = '[a][r]{title=short} '.repeat(1024)
  const source = `${uses}\n\n{title="${'a'.repeat(32768)}"}\n[r]: /u`
  const result = djotReferenceLayout(source, () => 0)
  expect(carveToHtml(result)).toBe(carveToHtml('[a](/u){title=short} '.repeat(1024) + '\n'))
  expect(result).not.toContain('a'.repeat(32768))
})

for (const label of ['a^b', 'a^^b', 'a ^b', 'a^ b']) {
  it(`keeps definition attributes on references with ${label}`, () => {
    const source = `{.target}\n[${label}]: /x\n\n[link][${label}]\n`
    expect(carveToHtml(djotReferenceLayout(source, () => 0))).toBe('<p><a href="/x" class="target">link</a></p>')
    expect(carveToHtml(djotToCarve(source))).toBe('<p><a href="/x" class="target">link</a></p>')
    expect(migrateDjot(source).report.diagnostics.filter(row => row.message.includes('unresolved Djot reference'))).toEqual([])
  })
}

it('keeps footnote definitions outside reference attribute handling', () => {
  const source = '{.target}\n[^a^b]: note\n\nr[^a^b]\n'
  expect(djotReferenceLayout(source, () => 0)).toBe(source)
})

for (const marker of ['*', '^']) {
  it(`keeps literal backslashes in ${marker} definition names`, () => {
    const name = `a\\${marker}b`
    const use = `a\\\\${marker}b`
    const source = `{.t}\n[${name}]: /x\n\n[link][${use}]\n`
    const result = migrateDjot(source)
    expect(carveToHtml(result.value)).toBe('<p><a href="/x" class="t">link</a></p>')
    expect(result.report.diagnostics.filter(row => row.message.includes('unresolved Djot reference'))).toEqual([])
  })

  it(`reports a mismatching ${marker} reference as unresolved`, () => {
    const name = `a\\${marker}b`
    const source = `{.t}\n[${name}]: /x\n\n[link][${name}]\n`
    expect(migrateDjot(source).report.diagnostics.filter(row => row.message.includes('unresolved Djot reference'))).toHaveLength(1)
  })
}

it.each(['escaped', 'styled', 'attributes'])('keeps long destinations shared for %s references', (shape) => {
  const target = '/' + 'x'.repeat(32768)
  const source = shape === 'escaped' ? `[a\\*b]: ${target}\n\n` + '[link][a\\\\*b] '.repeat(1024)
    : (shape === 'attributes' ? '{.target}\n' : '') + `[link]: ${target}\n\n` + '[_link_][] '.repeat(1024)
  const result = migrateDjot(source)
  expect(result.value.split(target)).toHaveLength(2)
  expect(result.value.length).toBeLessThan(source.length * 2)
  expect(result.report.diagnostics.filter(row => row.message.includes('unresolved Djot reference'))).toEqual([])
})

it('keeps nonbreaking label whitespace distinct from definition whitespace', () => {
  for (const label of ['a b', 'a\u00a0b']) {
    const result = migrateDjot(`[${label}]: /x\n\n[a\\ b][]\n`)
    expect(carveToHtml(result.value)).not.toContain('href="/x"')
    expect(result.report.diagnostics.filter(row => row.message.includes('unresolved Djot reference'))).toHaveLength(1)
  }
})

it('keeps pipes in nested attributes as table cell boundaries', () => {
  const source = '{.c}\n[x]: /u\n\n| h |\n|---|\n| [a{k="a|b"}][x] |\n'
  const normalized = djotReferenceLayout(source, () => 0)
  expect(normalized).toContain('[a{k="a|b"}][x]')
  expect(normalized).not.toContain('[x]{.c}')
})

it('keeps a sibling item attribute off its reference definition', () => {
  const source = '- {.t}\n- [a]: /x\n\n[l][a]\n'
  const normalized = djotReferenceLayout(source, line => /^- /.test(line) ? 2 : 0)
  expect(normalized).toBe(source)
})

it('keeps a malformed label from hiding later reference overrides', () => {
  const source = 'm[i][j\nthen [x][r] and [y][r]{title=own}\n\n{title=base}\n[r]: /u\n'
  const normalized = djotReferenceLayout(source, () => 0)
  expect(normalized).toContain('[r]: /u {title=base}')
  expect(normalized).toContain('[y][r]{title=own}')
})

it('preserves interior blank lines while trimming removed attribute lines', () => {
  const blanks = '\n'.repeat(32768)
  const source = '{title=base}\n[r]: /u\n\n```\n' + blanks + 'x\n```\n\n[x][r]\n\n'
  const result = djotReferenceLayout(source, () => 0)
  expect(result).toContain('```\n' + blanks + 'x\n```')
  expect(result.endsWith('[x][r]\n')).toBe(true)
})

it.each([
  ['[a[b]: /u\n\n[`a[b`][]', '<p><a href="/u"><code>a[b</code></a></p>'],
  ['[a[b]: /u\n\n[x][a\\[b]', '<p><a href="/u">x</a></p>'],
])('resolves opening brackets in definition labels: %s', (source, expected) => {
  const result = migrateDjot(source)
  expect(carveToHtml(result.value).trim()).toBe(expected)
  expect(result.report.diagnostics.filter(row => row.message.includes('unresolved Djot reference'))).toEqual([])
})

it.each([
  '[a[b]: /u\n\n| [x][a\\[b] |',
  '[a[b]: /u\n\n> [x][a\\[b]',
  '[a[b]: /u\n\n- [x][a\\[b]',
  '{title=base}\n[a[b]: /u\n\n[x][a\\[b]',
  '[carve-djot-reference-1]: /other\n[a[b]: /u\n\n[x][a\\[b] [y][carve-djot-reference-1]',
  '[a[b]: /old\n[a[b]: /u\n\n[x][a\\[b]',
  '[a[b]: /u\n[b]: /v\n\n[a\\[b][]',
  '[a[b|c]: /u\n\n| [x][a\\[b\\|c] |',
])('keeps opening-bracket references in their source contexts: %s', (source) => {
  const links = (html: string) => [...html.matchAll(/<a\b[^>]*>.*?<\/a>/gs)].map(match => match[0])
  expect(links(carveToHtml(djotToCarve(source)))).toEqual(links(renderHTML(parse(source))))
})

it.each([
  ['{.a .md:flex}\n[r]: /u\n\n[x][r]', 'a md:flex'],
  ['{.a\n  .md:flex}\n[r]: /u\n\n[x][r]', 'a md:flex'],
  ['[r]: /u\n\n[x][r]{.a .md:flex}', 'a md:flex'],
  ['{.a class=b .md:flex}\n[r]: /u\n\n[x][r]', 'b md:flex'],
])('keeps shorthand class append semantics on references: %s', (source, classes) => {
  const expected = `<p><a href="/u" class="${classes}">x</a></p>`
  expect(renderHTML(parse(source)).trim()).toBe(expected)
  expect(carveToHtml(djotToCarve(source)).trim()).toBe(expected)
})
