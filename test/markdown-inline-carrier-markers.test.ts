import { expect, it } from 'vitest'
import { carveToHtml, carveToMarkdown, migrateMarkdown, parse } from '../src/index.js'

const valid = '[ok](u)<!-- carve: {.kept} -->'
const diagnostics = (source: string) => migrateMarkdown(source).report.diagnostics.filter(row => row.code === 'carrier-markers-damaged')

it.each(['[x]{abbr="Word"}', '[x]{.term abbr="Word"}'])('preserves an HTML abbreviation span across repeated roundtrips: %s', source => {
  const exported = carveToMarkdown(source, { roundtrip: true })
  expect(exported).toContain('<abbr title="Word">x</abbr>')
  const first = migrateMarkdown(exported).value
  expect(carveToHtml(first)).toBe(carveToHtml(source))
  const second = migrateMarkdown(carveToMarkdown(first, { roundtrip: true })).value
  expect(second).toBe(first)
})

it.each([
  '<!-- carve: garbage -->',
  '<!-- carve: {key="unterminated} -->',
  '<!-- carve: {.lost} -->',
  '<!-- carve: </#lost> -->',
  '<!-- carve: </#bad target> -->[bad](u)',
])('retains an invalid inline marker alone: %s', marker => {
  const source = `Text ${marker} here. ${valid}\n`
  const result = migrateMarkdown(source)
  expect(result.value).toContain(marker.split(' -->')[0] + ' -->')
  expect(result.value).toContain('[ok](u){.kept}')
  expect(diagnostics(source)).toHaveLength(1)
})

it.each([
  'Text <!-- carve: ]{.c} -->\n',
  '<!-- carve: [ -->unclosed\n\n' + valid + '\n',
  '<!-- carve: [ -->first\n\nsecond<!-- carve: ]{.c} -->\n',
])('falls back for damaged span pairing: %s', source => {
  const result = migrateMarkdown(source)
  expect(result.value).toContain('<!-- carve:')
  expect(diagnostics(source)).toEqual([expect.objectContaining({
    message: 'Carrier markers no longer record a structure; read the source as plain Markdown',
    fidelity: 'degraded', confidence: 'fallback',
  })])
})

it.each([
  '| [x]{.c} | [l](u){.k} |\n|---|---|\n',
  '`[x]{.c}`\n',
  '![[x]{.c}](i.png)\n',
])('omits inline markers in narrowed content: %s', source => {
  expect(carveToMarkdown(source, { roundtrip: true })).not.toContain('<!-- carve:')
})

it('keeps the slug of a heading holding a cross-reference', () => {
  const source = '# Rise\n\n{#see}\n# See </#Rise>\n\n</#see>\n'
  const ordinary = carveToMarkdown(source)
  const exported = carveToMarkdown(source, { roundtrip: true })
  expect(exported.replace(/<!-- carve: \{#see\} -->\n/g, '').replace(/<!-- carve: [\s\S]*? -->/g, '')).toBe(ordinary)
  expect(exported).toContain('[See Rise](#see)')
})

it('keeps ordinary export free of markers', () => {
  expect(carveToMarkdown('[x]{.c} [l](u){.k} ![a](i){w=3}\n')).not.toContain('<!-- carve:')
})

it.each(['a-->b', 'a--\\>b', 'a--\\\\>b'])('escapes an attribute payload reversibly: %s', value => {
  const source = `[l](u){data-x="${value.replace(/\\/g, '\\\\')}"}\n`
  const exported = carveToMarkdown(source, { roundtrip: true })
  const result = parse(migrateMarkdown(exported).value).children[0]
  expect(result.type === 'paragraph' && result.children[0].attrs?.keyValues?.['data-x']).toBe(value)
})

it.each(['*[x]{.c}*', '[*x*]{.c}', 'a[x]{.c}b', '[x]{.c}[y]{.d}', '[[x]{.c}](u){.k}'])('adds only markers: %s', source => {
  expect(carveToMarkdown(source, { roundtrip: true }).replace(/<!-- carve: [\s\S]*? -->/g, '')).toBe(carveToMarkdown(source))
})

it('uses the block marker escape spelling', () => {
  expect(carveToMarkdown('[l](u){data-x="a-->b"}\n', { roundtrip: true })).toBe('[l](u)<!-- carve: {data-x="a--\\>b"} -->\n')
})

it.each(['<!-- carve: garbage -->', '<!-- carve: {key="unterminated} -->', '<!-- carve: {.lost} -->', '<!-- carve: </#lost> -->'])('recovers after an invalid marker at paragraph start: %s', marker => {
  const result = migrateMarkdown(`${marker} text ${valid}\n`)
  expect(result.value).toContain(marker)
  expect(result.value).toContain('[ok](u){.kept}')
  expect(result.report.diagnostics.filter(row => row.code === 'carrier-markers-damaged')).toHaveLength(1)
})

it('does not recover inline markers when a block pairing is damaged', () => {
  const result = migrateMarkdown(`<!-- carve: ::: note -->\n\n${valid}\n`)
  expect(result.value).toContain('<!-- carve: {.kept} -->')
  expect(result.value).not.toContain('[ok](u){.kept}')
  expect(result.report.diagnostics.filter(row => row.code === 'carrier-markers-damaged')).toHaveLength(1)
})

it('leaves carrier-shaped comments in code and tables untouched on import', () => {
  const source = '`<!-- carve: [ -->`\n\n```\n<!-- carve: ]{.c} -->\n```\n\n| Cell |\n| --- |\n| <!-- carve: [ --> |\n'
  expect(diagnostics(source)).toHaveLength(0)
  expect(migrateMarkdown(source).value).toContain('<!-- carve: [ -->')
})

it.each(['[l][ref]<!-- carve: {.c} -->\n\n[ref]: u\n', '[l]<!-- carve: {.c} -->\n\n[l]: u\n', '<https://example.com><!-- carve: {.c} -->\n'])('restores attributes on other Markdown link spellings: %s', source => {
  const paragraph = parse(migrateMarkdown(source).value).children[0]
  expect(paragraph.type === 'paragraph' && paragraph.children[0].attrs?.classes).toEqual(['c'])
  expect(diagnostics(source)).toHaveLength(0)
})

it.each(['[ x ]{.c}', '[ ]{.c}', '[*x*]{.c}*y*', '*x*[y]{.c}', '[x_]{.c}_y', '\\![x]{.c}', '[x]{.c}\\[', 'a.[x]{.c}b', '[x]{.c}:y', '*[ x ]{.c}*', '# [ x ]{.c}', '[1. x]{.c}', '[---]{.c}', '[- x]{.c}', '# [x #]{.c}', '*a*[ ]{.c}*b*', '*[ x ]{.c}*'])('preserves visible bytes at inline boundaries: %s', source => {
  expect(carveToMarkdown(source, { roundtrip: true }).replace(/<!-- carve: [\s\S]*? -->/g, '')).toBe(carveToMarkdown(source))
})

it('keeps authored marker-shaped code unchanged in both modes', () => {
  const source = '`<!-- carve: [ -->` and `[x]{.c}`\n'
  expect(carveToMarkdown(source, { roundtrip: true })).toBe(carveToMarkdown(source))
})
