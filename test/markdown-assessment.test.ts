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

  it('keeps exact task losses at their source lines', () => {
    const diagnostics = rows('```\ncode\n```\n\n1. [x] done\n2. [ ] next\n')
    expect(diagnostics.filter(row => row.fidelity === 'dropped').map(row => [row.code, row.path])).toEqual([
      ['structure-unspellable', 'line:5'], ['structure-unspellable', 'line:6'],
    ])
    expect(diagnostics.some(row => row.code === 'fidelity-unverified')).toBe(false)
  })

  it('fails closed for unsupported syntax and altered writer output', () => {
    for (const source of ['https://example.org', '[^note]\n\n[^note]: note', '\0', '| a |\n| --- |\n| x | extra |']) {
      expect(rows(source)).toContainEqual(expect.objectContaining({ code: 'fidelity-unverified', fidelity: 'dropped' }))
    }
    expect(assessMarkdown('**strong**', 'wrong').complete).toBe(false)
    expect(assessMarkdown('a  b', 'a b').complete).toBe(false)
  })
})
