import { describe, expect, it } from 'vitest'
import { migrateMarkdown } from '../src/index.js'
import { assessMarkdown } from '../src/markdown-assessment.js'

const rows = (source: string) => migrateMarkdown(source).report.diagnostics

describe('Markdown construct assessment', () => {
  it.each([
    ['a | b', 'a | b', ['markdown-paragraph'], ['line:1'], ['preserved']],
    ['[c](/a|b)', '[c](/a|b)', ['markdown-paragraph', 'markdown-link'], ['line:1', 'line:1'], ['preserved', 'preserved']],
    ['a [b <https://e.com/]> c', 'a [b <https://e.com/]> c', ['markdown-paragraph', 'markdown-autolink'], ['line:1', 'line:1'], ['preserved', 'normalized']],
    ['| h |\n| --- |\n| [a](/x\\|y) z |', '|= h |\n| [a](/x%7Cy) z |', ['markdown-table', 'markdown-table-row', 'markdown-table-cell', 'markdown-table-row', 'markdown-table-cell', 'markdown-link'], ['line:1', 'line:1', 'line:1', 'line:3', 'line:3', 'line:3'], ['preserved', 'preserved', 'preserved', 'preserved', 'preserved', 'preserved']],
  ])('assesses unambiguous pipes and brackets: %s', (source, value, codes, paths, fidelities) => {
    const result = migrateMarkdown(source)
    expect(result.value).toBe(value)
    expect(result.report.diagnostics.map(row => row.code)).toEqual(codes)
    expect(result.report.diagnostics.map(row => row.path)).toEqual(paths)
    expect(result.report.diagnostics.map(row => [row.severity, row.fidelity, row.confidence])).toEqual(
      fidelities.map(fidelity => ['info', fidelity, 'exact']),
    )
  })

  it('assesses ordinary construct families at their original lines', () => {
    for (const [source, code, fidelity] of [
      ['# heading', 'markdown-atx-heading', 'preserved'],
      ['heading\n=======', 'markdown-setext-heading', 'normalized'],
      ['**strong** and *emphasis*', 'markdown-strong', 'preserved'],
      ['~~gone~~', 'markdown-strikethrough', 'preserved'],
      ['    code', 'markdown-indented-code', 'normalized'],
      ['[label](https://example.org)', 'markdown-link', 'preserved'],
      ['<https://example.org>', 'markdown-autolink', 'normalized'],
      ['x &amp; y', 'markdown-entity', 'normalized'],
      ['x\\!', 'markdown-escape', 'normalized'],
      ['a  \nb', 'markdown-hard-break', 'normalized'],
      ['- [x] done\n', 'markdown-bullet-task', 'preserved'],
      ['| A | B |\n| --- | --- |\n| x | y |', 'markdown-table', 'preserved'],
    ]) {
      const diagnostics = rows(source!)
      expect(diagnostics).toContainEqual(expect.objectContaining({ code, fidelity, confidence: 'exact', path: 'line:1' }))
      expect(diagnostics.some(row => row.code === 'fidelity-unverified')).toBe(false)
    }
  })

  it('assesses encoded destinations in links, references, and fragments', () => {
    const explicit = migrateMarkdown('See [a](/ü).')
    expect(explicit.report.diagnostics.map(row => [row.code, row.path, row.fidelity])).toEqual([
      ['markdown-paragraph', 'line:1', 'preserved'],
      ['markdown-link', 'line:1', 'preserved'],
    ])
    expect(explicit.value).toBe('See [a](/ü).')
    expect(migrateMarkdown('See [a](/ü).\n').value).toBe('See [a](/ü).\n')

    const reference = rows('See [a][r].\n\n[r]: /ü\n')
    expect(reference).toContainEqual(expect.objectContaining({ code: 'markdown-reference-link' }))
    expect(reference.some(row => row.code === 'fidelity-unverified')).toBe(false)

    const fragment = rows('# Über Uns\n\nSee [a](#über-uns).\n')
    expect(fragment).toContainEqual(expect.objectContaining({ code: 'markdown-atx-heading', path: 'line:1' }))
    expect(fragment).toContainEqual(expect.objectContaining({ code: 'markdown-paragraph', path: 'line:3' }))
    expect(fragment).toContainEqual(expect.objectContaining({ code: 'markdown-link', path: 'line:3' }))
    expect(fragment).toContainEqual(expect.objectContaining({ code: 'link-fragment-case-rewritten' }))
    expect(fragment.some(row => row.code === 'fidelity-unverified')).toBe(false)
  })

  it('assesses a lone image as a block image', () => {
    const result = migrateMarkdown('![x](/ü.png)\n')
    expect(result.value).toBe('![x](/ü.png)\n')
    expect(result.report.diagnostics.map(row => [row.code, row.path])).toEqual([
      ['markdown-paragraph', 'line:1'], ['markdown-image', 'line:1'],
    ])
    for (const source of ['![x](/u.png "T")', '![x][r]\n\n[r]: /u.png']) {
      expect(rows(source).some(row => row.code === 'fidelity-unverified'), source).toBe(false)
    }
  })

  it('keeps images with other paragraph content inside a paragraph', () => {
    for (const source of ['![x](/u.png)\n![y](/v.png)', 'a ![x](/u.png)']) {
      expect(rows(source).some(row => row.code === 'fidelity-unverified'), source).toBe(false)
    }
  })

  it('keeps destination brackets in explicit links and images', () => {
    const source = '[a](/x[y]) and ![b](/p[q].png)'
    const result = migrateMarkdown(source)
    expect(result.value).toBe(source)
    expect(result.report.diagnostics.map(row => [row.code, row.path])).toEqual([
      ['markdown-paragraph', 'line:1'], ['markdown-link', 'line:1'], ['markdown-image', 'line:1'],
    ])
    expect(rows('[a][r]\n\n[r]: /x[y]').some(row => row.code === 'fidelity-unverified')).toBe(false)
    expect(rows('![a][r]\n\n[r]: /x[y].png').some(row => row.code === 'fidelity-unverified')).toBe(false)
  })

  it('assesses a bare URL containing brackets against its rendered href', () => {
    expect(rows('see https://e.com/a[b]c').some(row => row.code === 'fidelity-unverified')).toBe(false)
  })

  it('does not classify markers in fenced code as tasks or emphasis', () => {
    const diagnostics = rows('```\r\n1. [x] **code**\r\n```\r\n\r\n**text**')
    expect(diagnostics.map(row => [row.code, row.path])).toEqual([
      ['markdown-fenced-code', 'line:1'], ['markdown-paragraph', 'line:5'], ['markdown-strong', 'line:5'],
    ])
  })

  it('advances source locations across multiline code spans', () => {
    const diagnostics = rows('`a\nb` **text**')
    expect(diagnostics).toContainEqual(expect.objectContaining({ code: 'markdown-code-span', path: 'line:1' }))
    expect(diagnostics).toContainEqual(expect.objectContaining({ code: 'markdown-strong', path: 'line:2' }))
  })

  it('keeps exact task losses at their source lines', () => {
    const diagnostics = rows('```\ncode\n```\n\n1. [x] done\n2. [ ] next\n')
    expect(diagnostics.filter(row => row.fidelity === 'dropped').map(row => [row.code, row.path])).toEqual([
      ['structure-unspellable', 'line:5'], ['structure-unspellable', 'line:6'],
    ])
    expect(diagnostics.some(row => row.code === 'fidelity-unverified')).toBe(false)
  })

  it('does not report quoted ordered markers as dropped checkboxes', () => {
    expect(rows('> 1. [x] done').filter(row => row.code === 'structure-unspellable')).toEqual([])
    const losses = rows('https://example.org\n\n1. [x] done').filter(row => row.code === 'structure-unspellable')
    expect(losses).toEqual([expect.objectContaining({ path: 'line:3' })])
  })

  it('retains the task reach regressions and locates a loss after indented code', () => {
    for (const source of ['- [x] done\n', '> 1. [x] done\n', '```\n1. [x] done\n```\n', 'para\n2. [x] done\n', '- 1. [x] b\n', '- a\n\n      1. [x] code\n', '1. [x]\n', '1.     [x] code\n', '- a\n\n  > 1. [x] b\n']) {
      expect(rows(source).filter(row => row.code === 'structure-unspellable'), source).toEqual([])
    }
    for (const source of ['- a\n  1. [x] b\n', 'para\n1. [x] done\n', '1. [x] \n', '1. [x]\t\n']) {
      expect(rows(source).filter(row => row.code === 'structure-unspellable'), source).toHaveLength(1)
    }
    const losses = rows('1.     [x] code\n\n1. [x] real\n').filter(row => row.code === 'structure-unspellable')
    expect(losses).toEqual([expect.objectContaining({ path: 'line:3' })])
  })

  it('locates native task losses when the assessor reads a different list structure', () => {
    for (const [source, paths] of [
      ['a\n2. [x] b\n\n1. [x] c', ['line:4']],
      ['- a\n    1. [x] b\n\n1. [x] c', ['line:2', 'line:4']],
    ] as const) {
      expect(rows(source).filter(row => row.code === 'structure-unspellable').map(row => row.path)).toEqual(paths)
    }
  })

  it('locates a loss by its source line when the importer stripped lines before it', () => {
    // `path` counts in the source, never in the reference-definition-stripped
    // array the importer builds (markup-carve/carve#2792).
    const diagnostics = rows('[ref]: https://example.org\n\nvisit www.bare.example now\n\n1. [x] done\n')
    expect(diagnostics).toContainEqual(expect.objectContaining({ code: 'markdown-bare-autolink', path: 'line:3', confidence: 'exact' }))
    expect(diagnostics.filter(row => row.code === 'structure-unspellable').map(row => row.path)).toEqual(['line:5'])
  })

  it('fails closed for opt-in dialects and bounded scanner inputs', () => {
    expect(migrateMarkdown('hello', { dialect: { highlight: true } }).report.diagnostics[0]?.code).toBe('fidelity-unverified')
    expect(assessMarkdown('x ' + '<!--'.repeat(240000), 'wrong').complete).toBe(false)
    expect(assessMarkdown(('**' + 'é'.repeat(100) + '**\n\n').repeat(5000), 'wrong').diagnostics).toEqual([])
  })

  it('fails closed for unsupported syntax and altered writer output', () => {
    for (const source of ['<code>http://example.org</code>', '[^note]\n\n[^note]: note', '\0', '| a |\n| --- |\n| x | extra |']) {
      expect(rows(source)).toContainEqual(expect.objectContaining({ code: 'fidelity-unverified', fidelity: 'dropped' }))
    }
    expect(assessMarkdown('**strong**', 'wrong').complete).toBe(false)
    expect(assessMarkdown('a  b', 'a b').complete).toBe(false)
  })

  it('reports a body cell past the header width as dropped', () => {
    expect(rows('| h |\n| --- |\n| x | extra |').map(row => [row.code, row.fidelity, row.path])).toEqual([
      ['fidelity-unverified', 'dropped', undefined],
      ['markdown-table-extra-cells', 'dropped', 'line:3'],
    ])
    expect(rows('| h |\n| --- |\n| x | |').map(row => row.code)).toEqual(['fidelity-unverified'])
  })
})

