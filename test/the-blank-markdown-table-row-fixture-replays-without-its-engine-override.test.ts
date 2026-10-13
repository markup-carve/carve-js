import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { run, type CliIO } from '../src/cli.js'

// The spec's `markdown-blank-table-row` importer fixture, replayed the way
// `scripts/migration-evidence-claims.mjs` replays it, against the SHARED
// expectation: CARVE-P11-056 keeps a blank GFM body row, so this engine needs
// no per-engine override for it.

interface Fixture {
  id: string
  sourceFormat: string
  input: string
  expected: {
    output: string
    exit: number
    diagnostics: Array<Record<string, string>>
    engines?: Record<string, unknown>
  }
}

const manifest = JSON.parse(
  readFileSync(new URL('../spec/tests/importer-fidelity/manifest.json', import.meta.url), 'utf8'),
) as { cases: Fixture[] }

describe('the markdown-blank-table-row importer fixture', () => {
  const fixture = manifest.cases.find((row) => row.id === 'markdown-blank-table-row')

  it('exists in the pinned spec', () => {
    expect(fixture).toBeDefined()
  })

  it('replays through carve migrate with the shared expectation', async () => {
    let out = ''
    let err = ''
    const io: CliIO = {
      readStdin: async () => fixture!.input,
      write: (s) => { out += s },
      writeErr: (s) => { err += s },
      readFile: () => { throw new Error('no file') },
      writeFile: () => {},
    }
    const status = await run(['migrate', '--from', fixture!.sourceFormat, '--report', '-', '--check-loss'], io)
    const report = JSON.parse(err) as { diagnostics: Array<Record<string, string>> }
    const diagnostics = report.diagnostics.map(({ code, severity, fidelity, confidence, path }) =>
      ({ code, severity, fidelity, confidence, ...(path ? { path } : {}) }))
    expect(out).toBe(fixture!.expected.output)
    expect(diagnostics).toStrictEqual(fixture!.expected.diagnostics)
    expect(status).toBe(fixture!.expected.exit)
  })
})
