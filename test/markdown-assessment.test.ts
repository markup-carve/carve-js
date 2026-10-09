import { describe, expect, it } from 'vitest'
import { migrateMarkdown } from '../src/index.js'
import { assessMarkdown } from '../src/markdown-assessment.js'

const rows = (source: string) => migrateMarkdown(source).report.diagnostics

describe('Markdown construct assessment', () => {
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
    expect(diagnostics).toContainEqual(expect.objectContaining({ code: 'fidelity-unverified' }))
    expect(diagnostics.filter(row => row.code === 'structure-unspellable').map(row => row.path)).toEqual(['line:5'])
  })

  it('fails closed for opt-in dialects and bounded scanner inputs', () => {
    expect(migrateMarkdown('hello', { dialect: { highlight: true } }).report.diagnostics[0]?.code).toBe('fidelity-unverified')
    expect(assessMarkdown('x ' + '<!--'.repeat(240000), 'wrong').complete).toBe(false)
    expect(assessMarkdown(('**' + 'é'.repeat(100) + '**\n\n').repeat(5000), 'wrong').diagnostics).toEqual([])
  })

  it('fails closed for unsupported syntax and altered writer output', () => {
    for (const source of ['https://example.org', '[^note]\n\n[^note]: note', '\0', '| a |\n| --- |\n| x | extra |']) {
      expect(rows(source)).toContainEqual(expect.objectContaining({ code: 'fidelity-unverified', fidelity: 'dropped' }))
    }
    expect(assessMarkdown('**strong**', 'wrong').complete).toBe(false)
    expect(assessMarkdown('a  b', 'a b').complete).toBe(false)
  })
})