// Native cmark-gfm autolink output contains a link for every protocol spelling here.
it.each(['ftp://example.test', 'FTP://example.test', 'Ftp://example.test', 'HTTP://example.test', 'HTTPS://example.test', 'see ftp://example.test/a', 'ftp://x'])(
  'assesses a preserved GFM protocol link: %s', source => {
    expect(migrateMarkdown(source).report.diagnostics).toContainEqual(expect.objectContaining({
      code: 'markdown-bare-autolink', fidelity: 'normalized', confidence: 'exact',
    }))
    expect(rows(source).some(row => row.fidelity === 'dropped')).toBe(false)
  },
)

it.each(['`ftp://example.test`', '```\nftp://example.test\n```'])(
  'preserves opaque code containing a GFM protocol: %s', source => {
    expect(migrateMarkdown(source).report.diagnostics.some(row => row.code === 'fidelity-unverified')).toBe(false)
  },
)

it.each(['sftp://example.test', 'tftp://example.test', 'fooftp://example.test', '[ftp://example.test](https://target.test)', '[https://example.test](https://target.test)'])(
  'preserves text without an unsupported nested GFM protocol link: %s', source => {
    expect(rows(source).some(row => row.code === 'fidelity-unverified')).toBe(false)
  },
)

it('assesses preserved emphasis inside an explicit protocol link label', () => {
  const diagnostics = rows('[*ftp://example.test*](https://target.test)')
  expect(diagnostics).not.toContainEqual(expect.objectContaining({ code: 'fidelity-unverified' }))
  expect(diagnostics).toContainEqual(expect.objectContaining({ code: 'markdown-emphasis', fidelity: 'preserved', confidence: 'exact' }))
})

it('assesses a table autolink whose destination holds an escaped pipe', () => {
  const diagnostics = rows('| <https://example.com/a\\|b> | z |\n|---|---|\n')
  expect(diagnostics.map(row => [row.code, row.fidelity])).toEqual([
    ['markdown-table', 'preserved'],
    ['markdown-table-row', 'preserved'],
    ['markdown-table-cell', 'preserved'],
    ['markdown-autolink', 'normalized'],
    ['markdown-table-cell', 'preserved'],
  ])
})
