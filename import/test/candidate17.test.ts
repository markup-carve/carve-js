import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { importDocument } from '../src/index.ts'

const entry = (JSON.parse(readFileSync(new URL('../../test/candidate17-cases.json', import.meta.url), 'utf8')) as {
  cases: {
    id: string, html: string, options: { labels: Record<string, string> },
    expected: { children: unknown[], notReported: string[] }
  }[]
}).cases.find((item) => item.id === 'CC-1347')!
const titled = (JSON.parse(readFileSync(new URL('../../test/candidate17-cases.json', import.meta.url), 'utf8')) as {
  examples: { id: string, html: string, expected: { children: unknown[] } }[]
}).examples.find((item) => item.id === 'import-html-20')!

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
  it('keeps a generated default label out of a titled admonition', () => {
    expect(importDocument(titled.html, { from: 'html' }).document.children).toEqual(titled.expected.children)
  })
})
