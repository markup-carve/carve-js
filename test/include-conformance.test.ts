/*
 * Include-conformance GATE (Phase 2, carve-js runner).
 *
 * Reads every vendored golden vector under
 * spec/tests/include-conformance/vectors/ and re-runs it through carve-js's
 * own public API (parse + expandIncludes + renderHtml + renderCarve), then
 * asserts all FOUR goldens (html, fmt, warnings, dependencies) plus the I7
 * no-leak guard and the I12 expand-of-formatted equivalence property.
 *
 * The driver + normalization live in the spec repo's shared library
 * (spec/scripts/include-conformance-lib.mjs), which the golden generator also
 * uses, so "run a vector" is defined in exactly one place and cannot drift.
 * This runner only feeds it carve-js's real module and asserts — it does NOT
 * reimplement the include logic or the normalization contract.
 *
 * Unlike the spec repo's Phase-1 proof runner (which loads a *built* carve-js
 * via CARVE_JS), this one imports the library source directly, so it needs no
 * build and runs as part of `npm test` — the CI gate. See the suite README:
 * spec/tests/include-conformance/README.md.
 *
 * NOTE: the vendored `spec` submodule is currently pinned to an unmerged carve
 * branch (PR #301, test/include-conformance-suite, based on
 * spec/includes-section-19). The gitlink moves to carve `main` once carve
 * #291 + #301 merge; nothing here changes when it does.
 */

import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as carveApi from '../src/index.js'
import { fileSystemResolver } from '../src/includes-fs.js'

// The shared runner reads `fileSystemResolver` off the module namespace.
// It is not on this package's main entry - it needs `node:fs`, and that
// entry is bundled for the browser verbatim - so the Node-only resolver is
// handed over alongside rather than exported into a bundle that cannot
// have it.
const carve = { ...carveApi, fileSystemResolver }
import { runVector, EXPECTED_FIELDS } from '../spec/scripts/include-conformance-lib.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const vectorDir = resolve(__dirname, '../spec/tests/include-conformance/vectors')

if (!existsSync(vectorDir)) {
  throw new Error(
    `Include-conformance vectors not found at ${vectorDir}.\n` +
      `Did you initialize the submodule?\n` +
      `  git submodule update --init --recursive`,
  )
}

interface Vector {
  name: string
  rules: string[]
  forbiddenSubstrings?: string[]
  checkFmtExpandEquivalence?: boolean
  checkCarveTarget?: boolean
  checkFlattened?: boolean
  mode?: string
  entry?: string
  files?: Record<string, string>
  options?: Record<string, unknown>
  expected: Record<string, unknown>
}

interface VectorResult {
  html: string
  fmt: string
  flattened?: string
  warnings: unknown[]
  dependencies: unknown[]
  rawWarningMessages: string[]
  formattedRun?: { html: string; dependencies: unknown[] }
}

const files = readdirSync(vectorDir)
  .filter((f) => f.endsWith('.json'))
  .sort()

/**
 * Vector goldens the PINNED spec has not regenerated yet.
 *
 * CARVE-P12-064 (markup-carve/carve#2616) made `code_block.content` literal
 * payload text: a fence that runs out at EOF keeps whether its last line had a
 * break and must not invent one. The i04 golden was generated before that
 * ruling, so it still spells the invented break for a child fragment ending
 * mid-line. Entry goes out with the pin that regenerates it
 * (markup-carve/carve#2623).
 *
 * DECLARED, NEVER TOLERATED: an entry whose vector already matches its own
 * golden fails too, so a stale line cannot outlive the fix as slack.
 */
const AHEAD_OF_PIN = new Map<string, { field: string; value: string; reason: string }>([
  [
    'i04-fragment-containment-unclosed-fence',
    {
      field: 'html',
      value: '<p>Before.</p>\n<pre><code class="language-js">let x = 1;</code></pre>\n<p>After.</p>',
      reason: 'CARVE-P12-064: the child fragment ends mid-line, so its payload keeps no final break',
    },
  ],
])

