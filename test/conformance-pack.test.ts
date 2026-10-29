import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { carveToCarve, carveToHtml } from '../src/index.js'

/*
 * The spec repository's conformance pack (`resources/conformance-pack/` at the
 * spec pin): generated variants per cause family with the spec model's HTML.
 * A differing case must be declared in conformance-pack-drift.json under the
 * ticket for its cause; a declared case that passes, or that the pack no longer
 * has, fails too. CARVE_CONFORMANCE_PACK=<dir> runs another pack; a spec pin
 * older than the pack skips the test.
 */

const here = dirname(fileURLToPath(import.meta.url))
const packDir = process.env.CARVE_CONFORMANCE_PACK ?? resolve(here, '../spec/resources/conformance-pack')
const atPin = process.env.CARVE_CONFORMANCE_PACK !== undefined || existsSync(join(packDir, 'index.json'))
const read = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'))

interface Family { mode: string, shards: string[] }
interface Case { id: string, source: string, html: string }
interface Entry { ticket: string, cases: string[] }

const declared = new Map<string, string>()
for (const entry of (read(join(here, 'conformance-pack-drift.json')) as { entries: Entry[] }).entries) {
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
          if (html === c.html && ticket !== undefined) fixed.push(`${c.id} (${ticket})`)
        }
      }
    }
    const unknown = [...declared.keys()].filter((id) => !seen.has(id))
    expect({ undeclared, fixed, unknown }, `conformance pack at ${packDir}: fix the engine, or declare the ids under their cause's ticket in test/conformance-pack-drift.json`).toEqual({ undeclared: [], fixed: [], unknown: [] })
  }, 120_000)
})
