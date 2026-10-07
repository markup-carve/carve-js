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
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  version: string
}

describe('the LIB_VERSION constant', () => {
  it('tracks the package.json version', () => {
    expect(LIB_VERSION).toBe(pkg.version)
  })
})

// carve-js#2562: between releases `main` reads `X.Y.Z-dev`, so a build from a
// commit never claims a release it is not. Only the cut drops the suffix.
describe('the package version', () => {
  const changelog = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8')
  const released = [...changelog.matchAll(/^## \[(\d+\.\d+\.\d+)\]/gm)].map((m) => m[1]!)
  const parts = (v: string): number[] => v.split('.').map(Number)
  const above = (a: string, b: string): boolean => {
    const [x, y] = [parts(a), parts(b)]
    for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i]! > y[i]!
    return false
  }

  it('is a cut release with its own changelog section, or the next version with -dev', () => {
    const m = /^(\d+\.\d+\.\d+)(-dev)?$/.exec(pkg.version)
    expect(m, `unexpected version shape ${pkg.version}`).not.toBeNull()
    const [, base, dev] = m!
    if (dev) {
      expect(released).not.toContain(base)
      expect(above(base!, released[0]!)).toBe(true)
    } else {
      expect(released[0]).toBe(base)
    }
  })
})
