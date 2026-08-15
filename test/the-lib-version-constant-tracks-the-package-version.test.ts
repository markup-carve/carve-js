import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { LIB_VERSION } from '../src/index.js'

/**
 * `LIB_VERSION` is a hand-maintained constant with a "keep in sync with
 * package.json on release" comment - and the sync was missed: 0.1.1 through
 * 0.1.3 all shipped reporting `0.1.0`, so the `carve fmt --stamp` provenance
 * stamp and every downstream embedder reading the export named a release that
 * was not the one running. A comment cannot fail CI; this test can.
 */
describe('the LIB_VERSION constant', () => {
  it('tracks the package.json version', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      version: string
    }
    expect(LIB_VERSION).toBe(pkg.version)
  })
})
