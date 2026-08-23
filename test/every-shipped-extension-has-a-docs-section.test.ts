import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as carve from '../src/index.js'

/*
 * `docs/extensions.md` is the only place a reader learns which extensions
 * exist, and it was hand-maintained: `tabs` and `codeGroup` shipped with JSDoc
 * as their only doc home and were found by accident, not by a check
 * (markup-carve/carve-js#1288). carve-rs hit the same thing from the other
 * side - its page claimed four extensions against a registry of far more
 * (markup-carve/carve-rs#1234) - and fixed it by DERIVING the list and gating
 * it rather than trusting the prose to keep up.
 *
 * So this test derives the list too. It does not check that a section is any
 * good; it checks that a shipped extension cannot be invisible. A new extension
 * either gets a `## name` section or an explicit entry below, and adding the
 * entry is a deliberate act with a ticket attached rather than an omission
 * nobody sees.
 */

const docsPath = fileURLToPath(new URL('../docs/extensions.md', import.meta.url))
const srcDir = fileURLToPath(new URL('../src', import.meta.url))

/**
 * The same list read off the SOURCE: every exported declaration annotated
 * `CarveExtension` (or `CarveExtension[]`), intersected with what the package
 * index actually re-exports.
 *
 * It exists to catch what the runtime probe below cannot see. The probe has to
 * CALL a factory to look at what it returns, and a factory with a required
 * option it cannot guess would throw both times and drop out silently - a check
 * that stops detecting the thing it was written for, without going red. The two
 * derivations disagreeing is that failure, made visible.
 */
function declaredExtensionFactories(): string[] {
  const exported = new Set(Object.keys(carve))
  const declaration =
    /export\s+(?:function\s+(\w+)\s*\([^()]*\)|const\s+(\w+)\s*=\s*\([^()]*\))\s*:\s*CarveExtension(?:\[\])?\s*(?:\{|=>)/g
  const names = new Set<string>()
  for (const file of readdirSync(srcDir)) {
    if (!file.endsWith('.ts')) continue
    const source = readFileSync(`${srcDir}/${file}`, 'utf8')
    for (const m of source.matchAll(declaration)) {
      const name = m[1] ?? m[2]
      if (name !== undefined && exported.has(name)) names.add(name)
    }
  }
  return [...names].sort()
}

/**
 * An extension factory: a callable export that returns a `CarveExtension` (or
 * an array of them - `presets()` does). Detected by SHAPE rather than by name,
 * because a name list is the hand-maintained thing this test exists to replace.
 */
function extensionFactories(): string[] {
  const names: string[] = []
  for (const [name, value] of Object.entries(carve)) {
    if (typeof value !== 'function') continue
    let produced: unknown
    try {
      produced = (value as () => unknown)()
    } catch {
      // A factory with a REQUIRED option (`fencedRender`) still has to be seen.
      try {
        produced = (value as (o: unknown) => unknown)({ language: 'probe' })
      } catch {
        // Deliberately NOT skipped quietly: an un-probeable factory is caught
        // by the cross-check against `declaredExtensionFactories()`.
        continue
      }
    }
    const list = Array.isArray(produced) ? produced : [produced]
    if (list.length === 0) continue
    const isExtension = (o: unknown): boolean =>
      typeof o === 'object' &&
      o !== null &&
      !Array.isArray(o) &&
      typeof (o as { name?: unknown }).name === 'string' &&
      Object.keys(o).length > 1
    if (list.every(isExtension)) names.push(name)
  }
  return names.sort()
}

/**
 * Covered by ANOTHER extension's section, in prose and in call form.
 *
 * The `fencedRender` presets are the section's whole subject, and
 * `tocPlacement` only makes sense beside `tableOfContents`. Splitting them out
 * would make the page worse, so the exemption is that the name appears as a
 * call somewhere in the file - a weaker bar than a section, and still a bar.
 */
const COVERED_IN_ANOTHER_SECTION = [
  'abc',
  'chart',
  'd2',
  'graphviz',
  'plantuml',
  'presets',
  'tocPlacement',
  'vegaLite',
  'wavedrom',
]

/**
 * Shipped with no doc home at all. EMPTY, and markup-carve/carve-js#1313 - the
 * ticket that carried the eleven - is closed by emptying it.
 *
 * It stays here rather than being deleted with its last entry, because the
 * assertion below is what makes a NEW undocumented extension fail: an addition
 * here is someone saying out loud that one shipped without a doc home.
 */
const UNDOCUMENTED_KNOWN: string[] = []

describe('every shipped extension has a docs section', () => {
  const docs = readFileSync(docsPath, 'utf8')
  const headings = new Set(
    [...docs.matchAll(/^#{2,3} (.+)$/gm)].map((m) => (m[1] as string).trim()),
  )
  const factories = extensionFactories()

  it('agrees with the same list read off the source declarations', () => {
    // Two independent derivations of one fact. The probe can miss a factory it
    // cannot construct; the source scan can miss one whose annotation is
    // inferred rather than written. Either miss shows up here as a difference,
    // which is the point - a silent skip would leave the coverage assertion
    // below quietly weaker than it reads.
    expect(factories).toEqual(declaredExtensionFactories())
  })

  it('finds the extensions by shape, not by a hand-written name list', () => {
    // A floor, not the exact count: the point is that the derivation works at
    // all, so a refactor that stops producing extension-shaped objects (and
    // would make every other assertion here vacuous) goes red.
    expect(factories.length).toBeGreaterThan(20)
    expect(factories).toContain('tabs')
    expect(factories).toContain('codeGroup')
  })

  it('gives each one a section, a host section, or a tracked exemption', () => {
    const stranded = factories.filter(
      (name) =>
        !headings.has(name) &&
        !COVERED_IN_ANOTHER_SECTION.includes(name) &&
        !UNDOCUMENTED_KNOWN.includes(name),
    )
    expect(stranded).toEqual([])
  })

  it('keeps the two lists honest - an entry that stops applying is removed', () => {
    // An allowlist nobody prunes is how the page drifted in the first place.
    const gone = [...COVERED_IN_ANOTHER_SECTION, ...UNDOCUMENTED_KNOWN].filter(
      (name) => !factories.includes(name),
    )
    expect(gone).toEqual([])
    // A name on the undocumented list that HAS grown a section is done: delete
    // it from the list in the same PR that writes the section.
    const nowDocumented = UNDOCUMENTED_KNOWN.filter((name) => headings.has(name))
    expect(nowDocumented).toEqual([])
    // And a name claimed as covered elsewhere must really appear in call form.
    const notActuallyCovered = COVERED_IN_ANOTHER_SECTION.filter(
      (name) => !new RegExp(`\\b${name}\\(`).test(docs),
    )
    expect(notActuallyCovered).toEqual([])
  })

  it('documents tabs and codeGroup, the pair that started this', () => {
    expect(headings.has('tabs')).toBe(true)
    expect(headings.has('codeGroup')).toBe(true)
  })
})
