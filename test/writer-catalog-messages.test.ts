import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { tabsExtensions, writeWithDiagnostics } from '../src/index.ts'

interface Case {
  id: string
  tree: Parameters<typeof writeWithDiagnostics>[0]
  options: { extensions?: string[] }
  expected: { diagnostics: { code: string; path: string }[] }
}

const cases = (JSON.parse(readFileSync(new URL('../data/conformance/clause-cases.json', import.meta.url), 'utf8')) as { cases: Case[] })
  .cases.filter((entry) => ['CC-462', 'CC-465', 'CC-466', 'CC-478', 'CC-479', 'CC-500', 'CC-665', 'CC-667'].includes(entry.id))

describe('writer losses use the pinned 0.2 diagnostic catalog', () => {
  for (const entry of cases) it(entry.id, () => {
    const options = entry.options.extensions?.includes('carve.tabs') ? { extensions: tabsExtensions } : undefined
    const diagnostics = writeWithDiagnostics(entry.tree, options).diagnostics
    for (const expected of entry.expected.diagnostics) {
      const found = diagnostics.find((item) => item.code === expected.code && item.path === expected.path)
      expect(found?.message).toMatch(/^Carve source cannot spell .+/)
    }
  })
})
