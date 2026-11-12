/*
 * Every corpus document written from a tree without positions reads back as
 * the same tree: once from `parse(..., { positions: false })` and once from
 * AST JSON with `pos` dropped (pandoc-carve's reverse leg).
 *
 * Rows that do not round-trip yet are listed in the ledger. A new failure fails
 * the test, and so does a listed row that now passes, so the ledger only
 * shrinks. `UPDATE_POSITION_FREE_LEDGER=1` rewrites it.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { carveToAstJson, fromAstJson, parse, renderCarve } from '../src/index.js'
import { expectedCorpusSize } from './helpers/corpus-population.js'

const here = dirname(fileURLToPath(import.meta.url))
const specRoot = resolve(here, '../spec')
const corpusDir = resolve(specRoot, 'tests/corpus')
const ledgerPath = resolve(here, 'fixtures/corpus-position-free-roundtrip-known.txt')

const slugs = readdirSync(corpusDir).filter((name) => name.endsWith('.crv')).map((name) => name.slice(0, -4)).sort()
const tree = (source: string): string =>
  JSON.stringify(carveToAstJson(source), (key, value: unknown) => (key === 'pos' || key === 'srcByteLength') ? undefined : value)
const withoutPositions = (source: string): unknown =>
  JSON.parse(JSON.stringify(carveToAstJson(source), (key, value: unknown) => key === 'pos' ? undefined : value))

const PATHS = {
  native: (source: string) => renderCarve(parse(source, { positions: false })),
  json: (source: string) => renderCarve(fromAstJson(withoutPositions(source))),
} as const

function failing(): string[] {
  const out: string[] = []
  for (const slug of slugs) {
    const source = readFileSync(resolve(corpusDir, `${slug}.crv`), 'utf8')
    const expected = tree(source)
    for (const [path, write] of Object.entries(PATHS)) {
      let same = false
      try { same = tree(write(source)) === expected } catch { /* a throw is a failure */ }
      if (!same) out.push(`${slug} ${path}`)
    }
  }
  return out
}

describe('position-free Carve round trip over the corpus', () => {
  it('reads the whole corpus', () => {
    expect(slugs.length).toBe(expectedCorpusSize(specRoot))
  })

  it('writes every row outside the ledger back to the same tree', () => {
    const now = failing()
    if (process.env.UPDATE_POSITION_FREE_LEDGER === '1') {
      writeFileSync(ledgerPath, `${now.join('\n')}\n`)
      return
    }
    const known = readFileSync(ledgerPath, 'utf8').split('\n').filter((line) => line !== '')
    expect({ newFailures: now.filter((row) => !known.includes(row)), nowPassing: known.filter((row) => !now.includes(row)) })
      .toEqual({ newFailures: [], nowPassing: [] })
  }, 300_000)
})
