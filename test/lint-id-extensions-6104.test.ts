import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { type ExtensionDefinition, lint, tabsExtensions } from '../src/index.ts'
import { generateExtensionIds } from '../lint/generate-extension-ids.ts'
import { idExtensions } from '../lint/extension-ids.ts'
import { registration } from '../cli/standard-extensions.ts'

const root = join(import.meta.dirname, '..')
const read = (path: string): string => readFileSync(join(root, path), 'utf8')
const broken = (extensions: readonly ExtensionDefinition[]): number =>
  lint('[x](#missing)\n', { extensions }).filter((entry) => entry.code === 'broken-fragment-link').length
const standard = (name: string): ExtensionDefinition[] => registration([name], new Map(), false).extensions

it('lint/extension-ids.ts is what lint/generate-extension-ids.ts writes', () => {
  expect(read('lint/extension-ids.ts')).toBe(generateExtensionIds(read('data/extensions.json')))
})

describe('C2-X-079: only an extension that generates ids suppresses broken-fragment-link', () => {
  const rows = (JSON.parse(read('data/extensions.json')) as { extensions: { name: string, ids?: true }[] }).extensions
  const marked = new Set(rows.filter((row) => row.ids === true).map((row) => row.name))

  // `carve.tab` also registers `carve.tabs`, so a row counts by every definition its registration brings.
  for (const row of rows) {
    it(`${row.name} on the command line`, () => {
      const definitions = standard(row.name)
      expect(broken(definitions)).toBe(definitions.some((definition) => marked.has(definition.name)) ? 0 : 1)
    })
  }

  it('the rows marked ids are the six of the catalog', () => {
    expect([...marked].sort()).toEqual(['carve.cite', 'carve.codeGroup', 'carve.glossary', 'carve.index', 'carve.indexTerm', 'carve.tabs'])
  })

  it('a host extension outside the catalog suppresses it', () => {
    const host: ExtensionDefinition = { name: 'org.example.anchors', version: '1', props: {}, slots: {} }
    expect(broken([host])).toBe(0)
    expect(idExtensions([host])).toEqual(['org.example.anchors'])
  })

  it('a definition named below a plain catalog row belongs to that row', () => {
    expect(idExtensions([{ name: 'carve.codeCallouts.code' }, { name: 'carve.codeCallouts.list' }])).toEqual([])
  })

  it('a plain extension beside an id-generating one still suppresses it', () => {
    expect(broken([...standard('carve.wiki'), ...tabsExtensions])).toBe(0)
  })

  it('no extension keeps the finding', () => {
    expect(broken([])).toBe(1)
  })
})
