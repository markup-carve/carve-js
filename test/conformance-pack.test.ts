import { describe, expect, it } from 'vitest'
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { carveToCarve, carveToHtml } from '../src/index.js'

/*
 * The spec repository's conformance pack (`resources/conformance-pack/` at the
 * spec pin): generated variants per cause family with the spec model's HTML.
 * A differing case must be declared in conformance-pack-drift.json under the
 * ticket for its cause, in the PR that introduces the difference. A declared
 * case that passes, or that the pack no longer has, is stale: it is reported,
 * not failed, and `.github/workflows/ledger-refresh.yml` prunes it after the
 * merge (PRUNE_PACK_DRIFT=1). CARVE_CONFORMANCE_PACK=<dir> runs another pack; a
 * spec pin older than the pack skips the test.
 */

const here = dirname(fileURLToPath(import.meta.url))
const packDir = process.env.CARVE_CONFORMANCE_PACK ?? resolve(here, '../spec/resources/conformance-pack')
const atPin = process.env.CARVE_CONFORMANCE_PACK !== undefined || existsSync(join(packDir, 'index.json'))
const read = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'))

interface Family { mode: string, shards: string[] }
interface Case { id: string, source: string, html: string }
interface Entry { ticket: string, cases: string[] }

const driftPath = join(here, 'conformance-pack-drift.json')
const drift = read(driftPath) as { entries: Entry[] }
const declared = new Map<string, string>()
for (const entry of drift.entries) {
  for (const id of entry.cases) {
    if (declared.has(id)) throw new Error(`${id} is declared twice`)
    declared.set(id, entry.ticket)
  }
}

describe('conformance pack', () => {
  it.skipIf(!atPin)('renders every case as the spec model, or declares it', () => {
    const index = read(join(packDir, 'index.json')) as { families: Record<string, Family> }
    const seen = new Set<string>()
    const undeclared: string[] = []
    const fixed: string[] = []
    const fixedIds: string[] = []
    for (const [family, spec] of Object.entries(index.families)) {
      for (const shard of spec.shards) {
        for (const c of read(join(packDir, shard)) as Case[]) {
          seen.add(c.id)
          let html: string
          try {
            html = carveToHtml(spec.mode === 'roundtrip' ? carveToCarve(c.source) : c.source).trim()
          } catch (e) {
            html = `ERROR: ${String(e)}`
          }
          const ticket = declared.get(c.id)
          if (html !== c.html && ticket === undefined) undeclared.push(`${c.id} (${family})`)
          if (html === c.html && ticket !== undefined) {
            fixed.push(`${c.id} (${ticket})`)
            fixedIds.push(c.id)
          }
        }
      }
    }
    const unknown = [...declared.keys()].filter((id) => !seen.has(id))
    const stale = [...fixed, ...unknown.map((id) => `${id} (${declared.get(id)}, not in the pack)`)]
    // Pruning against another pack would drop ids that pack merely lacks.
    if (process.env.PRUNE_PACK_DRIFT === '1' && process.env.CARVE_CONFORMANCE_PACK === undefined) {
      const gone = new Set([...fixedIds, ...unknown])
      drift.entries = drift.entries
        .map((entry) => ({ ...entry, cases: entry.cases.filter((id) => !gone.has(id)) }))
        .filter((entry) => entry.cases.length > 0)
      writeFileSync(driftPath, `${JSON.stringify(drift, null, 2)}\n`)
      console.info(`Pruned ${gone.size} stale declaration(s):\n${stale.join('\n')}`)
    } else if (stale.length > 0) {
      const text = [
        '### carve-js conformance pack drift (informational)',
        '',
        `${stale.length} declaration(s) in test/conformance-pack-drift.json are stale. ` +
          'Do not remove them in a PR: `ledger-refresh.yml` prunes them after the merge.',
        '',
        '```',
        ...stale,
        '```',
        '',
      ].join('\n')
      console.info(text)
      if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text)
    }
    expect(undeclared, `conformance pack at ${packDir}: fix the engine, or declare the ids under their cause's ticket in test/conformance-pack-drift.json`).toEqual([])
  }, 120_000)
})
