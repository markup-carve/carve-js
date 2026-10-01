import { expect, it } from 'vitest'
import { carveToHtml, lintCarve, carveToCarvePatch, djotToCarve } from '../src/index.js'
import { tabs } from '../src/tabs.js'

it('recovers tab children, drops bare titles and diagnoses their opener lines', () => {
  const source = ':::: tabs\n::: tab Install\nBody one.\n:::\n::: tab Configure\nBody two.\n:::\n::::\n'
  const html = carveToHtml(source, { extensions: [tabs()] })
  expect(html).toContain('class="tabs-label">Tab 1</label>')
  expect(html).toContain('class="tabs-label">Tab 2</label>')
  expect(html).toContain('<p>Body one.</p>')
  expect(html).not.toContain(':::')
  expect(lintCarve(source).filter(w => w.rule === 'fence-title-syntax').map(w => w.line)).toEqual([2, 5])
})

it('recovers generic nested kinds and parses headings and lists', () => {
  const source = ':::: outer\n::: widget Bad title\n# Heading\n\n- one\n- two\n:::\n::::\nAfter.\n'
  const html = carveToHtml(source)
  expect(html).toContain('<div class="widget">')
  expect(html).toContain('<h1')
  expect(html).toContain('<ul>')
  expect(html).toMatch(/<\/div>\n<p>After\.<\/p>/)
  expect(html).not.toContain(':::')
})

it('keeps recovery out of opaque payloads and rejects glued kind prefixes', () => {
  for (const source of ['```\n::: tab Wrong\n```\n', '%%%\n::: tab Wrong\n%%%\n', ':::tab Wrong\nbody\n']) {
    expect(lintCarve(source).filter(w => w.rule === 'fence-title-syntax')).toEqual([])
  }
})

it('drops malformed quoted metadata and labels without promoting figure groups', () => {
  for (const metadata of ['Bare title', '“Curly title”', '"unclosed', '[unclosed', '"Good" [broken', '\t"Tabbed"', '{.inline}']) {
    const source = `::: figure ${metadata}\nBody.\n:::\n`
    const html = carveToHtml(source)
    expect(html).toContain('<div class="figure">')
    expect(html).toContain('<p>Body.</p>')
    expect(html).not.toContain('<figure')
    expect(lintCarve(source).filter(w => w.rule === 'fence-title-syntax')).toHaveLength(1)
  }
})


it('locates recovered metadata in the original UTF-16 source', () => {
  for (const prefix of ['', '\ufeff']) {
    const source = prefix + '😀\r\n\r\n> ::: widget Wrong😀\r\n> body\r\n> :::\r\n'
    const warnings = lintCarve(source).filter(w => w.rule === 'fence-title-syntax')
    expect(warnings).toHaveLength(1)
    expect(source.slice(warnings[0]!.start, warnings[0]!.end)).toBe('::: widget Wrong😀')
    expect(warnings[0]!.line).toBe(3)
    expect(warnings[0]!.column).toBe(3)
  }
})


it('diagnoses Unicode separators as invalid metadata rather than valid padding', () => {
  for (const ws of ['\u0085', '\ufeff']) {
    const source = `::: note${ws}"Title"\nx\n:::\n`
    expect(carveToHtml(source)).toContain('<aside')
    expect(carveToHtml(source)).not.toContain('admonition-title')
    expect(lintCarve(source).filter(w => w.rule === 'fence-title-syntax')).toHaveLength(1)
  }
})

it('requires review before formatting drops metadata', () => {
  const patch = carveToCarvePatch('::: note Wrong\nbody\n:::\n')
  expect(patch.edits).toEqual([])
  expect(patch.unresolved[0]?.code).toBe('invalid-container-metadata')
})

it('preserves rejected Djot opener text during migration', () => {
  const html = carveToHtml(djotToCarve('::: tip Custom Title\nbody\n:::\n'))
  expect(html).toBe('<p>::: tip Custom Title\nbody\n:::</p>')
})

it('does not block a formatting patch for a prose opener', () => {
  const patch = carveToCarvePatch('  ::: widget Bad\nx\n:::\n')
  expect(patch.edits.length).toBeGreaterThan(0)
  expect(patch.unresolved).toEqual([])
})

it('migrates authored malformed metadata rather than its masked tokens', () => {
  for (const metadata of ['"T" extra', '“T”', '{.x}']) {
    const source = `::: tip ${metadata}\nbody\n:::\n`
    const migrated = djotToCarve(source)
    expect(migrated).toContain('\\::: tip')
    expect(carveToHtml(migrated)).not.toContain('<aside')
    expect(carveToHtml(migrated)).not.toContain('<div')
    expect(carveToHtml(migrated)).toBe(`<p>::: tip${metadata === '{.x}' ? '' : ' ' + (metadata === '"T" extra' ? '“T” extra' : metadata)}\nbody\n:::</p>`)
  }
  const source = '::: tip Bad X\n\n::: note\nx\n:::\n:::\n'
  expect(carveToHtml(djotToCarve(source))).toBe('<p>::: tip Bad X</p>\n<aside class="admonition note" aria-label="Note">\n  <p>x</p>\n</aside>\n<p>:::</p>')
})

it('diagnoses metadata on a footnote marker line and blocks its format patch', () => {
  const source = 'a[^1]\n\n[^1]: ::: tip Bad X\n    body\n    :::\n'
  const warnings = lintCarve(source).filter(w => w.rule === 'fence-title-syntax')
  expect(warnings).toHaveLength(1)
  expect(warnings[0]!.line).toBe(3)
  expect(source.slice(warnings[0]!.start, warnings[0]!.end)).toBe('::: tip Bad X')
  expect(carveToCarvePatch(source).unresolved[0]?.code).toBe('invalid-container-metadata')
})

it('counts line and hard-break fences inside rejected migrated containers', () => {
  for (const opener of ['::: |', '::: \\']) {
    const source = `::: tip Bad X
${opener}
l
:::
out
:::
`
    const migrated = djotToCarve(source)
    expect(migrated).toBe(`\\::: tip Bad X
${opener}
l
:::
out
\\:::
`)
  }
})

it('preserves literal fence text after list and footnote markers during migration', () => {
  for (const [prefix, bodyIndent, migratedPrefix] of [
    ['- ', '  ', '- '], ['1. ', '   ', '1. '], ['+ ', '  ', '- '], ['(1) ', '    ', '1. '],
    ['- [x] ', '  ', '- [x] '], ['[^1]: ', '    ', '[^1]: '],
  ]) {
    const before = prefix === '[^1]: ' ? 'a[^1]\n\n' : ''
    const source = `${before}${prefix}::: tip Bad X\n${bodyIndent}body\n${bodyIndent}:::\n`
    const expected = `${before}${migratedPrefix}\\::: tip Bad X\n${bodyIndent}body\n${bodyIndent}\\:::\n`
    expect(carveToHtml(djotToCarve(source))).toBe(carveToHtml(expected))
    expect(carveToHtml(djotToCarve(source))).not.toContain('<aside')
  }
})
