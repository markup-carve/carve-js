import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { importDocument } from '../src/index.ts'

const entry = (JSON.parse(readFileSync(new URL('../../spec/spec/0.2/conformance/clause-cases.json', import.meta.url), 'utf8')) as {
  cases: { id: string, html: string, options: { labels: Record<string, string> }, expected: { children: unknown[], notReported: string[] } }[]
}).cases.find((item) => item.id === 'CC-1347')!

describe('candidate 17 HTML import', () => {
  it('CC-1347: a host label is recognized as a generated accessible name', () => {
    const result = importDocument(entry.html, { from: 'html', labels: entry.options.labels })
    expect(result.document.children).toEqual(entry.expected.children)
    expect(result.diagnostics.some((diagnostic) => entry.expected.notReported.includes(diagnostic.code))).toBe(false)
  })
  it('preserves a different authored accessible name', () => {
    const result = importDocument(entry.html, { from: 'html' })
    expect(result.document.children[0]).toMatchObject({ attrs: { keyValues: [['aria-label', 'Hinweis']] } })
  })
})
