import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  detailsExtension, lint, parse, renderWithDiagnostics, spoilerExtensions, standardTabsRenderer, tabsExtensions, wikiExtension,
} from '../src/index.ts'
import { treeFingerprint } from '../src/tree-patch.ts'
import { mermaid } from '../src/extensions/standard/fenced-render.ts'
import { codeGroup } from '../src/extensions/standard/code-group.ts'

interface Case {
  id: string
  input: string
  kind?: string
  options?: Record<string, unknown>
  expected: { html?: string, fingerprint?: string, notReported?: string[], diagnostics?: (string | { code: string })[] }
}
const cases = (JSON.parse(readFileSync(new URL('./candidate17-cases.json', import.meta.url), 'utf8')) as { cases: Case[] }).cases
const byId = (id: string): Case => cases.find((entry) => entry.id === id)!

const extensions = {
  'CC-1342': mermaid(),
  'CC-1343': codeGroup(),
  'CC-1344': { extensions: [detailsExtension] },
  'CC-1345': { extensions: spoilerExtensions },
  'CC-1346': { extensions: [wikiExtension] },
} as const

describe('candidate 17 clause outputs', () => {
  for (let number = 1302; number <= 1309; number++) {
    it(`CC-${number}: tabs keep the ruled modes and authored attributes`, () => {
      const entry = byId(`CC-${number}`)
      const renderer = (entry.options?.['renderers'] as Record<string, { standard?: { mode?: 'aria' } } | string>)?.['carve.tabs']
      const mode = typeof renderer === 'object' ? renderer.standard?.mode : undefined
      const result = renderWithDiagnostics(entry.input, { extensions: tabsExtensions,
        renderers: { 'carve.tabs': standardTabsRenderer(mode === undefined ? {} : { mode }) },
        ...(entry.options?.['mode'] === 'static' ? { mode: 'static' as const } : {}) })
      expect(result.html).toBe(entry.expected.html)
    })
  }
  for (const number of [1315, 1316, 1317, 1318, 1341]) {
    it(`CC-${number}: profile or slug output`, () => {
      const entry = byId(`CC-${number}`)
      expect(renderWithDiagnostics(entry.input, entry.options ?? {}).html).toBe(entry.expected.html)
    })
  }
  for (const [id, bundle] of Object.entries(extensions)) {
    it(`${id}: registered standard extension`, () => {
      const entry = byId(id)
      const result = renderWithDiagnostics(entry.input, { ...bundle, ...(entry.options?.['mode'] === 'static' ? { mode: 'static' as const } : {}) })
      expect(result.html).toBe(entry.expected.html)
      for (const diagnostic of entry.expected.diagnostics ?? []) {
        const code = typeof diagnostic === 'string' ? diagnostic : diagnostic.code
        expect(result.diagnostics.some((actual) => actual.code === code)).toBe(true)
        if (code === 'extension-fallback-rendered') {
          expect(result.diagnostics.find((actual) => actual.code === code)?.message)
            .toMatch(/^Rendered the fallback of the unknown extension "/)
        }
      }
      for (const code of entry.expected.notReported ?? []) {
        expect(result.diagnostics.some((actual) => actual.code === code)).toBe(false)
      }
    })
  }
  it('CC-1310 and CC-1312: lint uses headingIds', () => {
    expect(lint(byId('CC-1310').input, { headingIds: 'lower' }).some((entry) => entry.code === 'broken-fragment-link')).toBe(false)
    expect(lint(byId('CC-1312').input, { headingIds: 'off' }).some((entry) => entry.code === 'broken-fragment-link')).toBe(true)
  })
  it('CC-1338: a tree fingerprint hashes canonical JSON', () => {
    const entry = byId('CC-1338')
    expect(treeFingerprint(parse(entry.input, { positions: false }))).toBe(entry.expected.fingerprint)
  })
})
