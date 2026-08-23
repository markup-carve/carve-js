import { describe, expect, it } from 'vitest'
// @ts-expect-error - a plain .mjs script, imported for its exported comparison
import { compareCorpus } from '../scripts/published-drift.mjs'

/*
 * The drift ratchet's count is a count of what it COMPARED.
 *
 * `scripts/published-drift.mjs` renders the spec corpus through the published
 * engine and through this working tree and holds the number of differing
 * documents under `published-drift.ceiling`. Both renders used to sit inside a
 * `try` whose `catch` skipped the document, so an exception removed it from the
 * compared set and reported nothing.
 *
 * That made the gate unfailable in the one case it most needs to fail. Measured
 * on carve-js#1366, with `carveToHtml` mutated to throw:
 *
 *     published 0.1.4 vs working tree: 0 of 1371 corpus documents differ (1371 threw), ceiling 100
 *     Under the ceiling (0 <= 100).
 *     exit 0
 *
 * Green, under the ceiling, with a completely broken engine - the drift got
 * SMALLER because the working tree got worse.
 *
 * The two sides are not symmetric and are not treated the same way, which is
 * what these assertions pin. A local throw is not a drift measurement at all and
 * aborts the run; a published-only throw is drift of the sharpest kind, because
 * a consumer on that version cannot render the document.
 */

/** An engine stub: renders `pass`, throws on anything in `throwsOn`. */
function engine(render: (source: string) => string, throwsOn: string[] = []) {
  return {
    carveToHtml(source: string): string {
      if (throwsOn.includes(source)) throw new Error(`cannot render ${source}`)
      return render(source)
    },
  }
}

const FILES = ['a.crv', 'b.crv', 'c.crv']
const read = (file: string): string => file

function compare(local: unknown, published: unknown) {
  return compareCorpus({ files: FILES, read, local, published }) as {
    differing: string[]
    localThrew: Array<{ file: string; message: string }>
    publishedThrew: string[]
  }
}

describe('the published-drift comparison', () => {
  it('reports no drift when the two engines agree', () => {
    // The control. Every assertion below passes for a comparison that calls
    // everything different, and this is what such a comparison would break.
    const result = compare(engine((s) => `<p>${s}</p>`), engine((s) => `<p>${s}</p>`))

    expect(result.differing).toEqual([])
    expect(result.localThrew).toEqual([])
    expect(result.publishedThrew).toEqual([])
  })

  it('reports the documents whose rendering actually differs', () => {
    // The other control: the ordinary path still measures what it always did.
    const result = compare(
      engine((s) => (s === 'b.crv' ? 'new' : s)),
      engine((s) => s),
    )

    expect(result.differing).toEqual(['b.crv'])
  })

  it('does not silently drop a document the working tree cannot render', () => {
    // The defect. Under the old shape this document left the compared set and
    // the run reported a SMALLER drift than the truth.
    const result = compare(engine((s) => s, ['b.crv']), engine((s) => s))

    expect(result.localThrew.map((entry) => entry.file)).toEqual(['b.crv'])
  })

  it('names why the working tree could not render it', () => {
    // A caller told only that something was skipped cannot act on it.
    const result = compare(engine((s) => s, ['b.crv']), engine((s) => s))

    expect(result.localThrew[0]!.message).toContain('cannot render b.crv')
  })

  it('does not count a document the working tree could not render as agreement', () => {
    // The specific shape that made the gate green: a broken engine looked like
    // a perfectly aligned one, because both sides of the count were empty.
    const result = compare(engine((s) => s, FILES), engine((s) => 'entirely different'))

    expect(result.differing).toEqual([])
    expect(result.localThrew).toHaveLength(3)
  })

  it('counts a document only the PUBLISHED engine cannot render as drift', () => {
    // The other half. A consumer on that version cannot render the document at
    // all, which is drift rather than something to skip.
    const result = compare(engine((s) => s), engine((s) => s, ['c.crv']))

    expect(result.differing).toEqual(['c.crv'])
    expect(result.publishedThrew).toEqual(['c.crv'])
    expect(result.localThrew).toEqual([])
  })
})
