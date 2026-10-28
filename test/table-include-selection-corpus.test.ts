import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { expandIncludes, lintCarve, parse, renderHtml, renderMarkdown, resolve } from '../src/index.js'

interface Case {
  name: string
  attrs?: string
  lang?: string
  options: string
  file: string
  caption?: string
  html?: string[]
  absent?: string[]
  markdown?: string
  literal?: boolean
  codeFallback?: boolean
}
interface LintVector { name: string; entry: string; rule: string; severity: 'Hint'; line: number }
const corpus = JSON.parse(readFileSync(new URL('../spec/tests/include-selection/cases.json', import.meta.url), 'utf8')) as {
  cases: Case[]
  lintVectors: LintVector[]
}

describe('pinned table include selection corpus', () => {
  it.each(corpus.cases)('$name', row => {
    const lang = row.lang ?? 'csv'
    const section = row.options.startsWith('#') ? row.options.split(' ')[0]! : ''
    const options = section ? row.options.slice(section.length).trimStart() : row.options
    const directive = `{{ data.${lang}${section} @code:${lang} ${options} }}`
    const source = `${row.attrs ? `${row.attrs}\n` : ''}${directive}${row.caption ? `\n^ ${row.caption}` : ''}`
    const result = expandIncludes(parse(source, { positions: true }), source, { resolve: () => row.file })
    const doc = resolve(result.doc)
    const html = renderHtml(doc)
    if (row.literal) {
      expect(html).not.toContain('<table>')
      expect(html).toContain(directive)
      expect(result.dependencies).toEqual([{ id: `data.${lang}`, resolved: true }])
    } else if (row.codeFallback) expect(html).not.toContain('<table>')
    else expect(html).toContain('<table>')
    for (const text of row.html ?? []) expect(html).toContain(text)
    for (const text of row.absent ?? []) expect(html).not.toContain(text)
    if (row.markdown) expect(renderMarkdown(doc).trim()).toBe(row.markdown)
  })

  it.each(corpus.lintVectors)('lint: $name', vector => {
    const warnings = lintCarve(vector.entry, { includes: { resolve: () => 'Name,Price\nA,1\nB,2\n' } })
    expect(warnings).toContainEqual(expect.objectContaining({ rule: vector.rule, severity: vector.severity, line: vector.line }))
  })
})
