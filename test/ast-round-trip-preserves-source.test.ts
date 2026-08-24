/*
 * A document that goes through the published AST and back must come out as the
 * SAME SOURCE, not merely as the same HTML (carve-js#738).
 *
 * The HTML check cannot see this class of change. `to_html(fmt(x)) == to_html(x)`
 * (PART 11 §1) holds while the writer adds an attribute line the author never
 * typed, because the attribute it adds is the id the renderer was going to emit
 * anyway. So the invariant stays true and the author's document is still
 * rewritten.
 *
 * The live example: `resolveHeadingIds` stamps a generated id into the tree and
 * `toAstJson` publishes it, which PART 12 §5 asks for. On the wire the only
 * thing separating a generated id from an authored one is the absence of the
 * `#id` slot in `attrs.order` - and `order` is also absent on a
 * programmatically built tree, so ingest cannot tell them apart and treats the
 * id as authored. `# Notes` twice comes back as `{#Notes}` / `# Notes` and
 * `{#Notes-2}` / `# Notes`.
 *
 * carve-php has this assertion (`AstCodecTest::testEveryCorpusDocumentEncodes
 * IdenticallyAfterARoundTrip`) and it is why the same change is caught there and
 * not here. The spec question - whether the wire should mark a generated id, or
 * ingest should treat it as authored deliberately - is markup-carve/carve#814.
 * This test does not take a side: it fails while source is lost, whatever the
 * eventual answer, and the documents it currently names are listed so the gap is
 * visible rather than silent.
 */

import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse, carveToAstJson, fromAstJson } from '../src/index.js'
import { renderCarve } from '../src/render-carve.js'
import { expectedCorpusSize } from './helpers/corpus-population.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const corpusDir = resolve(__dirname, '../spec/tests/corpus')

/**
 * Documents whose source is NOT preserved through the AST today.
 *
 * A RATCHET, not a verdict. Each entry is a document where writing the resolved
 * tree back differs from writing the parsed tree back - which is what an editor
 * does when it round-trips through the published AST.
 *
 * WAS 41, THEN 2, NOW 0.
 *
 * The 39 generated-heading-id documents went first: publishing the id is right
 * (PART 12 §5), and 7f86472 stopped the WRITER emitting it, because an authored
 * id carries its `#id` slot in `attrs.order` and a generated one does not.
 * carve-php#901 established that mechanism.
 *
 * The last four went WITHOUT ANYONE NOTICING, and that is the reason the guard
 * below exists. Two named nested-link flattening (markup-carve/carve#817) and
 * two named a definition-list `definitionLines` side table that does not cross
 * the wire (carve-js#748, carve-js#754). Re-measured on the pinned corpus,
 * every one of the four round-tripped byte-identically - the set could have
 * been emptied at whatever commit fixed them, and instead it sat here reading
 * as a live, reasoned carve-out (markup-carve/carve-js#1447).
 *
 * Nothing could have said so. The sweep consulted this set in ONE direction: a
 * document that STOPS losing was silently excused, because `has(name)` only
 * ever suppressed a failure and never demanded one. Deleting the four rows
 * makes the ledger honest today; `still loses what it says it loses` below is
 * what stops the same finding recurring the next time a document is renumbered
 * or a writer fix lands quietly.
 *
 * The value is the boundary: a document joining this list means a change
 * started losing source that did not before, and a document LEAVING it without
 * its entry going too is the failure this file could not previously report.
 */
const KNOWN_LOSSES = new Set<string>([])

/*
 * A KNOWN LOSS THAT NAMES NO CORPUS FILE IS NOT A KNOWN LOSS.
 *
 * The sweep below only consults this set for a document it actually walked, so
 * an entry naming a file the corpus no longer has excuses nothing and still
 * reads as a live, reasoned carve-out. Corpus files carry the spec's ordering
 * number, which shifts whenever a section is inserted upstream, so an entry
 * here goes stale without anything in the diff saying so. Same guard shape as
 * AHEAD_OF_PIN in `test/corpus.test.ts`.
 */
describe('KNOWN_LOSSES', () => {
  it('names only corpus files that exist', () => {
    const files = new Set(existsSync(corpusDir) ? readdirSync(corpusDir) : [])
    const orphaned = [...KNOWN_LOSSES].filter((name) => !files.has(name)).sort()
    expect(
      orphaned,
      'renumbered upstream, or already retired - either way the entry excuses nothing',
    ).toEqual([])
  })
})

describe('a document round-tripped through the AST', () => {
  const sources = existsSync(corpusDir)
    ? readdirSync(corpusDir).filter((f) => f.endsWith('.crv'))
    : []

  it('finds the corpus', () => {
    expect(sources.length).toBe(expectedCorpusSize(resolve(__dirname, '../spec')))
  })

  /**
   * ONE PASS, THREE BUCKETS. The pass is shared so the two directions are
   * measured over the SAME run: a forward half and a staleness half computed
   * from different sweeps could disagree about what the corpus even is.
   */
  const sweep = () => {
    const lost: string[] = []
    const recovered: string[] = []
    const refused: string[] = []
    for (const name of sources) {
      const src = readFileSync(resolve(corpusDir, name), 'utf8')
      let written: string
      try {
        // `carveToAstJson`, NOT `toAstJson(parse(src))`: the ids this is about
        // are stamped during RESOLVE, and the second form never resolves - so a
        // test written that way passes while the defect it names is live.
        const back = fromAstJson(carveToAstJson(src))
        written = renderCarve(back)
      } catch {
        // A document the codec refuses is a different failure, and the codec's
        // own tests cover it; this assertion is about silent CHANGE, not about
        // errors.
        //
        // A DECLARED document is the exception, and it is reported on its own
        // rather than folded into either direction. It is not "still losing" -
        // nothing was compared - and calling it "recovered" would tell whoever
        // deletes the entry something false about why. Its entry no longer
        // describes what happens to it, which is its own finding.
        if (KNOWN_LOSSES.has(name)) refused.push(name)
        continue
      }
      // Compared against the formatter's own output for the same document, not
      // against the raw source: `fmt` legitimately normalizes spelling, and what
      // this test is about is whether the AST ROUND TRIP changes anything the
      // formatter would not have changed by itself.
      const direct = renderCarve(parse(src))
      const loses = written !== direct
      if (loses && !KNOWN_LOSSES.has(name)) lost.push(name)
      // THE STALENESS HALF. Without it `has(name)` can only ever suppress a
      // failure, so an entry outlives the loss it names and no run objects -
      // which is exactly how the four this file used to carry survived.
      if (!loses && KNOWN_LOSSES.has(name)) recovered.push(name)
    }
    return { lost, recovered, refused }
  }

  it('comes back as the same source', () => {
    const { lost } = sweep()
    expect(lost, `documents whose source changed through the AST: ${lost.join(', ')}`).toEqual([])
  })

  it('still loses what it says it loses', () => {
    const { recovered, refused } = sweep()
    expect(
      recovered,
      `${recovered.join(', ')} round-trip(s) byte-identically now: delete the KNOWN_LOSSES entry in the same commit that proves it`,
    ).toEqual([])
    expect(
      refused,
      `${refused.join(', ')} is declared a known loss but the codec now refuses it, so the entry describes something that no longer happens`,
    ).toEqual([])
  })
})
