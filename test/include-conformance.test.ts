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
import * as carve from '../src/index.js'
// @ts-expect-error - vendored spec-repo ESM helper, no type declarations.
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
  expected: Record<string, unknown>
}

interface VectorResult {
  html: string
  fmt: string
  warnings: unknown[]
  dependencies: unknown[]
  rawWarningMessages: string[]
  formattedRun?: { html: string; dependencies: unknown[] }
}

const files = readdirSync(vectorDir)
  .filter((f) => f.endsWith('.json'))
  .sort()

describe('include-conformance vectors (spec §19)', () => {
  // A misvendored or empty corpus must fail the gate, not silently pass.
  it('vendors the full vector corpus', () => {
    expect(files.length).toBeGreaterThanOrEqual(94)
  })

  for (const file of files) {
    const vector = JSON.parse(readFileSync(join(vectorDir, file), 'utf8')) as Vector
    it(`${vector.name} [${vector.rules.join(', ')}]`, () => {
      const result = runVector(vector, carve) as VectorResult

      for (const field of EXPECTED_FIELDS as string[]) {
        expect(result[field as keyof VectorResult], `${vector.name}: ${field} mismatch`).toEqual(
          vector.expected[field],
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