describe('include-conformance vectors (spec §19)', () => {
  // A misvendored or empty corpus must fail the gate, not silently pass.
  it('vendors the full vector corpus', () => {
    expect(files.length).toBeGreaterThanOrEqual(94)
  })

  it('declares only vectors that exist and still drift', () => {
    const names = new Set(files.map((file) => (JSON.parse(readFileSync(join(vectorDir, file), 'utf8')) as Vector).name))
    for (const name of AHEAD_OF_PIN.keys()) expect(names, `${name} is declared but not vendored`).toContain(name)
  })

  for (const file of files) {
    const vector = JSON.parse(readFileSync(join(vectorDir, file), 'utf8')) as Vector
    const ahead = AHEAD_OF_PIN.get(vector.name)
    it(`${vector.name} [${vector.rules.join(', ')}]${ahead ? ` AHEAD OF PIN: ${ahead.reason}` : ''}`, () => {
      const result = runVector(vector, carve) as VectorResult

      if (ahead) {
        expect(vector.expected[ahead.field], `${vector.name}: golden already regenerated - delete its entry`)
          .not.toEqual(ahead.value)
      }
      for (const field of EXPECTED_FIELDS as string[]) {
        expect(result[field as keyof VectorResult], `${vector.name}: ${field} mismatch`).toEqual(
          ahead && ahead.field === field ? ahead.value : vector.expected[field],
        )
      }

      // I7: no forbidden substring (a raw resolver error, an absolute path)
      // may reach any warning message.
      for (const forbidden of vector.forbiddenSubstrings ?? []) {
        for (const message of result.rawWarningMessages) {
          expect(
            message.includes(forbidden),
            `${vector.name}: warning message leaked ${JSON.stringify(forbidden)} (I7)`,
          ).toBe(false)
        }
      }

      // The EXPANDED document through the writer, which is what `carve flatten`
      // emits. The html golden cannot see the assembled tree's shape, since
      // footnotes are collected globally at render time either way.
      if (vector.checkFlattened) {
        expect(result.flattened, `${vector.name}: flattened mismatch`).toBe(
          vector.expected.flattened,
        )
      }

      /*
       * I15, and deliberately NOT read off the shared runner's result.
       *
       * The runner is carve-js driving carve-js, so a `carveTarget` it computed
       * would grade this engine against the spec repo's copy of the rule rather
       * than against this engine's own. What has to be exercised is the code
       * the CLI runs, which is why `expandsForTarget` is exported from the
       * library: flip it, and this vector fails here as well as in the CLI
       * tests.
       */
      if (vector.checkCarveTarget) {
        expect(vector.mode, `${vector.name}: carveTarget needs a virtual vector`).toBe('virtual')
        const resolver = (p: string) => {
          const source = vector.files?.[p]
          return source === undefined ? null : { source, id: p }
        }
        const entry = vector.entry!
        const doc = carveApi.parse(entry, { positions: true })
        // The pipeline decision, spelled the way the CLI spells it.
        const forCarve = carveApi.expandsForTarget('carve')
          ? carveApi.expandIncludes(doc, entry, { resolve: resolver }).doc
          : doc
        expect(
          carveApi.renderCarve(forCarve),
          `${vector.name}: the carve target expanded (I15)`,
        ).toBe(vector.expected.carveTarget)
      }

      // I12 stronger invariant: expanding the formatted document matches.
      if (vector.checkFmtExpandEquivalence) {
        expect(result.formattedRun, `${vector.name}: expected a formatted run`).toBeTruthy()
        expect(result.formattedRun!.html, `${vector.name}: fmt-expand html drift`).toBe(result.html)
        expect(
          result.formattedRun!.dependencies,
          `${vector.name}: fmt-expand dependency drift`,
        ).toEqual(result.dependencies)
      }
    })
  }
})
